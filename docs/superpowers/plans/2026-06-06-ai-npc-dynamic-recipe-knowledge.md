# AI NPC Dynamic Recipe Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded AI NPC crafting recipes with Mineflayer-backed recipe inspection, learned recipe cache files, and generic recipe tools.

**Architecture:** Add a focused recipe knowledge module that owns `learned-recipes.json` read/write/normalization. Extend per-bot memory path resolution so tool execution can store learned recipes beside existing NPC memory. Refactor AI NPC crafting tools so Mineflayer recipe APIs validate craftability instead of `SAFE_CRAFT_RECIPES`.

**Tech Stack:** Node.js CommonJS, Mineflayer recipe APIs (`bot.recipesFor`, `bot.recipesAll`, `bot.craft`), existing Mocha/assert tests in `test/botConfigTest.js`, StandardJS, JSON file persistence.

---

## Scope

This plan implements the recipe half of `docs/superpowers/specs/2026-06-06-ai-npc-dynamic-knowledge-design.md`.

It intentionally does not replace `SIMPLE_SHELTER_OFFSETS` or `LIGHT_AREA_OFFSETS`; that belongs in the follow-up blueprint plan. Keeping blueprint work separate gives us one clean green checkpoint after removing `SAFE_CRAFT_RECIPES`.

## File Structure

- Create `src/recipeKnowledge.js`
  - Owns `learned-recipes.json` schema, path handling, normalization, read/write, upsert, compact read summaries, and item/recipe inspection helpers.
- Modify `src/botMemory.js`
  - Add `learnedRecipesPath` to per-bot memory path resolution.
- Modify `src/aiNpcTools.js`
  - Remove `SAFE_CRAFT_RECIPES`.
  - Add `inspect_recipe` and `read_recipe_knowledge`.
  - Refactor `list_craftable_items` and `craft_item` to use Mineflayer item registry and recipe APIs.
- Modify `src/index.js`
  - Export recipe knowledge helpers.
- Modify `test/botConfigTest.js`
  - Add recipe knowledge tests and update AI NPC tool tests.
- Keep `docs/superpowers/specs/2026-06-06-ai-npc-dynamic-knowledge-design.md`
  - No change unless implementation reveals a spec correction.

## Task 1: Add Per-Bot Learned Recipe Path

**Files:**

- Modify: `src/botMemory.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write the failing path test**

Add this assertion to the existing `resolveBotMemoryPaths` test near the other path assertions:

```js
assert.strictEqual(paths.learnedRecipesPath, path.join(root, 'pyro-farm-bot', 'learned-recipes.json'))
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "resolves per-bot memory paths" --reporter spec --exit
```

Expected: FAIL because `learnedRecipesPath` is `undefined`.

- [ ] **Step 3: Implement the minimal path change**

In `src/botMemory.js`, update `resolveBotMemoryPaths` so the returned object includes:

```js
learnedRecipesPath: path.join(root, 'learned-recipes.json')
```

Keep the existing bot-id normalization and root behavior unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "resolves per-bot memory paths" --reporter spec --exit
```

Expected: PASS.

## Task 2: Add Recipe Knowledge Store

**Files:**

- Create: `src/recipeKnowledge.js`
- Modify: `src/index.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing store tests**

Add tests near the other memory/knowledge tests in `test/botConfigTest.js`:

```js
it('normalizes learned recipe knowledge safely', () => {
  const { normalizeRecipeKnowledge } = require('../bot')

  assert.deepStrictEqual(normalizeRecipeKnowledge({
    version: 999,
    recipes: {
      torch: {
        item: 'torch',
        status: 'verified',
        minecraftVersion: '1.21.5',
        plan: [{ tool: 'craft_item', item: 'torch', count: 4, requires: ['stick', 'coal'] }],
        missingIngredients: ['coal'],
        lastVerifiedAt: 123
      },
      broken: 'bad'
    }
  }), {
    version: 1,
    recipes: {
      torch: {
        item: 'torch',
        status: 'verified',
        minecraftVersion: '1.21.5',
        plan: [{ tool: 'craft_item', item: 'torch', count: 4, requires: ['stick', 'coal'] }],
        missingIngredients: ['coal'],
        lastVerifiedAt: 123
      }
    }
  })
})

it('reads and writes learned recipe knowledge', () => {
  const {
    readRecipeKnowledge,
    upsertLearnedRecipe
  } = require('../bot')
  const learnedRecipesPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'learned-recipes-')), 'learned-recipes.json')

  const record = upsertLearnedRecipe({
    item: 'torch',
    status: 'blocked',
    minecraftVersion: '1.21.5',
    plan: [],
    missingIngredients: ['coal']
  }, { learnedRecipesPath, now: () => 456 })
  const knowledge = readRecipeKnowledge({ learnedRecipesPath })

  assert.strictEqual(record.item, 'torch')
  assert.strictEqual(record.lastVerifiedAt, 456)
  assert.deepStrictEqual(knowledge.recipes.torch.missingIngredients, ['coal'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "learned recipe knowledge" --reporter spec --exit
```

Expected: FAIL because `normalizeRecipeKnowledge`, `readRecipeKnowledge`, and `upsertLearnedRecipe` are not exported.

- [ ] **Step 3: Create `src/recipeKnowledge.js`**

Create the file with this implementation:

```js
const fs = require('fs')
const path = require('path')

const RECIPE_KNOWLEDGE_VERSION = 1
const VALID_STATUSES = new Set(['draft', 'verified', 'blocked', 'failed'])

function compactText (value, fallback = '', maxLength = 160) {
  return String(value || fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function recipeKey (item) {
  return compactText(item, '', 80).toLowerCase()
}

function normalizePlanStep (step) {
  if (!step || typeof step !== 'object') return null
  const item = recipeKey(step.item)
  if (!item) return null
  const count = Math.max(1, Math.min(Number.parseInt(step.count || 1, 10) || 1, 64))
  const requires = Array.isArray(step.requires)
    ? [...new Set(step.requires.map(value => recipeKey(value)).filter(Boolean))].slice(0, 16)
    : []
  return {
    tool: compactText(step.tool, 'craft_item', 80),
    item,
    count,
    requires
  }
}

function normalizeRecipeRecord (record) {
  if (!record || typeof record !== 'object') return null
  const item = recipeKey(record.item)
  if (!item) return null
  const status = VALID_STATUSES.has(record.status) ? record.status : 'draft'
  const plan = Array.isArray(record.plan)
    ? record.plan.map(normalizePlanStep).filter(Boolean).slice(0, 32)
    : []
  const missingIngredients = Array.isArray(record.missingIngredients)
    ? [...new Set(record.missingIngredients.map(value => recipeKey(value)).filter(Boolean))].slice(0, 32)
    : []
  return {
    item,
    status,
    minecraftVersion: compactText(record.minecraftVersion, '', 40),
    plan,
    missingIngredients,
    lastVerifiedAt: Number.isFinite(record.lastVerifiedAt) ? record.lastVerifiedAt : 0
  }
}

function emptyRecipeKnowledge () {
  return {
    version: RECIPE_KNOWLEDGE_VERSION,
    recipes: {}
  }
}

function normalizeRecipeKnowledge (knowledge) {
  const normalized = emptyRecipeKnowledge()
  if (!knowledge || typeof knowledge !== 'object' || !knowledge.recipes || typeof knowledge.recipes !== 'object') {
    return normalized
  }

  for (const value of Object.values(knowledge.recipes)) {
    const record = normalizeRecipeRecord(value)
    if (record) normalized.recipes[record.item] = record
  }
  return normalized
}

function readRecipeKnowledge (options = {}) {
  const filePath = options.learnedRecipesPath
  if (!filePath || !fs.existsSync(filePath)) return emptyRecipeKnowledge()
  try {
    return normalizeRecipeKnowledge(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch (err) {
    return emptyRecipeKnowledge()
  }
}

function writeRecipeKnowledge (knowledge, options = {}) {
  const filePath = options.learnedRecipesPath
  if (!filePath) return normalizeRecipeKnowledge(knowledge)
  const normalized = normalizeRecipeKnowledge(knowledge)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`)
  return normalized
}

function upsertLearnedRecipe (record, options = {}) {
  const normalizedRecord = normalizeRecipeRecord({
    ...record,
    lastVerifiedAt: record.lastVerifiedAt || options.now?.() || Date.now()
  })
  if (!normalizedRecord) return null
  const knowledge = readRecipeKnowledge(options)
  knowledge.recipes[normalizedRecord.item] = normalizedRecord
  writeRecipeKnowledge(knowledge, options)
  return normalizedRecord
}

function summarizeRecipeKnowledge (options = {}) {
  const limit = Math.max(1, Math.min(Number.parseInt(options.limit || 8, 10) || 8, 20))
  return Object.values(readRecipeKnowledge(options).recipes)
    .sort((a, b) => b.lastVerifiedAt - a.lastVerifiedAt)
    .slice(0, limit)
    .map(record => ({
      item: record.item,
      status: record.status,
      missingIngredients: record.missingIngredients,
      steps: record.plan.length
    }))
}

module.exports = {
  emptyRecipeKnowledge,
  normalizeRecipeKnowledge,
  readRecipeKnowledge,
  RECIPE_KNOWLEDGE_VERSION,
  summarizeRecipeKnowledge,
  upsertLearnedRecipe,
  writeRecipeKnowledge
}
```

- [ ] **Step 4: Export the module from `src/index.js`**

Add:

```js
...require('./recipeKnowledge'),
```

to the exported object in `src/index.js`, following the existing spread-export pattern.

- [ ] **Step 5: Run the store tests to verify they pass**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "learned recipe knowledge" --reporter spec --exit
```

Expected: PASS.

## Task 3: Add Recipe Inspection Helpers To The Tool Registry

**Files:**

- Modify: `src/aiNpcTools.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing registry tests for new tools**

Update the `lists initial AI NPC tools from the registry` expected list to include:

```js
'inspect_recipe',
'read_recipe_knowledge',
```

Place them near `list_craftable_items` and `craft_item`.

Add this test:

```js
it('inspects Mineflayer recipes through the AI NPC tool registry', async () => {
  const { executeAiNpcTool } = require('../bot')
  const bot = survivalToolBot()
  bot.registry.itemsByName.ladder = { id: 65 }
  bot.recipesAll = (type, metadata, craftingTable) => {
    assert.strictEqual(type, 65)
    return craftingTable
      ? [{ result: { id: 65, count: 3 }, requiresTable: true }]
      : []
  }

  const result = await executeAiNpcTool(bot, {
    tool: 'inspect_recipe',
    args: { item: 'ladder', count: 3 }
  })

  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.result, {
    item: 'ladder',
    count: 3,
    known: true,
    inventoryRecipes: 0,
    tableRecipes: 1,
    requiresCraftingTable: true
  })
})

it('reads compact learned recipe knowledge through the AI NPC tool registry', async () => {
  const { executeAiNpcTool, upsertLearnedRecipe } = require('../bot')
  const learnedRecipesPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'learned-recipes-')), 'learned-recipes.json')
  const bot = survivalToolBot()

  upsertLearnedRecipe({
    item: 'torch',
    status: 'blocked',
    minecraftVersion: '1.21.5',
    plan: [],
    missingIngredients: ['coal']
  }, { learnedRecipesPath, now: () => 1000 })

  const result = await executeAiNpcTool(bot, {
    tool: 'read_recipe_knowledge',
    args: { limit: 3 }
  }, { learnedRecipesPath })

  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.result.recipes, [
    { item: 'torch', status: 'blocked', missingIngredients: ['coal'], steps: 0 }
  ])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "inspects Mineflayer recipes|compact learned recipe|initial AI NPC tools" --reporter spec --exit
```

Expected: FAIL because `inspect_recipe` and `read_recipe_knowledge` are unknown.

- [ ] **Step 3: Import recipe knowledge helpers**

In `src/aiNpcTools.js`, add:

```js
const {
  readRecipeKnowledge,
  summarizeRecipeKnowledge,
  upsertLearnedRecipe
} = require('./recipeKnowledge')
```

- [ ] **Step 4: Add validation and helper functions**

In `src/aiNpcTools.js`, add:

```js
function validateRecipeItemArgs (args) {
  const item = sanitizeItemNames(args.item || args.items)[0]
  const count = positiveIntegerOrNull(args.count) || 1
  if (!item) return { ok: false, reason: 'missing-item' }
  return { ok: true, args: { item, count } }
}

function itemTypeForRecipe (bot, itemName) {
  return bot.registry?.itemsByName?.[itemName]?.id ?? null
}

function inspectRecipeState (bot, args) {
  const itemType = itemTypeForRecipe(bot, args.item)
  if (itemType === null) {
    return {
      item: args.item,
      count: args.count,
      known: false,
      inventoryRecipes: 0,
      tableRecipes: 0,
      requiresCraftingTable: false
    }
  }

  const inventoryRecipes = typeof bot.recipesAll === 'function'
    ? bot.recipesAll(itemType, null, null)
    : []
  const tableRecipes = typeof bot.recipesAll === 'function'
    ? bot.recipesAll(itemType, null, true)
    : []

  return {
    item: args.item,
    count: args.count,
    known: inventoryRecipes.length > 0 || tableRecipes.length > 0,
    inventoryRecipes: inventoryRecipes.length,
    tableRecipes: tableRecipes.length,
    requiresCraftingTable: tableRecipes.length > 0 && inventoryRecipes.length === 0
  }
}
```

- [ ] **Step 5: Add tool definitions**

In `toolDefinitions()`, add:

```js
{
  name: 'inspect_recipe',
  description: 'Inspect Mineflayer recipe availability for a target item.',
  validate: validateRecipeItemArgs,
  execute: async (bot, args) => inspectRecipeState(bot, args)
},
{
  name: 'read_recipe_knowledge',
  description: 'Read compact cached recipe plans and blockers.',
  validate: passArgs,
  execute: async (bot, args, options) => {
    const memoryPaths = resolveBotMemoryPaths(bot, options)
    const limit = Math.max(1, Math.min(Number.parseInt(args.limit || 8, 10) || 8, 20))
    return {
      recipes: summarizeRecipeKnowledge({
        ...options,
        learnedRecipesPath: options.learnedRecipesPath || memoryPaths.learnedRecipesPath,
        limit
      })
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "inspects Mineflayer recipes|compact learned recipe|initial AI NPC tools" --reporter spec --exit
```

Expected: PASS.

## Task 4: Refactor Crafting Away From `SAFE_CRAFT_RECIPES`

**Files:**

- Modify: `src/aiNpcTools.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Replace the unsafe-recipe validation test**

In `validates AI NPC crafting and survival tools before execution`, replace the `diamond_sword` unsafe-recipe assertion with:

```js
assert.deepStrictEqual(validateAiNpcToolCall({
  tool: 'craft_item',
  args: { item: 'diamond_sword' }
}), {
  ok: true,
  tool: 'craft_item',
  args: { item: 'diamond_sword', count: 1 }
})
```

This pins the new policy: validation allows arbitrary item names; Mineflayer recipe inspection decides runtime feasibility.

- [ ] **Step 2: Add failing Mineflayer-backed craft tests**

Add:

```js
it('crafts any Mineflayer-known recipe without hardcoded recipe allowlists', async () => {
  const { executeAiNpcTool } = require('../bot')
  const events = []
  const learnedRecipesPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'learned-recipes-')), 'learned-recipes.json')
  const bot = survivalToolBot(events)
  bot.registry.itemsByName.ladder = { id: 65 }
  bot.recipesFor = (type, metadata, count, craftingTable) => {
    assert.strictEqual(type, 65)
    assert.strictEqual(count, 3)
    assert.strictEqual(craftingTable, null)
    return [{ id: 'ladder_recipe', result: { id: 65, count: 3 }, delta: [] }]
  }
  bot.craft = async (recipe, count) => events.push(['craft', recipe.id, count])

  const result = await executeAiNpcTool(bot, {
    tool: 'craft_item',
    args: { item: 'ladder', count: 3 }
  }, { learnedRecipesPath, now: () => 2000 })

  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(events, [['craft', 'ladder_recipe', 3]])
})

it('records blocked learned recipes when Mineflayer has no craftable recipe', async () => {
  const { executeAiNpcTool, readRecipeKnowledge } = require('../bot')
  const learnedRecipesPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'learned-recipes-')), 'learned-recipes.json')
  const bot = survivalToolBot()
  bot.registry.itemsByName.ladder = { id: 65 }
  bot.recipesFor = () => []
  bot.recipesAll = () => [{ id: 'ladder_recipe', requiresTable: true }]

  const result = await executeAiNpcTool(bot, {
    tool: 'craft_item',
    args: { item: 'ladder', count: 3 }
  }, { learnedRecipesPath, now: () => 3000 })
  const knowledge = readRecipeKnowledge({ learnedRecipesPath })

  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.reason, 'missing-ingredients-or-table')
  assert.strictEqual(knowledge.recipes.ladder.status, 'blocked')
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "crafting and survival|Mineflayer-known recipe|blocked learned recipes" --reporter spec --exit
```

Expected: FAIL while `SAFE_CRAFT_RECIPES` still rejects `ladder`.

- [ ] **Step 4: Remove hardcoded recipe validation**

In `src/aiNpcTools.js`:

- Delete the `SAFE_CRAFT_RECIPES` constant.
- Delete `recipeMissingIngredients`.
- Update `validateCraftItemArgs` to:

```js
function validateCraftItemArgs (args) {
  const item = sanitizeItemNames(args.item || args.items)[0]
  const count = positiveIntegerOrNull(args.count) || 1
  if (!item) return { ok: false, reason: 'missing-item' }
  if (count > 64) return { ok: false, reason: 'craft-count-too-large' }
  return { ok: true, args: { item, count } }
}
```

- [ ] **Step 5: Refactor `list_craftable_items`**

Replace the existing `list_craftable_items` implementation with inventory-grounded output:

```js
{
  name: 'list_craftable_items',
  description: 'List currently craftable target items known from the bot registry and Mineflayer recipe API.',
  validate: passArgs,
  execute: async (bot, args) => {
    if (typeof bot.recipesFor !== 'function') return { items: [] }
    const limit = Math.max(1, Math.min(Number.parseInt(args.limit || 24, 10) || 24, 64))
    const names = Object.keys(bot.registry?.itemsByName || {})
    const items = []
    for (const name of names) {
      const type = itemTypeForRecipe(bot, name)
      if (type === null) continue
      const recipes = bot.recipesFor(type, null, 1, null)
      if (recipes.length === 0) continue
      items.push({ name, craftable: true, recipes: recipes.length })
      if (items.length >= limit) break
    }
    return { items }
  }
}
```

- [ ] **Step 6: Refactor `craft_item` execution**

Replace the existing missing ingredient check and recipe lookup with:

```js
const memoryPaths = resolveBotMemoryPaths(bot, options)
const learnedRecipesPath = options.learnedRecipesPath || memoryPaths.learnedRecipesPath
const itemType = itemTypeForRecipe(bot, args.item)
if (itemType === null) {
  upsertLearnedRecipe({
    item: args.item,
    status: 'failed',
    minecraftVersion: bot.version || bot.registry?.version?.minecraftVersion || '',
    plan: [],
    missingIngredients: ['unknown-item']
  }, { ...options, learnedRecipesPath })
  return { ok: false, reason: 'unknown-item' }
}

const inventoryRecipes = bot.recipesFor(itemType, null, args.count, null)
const recipe = Array.isArray(inventoryRecipes) ? inventoryRecipes[0] : null
if (!recipe) {
  const allInventoryRecipes = typeof bot.recipesAll === 'function' ? bot.recipesAll(itemType, null, null) : []
  const tableRecipes = typeof bot.recipesAll === 'function' ? bot.recipesAll(itemType, null, true) : []
  upsertLearnedRecipe({
    item: args.item,
    status: 'blocked',
    minecraftVersion: bot.version || bot.registry?.version?.minecraftVersion || '',
    plan: [],
    missingIngredients: tableRecipes.length > allInventoryRecipes.length ? ['crafting_table_or_ingredients'] : ['ingredients']
  }, { ...options, learnedRecipesPath })
  return { ok: false, reason: 'missing-ingredients-or-table' }
}

await bot.craft(recipe, args.count)
upsertLearnedRecipe({
  item: args.item,
  status: 'verified',
  minecraftVersion: bot.version || bot.registry?.version?.minecraftVersion || '',
  plan: [{ tool: 'craft_item', item: args.item, count: args.count, requires: [] }],
  missingIngredients: []
}, { ...options, learnedRecipesPath })
return { item: args.item, count: args.count }
```

Keep the existing `crafting-support-unavailable` branch.

- [ ] **Step 7: Run the tests to verify they pass**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "crafting and survival|Mineflayer-known recipe|blocked learned recipes|safe craftable|crafts known safe" --reporter spec --exit
```

Expected: PASS after updating older tests that mention “safe craftable” to expect registry/Mineflayer-backed behavior.

## Task 5: Add `plan_crafting_goal` And `craft_from_plan` Skeletons

**Files:**

- Modify: `src/aiNpcTools.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing tool tests**

Add `plan_crafting_goal` and `craft_from_plan` to the initial tool list.

Add:

```js
it('plans and crafts from learned recipe plans', async () => {
  const { executeAiNpcTool, readRecipeKnowledge } = require('../bot')
  const events = []
  const learnedRecipesPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'learned-recipes-')), 'learned-recipes.json')
  const bot = survivalToolBot(events)
  bot.registry.itemsByName.ladder = { id: 65 }
  bot.recipesAll = () => [{ id: 'ladder_recipe', result: { id: 65, count: 3 }, delta: [] }]
  bot.recipesFor = () => [{ id: 'ladder_recipe', result: { id: 65, count: 3 }, delta: [] }]
  bot.craft = async (recipe, count) => events.push(['craft', recipe.id, count])

  const planned = await executeAiNpcTool(bot, {
    tool: 'plan_crafting_goal',
    args: { item: 'ladder', count: 3 }
  }, { learnedRecipesPath, now: () => 4000 })
  const crafted = await executeAiNpcTool(bot, {
    tool: 'craft_from_plan',
    args: { item: 'ladder' }
  }, { learnedRecipesPath })
  const knowledge = readRecipeKnowledge({ learnedRecipesPath })

  assert.strictEqual(planned.ok, true)
  assert.strictEqual(crafted.ok, true)
  assert.strictEqual(knowledge.recipes.ladder.status, 'verified')
  assert.deepStrictEqual(events, [['craft', 'ladder_recipe', 3]])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "plans and crafts from learned recipe plans|initial AI NPC tools" --reporter spec --exit
```

Expected: FAIL because the new tools are unknown.

- [ ] **Step 3: Add validators**

In `src/aiNpcTools.js`, reuse `validateRecipeItemArgs` for both tools.

- [ ] **Step 4: Add `plan_crafting_goal`**

Add:

```js
{
  name: 'plan_crafting_goal',
  description: 'Create and cache a Mineflayer-grounded single-target crafting plan.',
  validate: validateRecipeItemArgs,
  execute: async (bot, args, options) => {
    const memoryPaths = resolveBotMemoryPaths(bot, options)
    const learnedRecipesPath = options.learnedRecipesPath || memoryPaths.learnedRecipesPath
    const state = inspectRecipeState(bot, args)
    if (!state.known) {
      const record = upsertLearnedRecipe({
        item: args.item,
        status: 'failed',
        minecraftVersion: bot.version || bot.registry?.version?.minecraftVersion || '',
        plan: [],
        missingIngredients: ['missing-recipe']
      }, { ...options, learnedRecipesPath })
      return { ok: false, reason: 'missing-recipe', record }
    }
    const record = upsertLearnedRecipe({
      item: args.item,
      status: state.requiresCraftingTable ? 'blocked' : 'verified',
      minecraftVersion: bot.version || bot.registry?.version?.minecraftVersion || '',
      plan: [{ tool: 'craft_item', item: args.item, count: args.count, requires: [] }],
      missingIngredients: state.requiresCraftingTable ? ['crafting_table_or_ingredients'] : []
    }, { ...options, learnedRecipesPath })
    return { record, recipe: state }
  }
}
```

- [ ] **Step 5: Add `craft_from_plan`**

Add:

```js
{
  name: 'craft_from_plan',
  description: 'Craft from a cached learned recipe plan after immediate Mineflayer validation.',
  validate: validateRecipeItemArgs,
  execute: async (bot, args, options) => {
    const memoryPaths = resolveBotMemoryPaths(bot, options)
    const learnedRecipesPath = options.learnedRecipesPath || memoryPaths.learnedRecipesPath
    const record = readRecipeKnowledge({ ...options, learnedRecipesPath }).recipes[args.item]
    if (!record) return { ok: false, reason: 'missing-plan' }
    const step = record.plan[record.plan.length - 1]
    if (!step) return { ok: false, reason: 'empty-plan' }
    return toolDefinitions()
      .find(tool => tool.name === 'craft_item')
      .execute(bot, { item: step.item, count: step.count }, { ...options, learnedRecipesPath })
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "plans and crafts from learned recipe plans|initial AI NPC tools" --reporter spec --exit
```

Expected: PASS.

## Task 6: Verification And Cleanup

**Files:**

- Modify as needed: `src/aiNpcTools.js`, `test/botConfigTest.js`

- [ ] **Step 1: Confirm hardcoded recipe constant is gone**

Run:

```powershell
rg -n "SAFE_CRAFT_RECIPES|unsafe-recipe|recipeMissingIngredients" src test docs
```

Expected: No matches in `src` or tests. Matches in historical design docs are acceptable only when discussing removal.

- [ ] **Step 2: Run lint**

Run:

```powershell
npx standard src\recipeKnowledge.js src\botMemory.js src\aiNpcTools.js src\index.js test\botConfigTest.js
```

Expected: PASS.

- [ ] **Step 3: Run focused AI NPC recipe tests**

Run:

```powershell
npx mocha test/botConfigTest.js --grep "learned recipe knowledge|Mineflayer recipes|compact learned recipe|Mineflayer-known recipe|blocked learned recipes|plans and crafts|crafting and survival|initial AI NPC tools" --reporter dot --exit
```

Expected: PASS.

- [ ] **Step 4: Run full config tests**

Run:

```powershell
npx mocha test/botConfigTest.js --reporter dot --exit
```

Expected: PASS. If this modifies `MEMORY.md`, inspect with `git diff -- MEMORY.md` and restore only generated test fixture churn.

- [ ] **Step 5: Run final workspace checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors. Expected modified files are `src/botMemory.js`, `src/recipeKnowledge.js`, `src/aiNpcTools.js`, `src/index.js`, and `test/botConfigTest.js`.

## Follow-Up Plan

After this recipe plan is implemented and verified, create a separate blueprint implementation plan for:

- `blueprints.json`
- `build-projects.json`
- `save_blueprint`
- `inspect_blueprints`
- `validate_blueprint`
- `build_from_blueprint`
- replacing `SIMPLE_SHELTER_OFFSETS` and `LIGHT_AREA_OFFSETS`

That follow-up should preserve `place_block` and `dig_block` as safe low-level execution tools.

## Self-Review

- Spec coverage: This plan implements per-bot `learned-recipes.json`, Mineflayer recipe inspection, recipe knowledge reading, `craft_item` refactor away from hardcoded recipe names, and basic plan/craft tools. Blueprint caching is explicitly deferred into its own plan because it is an independent subsystem.
- Completion marker scan: No unfilled implementation markers are intentionally present.
- Type consistency: The plan consistently uses `learnedRecipesPath`, `learned-recipes.json`, `inspect_recipe`, `read_recipe_knowledge`, `plan_crafting_goal`, and `craft_from_plan`.
