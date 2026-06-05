# AI NPC Missing Tool Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured self-improvement backlog so the AI NPC records missing tools whenever its goals are blocked by unavailable capabilities.

**Architecture:** Introduce a focused per-bot memory path resolver and a structured `missingTools` module that dedupes missing capabilities into JSON. Wire the existing `record_missing_function` behavior and unknown Codex tool handling into the new structured backlog while keeping the existing markdown report for human readability.

**Tech Stack:** Node.js CommonJS, Mineflayer local app modules, Mocha/assert tests, StandardJS.

---

## File Structure

- Create `src/botMemory.js`: resolves safe per-bot memory roots and per-bot memory file paths.
- Create `src/missingTools.js`: normalizes, reads, writes, dedupes, and reports structured missing-tool records.
- Modify `src/config.js`: add `BOT_MEMORY_ROOT` and `SHARED_MISSING_TOOLS_PATH`.
- Modify `src/index.js`: export `botMemory` and `missingTools`.
- Modify `src/issueRecorder.js`: call the structured missing-tool recorder from `recordMissingFunction`.
- Modify `src/aiChat.js`: document and accept `record_missing_tool` as an alias for `record_missing_function`.
- Modify `src/aiNpc.js`: document and accept `record_missing_tool`, and use per-bot missing-tool paths during NPC planner execution.
- Modify `test/botConfigTest.js`: add focused tests for path resolution, dedupe behavior, chat wiring, NPC wiring, and unknown-tool capture.

## Task 1: Per-Bot Memory Path Resolver

**Files:**
- Create: `src/botMemory.js`
- Modify: `src/config.js`
- Modify: `src/index.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing path resolver tests**

Add tests near other pure helper tests in `test/botConfigTest.js`:

```js
it('resolves sanitized per-bot memory paths from bot username', () => {
  const { resolveBotMemoryPaths } = require('../bot')
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-memory-')), 'bots')

  const paths = resolveBotMemoryPaths({
    username: 'Pyro Farm/Bot'
  }, { botMemoryRoot: root })

  assert.strictEqual(paths.botId, 'pyro-farm-bot')
  assert.strictEqual(paths.root, path.join(root, 'pyro-farm-bot'))
  assert.strictEqual(paths.missingToolsPath, path.join(root, 'pyro-farm-bot', 'missing-tools.json'))
  assert.strictEqual(paths.memorySummaryPath, path.join(root, 'pyro-farm-bot', 'memory-summary.json'))
  assert.strictEqual(paths.eventLogPath, path.join(root, 'pyro-farm-bot', 'event-log.jsonl'))
  assert.strictEqual(paths.debugLogPath, path.join(root, 'pyro-farm-bot', 'debug.log'))
})

it('uses configured profile id before username for per-bot memory', () => {
  const { resolveBotMemoryPaths } = require('../bot')
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-memory-')), 'bots')

  const paths = resolveBotMemoryPaths({
    username: 'VisibleName',
    profile: { id: '1234-ABCD main' }
  }, { botMemoryRoot: root })

  assert.strictEqual(paths.botId, '1234-abcd-main')
  assert.strictEqual(paths.root, path.join(root, '1234-abcd-main'))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx mocha test/botConfigTest.js --grep "per-bot memory" --reporter spec --exit
```

Expected: FAIL with `resolveBotMemoryPaths` not exported.

- [ ] **Step 3: Add config constants**

In `src/config.js`, add near the other path constants:

```js
const BOT_MEMORY_ROOT = path.join(__dirname, '..', 'data', 'bots')
const SHARED_MISSING_TOOLS_PATH = path.join(__dirname, '..', 'data', 'missing-tools.json')
```

Add both names to `module.exports` near the other exported paths:

```js
  BOT_MEMORY_ROOT,
  SHARED_MISSING_TOOLS_PATH,
```

- [ ] **Step 4: Create `src/botMemory.js`**

Create the file with:

```js
const path = require('path')

const { BOT_MEMORY_ROOT } = require('./config')

function sanitizeBotId (value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return text || 'unknown-bot'
}

function resolveBotId (bot, options = {}) {
  return sanitizeBotId(
    options.botId ||
    bot?.profile?.id ||
    bot?.username ||
    options.username ||
    'unknown-bot'
  )
}

function resolveBotMemoryRoot (bot, options = {}) {
  const root = options.botMemoryRoot || BOT_MEMORY_ROOT
  return path.join(root, resolveBotId(bot, options))
}

function resolveBotMemoryPaths (bot, options = {}) {
  const botId = resolveBotId(bot, options)
  const root = path.join(options.botMemoryRoot || BOT_MEMORY_ROOT, botId)

  return {
    botId,
    root,
    npcLifePath: path.join(root, 'npc-life.json'),
    placesPath: path.join(root, 'places.json'),
    containersPath: path.join(root, 'containers.json'),
    projectsPath: path.join(root, 'projects.json'),
    playersPath: path.join(root, 'players.json'),
    craftingPath: path.join(root, 'crafting.json'),
    buildingPath: path.join(root, 'building.json'),
    cookingPath: path.join(root, 'cooking.json'),
    missingToolsPath: path.join(root, 'missing-tools.json'),
    memorySummaryPath: path.join(root, 'memory-summary.json'),
    eventLogPath: path.join(root, 'event-log.jsonl'),
    journalPath: path.join(root, 'daily-journal.md'),
    debugLogPath: path.join(root, 'debug.log')
  }
}

module.exports = {
  resolveBotId,
  resolveBotMemoryPaths,
  resolveBotMemoryRoot,
  sanitizeBotId
}
```

- [ ] **Step 5: Export the module**

In `src/index.js`, add:

```js
  ...require('./botMemory'),
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
npx mocha test/botConfigTest.js --grep "per-bot memory" --reporter spec --exit
```

Expected: PASS for both per-bot memory tests.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/config.js src/index.js src/botMemory.js test/botConfigTest.js
git commit -m "feat: add per-bot memory paths"
```

## Task 2: Structured Missing Tool Store

**Files:**
- Create: `src/missingTools.js`
- Modify: `src/index.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing missing-tool store tests**

Add tests near the issue recorder tests in `test/botConfigTest.js`:

```js
it('records structured missing tools with stable dedupe', () => {
  const { recordMissingTool, readMissingTools } = require('../bot')
  const missingToolsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'missing-tools-')), 'missing-tools.json')
  let now = 1000

  const first = recordMissingTool({
    capability: 'Mine ore safely',
    desiredTool: 'mine_block_or_vein',
    blockedGoal: 'Upgrade gear',
    reason: 'Need iron for better gear.',
    context: { inventory: ['stone_pickaxe'] },
    priority: 'high'
  }, { missingToolsPath, now: () => now })

  now = 2000
  const second = recordMissingTool({
    capability: 'mine ore safely',
    desiredTool: 'mine_block_or_vein',
    blockedGoal: 'Upgrade gear',
    reason: 'Need iron again.',
    context: { inventory: ['stone_pickaxe', 'torch'] },
    priority: 'medium'
  }, { missingToolsPath, now: () => now })

  const records = readMissingTools({ missingToolsPath })

  assert.strictEqual(first.recorded, true)
  assert.strictEqual(second.recorded, false)
  assert.strictEqual(records.length, 1)
  assert.strictEqual(records[0].id, 'mine-ore-safely-mine-block-or-vein-upgrade-gear')
  assert.strictEqual(records[0].capability, 'Mine ore safely')
  assert.strictEqual(records[0].desiredTool, 'mine_block_or_vein')
  assert.strictEqual(records[0].blockedGoal, 'Upgrade gear')
  assert.strictEqual(records[0].priority, 'high')
  assert.strictEqual(records[0].count, 2)
  assert.strictEqual(records[0].firstSeenAt, 1000)
  assert.strictEqual(records[0].lastSeenAt, 2000)
  assert.strictEqual(records[0].examples.length, 2)
})

it('limits relevant missing tool summaries for prompts', () => {
  const { recordMissingTool, summarizeMissingTools } = require('../bot')
  const missingToolsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'missing-tools-')), 'missing-tools.json')

  recordMissingTool({
    capability: 'Mine ore safely',
    desiredTool: 'mine_block_or_vein',
    blockedGoal: 'Upgrade gear',
    reason: 'Need iron.',
    priority: 'high'
  }, { missingToolsPath, now: () => 1000 })

  recordMissingTool({
    capability: 'Cook food',
    desiredTool: 'cook_item',
    blockedGoal: 'Build food supply',
    reason: 'Need cooked food.',
    priority: 'medium'
  }, { missingToolsPath, now: () => 2000 })

  const summary = summarizeMissingTools({
    missingToolsPath,
    currentGoal: 'Upgrade gear',
    limit: 1
  })

  assert.deepStrictEqual(summary, [
    'Mine ore safely blocked "Upgrade gear"; desired tool `mine_block_or_vein`; seen 1 time.'
  ])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx mocha test/botConfigTest.js --grep "missing tools" --reporter spec --exit
```

Expected: FAIL with `recordMissingTool` not exported.

- [ ] **Step 3: Create `src/missingTools.js`**

Create the file with:

```js
const fs = require('fs')
const path = require('path')

const {
  SHARED_MISSING_TOOLS_PATH
} = require('./config')
const {
  appendUniqueMarkdownEntry,
  formatJsonBlock
} = require('./issueRecorder')

const PRIORITY_RANK = {
  low: 1,
  medium: 2,
  high: 3
}

function compactText (value, fallback = '', maxLength = 200) {
  const text = String(value || fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, maxLength)
}

function slugPart (value) {
  return compactText(value, 'unknown', 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown'
}

function normalizePriority (value) {
  const priority = String(value || '').toLowerCase()
  return PRIORITY_RANK[priority] ? priority : 'medium'
}

function comparePriority (a, b) {
  return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    b.count - a.count ||
    b.lastSeenAt - a.lastSeenAt
}

function missingToolId (entry) {
  return [
    slugPart(entry.capability),
    slugPart(entry.desiredTool),
    slugPart(entry.blockedGoal)
  ].join('-')
}

function readJsonArray (filePath, fileSystem = fs) {
  try {
    const parsed = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    if (err.code === 'ENOENT') return []
    return []
  }
}

function writeJsonArray (filePath, records, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(filePath), { recursive: true })
  fileSystem.writeFileSync(filePath, `${JSON.stringify(records, null, 2)}\n`)
}

function normalizeMissingToolRecord (entry, options = {}) {
  const now = options.now?.() || Date.now()
  const capability = compactText(entry.capability, 'Unknown missing capability', 120)
  const desiredTool = compactText(entry.desiredTool || entry.suggestedTool || entry.tool, '', 120)
  const blockedGoal = compactText(entry.blockedGoal || entry.goal, 'Unspecified goal', 160)
  const reason = compactText(entry.reason, 'No reason captured', 300)
  const priority = normalizePriority(entry.priority)
  const context = entry.context && typeof entry.context === 'object' ? entry.context : {}
  const example = {
    at: entry.at || now,
    reason,
    context
  }

  return {
    id: missingToolId({ capability, desiredTool, blockedGoal }),
    status: compactText(entry.status, 'open', 40),
    capability,
    desiredTool,
    blockedGoal,
    reason,
    priority,
    count: Math.max(1, Number.parseInt(entry.count || 1, 10)),
    firstSeenAt: entry.firstSeenAt || now,
    lastSeenAt: entry.lastSeenAt || now,
    suggestedInputs: Array.isArray(entry.suggestedInputs) ? entry.suggestedInputs.slice(0, 8) : [],
    suggestedResult: compactText(entry.suggestedResult, '', 200),
    examples: Array.isArray(entry.examples) ? entry.examples.slice(-5) : [example]
  }
}

function mergeMissingToolRecord (existing, incoming) {
  const priority = PRIORITY_RANK[incoming.priority] > PRIORITY_RANK[existing.priority]
    ? incoming.priority
    : existing.priority
  const examples = [
    ...(Array.isArray(existing.examples) ? existing.examples : []),
    ...(Array.isArray(incoming.examples) ? incoming.examples : [])
  ].slice(-5)

  return {
    ...existing,
    status: existing.status || incoming.status,
    reason: incoming.reason || existing.reason,
    priority,
    count: Math.max(1, existing.count || 1) + Math.max(1, incoming.count || 1),
    firstSeenAt: Math.min(existing.firstSeenAt || incoming.firstSeenAt, incoming.firstSeenAt || existing.firstSeenAt),
    lastSeenAt: Math.max(existing.lastSeenAt || incoming.lastSeenAt, incoming.lastSeenAt || existing.lastSeenAt),
    suggestedInputs: incoming.suggestedInputs.length ? incoming.suggestedInputs : existing.suggestedInputs,
    suggestedResult: incoming.suggestedResult || existing.suggestedResult,
    examples
  }
}

function readMissingTools (options = {}) {
  const filePath = options.missingToolsPath || SHARED_MISSING_TOOLS_PATH
  return readJsonArray(filePath, options.fs)
    .map(entry => normalizeMissingToolRecord(entry, options))
    .sort(comparePriority)
}

function recordMissingTool (entry, options = {}) {
  const filePath = options.missingToolsPath || SHARED_MISSING_TOOLS_PATH
  const incoming = normalizeMissingToolRecord(entry, options)
  const records = readJsonArray(filePath, options.fs).map(record => normalizeMissingToolRecord(record, options))
  const index = records.findIndex(record => record.id === incoming.id)
  const recorded = index < 0

  if (recorded) {
    records.push(incoming)
  } else {
    records[index] = mergeMissingToolRecord(records[index], incoming)
  }

  records.sort(comparePriority)
  writeJsonArray(filePath, records, options.fs)

  return {
    id: incoming.id,
    capability: incoming.capability,
    path: filePath,
    recorded
  }
}

function recordSharedMissingTool (entry, options = {}) {
  return recordMissingTool(entry, {
    ...options,
    missingToolsPath: options.sharedMissingToolsPath || SHARED_MISSING_TOOLS_PATH
  })
}

function summarizeMissingTools (options = {}) {
  const goal = compactText(options.currentGoal, '', 160).toLowerCase()
  const limit = Math.max(1, Math.min(Number.parseInt(options.limit || 3, 10), 10))
  return readMissingTools(options)
    .filter(record => record.status === 'open')
    .filter(record => !goal || record.blockedGoal.toLowerCase().includes(goal) || record.capability.toLowerCase().includes(goal))
    .slice(0, limit)
    .map(record => {
      const desired = record.desiredTool ? `; desired tool \`${record.desiredTool}\`` : ''
      const times = record.count === 1 ? '1 time' : `${record.count} times`
      return `${record.capability} blocked "${record.blockedGoal}"${desired}; seen ${times}.`
    })
}

function appendMissingToolMarkdownReport (entry, options = {}) {
  if (!options.missingFunctionsPath) return { recorded: false }
  const record = normalizeMissingToolRecord(entry, options)
  const marker = `<!-- missing-tool:${record.id} -->`
  const lines = [
    `## ${new Date(record.lastSeenAt).toISOString()} - ${record.capability}`,
    '',
    `- Blocked goal: ${record.blockedGoal}`,
    `- Desired tool: \`${record.desiredTool || 'unspecified'}\``,
    `- Priority: \`${record.priority}\``,
    `- Seen: ${record.count}`,
    `- Reason: ${record.reason}`
  ]

  if (Object.keys(record.examples[record.examples.length - 1]?.context || {}).length > 0) {
    lines.push('', '```json', formatJsonBlock(record.examples[record.examples.length - 1].context), '```')
  }

  return appendUniqueMarkdownEntry({
    fs: options.fs,
    filePath: options.missingFunctionsPath,
    title: 'Missing Bot Functions',
    intro: 'Feature backlog captured by the Minecraft AI NPC when players ask for abilities the runtime does not have yet.',
    marker,
    body: lines.join('\n')
  })
}

module.exports = {
  appendMissingToolMarkdownReport,
  missingToolId,
  normalizeMissingToolRecord,
  readMissingTools,
  recordMissingTool,
  recordSharedMissingTool,
  summarizeMissingTools
}
```

- [ ] **Step 4: Export the module**

In `src/index.js`, add:

```js
  ...require('./missingTools'),
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
npx mocha test/botConfigTest.js --grep "missing tools" --reporter spec --exit
```

Expected: PASS for both missing-tool store tests.

- [ ] **Step 6: Run lint for new modules**

Run:

```bash
npx standard src\botMemory.js src\missingTools.js src\config.js src\index.js test\botConfigTest.js
```

Expected: command exits 0.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/missingTools.js src/index.js test/botConfigTest.js
git commit -m "feat: add structured missing tool backlog"
```

## Task 3: Wire Missing Tools Into Chat And NPC Execution

**Files:**
- Modify: `src/issueRecorder.js`
- Modify: `src/aiChat.js`
- Modify: `src/aiNpc.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing chat integration tests**

Extend the existing missing-function tests around `records missing bot functions from Codex tool calls`:

```js
it('records missing bot functions into structured per-bot and shared backlogs', async () => {
  const { attachAiChat } = require('../bot')
  const missingFunctionsPath = tempMissingFunctionsPath()
  const botMemoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-memory-'))
  const sharedMissingToolsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-missing-')), 'missing-tools.json')
  const chatMessages = []
  const bot = createFakeBot({ username: 'LifeBot' })
  bot.chat = message => chatMessages.push(message)

  attachAiChat(bot, {
    missingFunctionsPath,
    botMemoryRoot,
    sharedMissingToolsPath,
    runCodex: async request => {
      if (request.toolResult) return 'I wrote that down for future upgrades.'
      return JSON.stringify({
        tool: 'record_missing_tool',
        args: {
          capability: 'mine ore safely',
          desiredTool: 'mine_block_or_vein',
          blockedGoal: 'Upgrade gear',
          reason: 'The bot needs iron but has no mining tool.',
          priority: 'high'
        }
      })
    }
  })

  bot.emit('chat', 'Steve', 'LifeBot upgrade your gear')
  await waitForMicrotasks()

  const perBot = JSON.parse(fs.readFileSync(path.join(botMemoryRoot, 'lifebot', 'missing-tools.json'), 'utf8'))
  const shared = JSON.parse(fs.readFileSync(sharedMissingToolsPath, 'utf8'))

  assert.strictEqual(perBot.length, 1)
  assert.strictEqual(shared.length, 1)
  assert.strictEqual(perBot[0].capability, 'mine ore safely')
  assert.strictEqual(perBot[0].blockedGoal, 'Upgrade gear')
  assert.strictEqual(perBot[0].priority, 'high')
  assert.match(fs.readFileSync(missingFunctionsPath, 'utf8'), /mine ore safely/)
})
```

Add this unknown tool assertion near the existing unknown Codex tool test:

```js
it('records unknown Codex tools into structured missing tool backlog', async () => {
  const { attachAiChat } = require('../bot')
  const botMemoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-memory-'))
  const sharedMissingToolsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-missing-')), 'missing-tools.json')
  const bot = createFakeBot({ username: 'LifeBot' })
  bot.chat = () => {}

  attachAiChat(bot, {
    botMemoryRoot,
    sharedMissingToolsPath,
    runCodex: async request => {
      if (request.toolResult) return 'I cannot do that yet.'
      return JSON.stringify({
        tool: 'mine_block_or_vein',
        args: { blockType: 'iron_ore' }
      })
    }
  })

  bot.emit('chat', 'Steve', 'LifeBot mine iron')
  await waitForMicrotasks()

  const records = JSON.parse(fs.readFileSync(path.join(botMemoryRoot, 'lifebot', 'missing-tools.json'), 'utf8'))
  assert.strictEqual(records.length, 1)
  assert.strictEqual(records[0].desiredTool, 'mine_block_or_vein')
  assert.strictEqual(records[0].capability, 'Unknown tool: mine_block_or_vein')
})
```

- [ ] **Step 2: Write failing NPC planner integration test**

Add near AI NPC tests:

```js
it('records AI NPC missing tools into per-bot memory', async () => {
  const { runAiNpcCycle } = require('../bot')
  const botMemoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-memory-'))
  const sharedMissingToolsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-missing-')), 'missing-tools.json')
  const bot = createFakeBot({ username: 'LifeBot' })
  bot.food = 20
  bot.health = 20
  bot.time = { isDay: true, timeOfDay: 1000 }
  bot.players = {}

  const result = await runAiNpcCycle(bot, {
    botMemoryRoot,
    sharedMissingToolsPath,
    automationManager: {
      isIdle: () => true,
      list: () => [],
      getStatus: () => ({ active: false })
    },
    followController: {
      isIdle: () => true,
      getStatus: () => ({ active: false })
    },
    runPlanner: async () => JSON.stringify({
      action: 'record_missing_tool',
      capability: 'mine ore safely',
      desiredTool: 'mine_block_or_vein',
      blockedGoal: 'Upgrade gear',
      reason: 'I need iron gear but cannot mine ore yet.',
      priority: 'high'
    })
  })

  const records = JSON.parse(fs.readFileSync(path.join(botMemoryRoot, 'lifebot', 'missing-tools.json'), 'utf8'))

  assert.strictEqual(result.execution.ok, true)
  assert.strictEqual(records.length, 1)
  assert.strictEqual(records[0].capability, 'mine ore safely')
  assert.strictEqual(records[0].desiredTool, 'mine_block_or_vein')
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npx mocha test/botConfigTest.js --grep "structured missing tool|unknown Codex tools into structured|AI NPC missing tools" --reporter spec --exit
```

Expected: FAIL because chat and NPC paths still only write markdown.

- [ ] **Step 4: Export helper functions from `issueRecorder.js`**

At the bottom of `src/issueRecorder.js`, add `appendUniqueMarkdownEntry` and `formatJsonBlock` to `module.exports` if they are not already exported:

```js
  appendUniqueMarkdownEntry,
  formatJsonBlock,
```

- [ ] **Step 5: Update `recordMissingFunction` to write structured backlog**

In `src/issueRecorder.js`, require the new helpers lazily inside `recordMissingFunction` to avoid circular-load problems:

```js
  let structuredRecord = null
  try {
    const { recordMissingTool, recordSharedMissingTool } = require('./missingTools')
    structuredRecord = recordMissingTool({
      capability,
      desiredTool: suggestedTool,
      blockedGoal: entry.blockedGoal || 'Unspecified goal',
      reason,
      context: {
        playerName,
        channel,
        requestMessage,
        source,
        rawTool: entry.rawTool || null
      },
      priority: entry.priority
    }, options)

    if (options.sharedMissingToolsPath) {
      recordSharedMissingTool({
        capability,
        desiredTool: suggestedTool,
        blockedGoal: entry.blockedGoal || 'Unspecified goal',
        reason,
        context: {
          playerName,
          channel,
          requestMessage,
          source,
          rawTool: entry.rawTool || null
        },
        priority: entry.priority
      }, options)
    }
  } catch (err) {
    structuredRecord = { error: err.message }
  }
```

Include the structured path in the returned object:

```js
    missingTool: structuredRecord,
```

- [ ] **Step 6: Pass per-bot missing-tool path from chat execution**

In `src/aiChat.js`, import `resolveBotMemoryPaths`:

```js
const { resolveBotMemoryPaths } = require('./botMemory')
```

Before calling `executeAgentTool` in `respondWithCodex`, compute tool options:

```js
    const memoryPaths = resolveBotMemoryPaths(bot, options)
    const result = await executeAgentTool(bot, toolCall, request, {
      ...options,
      missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
    })
```

In `executeAgentTool`, accept the alias:

```js
  if (toolName === 'record_missing_function' || toolName === 'record_missing_tool') {
    return executeRecordMissingFunction(request, toolCall.args, options)
  }
```

In `executeUnknownTool`, add `blockedGoal` and `priority`:

```js
    blockedGoal: request.message || 'Unknown player request',
    priority: 'medium',
```

- [ ] **Step 7: Update chat tool docs and prompt rule**

In `src/aiChat.js`, rename the visible docs heading to include the alias:

```js
    '### record_missing_tool',
    '',
    'Use when a player asks the bot to do something useful but no available tool/function can do it yet.',
```

Change the example JSON to:

```js
    '{"tool":"record_missing_tool","args":{"capability":"craft wooden doors","reason":"Player asked the bot to craft a door from wood.","suggestedTool":"craft_item","blockedGoal":"Help player build a house"}}',
```

Keep the existing prompt rule but update the tool name:

```js
    'If a useful player request needs a capability that is not available, use record_missing_tool instead of inventing a tool.',
```

- [ ] **Step 8: Update AI NPC planner parsing and execution**

In `src/aiNpc.js`, import `resolveBotMemoryPaths`:

```js
const { resolveBotMemoryPaths } = require('./botMemory')
```

Add the alias to the allowed instructions:

```js
    '{"action":"record_missing_tool","capability":"craft items","desiredTool":"craft_item","blockedGoal":"Build shelter","reason":"short reason"}',
```

Change parsing to accept both names:

```js
  } else if (action === 'record_missing_function' || action === 'record_missing_tool') {
    instruction.capability = cleanShortText(parsed.capability || parsed.function || parsed.name, 80)
    instruction.suggestedTool = cleanShortText(parsed.suggestedTool || parsed.suggested_tool || parsed.desiredTool || parsed.desired_tool || parsed.tool, 80)
    instruction.blockedGoal = cleanShortText(parsed.blockedGoal || parsed.blocked_goal || parsed.goal, 120)
    instruction.priority = cleanShortText(parsed.priority, 20)
```

Update execution:

```js
  if (action === 'record_missing_function' || action === 'record_missing_tool') {
    const memoryPaths = resolveBotMemoryPaths(bot, options)
    const record = recordMissingFunction({
      capability: instruction.capability,
      reason: instruction.reason || 'Idle planner needed a capability the bot does not have yet.',
      suggestedTool: instruction.suggestedTool,
      blockedGoal: instruction.blockedGoal,
      priority: instruction.priority,
      playerName: 'idle-planner',
      channel: 'npc',
      requestMessage: instruction.reason,
      source: 'ai-npc'
    }, {
      ...options,
      missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
    })

    return {
      ok: true,
      action,
      capability: record.capability,
      recorded: record.recorded,
      path: record.path,
      missingTool: record.missingTool
    }
  }
```

- [ ] **Step 9: Run targeted integration tests**

Run:

```bash
npx mocha test/botConfigTest.js --grep "structured missing tool|unknown Codex tools into structured|AI NPC missing tools" --reporter spec --exit
```

Expected: PASS for the three new integration tests.

- [ ] **Step 10: Commit Task 3**

```bash
git add src/issueRecorder.js src/aiChat.js src/aiNpc.js test/botConfigTest.js
git commit -m "feat: wire missing tools into npc brain"
```

## Task 4: Final Verification And Backlog Report Guardrails

**Files:**
- Modify: `test/botConfigTest.js`
- Modify: `docs/superpowers/specs/2026-06-06-ai-npc-brain-tools-design.md`

- [ ] **Step 1: Add regression test that repeated missing tools do not grow prompts**

Add a pure test near the missing-tool summary tests:

```js
it('summarizes only the highest priority missing tools for prompt use', () => {
  const { recordMissingTool, summarizeMissingTools } = require('../bot')
  const missingToolsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'missing-tools-')), 'missing-tools.json')

  for (let i = 0; i < 6; i++) {
    recordMissingTool({
      capability: `Capability ${i}`,
      desiredTool: `tool_${i}`,
      blockedGoal: 'Upgrade gear',
      reason: `Reason ${i}`,
      priority: i === 5 ? 'high' : 'medium'
    }, { missingToolsPath, now: () => 1000 + i })
  }

  const summary = summarizeMissingTools({
    missingToolsPath,
    currentGoal: 'Upgrade gear',
    limit: 3
  })

  assert.strictEqual(summary.length, 3)
  assert.match(summary[0], /Capability 5/)
})
```

- [ ] **Step 2: Run targeted prompt-budget test**

Run:

```bash
npx mocha test/botConfigTest.js --grep "highest priority missing tools" --reporter spec --exit
```

Expected: PASS.

- [ ] **Step 3: Run full focused test suite for this slice**

Run:

```bash
npx mocha test/botConfigTest.js --grep "per-bot memory|missing tools|structured missing tool|unknown Codex tools into structured|AI NPC missing tools|highest priority missing tools" --reporter spec --exit
```

Expected: all matching tests PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
npx standard src\botMemory.js src\missingTools.js src\issueRecorder.js src\aiChat.js src\aiNpc.js src\config.js src\index.js test\botConfigTest.js
```

Expected: command exits 0.

- [ ] **Step 5: Run broader regression tests**

Run:

```bash
npx mocha test/botConfigTest.js --reporter dot --exit
```

Expected: all tests PASS.

- [ ] **Step 6: Run markdown verification**

Run:

```bash
npx standard-markdown docs\superpowers\specs\2026-06-06-ai-npc-brain-tools-design.md docs\superpowers\plans\2026-06-06-ai-npc-missing-tool-backlog.md
```

Expected: command exits 0.

- [ ] **Step 7: Commit Task 4**

```bash
git add test/botConfigTest.js docs/superpowers/specs/2026-06-06-ai-npc-brain-tools-design.md docs/superpowers/plans/2026-06-06-ai-npc-missing-tool-backlog.md
git commit -m "test: verify missing tool backlog behavior"
```

## Self-Review

- Spec coverage: This plan implements the missing capability backlog, per-bot `missing-tools.json`, shared backlog, dedupe, priority/count tracking, prompt summary limits, and fallback wiring for unknown tools. It does not implement mining, crafting, cooking, or building tools because those are later milestones in the spec.
- Placeholder scan: No placeholder steps are intentionally left for implementers. Each code-changing step names the file and shows the relevant code shape.
- Type consistency: The plan consistently uses `recordMissingTool`, `readMissingTools`, `summarizeMissingTools`, `resolveBotMemoryPaths`, `missingToolsPath`, and `sharedMissingToolsPath`.

