const { goals: { GoalGetToBlock, GoalNearXZ } } = require('mineflayer-pathfinder')
const {
  WOODCUTTING_ACTION_DELAY_MS,
  WOODCUTTING_CHEST_SEARCH_RADIUS,
  WOODCUTTING_EMPTY_SLOT_THRESHOLD,
  WOODCUTTING_HOME_COMMAND,
  WOODCUTTING_HOME_WAIT_MS,
  WOODCUTTING_LOG_CANDIDATE_COUNT,
  WOODCUTTING_LOOP_DELAY_MS,
  WOODCUTTING_PATH_TIMEOUT_MS,
  WOODCUTTING_POST_DIG_DELAY_MS,
  WOODCUTTING_ROAM_RADIUS,
  WOODCUTTING_TREE_SEARCH_RADIUS
} = require('./config')
const { sleep } = require('./time')

function isLogName (name = '') {
  return /_(log|stem)$/i.test(name)
}

function isLeafName (name = '') {
  return /_leaves$/i.test(name) || /wart_block$/i.test(name)
}

function isWoodItemName (name = '') {
  return /_(log|stem|wood|hyphae)$/i.test(name)
}

function isContainerBlockName (name = '') {
  return /^(chest|trapped_chest|barrel)$/i.test(name)
}

function isBuildingBlockName (name = '') {
  return /planks|stairs|slab|fence|door|trapdoor|glass|pane|brick|stone|cobblestone|concrete|terracotta|wool|carpet|chest|barrel|crafting_table|furnace|lantern|torch|bed/i.test(name)
}

function isInventoryAlmostFull (bot, threshold = WOODCUTTING_EMPTY_SLOT_THRESHOLD) {
  if (typeof bot.inventory?.emptySlotCount === 'function') {
    return bot.inventory.emptySlotCount() <= threshold
  }

  const slots = bot.inventory?.slots || []
  const inventorySlots = slots.slice(9, 45)
  const emptySlots = inventorySlots.filter(slot => !slot).length
  return emptySlots <= threshold
}

function distanceBetween (a, b) {
  if (typeof a?.distanceTo === 'function') return a.distanceTo(b)
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

function positionData (position) {
  if (!position) return null
  return {
    x: position.x,
    y: position.y,
    z: position.z
  }
}

function goalData (goal) {
  if (!goal) return null
  return {
    type: goal.constructor?.name,
    x: goal.x,
    y: goal.y,
    z: goal.z,
    rangeSq: goal.rangeSq
  }
}

function botPathStateData (bot) {
  return {
    physicsEnabled: bot.physicsEnabled,
    position: positionData(bot.entity?.position)
  }
}

function ensureWoodcuttingMovementEnabled (bot, debugLog = () => {}) {
  if (bot.physicsEnabled === false) {
    bot.physicsEnabled = true
    debugLog('automation.woodcutting.physicsEnabled')
  }
}

function getEquipmentSlot (bot, destination) {
  if (typeof bot.getEquipmentDestSlot !== 'function') return null

  try {
    const slot = bot.getEquipmentDestSlot(destination)
    return Number.isInteger(slot) ? slot : null
  } catch (err) {
    return null
  }
}

function getEquipmentItem (bot, destination) {
  const slot = getEquipmentSlot(bot, destination)
  return Number.isInteger(slot) ? bot.inventory?.slots?.[slot] : null
}

function normalizeItemEnchants (item) {
  if (!item || Array.isArray(item.enchants)) return false
  item.enchants = []
  return true
}

function normalizeDigEquipmentEnchants (bot, debugLog = () => {}) {
  const normalized = []

  if (normalizeItemEnchants(getEquipmentItem(bot, 'hand'))) {
    normalized.push({ slot: 'hand', item: getEquipmentItem(bot, 'hand')?.name })
  }

  if (normalizeItemEnchants(bot.heldItem)) {
    normalized.push({ slot: 'hand', item: bot.heldItem.name })
  }

  const helmet = getEquipmentItem(bot, 'head')
  if (normalizeItemEnchants(helmet)) {
    normalized.push({ slot: 'head', item: helmet.name })
  }

  if (normalized.length > 0) {
    debugLog('automation.woodcutting.normalizedEnchants', { items: normalized })
  }
}

function safeEnchantments (item, slot, debugLog = () => {}) {
  if (!item) return []

  let enchantments
  try {
    enchantments = item.enchants
  } catch (err) {
    debugLog('automation.woodcutting.ignoredEnchantError', {
      slot,
      item: item.name,
      message: err.message
    })
    return []
  }

  if (Array.isArray(enchantments)) return enchantments

  debugLog('automation.woodcutting.ignoredBadEnchantData', {
    slot,
    item: item.name,
    type: typeof enchantments
  })
  return []
}

function safeDigTime (bot, block, debugLog = () => {}) {
  const currentlyHeldItem = bot.heldItem
  const helmet = getEquipmentItem(bot, 'head')
  const enchantments = safeEnchantments(currentlyHeldItem, 'hand', debugLog)
    .concat(safeEnchantments(helmet, 'head', debugLog))
  const creative = bot.game?.gameMode === 'creative'

  return block.digTime(
    currentlyHeldItem?.type ?? null,
    creative,
    ['water', 'flowing_water'].includes(bot._getBlockAtEyeLevel?.()?.name),
    !bot.entity?.onGround,
    enchantments,
    bot.entity?.effects || {}
  )
}

async function digBlockWithSafeEnchantments (bot, block, debugLog = () => {}) {
  const originalDigTime = bot.digTime
  if (typeof originalDigTime !== 'function') {
    await bot.dig(block)
    return
  }

  bot.digTime = target => safeDigTime(bot, target, debugLog)
  try {
    await bot.dig(block)
  } finally {
    bot.digTime = originalDigTime
  }
}

async function clearOffhand (bot, debugLog = () => {}) {
  const offhand = getEquipmentItem(bot, 'off-hand')
  if (!offhand) return false

  if (typeof bot.unequip !== 'function') {
    debugLog('automation.woodcutting.offhandClearUnavailable', { item: offhand.name })
    return false
  }

  try {
    await bot.unequip('off-hand')
    debugLog('automation.woodcutting.offhandCleared', { item: offhand.name })
    return true
  } catch (err) {
    debugLog('automation.woodcutting.offhandClearFailed', {
      item: offhand.name,
      message: err.message
    })
    return false
  }
}

function blockCenterPosition (block) {
  if (typeof block.position?.offset === 'function') {
    return block.position.offset(0.5, 0.5, 0.5)
  }

  return {
    x: block.position.x + 0.5,
    y: block.position.y + 0.5,
    z: block.position.z + 0.5
  }
}

async function prepareForManualDig (bot, block, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const actionDelayMs = options.actionDelayMs ?? WOODCUTTING_ACTION_DELAY_MS

  if (typeof bot.setControlState === 'function') {
    bot.setControlState('sprint', false)
    bot.setControlState('jump', false)
  }

  if (typeof bot.pathfinder?.setGoal === 'function') {
    bot.pathfinder.setGoal(null)
  }

  if (typeof bot.lookAt === 'function') {
    await bot.lookAt(blockCenterPosition(block), true)
  }

  if (actionDelayMs > 0) {
    await wait(actionDelayMs)
  }

  debugLog('automation.woodcutting.preparedDig', {
    block: block.name,
    position: positionData(block.position),
    actionDelayMs
  })
}

async function waitAfterDig (block, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const postDigDelayMs = options.postDigDelayMs ?? WOODCUTTING_POST_DIG_DELAY_MS

  if (postDigDelayMs > 0) {
    await wait(postDigDelayMs)
  }

  debugLog('automation.woodcutting.postDigDelay', {
    block: block.name,
    position: positionData(block.position),
    postDigDelayMs
  })
}

function hasUsablePosition (block) {
  return Boolean(block?.position && typeof block.position.offset === 'function')
}

function hasNearbyLeaves (bot, block, radius = 4) {
  if (!hasUsablePosition(block)) return false

  for (let x = -radius; x <= radius; x++) {
    for (let y = 0; y <= radius + 2; y++) {
      for (let z = -radius; z <= radius; z++) {
        const position = block.position.offset(x, y, z)
        const nearby = bot.blockAt(position)
        if (nearby && isLeafName(nearby.name)) return true
      }
    }
  }
  return false
}

function hasNearbyBuildingBlocks (bot, block, radius = 2) {
  if (!hasUsablePosition(block)) return false

  for (let x = -radius; x <= radius; x++) {
    for (let y = -1; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        if (x === 0 && y === 0 && z === 0) continue
        const position = block.position.offset(x, y, z)
        const nearby = bot.blockAt(position)
        if (nearby && isBuildingBlockName(nearby.name)) return true
      }
    }
  }
  return false
}

function isNaturalTreeLog (bot, block) {
  return Boolean(
    block &&
    hasUsablePosition(block) &&
    isLogName(block.name) &&
    hasNearbyLeaves(bot, block) &&
    !hasNearbyBuildingBlocks(bot, block)
  )
}

function findNearestBlock (bot, matching, maxDistance) {
  if (typeof bot.findBlock === 'function') {
    return bot.findBlock({ matching, maxDistance })
  }

  if (typeof bot.findBlocks !== 'function') return null
  const positions = bot.findBlocks({ matching, maxDistance, count: 32 })
  return positions
    .map(position => bot.blockAt(position))
    .filter(Boolean)
    .sort((a, b) => distanceBetween(bot.entity.position, a.position) - distanceBetween(bot.entity.position, b.position))[0] || null
}

function logBlockIds (bot) {
  if (!bot.registry?.blocksByName) return null

  return Object.values(bot.registry.blocksByName)
    .filter(block => isLogName(block.name))
    .map(block => block.id)
}

function findNaturalTreeLog (bot, options = {}) {
  const searchRadius = options.searchRadius ?? WOODCUTTING_TREE_SEARCH_RADIUS
  const logIds = logBlockIds(bot)
  if (logIds && typeof bot.findBlocks === 'function') {
    const positions = bot.findBlocks({
      matching: logIds,
      maxDistance: searchRadius,
      count: options.logCandidateCount ?? WOODCUTTING_LOG_CANDIDATE_COUNT
    })

    return positions
      .map(position => bot.blockAt(position))
      .filter(block => isNaturalTreeLog(bot, block))
      .sort((a, b) => distanceBetween(bot.entity.position, a.position) - distanceBetween(bot.entity.position, b.position))[0] || null
  }

  return findNearestBlock(bot, block => isNaturalTreeLog(bot, block), searchRadius)
}

function withTimeout (promise, timeoutMs) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
  ])
}

async function gotoGoal (bot, goal, options = {}, context = {}) {
  const debugLog = options.debugLog || (() => {})
  const timeoutMs = options.pathTimeoutMs ?? WOODCUTTING_PATH_TIMEOUT_MS
  const pathContext = {
    ...context,
    goal: goalData(goal),
    bot: botPathStateData(bot)
  }
  let result
  try {
    result = await withTimeout(bot.pathfinder.goto(goal), timeoutMs)
  } catch (err) {
    if (typeof bot.pathfinder?.setGoal === 'function') {
      bot.pathfinder.setGoal(null)
    }
    debugLog('automation.woodcutting.pathError', {
      ...pathContext,
      message: err.message
    })
    return false
  }

  if (result === 'timeout') {
    if (typeof bot.pathfinder?.setGoal === 'function') {
      bot.pathfinder.setGoal(null)
    }
    debugLog('automation.woodcutting.pathTimeout', pathContext)
    return false
  }

  return true
}

function pickRoamTarget (bot, options = {}) {
  if (options.roamTarget) return options.roamTarget

  const position = bot.entity?.position
  if (!position || typeof position.offset !== 'function') return null

  const radius = options.roamRadius ?? WOODCUTTING_ROAM_RADIUS
  const random = options.random || Math.random
  const dx = Math.round((random() * 2 - 1) * radius)
  const dz = Math.round((random() * 2 - 1) * radius)
  return position.offset(dx, 0, dz)
}

async function roamForTrees (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (!bot.pathfinder) return false

  const target = pickRoamTarget(bot, options)
  if (!target) return false

  const reached = await gotoGoal(
    bot,
    new GoalNearXZ(target.x, target.z, 5),
    options,
    { mode: 'roam', target: positionData(target) }
  )
  if (!reached) return false
  debugLog('automation.woodcutting.roam', { target: positionData(target) })
  return true
}

function findAxe (bot) {
  const items = typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
  return items.find(item => /_axe$/i.test(item.name || '')) || null
}

async function equipBestWoodTool (bot, block) {
  const tool = typeof bot.pathfinder?.bestHarvestTool === 'function'
    ? bot.pathfinder.bestHarvestTool(block)
    : findAxe(bot)

  if (tool) await bot.equip(tool, 'hand')
}

async function cutTreeLog (bot, treeLog, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (!treeLog) return false
  if (!isNaturalTreeLog(bot, treeLog)) return false

  if (!bot.pathfinder) {
    throw new Error('Wood cutting requires mineflayer-pathfinder to be loaded.')
  }

  const reached = await gotoGoal(
    bot,
    new GoalGetToBlock(treeLog.position.x, treeLog.position.y, treeLog.position.z),
    options,
    {
      mode: 'cut',
      block: treeLog.name,
      position: positionData(treeLog.position)
    }
  )
  if (!reached) return false
  await clearOffhand(bot, debugLog)
  await equipBestWoodTool(bot, treeLog)
  normalizeDigEquipmentEnchants(bot, debugLog)
  await prepareForManualDig(bot, treeLog, options)
  await digBlockWithSafeEnchantments(bot, treeLog, debugLog)
  await waitAfterDig(treeLog, options)
  debugLog('automation.woodcutting.cut', {
    block: treeLog.name,
    position: treeLog.position
  })
  return true
}

function findNearbyContainer (bot, options = {}) {
  const searchRadius = options.chestSearchRadius ?? WOODCUTTING_CHEST_SEARCH_RADIUS
  return findNearestBlock(bot, block => isContainerBlockName(block.name), searchRadius)
}

async function depositWoodAtHome (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const homeCommand = options.homeCommand || WOODCUTTING_HOME_COMMAND
  const homeWaitMs = options.homeWaitMs ?? WOODCUTTING_HOME_WAIT_MS

  bot.chat(homeCommand)
  await wait(homeWaitMs)

  const containerBlock = findNearbyContainer(bot, options)
  if (!containerBlock) {
    debugLog('automation.woodcutting.deposit.missingContainer')
    return false
  }

  const container = await bot.openContainer(containerBlock)
  try {
    const woodItems = bot.inventory.items().filter(item => isWoodItemName(item.name))
    for (const item of woodItems) {
      await container.deposit(item.type, null, item.count)
      debugLog('automation.woodcutting.deposit.item', {
        item: item.name,
        count: item.count
      })
    }
  } finally {
    container.close()
  }

  return true
}

async function runWoodCuttingCycle (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})

  if (bot.__combatActiveUntil && bot.__combatActiveUntil > Date.now()) {
    debugLog('automation.woodcutting.pausedForCombat')
    return false
  }

  if (isInventoryAlmostFull(bot, options.emptySlotThreshold)) {
    return depositWoodAtHome(bot, options)
  }

  const treeLog = findNaturalTreeLog(bot, options)
  if (!treeLog) {
    debugLog('automation.woodcutting.noTree')
    return roamForTrees(bot, options)
  }

  return cutTreeLog(bot, treeLog, options)
}

function startWoodCuttingAutomation (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const output = options.output || console.log
  const loopDelayMs = options.loopDelayMs ?? WOODCUTTING_LOOP_DELAY_MS
  let stopped = false

  ensureWoodcuttingMovementEnabled(bot, debugLog)

  async function run () {
    output('Started wood cutting automation.')
    debugLog('automation.woodcutting.start')
    for (;;) {
      if (stopped || bot._ended) break
      try {
        await runWoodCuttingCycle(bot, options)
      } catch (err) {
        output(`Wood cutting error: ${err.message}`)
        debugLog('automation.woodcutting.error', { message: err.message, stack: err.stack })
      }
      await wait(loopDelayMs)
    }
    debugLog('automation.woodcutting.stop')
  }

  run()
  return {
    name: 'Wood cutting',
    stop: () => {
      stopped = true
      if (typeof bot.pathfinder?.setGoal === 'function') {
        bot.pathfinder.setGoal(null)
      }
    }
  }
}

module.exports = {
  cutTreeLog,
  depositWoodAtHome,
  findNaturalTreeLog,
  isInventoryAlmostFull,
  isNaturalTreeLog,
  roamForTrees,
  runWoodCuttingCycle,
  startWoodCuttingAutomation
}
