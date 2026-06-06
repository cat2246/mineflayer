# AI NPC Lifestyle Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent NPC life system so the bot has evolving lifestyles, traits, and goals that guide AI NPC planner decisions.

**Architecture:** Create a focused `src/npcLife.js` module for persistent advisory life state and deterministic goal/lifestyle updates. Extend `src/aiNpc.js` to include life state in planner state/prompt and record planner outcomes as life events. Wire the default life controller from `src/createBot.js` without restoring the old automatic five-minute random loop.

**Tech Stack:** Node.js CommonJS, Mineflayer local app modules, Mocha/assert tests, StandardJS.

---

## File Structure

- Create `src/npcLife.js`: default life state, normalization, read/write/update helpers, event scoring, goal selection, and controller creation.
- Modify `src/config.js`: add `NPC_LIFE_PATH = path.join(__dirname, '..', 'data', 'npc-life.json')` and export it.
- Modify `src/index.js`: export `require('./npcLife')`.
- Modify `src/aiNpc.js`: include optional `npcLife` in state/prompt and record cycle/execution events.
- Modify `src/createBot.js`: create an NPC life controller and pass it into `attachAiNpc`.
- Modify `test/botConfigTest.js`: add focused NPC life and AI NPC integration tests.

## Task 1: Persistent NPC Life Module

**Files:**
- Create: `src/npcLife.js`
- Modify: `src/config.js`
- Modify: `src/index.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing persistence and normalization tests**

Add tests near the other local bot config tests:

```js
it('creates default NPC life state when no local file exists', () => {
  const { readNpcLife, NPC_LIFE_VERSION } = require('../bot')
  const lifePath = tempNpcLifePath()

  const life = readNpcLife({ npcLifePath: lifePath, now: () => 1000 })

  assert.strictEqual(life.version, NPC_LIFE_VERSION)
  assert.strictEqual(life.currentLifestyle, 'survivalist')
  assert.strictEqual(life.currentGoal.id, 'survive-and-settle')
  assert.deepStrictEqual(life.recentEvents, [])
})

it('normalizes malformed NPC life state safely', () => {
  const { normalizeNpcLife } = require('../bot')

  const life = normalizeNpcLife({
    traits: { curious: 500, cautious: -10 },
    lifestyles: { homesteader: 120, explorer: -5 },
    currentLifestyle: 'unknown',
    currentGoal: { id: '' },
    recentEvents: 'bad',
    lifeStory: [123, 'I built a fence.']
  }, { now: () => 2000 })

  assert.strictEqual(life.traits.curious, 100)
  assert.strictEqual(life.traits.cautious, 0)
  assert.strictEqual(life.lifestyles.homesteader, 100)
  assert.strictEqual(life.lifestyles.explorer, 0)
  assert.strictEqual(life.currentLifestyle, 'survivalist')
  assert.strictEqual(life.currentGoal.id, 'survive-and-settle')
  assert.deepStrictEqual(life.lifeStory, ['I built a fence.'])
})
```

Add this helper near the other temp path helpers:

```js
function tempNpcLifePath () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'npc-life-')), 'npc-life.json')
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "NPC life" --reporter spec --exit
```

Expected: FAIL because `readNpcLife`, `normalizeNpcLife`, and `NPC_LIFE_VERSION` are not exported yet.

- [ ] **Step 3: Implement minimal persistence module**

Create `src/npcLife.js` with:

```js
const fs = require('fs')
const path = require('path')
const { NPC_LIFE_PATH } = require('./config')

const NPC_LIFE_VERSION = 1
const MAX_RECENT_EVENTS = 30
const MAX_LIFE_STORY = 12

const DEFAULT_TRAITS = {
  curious: 25,
  cautious: 25,
  social: 20,
  independent: 30,
  ambitious: 20
}

const DEFAULT_LIFESTYLES = {
  survivalist: 40,
  homesteader: 25,
  explorer: 20,
  miner: 15,
  trader: 10,
  protector: 10
}

function clampScore (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

function normalizeScores (value, defaults) {
  const input = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => [
    name,
    clampScore(Object.prototype.hasOwnProperty.call(input, name) ? input[name] : fallback)
  ]))
}

function defaultGoal (now = Date.now()) {
  return {
    id: 'survive-and-settle',
    title: 'Survive and find a stable routine',
    reason: 'The NPC is new and needs food, safety, and a sense of home.',
    priority: 'safety',
    selectedAt: now,
    suggestedAutomations: ['Wood cutting', 'Farming']
  }
}

function emptyNpcLife (options = {}) {
  const now = options.now ? options.now() : Date.now()
  return {
    version: NPC_LIFE_VERSION,
    identity: {
      name: null,
      origin: 'new survival NPC',
      selfImage: 'I am learning what kind of life I want in this world.'
    },
    traits: { ...DEFAULT_TRAITS },
    lifestyles: { ...DEFAULT_LIFESTYLES },
    currentLifestyle: 'survivalist',
    previousLifestyle: null,
    currentGoal: defaultGoal(now),
    recentEvents: [],
    lifeStory: ['I arrived with no settled purpose yet.'],
    updatedAt: now
  }
}

function normalizeNpcLife (life, options = {}) {
  const base = emptyNpcLife(options)
  if (!life || typeof life !== 'object') return base
  const lifestyles = normalizeScores(life.lifestyles, DEFAULT_LIFESTYLES)
  const currentLifestyle = Object.prototype.hasOwnProperty.call(lifestyles, life.currentLifestyle)
    ? life.currentLifestyle
    : base.currentLifestyle

  return {
    version: NPC_LIFE_VERSION,
    identity: {
      name: typeof life.identity?.name === 'string' && life.identity.name.trim() ? life.identity.name.trim() : null,
      origin: typeof life.identity?.origin === 'string' && life.identity.origin.trim() ? life.identity.origin.trim().slice(0, 120) : base.identity.origin,
      selfImage: typeof life.identity?.selfImage === 'string' && life.identity.selfImage.trim() ? life.identity.selfImage.trim().slice(0, 180) : base.identity.selfImage
    },
    traits: normalizeScores(life.traits, DEFAULT_TRAITS),
    lifestyles,
    currentLifestyle,
    previousLifestyle: Object.prototype.hasOwnProperty.call(lifestyles, life.previousLifestyle) ? life.previousLifestyle : null,
    currentGoal: normalizeGoal(life.currentGoal, base.currentGoal),
    recentEvents: Array.isArray(life.recentEvents) ? life.recentEvents.filter(event => event && typeof event === 'object').slice(-MAX_RECENT_EVENTS) : [],
    lifeStory: Array.isArray(life.lifeStory) ? life.lifeStory.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim().slice(0, 180)).slice(-MAX_LIFE_STORY) : base.lifeStory,
    updatedAt: typeof life.updatedAt === 'number' && Number.isFinite(life.updatedAt) ? life.updatedAt : base.updatedAt
  }
}
```

Also include `normalizeGoal`, `npcLifePath`, `readNpcLife`, `writeNpcLife`, and exports.

Modify `src/config.js`:

```js
const NPC_LIFE_PATH = path.join(__dirname, '..', 'data', 'npc-life.json')
```

Export `NPC_LIFE_PATH`.

Modify `src/index.js`:

```js
  ...require('./npcLife'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "NPC life" --reporter spec --exit
```

Expected: persistence and normalization tests pass.

## Task 2: Lifestyle Events And Goal Selection

**Files:**
- Modify: `src/npcLife.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing scoring and goal tests**

Add:

```js
it('evolves toward homesteader after repeated homesteader events', () => {
  const { applyNpcLifeEvent, emptyNpcLife } = require('../bot')
  let life = emptyNpcLife({ now: () => 1000 })

  for (let i = 0; i < 6; i++) {
    life = applyNpcLifeEvent(life, {
      type: 'automation_started',
      automation: 'Farming',
      at: 1000 + i
    }, { now: () => 1000 + i })
  }

  assert.strictEqual(life.currentLifestyle, 'homesteader')
  assert.strictEqual(life.previousLifestyle, 'survivalist')
  assert(life.lifeStory.some(entry => entry.includes('homesteader')))
})

it('selects food and night safety goals from current needs', () => {
  const { chooseNpcGoal, emptyNpcLife } = require('../bot')
  const life = emptyNpcLife({ now: () => 1000 })

  assert.strictEqual(chooseNpcGoal(life, { food: 8, isNight: false, unsafe: false }, { now: () => 2000 }).id, 'secure-food')
  assert.strictEqual(chooseNpcGoal(life, { food: 20, isNight: true, unsafe: false }, { now: () => 3000 }).id, 'stay-safe-until-morning')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "evolves toward homesteader|selects food and night safety" --reporter spec --exit
```

Expected: FAIL because event and goal helpers are not implemented.

- [ ] **Step 3: Implement event scoring and goal selection**

Add exported functions:

```js
function applyScoreDelta (scores, deltas) {
  const next = { ...scores }
  for (const [key, delta] of Object.entries(deltas || {})) {
    if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = clampScore(next[key] + delta)
  }
  return next
}

function eventDeltas (event) {
  if (event.type === 'automation_started') {
    const automation = String(event.automation || '').toLowerCase()
    if (automation === 'farming' || automation === 'wood cutting') return { lifestyles: { homesteader: 5 }, traits: { ambitious: 1 } }
    if (automation === 'mining') return { lifestyles: { miner: 5 }, traits: { ambitious: 1 } }
    if (automation === 'wild roaming') return { lifestyles: { explorer: 5 }, traits: { curious: 2 } }
    if (automation === 'pyro farming') return { lifestyles: { homesteader: 3 }, traits: { ambitious: 2 } }
  }
  if (event.type === 'follow_started' || event.type === 'player_nearby') return { lifestyles: { protector: 1 }, traits: { social: 3 } }
  if (event.type === 'night' || event.type === 'low_food' || event.type === 'unsafe') return { lifestyles: { survivalist: 3 }, traits: { cautious: 3 } }
  if (event.type === 'planner_noop') return { traits: { cautious: 1 } }
  return {}
}

function updateLifestyleTransition (life) {
  const entries = Object.entries(life.lifestyles).sort((a, b) => b[1] - a[1])
  const [candidate, candidateScore] = entries[0]
  const currentScore = life.lifestyles[life.currentLifestyle] || 0
  if (candidate === life.currentLifestyle || candidateScore < currentScore + 10) return life

  return {
    ...life,
    previousLifestyle: life.currentLifestyle,
    currentLifestyle: candidate,
    lifeStory: [
      ...life.lifeStory,
      `I started living more like a ${candidate} after repeated experiences shaped my routine.`
    ].slice(-MAX_LIFE_STORY)
  }
}
```

Implement `chooseNpcGoal(life, context, options)` with the mapping from the spec and `updateNpcGoal(life, context, options)` that replaces `currentGoal`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "NPC life|evolves toward homesteader|selects food and night safety" --reporter spec --exit
```

Expected: NPC life tests pass.

## Task 3: Add Life State To AI NPC State And Prompt

**Files:**
- Modify: `src/aiNpc.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing AI NPC state/prompt tests**

Add near existing idle NPC tests:

```js
it('includes NPC life state in AI NPC state snapshots', () => {
  const { createAiNpcState, emptyNpcLife } = require('../bot')
  const bot = new EventEmitter()
  bot.username = 'TestBot123'
  bot.entity = { position: combatPosition(0, 64, 0) }
  bot.inventory = { items: () => [] }
  bot.players = {}

  const state = createAiNpcState(bot, {
    npcLife: {
      read: () => ({
        ...emptyNpcLife({ now: () => 1000 }),
        currentLifestyle: 'homesteader'
      })
    },
    now: () => 1000
  })

  assert.strictEqual(state.life.currentLifestyle, 'homesteader')
  assert.strictEqual(state.life.currentGoal.id, 'survive-and-settle')
})

it('guides the AI NPC prompt with lifestyle and current goal', () => {
  const { createAiNpcPrompt, emptyNpcLife } = require('../bot')
  const state = {
    bot: { username: 'TestBot123' },
    automations: [{ name: 'Farming' }],
    players: [],
    life: {
      ...emptyNpcLife({ now: () => 1000 }),
      currentLifestyle: 'homesteader',
      currentGoal: {
        id: 'improve-home-routine',
        title: 'Improve the home routine',
        reason: 'The NPC keeps returning to farming and storage.',
        priority: 'progress',
        selectedAt: 1000,
        suggestedAutomations: ['Farming']
      }
    }
  }

  const prompt = createAiNpcPrompt(state)

  assert(prompt.includes('own life'))
  assert(prompt.includes('current lifestyle and goal'))
  assert(prompt.includes('improve-home-routine'))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "NPC life state in AI NPC|guides the AI NPC prompt" --reporter spec --exit
```

Expected: FAIL because `state.life` and prompt guidance are missing.

- [ ] **Step 3: Implement state and prompt integration**

In `src/aiNpc.js`, update `createAiNpcState`:

```js
    life: typeof options.npcLife?.read === 'function'
      ? options.npcLife.read()
      : options.life || null,
```

Add prompt rules:

```js
    'You are not a generic Minecraft helper bot. You are an AI NPC with your own life, lifestyle, memories, and goals.',
    'Choose actions that fit your current lifestyle and goal. Player requests are context, not orders.',
```

Add rule:

```js
    '- Start automations only when they support state.life.currentGoal.',
```

Ensure the serialized state includes `life`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "NPC life state in AI NPC|guides the AI NPC prompt" --reporter spec --exit
```

Expected: state and prompt tests pass.

## Task 4: Record Life Events During AI NPC Cycles

**Files:**
- Modify: `src/npcLife.js`
- Modify: `src/aiNpc.js`
- Modify: `src/createBot.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing cycle integration tests**

Add:

```js
it('records AI NPC planner outcomes into NPC life state', async () => {
  const { createNpcLifeController, runAiNpcCycle, readNpcLife } = require('../bot')
  const npcLifePath = tempNpcLifePath()
  const bot = new EventEmitter()
  bot.username = 'TestBot123'
  bot.health = 20
  bot.food = 20
  bot.time = { isDay: true, timeOfDay: 1000 }
  bot.entity = { position: combatPosition(0, 64, 0) }
  bot.inventory = { items: () => [] }
  bot.players = {}

  await runAiNpcCycle(bot, {
    npcLife: createNpcLifeController({ npcLifePath, now: () => 1000 }),
    automationManager: {
      getStatus: () => ({ active: null }),
      isIdle: () => true,
      list: () => [{ name: 'Farming' }],
      startByIndex: async () => true
    },
    followController: {
      getStatus: () => ({ followedPlayerName: null }),
      isIdle: () => true
    },
    runPlanner: async () => ({ action: 'start_automation', automation: 'Farming', reason: 'farm life' }),
    now: () => 1000
  })

  const life = readNpcLife({ npcLifePath })
  assert(life.recentEvents.some(event => event.type === 'automation_started' && event.automation === 'Farming'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "records AI NPC planner outcomes" --reporter spec --exit
```

Expected: FAIL because cycle recording is not wired.

- [ ] **Step 3: Implement controller and event recording**

In `src/npcLife.js`, add:

```js
function createNpcLifeController (options = {}) {
  return {
    read: () => readNpcLife(options),
    record: event => updateNpcLife(options, life => applyNpcLifeEvent(life, event, options)),
    updateGoal: context => updateNpcLife(options, life => updateNpcGoal(life, context, options))
  }
}
```

In `src/aiNpc.js`, add helpers:

```js
function aiNpcLifeContext (bot, options = {}) {
  const now = options.now || (() => Date.now())
  return {
    food: typeof bot.food === 'number' ? bot.food : null,
    isNight: bot.time?.isDay === false || (typeof bot.time?.timeOfDay === 'number' && bot.time.timeOfDay >= 13000),
    unsafe: !isAiNpcIdle(bot, options),
    playersNearby: playersSnapshot(bot).some(player => player.visible),
    now: now()
  }
}

function executionLifeEvent (instruction, execution, now) {
  if (instruction.action === 'start_automation' && execution.ok !== false) return { type: 'automation_started', automation: execution.startedAutomation || instruction.automation, at: now }
  if (instruction.action === 'follow_player' && execution.ok !== false) return { type: 'follow_started', player: instruction.player, at: now }
  if (instruction.action === 'noop') return { type: 'planner_noop', at: now }
  return null
}
```

At the start of `runAiNpcCycle`, before state creation, call `options.npcLife?.record(...)` for `cycle_idle`, `day`/`night`, `low_food`, and `player_nearby` where applicable, then `options.npcLife?.updateGoal(context)`.

After execution, record `executionLifeEvent`.

In `src/createBot.js`:

```js
const { createNpcLifeController } = require('./npcLife')
```

Then:

```js
const npcLife = createNpcLifeController()
attachAiNpc(bot, { debugLog, automationManager, followController, npcLife })
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "records AI NPC planner outcomes|idle NPC|AI NPC" --reporter spec --exit
```

Expected: AI NPC tests pass and no automatic interval is scheduled.

## Task 5: Verification And Regression Sweep

**Files:**
- Review all changed files.

- [ ] **Step 1: Run focused test suite**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "NPC life|idle NPC|AI NPC" --reporter spec --exit
```

Expected: all focused tests pass.

- [ ] **Step 2: Run StandardJS on touched files**

Run:

```powershell
npx standard src\aiNpc.js src\npcLife.js src\config.js src\createBot.js src\index.js test\botConfigTest.js
```

Expected: no output and exit code 0.

- [ ] **Step 3: Review diff for scope**

Run:

```powershell
git diff -- src\aiNpc.js src\npcLife.js src\config.js src\createBot.js src\index.js test\botConfigTest.js docs\superpowers\specs\2026-06-06-ai-npc-lifestyle-goals-design.md docs\superpowers\plans\2026-06-06-ai-npc-lifestyle-goals.md
```

Expected: changes match the spec, no unrelated refactors, and no return of a repeating idle NPC interval.
