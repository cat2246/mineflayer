const fs = require('fs')
const path = require('path')
const vec3 = require('vec3')
const { resolveBotMemoryPaths } = require('./botMemory')
const {
  containerItems,
  findNearbyContainerBlocks,
  readContainerMemory,
  visitContainerBlocks
} = require('./containers')
const { readMissingTools, recordMissingTool, recordSharedMissingTool } = require('./missingTools')
const { readPlaceCoordinates, rememberPlaceCoordinates } = require('./places')
const { readRecipeKnowledge, summarizeRecipeKnowledge, upsertLearnedRecipe } = require('./recipeKnowledge')

const MAX_TOOL_TEXT_LENGTH = 160
const SAFE_PLACE_NAME = /^[A-Za-z0-9_-]{1,32}$/
const BUILDING_SAFETY_POLICY = 'home_improvement'
const DEFAULT_BUILDING_HOME_RADIUS = 12
const SAFE_BUILDING_BLOCK_NAMES = new Set([
  'cobblestone',
  'dirt',
  'glass',
  'oak_planks',
  'spruce_planks',
  'birch_planks',
  'jungle_planks',
  'acacia_planks',
  'dark_oak_planks',
  'mangrove_planks',
  'cherry_planks',
  'torch'
])
const PROTECTED_BUILDING_BLOCK_PATTERN = /(chest|barrel|furnace|bed|door|glass|pane|log|wood|leaves|torch|lantern|sign|rail|spawner|water|lava|bedrock)/i
const SIMPLE_SHELTER_OFFSETS = [
  { x: 1, y: 1, z: 0 },
  { x: -1, y: 1, z: 0 },
  { x: 0, y: 1, z: 1 },
  { x: 0, y: 1, z: -1 }
]
const LIGHT_AREA_OFFSETS = [
  { x: 1, y: 1, z: 0 },
  { x: -1, y: 1, z: 0 },
  { x: 0, y: 1, z: 1 },
  { x: 0, y: 1, z: -1 }
]
const FOOD_ITEM_NAMES = new Set([
  'apple',
  'baked_potato',
  'beef',
  'bread',
  'carrot',
  'cooked_beef',
  'cooked_chicken',
  'cooked_cod',
  'cooked_mutton',
  'cooked_porkchop',
  'cooked_rabbit',
  'cooked_salmon',
  'golden_carrot',
  'melon_slice',
  'mushroom_stew',
  'potato',
  'pumpkin_pie'
])
const RAW_COOKABLE_FOOD_NAMES = new Set([
  'beef',
  'chicken',
  'cod',
  'mutton',
  'porkchop',
  'rabbit',
  'raw_beef',
  'raw_chicken',
  'raw_cod',
  'raw_mutton',
  'raw_porkchop',
  'raw_rabbit',
  'raw_salmon',
  'salmon'
])
const FUEL_ITEM_NAMES = new Set([
  'coal',
  'charcoal',
  'dried_kelp_block',
  'lava_bucket'
])
const SAFE_SMELT_ITEM_NAMES = new Set([
  'cobblestone',
  'copper_ore',
  'deepslate_copper_ore',
  'deepslate_gold_ore',
  'deepslate_iron_ore',
  'gold_ore',
  'iron_ore',
  'raw_copper',
  'raw_gold',
  'raw_iron',
  ...RAW_COOKABLE_FOOD_NAMES
])

function compactText (value, fallback = '', maxLength = MAX_TOOL_TEXT_LENGTH) {
  const text = String(value || fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, maxLength)
}

function objectArgs (args) {
  return args && typeof args === 'object' && !Array.isArray(args) ? args : {}
}

function roundedNumber (value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null
}

function positionSnapshot (position) {
  if (!position) return null
  return {
    x: roundedNumber(position.x),
    y: roundedNumber(position.y),
    z: roundedNumber(position.z)
  }
}

function inventorySnapshot (bot) {
  const items = typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
  return {
    emptySlots: typeof bot.inventory?.emptySlotCount === 'function'
      ? bot.inventory.emptySlotCount()
      : null,
    items: items
      .filter(item => item && item.count > 0)
      .slice(0, 24)
      .map(item => ({
        name: item.name,
        count: item.count
      }))
  }
}

function normalizeCommand (command) {
  const text = compactText(command, '', 120)
  if (!text || /[\r\n]/.test(text)) return ''
  return text.startsWith('/') ? text : `/${text}`
}

function isSafePlaceName (name) {
  return SAFE_PLACE_NAME.test(String(name || ''))
}

function isAllowedSafeCommand (command) {
  const normalized = normalizeCommand(command)
  if (!normalized) return false
  if (/^\/(spawn|survival|rtp|warps)$/i.test(normalized)) return true
  if (/^\/home\s+home$/i.test(normalized)) return true
  if (/^\/sethome\s+home$/i.test(normalized)) return true
  if (/^\/warp\s+[A-Za-z0-9_-]{1,32}$/i.test(normalized)) return true
  return false
}

function validateSafeCommandArgs (args) {
  const command = normalizeCommand(args.command)
  if (!isAllowedSafeCommand(command)) {
    return { ok: false, reason: 'command-not-allowed' }
  }
  return { ok: true, args: { command } }
}

function validateHomeNameArgs (args) {
  const name = compactText(args.name, 'home', 32)
  if (name !== 'home' || !isSafePlaceName(name)) return { ok: false, reason: 'invalid-home-name' }
  return { ok: true, args: { name } }
}

function validatePlaceArgs (args) {
  const name = compactText(args.name, '', 32)
  if (!isSafePlaceName(name)) return { ok: false, reason: 'invalid-place-name' }
  return { ok: true, args: { name } }
}

function validateMemoryEventArgs (args) {
  const type = compactText(args.type, '', 80)
  const message = compactText(args.message || args.reason, '', 300)
  if (!type) return { ok: false, reason: 'missing-event-type' }
  return { ok: true, args: { type, message } }
}

function validateMissingToolArgs (args) {
  const capability = compactText(args.capability, '', 120)
  if (!capability) return { ok: false, reason: 'missing-capability' }
  return {
    ok: true,
    args: {
      capability,
      desiredTool: compactText(args.desiredTool || args.suggestedTool || args.tool, '', 120),
      blockedGoal: compactText(args.blockedGoal || args.goal, 'Unspecified goal', 160),
      reason: compactText(args.reason, 'No reason captured', 300),
      priority: compactText(args.priority, 'medium', 20)
    }
  }
}

function sanitizeItemNames (value) {
  const items = Array.isArray(value) ? value : [value]
  return [...new Set(items
    .map(item => compactText(item, '', 80))
    .filter(Boolean))]
}

function positiveIntegerOrNull (value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function validateDepositItemsArgs (args) {
  const items = sanitizeItemNames(args.items || args.item)
  if (items.length === 0) return { ok: false, reason: 'missing-items' }
  return {
    ok: true,
    args: {
      items,
      maxCount: positiveIntegerOrNull(args.maxCount || args.count)
    }
  }
}

function validateWithdrawItemsArgs (args) {
  const item = sanitizeItemNames(args.item || args.items)[0]
  const count = positiveIntegerOrNull(args.count) || 1
  if (!item) return { ok: false, reason: 'missing-item' }
  return { ok: true, args: { item, count } }
}

function validateEquipItemArgs (args) {
  const item = sanitizeItemNames(args.item || args.items)[0]
  const destination = compactText(args.destination, 'hand', 32).toLowerCase()
  if (!item) return { ok: false, reason: 'missing-item' }
  if (!['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'].includes(destination)) {
    return { ok: false, reason: 'invalid-destination' }
  }
  return { ok: true, args: { item, destination } }
}

function validateContainerSearchArgs (args) {
  const maxDistance = positiveIntegerOrNull(args.maxDistance || args.searchRadius)
  return {
    ok: true,
    args: {
      maxDistance: maxDistance || 8
    }
  }
}

function validateCraftItemArgs (args) {
  const item = sanitizeItemNames(args.item || args.items)[0]
  const count = positiveIntegerOrNull(args.count) || 1
  if (!item) return { ok: false, reason: 'missing-item' }
  if (count > 64) return { ok: false, reason: 'craft-count-too-large' }
  return { ok: true, args: { item, count } }
}

function validateRecipeItemArgs (args) {
  const item = sanitizeItemNames(args.item || args.items)[0]
  const count = positiveIntegerOrNull(args.count) || 1
  if (!item) return { ok: false, reason: 'missing-item' }
  if (count > 64) return { ok: false, reason: 'recipe-count-too-large' }
  return { ok: true, args: { item, count } }
}

function validateOptionalItemArgs (args) {
  const item = sanitizeItemNames(args.item || args.items)[0] || null
  return { ok: true, args: { item } }
}

function validateFurnaceItemArgs (args) {
  const item = sanitizeItemNames(args.item || args.items)[0]
  const count = positiveIntegerOrNull(args.count) || 1
  if (!item) return { ok: false, reason: 'missing-item' }
  if (!SAFE_SMELT_ITEM_NAMES.has(item)) return { ok: false, reason: 'unsafe-smelt-item' }
  return { ok: true, args: { item, count } }
}

function normalizePositionArg (value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  const z = Number(value.z)
  if (![x, y, z].every(Number.isFinite)) return null
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
}

function validateBuildingSafetyPolicy (args) {
  const safetyPolicy = compactText(args.safetyPolicy || args.safety_policy, '', 40)
  return safetyPolicy === BUILDING_SAFETY_POLICY ? safetyPolicy : null
}

function validateBuildingPositionArgs (args, options = {}) {
  const safetyPolicy = validateBuildingSafetyPolicy(args)
  if (!safetyPolicy) return { ok: false, reason: 'safety-policy-required' }
  const position = normalizePositionArg(args.position || args.target)
  if (!position) return { ok: false, reason: 'missing-position' }
  return { ok: true, args: { ...options, position, safetyPolicy } }
}

function validatePlaceBlockArgs (args) {
  const item = sanitizeItemNames(args.item || args.block)[0]
  if (!item) return { ok: false, reason: 'missing-item' }
  if (!SAFE_BUILDING_BLOCK_NAMES.has(item)) return { ok: false, reason: 'unsafe-building-block' }
  return validateBuildingPositionArgs(args, { item })
}

function validateDigBlockArgs (args) {
  return validateBuildingPositionArgs(args)
}

function validateShelterArgs (args) {
  const safetyPolicy = validateBuildingSafetyPolicy(args)
  if (!safetyPolicy) return { ok: false, reason: 'safety-policy-required' }
  const item = sanitizeItemNames(args.item || args.block)[0] || 'cobblestone'
  if (!SAFE_BUILDING_BLOCK_NAMES.has(item) || item === 'torch') return { ok: false, reason: 'unsafe-building-block' }
  return { ok: true, args: { item, safetyPolicy } }
}

function validateLightAreaArgs (args) {
  const safetyPolicy = validateBuildingSafetyPolicy(args)
  if (!safetyPolicy) return { ok: false, reason: 'safety-policy-required' }
  return { ok: true, args: { item: 'torch', safetyPolicy } }
}

function validateRepairShelterArgs (args) {
  const safetyPolicy = validateBuildingSafetyPolicy(args)
  if (!safetyPolicy) return { ok: false, reason: 'safety-policy-required' }
  const item = sanitizeItemNames(args.item || args.block)[0] || 'cobblestone'
  if (!SAFE_BUILDING_BLOCK_NAMES.has(item) || item === 'torch') return { ok: false, reason: 'unsafe-building-block' }
  const holes = (Array.isArray(args.holes) ? args.holes : [args.position || args.target])
    .map(normalizePositionArg)
    .filter(Boolean)
    .slice(0, 8)
  if (holes.length === 0) return { ok: false, reason: 'missing-position' }
  return { ok: true, args: { item, holes, safetyPolicy } }
}

function passArgs (args) {
  return { ok: true, args: objectArgs(args) }
}

function itemMatchesName (item, name) {
  return String(item?.name || '').toLowerCase() === String(name || '').toLowerCase()
}

function itemMatchesAnyName (item, names) {
  return names.some(name => itemMatchesName(item, name))
}

function inventoryItems (bot) {
  return typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
}

function itemIdByName (bot, itemName) {
  return bot.registry?.itemsByName?.[itemName]?.id ?? null
}

function itemTypeForRecipe (bot, itemName) {
  return itemIdByName(bot, itemName)
}

function itemNameByType (bot, type) {
  return Object.entries(bot.registry?.itemsByName || {})
    .find(([, item]) => item?.id === type)?.[0] || null
}

function recipeRequires (bot, recipe) {
  if (!Array.isArray(recipe?.delta)) return []

  return [...new Set(recipe.delta
    .filter(entry => Number(entry?.count) < 0)
    .map(entry => itemNameByType(bot, entry.id ?? entry.type))
    .filter(Boolean))]
    .sort()
}

function craftOperationCount (recipe, desiredCount) {
  return Math.max(1, Math.ceil(desiredCount / (recipe.result?.count || 1)))
}

function recipesAllForTableState (bot, itemType, craftingTable) {
  if (typeof bot.recipesAll !== 'function') return []
  const recipes = bot.recipesAll(itemType, null, craftingTable)
  return Array.isArray(recipes) ? recipes : []
}

function inspectRecipeState (bot, args) {
  if (typeof bot.recipesAll !== 'function') return { ok: false, reason: 'recipe-support-unavailable' }

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

  const inventoryRecipes = recipesAllForTableState(bot, itemType, false)
  const tableRecipes = recipesAllForTableState(bot, itemType, true)

  return {
    item: args.item,
    count: args.count,
    known: inventoryRecipes.length > 0 || tableRecipes.length > 0,
    inventoryRecipes: inventoryRecipes.length,
    tableRecipes: tableRecipes.length,
    requiresCraftingTable: inventoryRecipes.length === 0 && tableRecipes.length > 0
  }
}

function findInventoryItem (bot, itemName) {
  return inventoryItems(bot).find(item => itemMatchesName(item, itemName))
}

function isFoodItem (bot, item) {
  return Boolean(item?.name && (bot.registry?.foodsByName?.[item.name] || FOOD_ITEM_NAMES.has(item.name)))
}

function findFoodItem (bot, itemName) {
  return inventoryItems(bot)
    .filter(isFoodItem.bind(null, bot))
    .find(item => !itemName || itemMatchesName(item, itemName)) || null
}

function isFuelItem (item) {
  return Boolean(item?.name && FUEL_ITEM_NAMES.has(item.name))
}

function findFuelItem (bot) {
  return inventoryItems(bot).find(isFuelItem) || null
}

function isBedBlockName (name = '') {
  return /_bed$/i.test(name) || name === 'bed'
}

function isFurnaceBlockName (name = '') {
  return /^(furnace|smoker|blast_furnace)$/i.test(name)
}

function isCraftingTableBlockName (name = '') {
  return name === 'crafting_table'
}

function findNearbyBlockForTool (bot, predicate, options = {}) {
  const maxDistance = options.searchRadius || options.maxDistance || 8
  if (typeof bot.findBlock === 'function') return bot.findBlock({ matching: predicate, maxDistance })
  if (typeof bot.findBlocks !== 'function') return null
  const position = bot.findBlocks({ matching: predicate, maxDistance, count: 16 })[0]
  return position ? bot.blockAt(position) : null
}

function findNearbyCraftingTable (bot, options = {}) {
  return findNearbyBlockForTool(bot, block => isCraftingTableBlockName(block?.name), options)
}

function recordUnavailableTool (bot, tool, reason, options) {
  const memoryPaths = resolveBotMemoryPaths(bot, options)
  return recordMissingTool({
    capability: `Unavailable tool support: ${tool}`,
    desiredTool: tool,
    blockedGoal: 'NPC survival action',
    reason,
    priority: 'medium'
  }, {
    ...options,
    missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
  })
}

async function executeCraftItem (bot, args, options = {}) {
  if (typeof bot.recipesFor !== 'function' || typeof bot.craft !== 'function') {
    return {
      ok: false,
      reason: 'crafting-support-unavailable',
      missingTool: recordUnavailableTool(bot, 'craft_item', 'Bot cannot inspect recipes or craft items.', options)
    }
  }

  const memoryPaths = resolveBotMemoryPaths(bot, options)
  const learnedRecipesPath = options.learnedRecipesPath || memoryPaths.learnedRecipesPath
  const recipeOptions = { ...options, learnedRecipesPath }
  const minecraftVersion = compactText(bot.version || bot.registry?.version?.minecraftVersion || '', '', 40)

  const itemType = itemTypeForRecipe(bot, args.item)
  if (itemType === null) {
    upsertLearnedRecipe({
      item: args.item,
      status: 'failed',
      minecraftVersion,
      plan: [],
      missingIngredients: ['unknown-item']
    }, recipeOptions)
    return { ok: false, reason: 'unknown-item', missingIngredients: ['unknown-item'] }
  }

  const inventoryRecipes = bot.recipesFor(itemType, null, args.count, null)
  let craftingTable = null
  let recipe = Array.isArray(inventoryRecipes) ? inventoryRecipes[0] : null
  if (!recipe) {
    craftingTable = findNearbyCraftingTable(bot, options)
    if (craftingTable) {
      const tableRecipes = bot.recipesFor(itemType, null, args.count, craftingTable)
      recipe = Array.isArray(tableRecipes) ? tableRecipes[0] : null
    }
  }
  if (!recipe) {
    const allInventoryRecipes = recipesAllForTableState(bot, itemType, false)
    const allTableRecipes = recipesAllForTableState(bot, itemType, true)
    const missingIngredients = allTableRecipes.length > allInventoryRecipes.length
      ? ['crafting_table_or_ingredients']
      : ['ingredients']

    upsertLearnedRecipe({
      item: args.item,
      status: 'blocked',
      minecraftVersion,
      plan: [],
      missingIngredients
    }, recipeOptions)
    return { ok: false, reason: 'missing-ingredients-or-table', missingIngredients }
  }

  await bot.craft(recipe, craftOperationCount(recipe, args.count), craftingTable)
  upsertLearnedRecipe({
    item: args.item,
    status: 'verified',
    minecraftVersion,
    plan: [{ tool: 'craft_item', item: args.item, count: args.count, requires: recipeRequires(bot, recipe) }],
    missingIngredients: []
  }, recipeOptions)
  return { item: args.item, count: args.count }
}

function furnaceInputCount (item, requestedCount) {
  return Math.min(item.count, requestedCount)
}

async function putItemInFurnace (bot, args, options = {}) {
  if (typeof bot.openFurnace !== 'function') {
    return { ok: false, reason: 'furnace-support-unavailable', missingTool: recordUnavailableTool(bot, 'openFurnace', 'Bot cannot open furnaces.', options) }
  }

  const input = findInventoryItem(bot, args.item)
  if (!input) return { ok: false, reason: 'missing-ingredients', missingIngredients: [args.item] }

  const fuel = findFuelItem(bot)
  if (!fuel) return { ok: false, reason: 'missing-ingredients', missingIngredients: ['fuel'] }

  const furnaceBlock = findNearbyBlockForTool(bot, block => isFurnaceBlockName(block.name), options)
  if (!furnaceBlock) return { ok: false, reason: 'missing-furnace' }

  const furnace = await bot.openFurnace(furnaceBlock)
  const count = furnaceInputCount(input, args.count)
  try {
    if (typeof furnace.outputItem === 'function' && furnace.outputItem() && typeof furnace.takeOutput === 'function') {
      await furnace.takeOutput()
    }
    if (typeof furnace.fuelItem === 'function' && !furnace.fuelItem()) {
      await furnace.putFuel(fuel.type, fuel.metadata ?? null, 1)
    }
    if (typeof furnace.inputItem === 'function' && !furnace.inputItem()) {
      await furnace.putInput(input.type, input.metadata ?? null, count)
    }
  } finally {
    if (typeof furnace.close === 'function') furnace.close()
  }

  return {
    input: input.name,
    count,
    fuel: fuel.name,
    furnace: containerBlockSnapshot(furnaceBlock)
  }
}

function buildingHomePosition (bot, options = {}) {
  return normalizePositionArg(options.homePosition) ||
    normalizePositionArg(readPlaceCoordinates('home', options)?.position) ||
    normalizePositionArg(bot.__containerHomeAnchor) ||
    normalizePositionArg(bot.__nightSafetyHomeAnchor) ||
    null
}

function horizontalDistanceBetween (a, b) {
  return Math.sqrt(
    Math.pow((a?.x || 0) - (b?.x || 0), 2) +
    Math.pow((a?.z || 0) - (b?.z || 0), 2)
  )
}

function isWithinBuildingHomeRadius (position, homePosition, options = {}) {
  return horizontalDistanceBetween(position, homePosition) <= (options.buildingHomeRadius ?? DEFAULT_BUILDING_HOME_RADIUS)
}

function buildingTargetAllowed (bot, position, options = {}) {
  const homePosition = buildingHomePosition(bot, options)
  if (!homePosition) return { ok: false, reason: 'missing-home' }
  if (!isWithinBuildingHomeRadius(position, homePosition, options)) {
    return { ok: false, reason: 'outside-home-build-radius' }
  }
  return { ok: true, homePosition }
}

function blockAtPosition (bot, position) {
  if (typeof bot.blockAt !== 'function') return null
  return bot.blockAt(vec3(position.x, position.y, position.z))
}

function isAirBlock (block) {
  return !block || /^(air|cave_air|void_air)$/i.test(block.name || '')
}

function isProtectedBuildingBlock (block) {
  return Boolean(block?.name && PROTECTED_BUILDING_BLOCK_PATTERN.test(block.name))
}

function offsetPosition (position, offset) {
  return {
    x: position.x + offset.x,
    y: position.y + offset.y,
    z: position.z + offset.z
  }
}

function faceVectorFromReference (referencePosition, targetPosition) {
  return vec3(
    targetPosition.x - referencePosition.x,
    targetPosition.y - referencePosition.y,
    targetPosition.z - referencePosition.z
  )
}

function findPlacementReference (bot, targetPosition) {
  const offsets = [
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 1 }
  ]

  for (const offset of offsets) {
    const referencePosition = offsetPosition(targetPosition, offset)
    const referenceBlock = blockAtPosition(bot, referencePosition)
    if (isAirBlock(referenceBlock) || isProtectedBuildingBlock(referenceBlock)) continue
    return {
      referenceBlock,
      faceVector: faceVectorFromReference(referencePosition, targetPosition)
    }
  }
  return null
}

function appendBuildingEvent (bot, type, message, data, options = {}) {
  const memoryPaths = resolveBotMemoryPaths(bot, options)
  const eventLogPath = options.eventLogPath || memoryPaths.eventLogPath
  if (!eventLogPath) return null
  const event = {
    at: options.now?.() || Date.now(),
    source: 'ai-npc-tool',
    type,
    message,
    data
  }
  fs.mkdirSync(path.dirname(eventLogPath), { recursive: true })
  fs.appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`)
  return event
}

async function placeBuildingBlock (bot, itemName, targetPosition, options = {}) {
  const allowed = buildingTargetAllowed(bot, targetPosition, options)
  if (!allowed.ok) return allowed
  if (typeof bot.placeBlock !== 'function' || typeof bot.equip !== 'function') {
    return { ok: false, reason: 'building-support-unavailable' }
  }

  const existing = blockAtPosition(bot, targetPosition)
  if (!isAirBlock(existing)) return { ok: false, reason: 'target-occupied' }

  const item = findInventoryItem(bot, itemName)
  if (!item) return { ok: false, reason: 'missing-ingredients', missingIngredients: [itemName] }

  const placement = findPlacementReference(bot, targetPosition)
  if (!placement) return { ok: false, reason: 'missing-reference-block' }

  await bot.equip(item, 'hand')
  await bot.placeBlock(placement.referenceBlock, placement.faceVector)
  const placed = { item: item.name, position: targetPosition }
  appendBuildingEvent(bot, 'building_project', `Placed ${item.name} near home.`, placed, options)
  return placed
}

async function digBuildingBlock (bot, targetPosition, options = {}) {
  const allowed = buildingTargetAllowed(bot, targetPosition, options)
  if (!allowed.ok) return allowed
  if (typeof bot.dig !== 'function') return { ok: false, reason: 'dig-support-unavailable' }

  const target = blockAtPosition(bot, targetPosition)
  if (isAirBlock(target)) return { ok: false, reason: 'missing-block' }
  if (isProtectedBuildingBlock(target)) return { ok: false, reason: 'protected-block' }
  if (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(target)) return { ok: false, reason: 'undiggable-block' }

  await bot.dig(target)
  const dug = { block: target.name, position: targetPosition }
  appendBuildingEvent(bot, 'building_project', `Dug ${target.name} near home.`, dug, options)
  return dug
}

function plannedHomePositions (bot, offsets, options = {}) {
  const homePosition = buildingHomePosition(bot, options)
  if (!homePosition) return null
  return offsets.map(offset => offsetPosition(homePosition, offset))
}

function containerBlockSnapshot (block) {
  return {
    name: block.name,
    position: positionSnapshot(block.position)
  }
}

function findContainerBlocksForTool (bot, args, options) {
  return findNearbyContainerBlocks(bot, {
    ...options,
    chestSearchRadius: args.maxDistance,
    searchRadius: args.maxDistance,
    houseOnly: false
  })
}

function toolDefinitions () {
  return [
    {
      name: 'observe_world',
      description: 'Read compact bot/world state.',
      validate: passArgs,
      execute: async (bot) => ({
        bot: {
          username: bot.username || null,
          position: positionSnapshot(bot.entity?.position),
          health: typeof bot.health === 'number' ? bot.health : null,
          food: typeof bot.food === 'number' ? bot.food : null,
          dimension: bot.game?.dimension || bot.game?.dimensionType || null
        },
        time: {
          isDay: bot.time?.isDay ?? null,
          timeOfDay: typeof bot.time?.timeOfDay === 'number' ? bot.time.timeOfDay : null
        },
        players: Object.keys(bot.players || {}).filter(username => username && username !== bot.username)
      })
    },
    {
      name: 'inspect_inventory',
      description: 'Read compact inventory state.',
      validate: passArgs,
      execute: async bot => inventorySnapshot(bot)
    },
    {
      name: 'run_safe_command',
      description: 'Run an allowlisted survival command.',
      validate: validateSafeCommandArgs,
      execute: async (bot, args) => {
        if (typeof bot.chat !== 'function') return { ok: false, reason: 'chat-unavailable' }
        bot.chat(args.command)
        return { command: args.command }
      }
    },
    {
      name: 'rtp',
      description: 'Run /rtp for a fresh wilderness start.',
      validate: passArgs,
      execute: async bot => {
        if (typeof bot.chat !== 'function') return { ok: false, reason: 'chat-unavailable' }
        bot.chat('/rtp')
        return { command: '/rtp' }
      }
    },
    {
      name: 'set_home',
      description: 'Set and remember /sethome home.',
      validate: validateHomeNameArgs,
      execute: async (bot, args, options) => {
        if (typeof bot.chat !== 'function') return { ok: false, reason: 'chat-unavailable' }
        if (!bot.entity?.position) return { ok: false, reason: 'position-unavailable' }
        bot.chat(`/sethome ${args.name}`)
        const place = rememberPlaceCoordinates(bot, args.name, bot.entity.position, options)
        return { command: `/sethome ${args.name}`, place }
      }
    },
    {
      name: 'go_home',
      description: 'Run /home home.',
      validate: validateHomeNameArgs,
      execute: async (bot, args) => {
        if (typeof bot.chat !== 'function') return { ok: false, reason: 'chat-unavailable' }
        bot.chat(`/home ${args.name}`)
        return { command: `/home ${args.name}` }
      }
    },
    {
      name: 'remember_place',
      description: 'Remember current position as a named place.',
      validate: validatePlaceArgs,
      execute: async (bot, args, options) => {
        if (!bot.entity?.position) return { ok: false, reason: 'position-unavailable' }
        return readPlaceCoordinates(args.name, options) ||
          rememberPlaceCoordinates(bot, args.name, bot.entity.position, options)
      }
    },
    {
      name: 'write_memory_event',
      description: 'Append a compact event to event-log.jsonl.',
      validate: validateMemoryEventArgs,
      execute: async (bot, args, options) => {
        const memoryPaths = resolveBotMemoryPaths(bot, options)
        const eventLogPath = options.eventLogPath || memoryPaths.eventLogPath
        const event = {
          at: options.now?.() || Date.now(),
          source: 'ai-npc-tool',
          type: args.type,
          message: args.message
        }
        fs.mkdirSync(path.dirname(eventLogPath), { recursive: true })
        fs.appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`)
        return { path: eventLogPath, event }
      }
    },
    {
      name: 'record_missing_tool',
      description: 'Record a missing capability in structured memory.',
      validate: validateMissingToolArgs,
      execute: async (bot, args, options) => {
        const memoryPaths = resolveBotMemoryPaths(bot, options)
        const record = recordMissingTool(args, {
          ...options,
          missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
        })
        const shared = options.sharedMissingToolsPath
          ? recordSharedMissingTool(args, options)
          : null
        return { record, shared }
      }
    },
    {
      name: 'read_missing_tools',
      description: 'Read top structured missing capabilities.',
      validate: passArgs,
      execute: async (bot, args, options) => {
        const memoryPaths = resolveBotMemoryPaths(bot, options)
        const limit = Math.max(1, Math.min(Number.parseInt(args.limit || 5, 10), 20))
        return readMissingTools({
          ...options,
          missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
        }).slice(0, limit)
      }
    },
    {
      name: 'deposit_items',
      description: 'Deposit explicitly selected inventory items into a nearby container.',
      validate: validateDepositItemsArgs,
      execute: async (bot, args, options) => {
        const blocks = findContainerBlocksForTool(bot, { maxDistance: options.chestSearchRadius || 8 }, options)
        if (blocks.length === 0) return { ok: false, reason: 'no-container' }
        const deposited = []
        let remaining = args.maxCount

        const visited = await visitContainerBlocks(bot, blocks, {
          ...options,
          houseOnly: false,
          originPosition: bot.entity?.position
        }, async container => {
          const candidates = (typeof bot.inventory?.items === 'function' ? bot.inventory.items() : [])
            .filter(item => item && item.count > 0 && itemMatchesAnyName(item, args.items))

          for (const item of candidates) {
            if (remaining !== null && remaining <= 0) break
            const count = remaining === null ? item.count : Math.min(item.count, remaining)
            await container.deposit(item.type, item.metadata ?? null, count)
            deposited.push({ name: item.name, count })
            if (remaining !== null) remaining -= count
          }

          return deposited.length > 0
        })

        if (!visited) return { ok: false, reason: 'item-unavailable', deposited }
        return { deposited }
      }
    },
    {
      name: 'withdraw_items',
      description: 'Withdraw an explicitly selected item from a nearby container.',
      validate: validateWithdrawItemsArgs,
      execute: async (bot, args, options) => {
        const blocks = findContainerBlocksForTool(bot, { maxDistance: options.chestSearchRadius || 8 }, options)
        if (blocks.length === 0) return { ok: false, reason: 'no-container' }
        const withdrawn = []

        const visited = await visitContainerBlocks(bot, blocks, {
          ...options,
          houseOnly: false,
          originPosition: bot.entity?.position
        }, async container => {
          const item = containerItems(container).find(candidate => itemMatchesName(candidate, args.item))
          if (!item) return false

          const count = Math.min(args.count, item.count)
          await container.withdraw(item.type, item.metadata ?? null, count)
          withdrawn.push({ name: item.name, count })
          return true
        })

        if (!visited) return { ok: false, reason: 'item-unavailable', withdrawn }
        return { withdrawn }
      }
    },
    {
      name: 'equip_item',
      description: 'Equip a selected inventory item.',
      validate: validateEquipItemArgs,
      execute: async (bot, args) => {
        if (typeof bot.equip !== 'function') return { ok: false, reason: 'equip-unavailable' }
        const item = (typeof bot.inventory?.items === 'function' ? bot.inventory.items() : [])
          .find(candidate => itemMatchesName(candidate, args.item))
        if (!item) return { ok: false, reason: 'item-unavailable' }
        await bot.equip(item, args.destination)
        return { item: item.name, destination: args.destination }
      }
    },
    {
      name: 'find_container',
      description: 'Find nearby containers and return compact locations.',
      validate: validateContainerSearchArgs,
      execute: async (bot, args, options) => {
        const blocks = findContainerBlocksForTool(bot, args, options)
        return { containers: blocks.map(containerBlockSnapshot) }
      }
    },
    {
      name: 'remember_container',
      description: 'Remember nearby containers in structured container memory.',
      validate: validateContainerSearchArgs,
      execute: async (bot, args, options) => {
        const blocks = findContainerBlocksForTool(bot, args, options)
        return {
          containers: blocks.map(containerBlockSnapshot),
          memory: readContainerMemory(options)
        }
      }
    },
    {
      name: 'list_craftable_items',
      description: 'List currently craftable items from Mineflayer recipe data.',
      validate: passArgs,
      execute: async (bot, args) => {
        const limit = Math.max(1, Math.min(Number.parseInt(args.limit || 24, 10) || 24, 64))
        const itemsByName = bot.registry?.itemsByName || {}
        const items = []

        if (typeof bot.recipesFor !== 'function') return { items }

        for (const [name, item] of Object.entries(itemsByName)) {
          const recipes = bot.recipesFor(item.id, null, 1, null)
          if (!Array.isArray(recipes) || recipes.length === 0) continue
          items.push({
            name,
            craftable: true,
            recipes: recipes.length
          })
          if (items.length >= limit) break
        }

        return { items }
      }
    },
    {
      name: 'inspect_recipe',
      description: 'Inspect Mineflayer recipe availability for an item with and without a crafting table.',
      validate: validateRecipeItemArgs,
      execute: async (bot, args) => inspectRecipeState(bot, args)
    },
    {
      name: 'read_recipe_knowledge',
      description: 'Read compact learned recipe knowledge from bot memory.',
      validate: passArgs,
      execute: async (bot, args, options) => {
        const memoryPaths = resolveBotMemoryPaths(bot, options)
        const learnedRecipesPath = options.learnedRecipesPath || memoryPaths.learnedRecipesPath
        return {
          recipes: summarizeRecipeKnowledge({
            ...options,
            learnedRecipesPath,
            limit: args.limit
          })
        }
      }
    },
    {
      name: 'plan_crafting_goal',
      description: 'Plan a learned crafting goal from Mineflayer recipe availability.',
      validate: validateRecipeItemArgs,
      execute: async (bot, args, options) => {
        const memoryPaths = resolveBotMemoryPaths(bot, options)
        const learnedRecipesPath = options.learnedRecipesPath || memoryPaths.learnedRecipesPath
        const recipeOptions = { ...options, learnedRecipesPath }
        const minecraftVersion = compactText(bot.version || bot.registry?.version?.minecraftVersion || '', '', 40)
        const state = inspectRecipeState(bot, args)

        if (state.ok === false) return state

        if (!state.known) {
          const record = upsertLearnedRecipe({
            item: args.item,
            status: 'failed',
            minecraftVersion,
            plan: [],
            missingIngredients: ['missing-recipe']
          }, recipeOptions)
          return { ok: false, reason: 'missing-recipe', record, recipe: state }
        }

        const missingIngredients = state.requiresCraftingTable ? ['crafting_table_or_ingredients'] : []
        const record = upsertLearnedRecipe({
          item: args.item,
          status: state.requiresCraftingTable ? 'blocked' : 'draft',
          minecraftVersion,
          plan: [{ tool: 'craft_item', item: args.item, count: args.count, requires: [] }],
          missingIngredients
        }, recipeOptions)

        return { record, recipe: state }
      }
    },
    {
      name: 'craft_from_plan',
      description: 'Craft an item from a learned recipe plan.',
      validate: validateRecipeItemArgs,
      execute: async (bot, args, options) => {
        const memoryPaths = resolveBotMemoryPaths(bot, options)
        const learnedRecipesPath = options.learnedRecipesPath || memoryPaths.learnedRecipesPath
        const knowledge = readRecipeKnowledge({ ...options, learnedRecipesPath })
        const record = knowledge.recipes[args.item]
        if (!record) return { ok: false, reason: 'missing-plan' }

        const step = Array.isArray(record.plan)
          ? record.plan.find(step => step?.tool === 'craft_item')
          : null
        if (!step) return { ok: false, reason: 'empty-plan' }

        return executeCraftItem(bot, {
          item: step.item || args.item,
          count: step.count || args.count
        }, { ...options, learnedRecipesPath })
      }
    },
    {
      name: 'craft_item',
      description: 'Craft an item using Mineflayer recipe data and record learned recipe outcomes.',
      validate: validateCraftItemArgs,
      execute: executeCraftItem
    },
    {
      name: 'eat_food',
      description: 'Eat selected or best available food from inventory.',
      validate: validateOptionalItemArgs,
      execute: async (bot, args, options) => {
        if (typeof bot.consume !== 'function' || typeof bot.equip !== 'function') {
          return {
            ok: false,
            reason: 'eating-support-unavailable',
            missingTool: recordUnavailableTool(bot, 'eat_food', 'Bot cannot equip and consume food.', options)
          }
        }
        const food = findFoodItem(bot, args.item)
        if (!food) return { ok: false, reason: 'missing-food' }
        await bot.equip(food, 'hand')
        await bot.consume()
        return { item: food.name, food: typeof bot.food === 'number' ? bot.food : null }
      }
    },
    {
      name: 'sleep_if_possible',
      description: 'Sleep in a nearby bed when the world allows it.',
      validate: passArgs,
      execute: async (bot, args, options) => {
        if (typeof bot.sleep !== 'function') {
          return {
            ok: false,
            reason: 'sleep-support-unavailable',
            missingTool: recordUnavailableTool(bot, 'sleep_if_possible', 'Bot cannot sleep in beds.', options)
          }
        }
        const bed = findNearbyBlockForTool(bot, block => isBedBlockName(block.name), options)
        if (!bed) return { ok: false, reason: 'missing-bed' }
        try {
          await bot.sleep(bed)
          return { bed: containerBlockSnapshot(bed) }
        } catch (err) {
          return { ok: false, reason: 'sleep-failed', message: compactText(err.message, 'Sleep failed', 160) }
        }
      }
    },
    {
      name: 'cook_food',
      description: 'Start cooking raw food in a nearby furnace with available fuel.',
      validate: validateFurnaceItemArgs,
      execute: async (bot, args, options) => {
        if (!RAW_COOKABLE_FOOD_NAMES.has(args.item)) return { ok: false, reason: 'not-cookable-food' }
        return putItemInFurnace(bot, args, options)
      }
    },
    {
      name: 'smelt_item',
      description: 'Start smelting a safe ore or simple input in a nearby furnace with available fuel.',
      validate: validateFurnaceItemArgs,
      execute: async (bot, args, options) => putItemInFurnace(bot, args, options)
    },
    {
      name: 'place_block',
      description: 'Place one safe block near remembered home with an explicit home-improvement policy.',
      validate: validatePlaceBlockArgs,
      execute: async (bot, args, options) => placeBuildingBlock(bot, args.item, args.position, options)
    },
    {
      name: 'dig_block',
      description: 'Dig one conservative repair block near remembered home with an explicit policy.',
      validate: validateDigBlockArgs,
      execute: async (bot, args, options) => digBuildingBlock(bot, args.position, options)
    },
    {
      name: 'build_small_shelter',
      description: 'Place a tiny bounded ring of safe blocks around remembered home.',
      validate: validateShelterArgs,
      execute: async (bot, args, options) => {
        const positions = plannedHomePositions(bot, SIMPLE_SHELTER_OFFSETS, options)
        if (!positions) return { ok: false, reason: 'missing-home' }
        const placed = []
        for (const position of positions) {
          const result = await placeBuildingBlock(bot, args.item, position, options)
          if (result?.ok === false) continue
          placed.push(result)
        }
        if (placed.length === 0) return { ok: false, reason: 'no-blocks-placed' }
        return { placed }
      }
    },
    {
      name: 'light_area',
      description: 'Place a bounded set of torches around remembered home.',
      validate: validateLightAreaArgs,
      execute: async (bot, args, options) => {
        const positions = plannedHomePositions(bot, LIGHT_AREA_OFFSETS, options)
        if (!positions) return { ok: false, reason: 'missing-home' }
        const placed = []
        for (const position of positions) {
          const result = await placeBuildingBlock(bot, args.item, position, options)
          if (result?.ok === false) continue
          placed.push(result)
        }
        if (placed.length === 0) return { ok: false, reason: 'no-lights-placed' }
        return { placed }
      }
    },
    {
      name: 'repair_shelter',
      description: 'Fill a small explicit list of shelter holes near remembered home.',
      validate: validateRepairShelterArgs,
      execute: async (bot, args, options) => {
        const repaired = []
        for (const position of args.holes) {
          const result = await placeBuildingBlock(bot, args.item, position, options)
          if (result?.ok === false) continue
          repaired.push(result)
        }
        if (repaired.length === 0) return { ok: false, reason: 'no-repairs-made' }
        return { repaired }
      }
    }
  ]
}

function createAiNpcToolRegistry () {
  return new Map(toolDefinitions().map(tool => [tool.name, tool]))
}

function listAiNpcTools (registry = createAiNpcToolRegistry()) {
  return [...registry.values()].map(tool => ({
    name: tool.name,
    description: tool.description
  }))
}

function validateAiNpcToolCall (toolCall, registry = createAiNpcToolRegistry()) {
  const tool = compactText(toolCall?.tool || toolCall?.name, '', 80)
  if (!registry.has(tool)) return { ok: false, tool, reason: 'unknown-tool' }
  const validation = registry.get(tool).validate(objectArgs(toolCall?.args))
  if (!validation.ok) return { ok: false, tool, reason: validation.reason }
  return { ok: true, tool, args: validation.args }
}

async function recordUnknownAiNpcTool (bot, toolCall, options = {}) {
  const memoryPaths = resolveBotMemoryPaths(bot, options)
  const tool = compactText(toolCall?.tool || toolCall?.name || 'unknown_tool', 'unknown_tool', 80)
  const blockedGoal = compactText(toolCall?.reason, 'Unknown NPC goal', 160)
  const record = recordMissingTool({
    capability: `Unknown tool: ${tool}`,
    desiredTool: tool,
    blockedGoal,
    reason: blockedGoal,
    priority: 'medium',
    context: {
      args: objectArgs(toolCall?.args)
    }
  }, {
    ...options,
    missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
  })
  return {
    ok: false,
    tool,
    reason: 'unknown-tool',
    missingTool: record
  }
}

async function executeAiNpcTool (bot, toolCall, options = {}) {
  const registry = options.toolRegistry || createAiNpcToolRegistry()
  const validation = validateAiNpcToolCall(toolCall, registry)
  if (!validation.ok) {
    if (validation.reason === 'unknown-tool') return recordUnknownAiNpcTool(bot, toolCall, options)
    return {
      ok: false,
      tool: validation.tool,
      reason: validation.reason
    }
  }

  const definition = registry.get(validation.tool)
  const result = await definition.execute(bot, validation.args, options)
  if (result?.ok === false) {
    return {
      ok: false,
      tool: validation.tool,
      reason: result.reason,
      result
    }
  }

  return {
    ok: true,
    tool: validation.tool,
    result
  }
}

module.exports = {
  createAiNpcToolRegistry,
  executeAiNpcTool,
  isAllowedSafeCommand,
  listAiNpcTools,
  normalizeCommand,
  validateAiNpcToolCall
}
