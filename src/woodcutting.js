const vec3 = require('vec3')
const { goals: { GoalGetToBlock, GoalNear, GoalNearXZ } } = require('mineflayer-pathfinder')
const {
  WOODCUTTING_ACTION_DELAY_MS,
  WOODCUTTING_CHEST_SEARCH_RADIUS,
  WOODCUTTING_DROP_COLLECT_COUNT,
  WOODCUTTING_DROP_PICKUP_WAIT_MS,
  WOODCUTTING_DROP_SEARCH_RADIUS,
  WOODCUTTING_EMPTY_SLOT_THRESHOLD,
  WOODCUTTING_CREATIVE_REACH_DISTANCE,
  WOODCUTTING_HOME_COMMAND,
  WOODCUTTING_HOME_WAIT_MS,
  WOODCUTTING_IGNORED_LOG_MS,
  WOODCUTTING_LEAF_BLOCKER_CLEAR_COUNT,
  WOODCUTTING_LEAF_BLOCKER_SEARCH_RADIUS,
  WOODCUTTING_LOG_CANDIDATE_COUNT,
  WOODCUTTING_LOOP_DELAY_MS,
  WOODCUTTING_MAX_SCAFFOLD_BLOCKS,
  WOODCUTTING_PATH_TIMEOUT_MS,
  WOODCUTTING_POST_DIG_DELAY_MS,
  WOODCUTTING_ROAM_RADIUS,
  WOODCUTTING_SURVIVAL_REACH_DISTANCE,
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

function isSaplingItemName (name = '') {
  return /_sapling$/i.test(name) || name === 'mangrove_propagule' || name === 'crimson_fungus' || name === 'warped_fungus'
}

const SCAFFOLD_ITEM_PRIORITY = [
  'dirt',
  'coarse_dirt',
  'rooted_dirt',
  'grass_block',
  'cobblestone',
  'cobbled_deepslate',
  'stone',
  'andesite',
  'diorite',
  'granite',
  'netherrack',
  'sand',
  'gravel'
]

const WOODCUTTING_IGNORED_TREE_CLUSTER_RADIUS = 2

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

function positionKey (position) {
  if (!position) return 'unknown'
  return `${position.x},${position.y},${position.z}`
}

function columnKey (position) {
  if (!position) return 'unknown'
  return `${position.x},${position.z}`
}

function currentTime (options = {}) {
  return typeof options.now === 'function' ? options.now() : Date.now()
}

function randomizedWoodcuttingDelayMs (baseDelayMs, options = {}) {
  if (!Number.isFinite(baseDelayMs) || baseDelayMs <= 0) return baseDelayMs

  const minDelayMs = Math.max(1, Math.floor(baseDelayMs * 0.7))
  const maxDelayMs = Math.max(minDelayMs, Math.ceil(baseDelayMs * 1.3))
  const randomInt = options.randomInt || getRandomInt
  return randomInt(minDelayMs, maxDelayMs)
}

function ignoredLogMap (bot) {
  if (!bot.__woodcuttingIgnoredLogs) {
    bot.__woodcuttingIgnoredLogs = new Map()
  }

  return bot.__woodcuttingIgnoredLogs
}

function ignoredTreeAreaMap (bot) {
  if (!bot.__woodcuttingIgnoredTreeAreas) {
    bot.__woodcuttingIgnoredTreeAreas = new Map()
  }

  return bot.__woodcuttingIgnoredTreeAreas
}

function horizontalDistanceBetween (a, b) {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

function isIgnoredTreeArea (bot, block, options = {}) {
  if (!block?.position) return false
  const now = currentTime(options)
  const areas = ignoredTreeAreaMap(bot)

  for (const [key, area] of areas.entries()) {
    if (area.ignoredUntil <= now) {
      areas.delete(key)
      continue
    }

    if (horizontalDistanceBetween(area.position, block.position) <= area.radius) {
      return true
    }
  }

  return false
}

function isIgnoredTreeLog (bot, block, options = {}) {
  const key = positionKey(block?.position)
  const ignoredUntil = ignoredLogMap(bot).get(key)
  if (!ignoredUntil) return isIgnoredTreeArea(bot, block, options)

  if (ignoredUntil <= currentTime(options)) {
    ignoredLogMap(bot).delete(key)
    return isIgnoredTreeArea(bot, block, options)
  }

  return true
}

function ignoreTreeLog (bot, block, options = {}, reason = 'unreachable') {
  const debugLog = options.debugLog || (() => {})
  const ignoredLogMs = options.ignoredLogMs ?? WOODCUTTING_IGNORED_LOG_MS
  const ignoredUntil = currentTime(options) + ignoredLogMs
  const clusterRadius = options.ignoredTreeClusterRadius ?? WOODCUTTING_IGNORED_TREE_CLUSTER_RADIUS

  ignoredLogMap(bot).set(positionKey(block.position), ignoredUntil)
  ignoredTreeAreaMap(bot).set(columnKey(block.position), {
    position: positionData(block.position),
    ignoredUntil,
    radius: clusterRadius
  })
  debugLog('automation.woodcutting.ignoreLog', {
    block: block.name,
    position: positionData(block.position),
    reason,
    ignoredLogMs,
    clusterRadius
  })
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

function isWoodcuttingStopped (bot, options = {}) {
  return Boolean(bot?._ended || (typeof options.shouldStop === 'function' && options.shouldStop()))
}

function cancelWoodcuttingActivity (bot) {
  if (typeof bot.pathfinder?.setGoal === 'function') {
    bot.pathfinder.setGoal(null)
  }

  if (typeof bot.stopDigging === 'function') {
    try {
      bot.stopDigging()
    } catch {
      // stopDigging can throw if there is no active dig to cancel.
    }
  }

  if (typeof bot.clearControlStates === 'function') {
    bot.clearControlStates()
  } else if (typeof bot.setControlState === 'function') {
    bot.setControlState('forward', false)
    bot.setControlState('back', false)
    bot.setControlState('left', false)
    bot.setControlState('right', false)
    bot.setControlState('jump', false)
    bot.setControlState('sprint', false)
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
    await bot.dig(block, true, 'raycast')
    return
  }

  bot.digTime = target => safeDigTime(bot, target, debugLog)
  try {
    await bot.dig(block, true, 'raycast')
  } finally {
    bot.digTime = originalDigTime
  }
}

function isBlockNotInViewError (err) {
  return /block not in view/i.test(err?.message || '')
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

function offsetPosition (position, x, y, z) {
  if (!position) return null
  if (typeof position.offset === 'function') return position.offset(x, y, z)

  return {
    x: position.x + x,
    y: position.y + y,
    z: position.z + z
  }
}

function clamp (value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function squaredDistanceToBlockBounds (position, block) {
  const closestX = clamp(position.x, block.position.x, block.position.x + 1)
  const closestY = clamp(position.y, block.position.y, block.position.y + 1)
  const closestZ = clamp(position.z, block.position.z, block.position.z + 1)

  return Math.pow(position.x - closestX, 2) +
    Math.pow(position.y - closestY, 2) +
    Math.pow(position.z - closestZ, 2)
}

function woodcuttingReachDistance (bot) {
  return bot.game?.gameMode === 'creative'
    ? WOODCUTTING_CREATIVE_REACH_DISTANCE
    : WOODCUTTING_SURVIVAL_REACH_DISTANCE
}

function isBlockWithinPlayerReach (bot, block) {
  const eyePosition = offsetPosition(bot.entity?.position, 0, bot.entity?.eyeHeight ?? 1.65, 0)
  if (!eyePosition || !block?.position) return false

  const reachDistance = woodcuttingReachDistance(bot)
  return squaredDistanceToBlockBounds(eyePosition, block) <= Math.pow(reachDistance, 2)
}

function isBlockReachableForDig (bot, block) {
  if (!block) return false
  if (!isBlockWithinPlayerReach(bot, block)) return false

  if (typeof bot.canDigBlock === 'function') {
    try {
      return bot.canDigBlock(block)
    } catch {
      // Fall back to a distance check if canDigBlock is unavailable for this block.
    }
  }

  return true
}

function shouldApproachLogColumn (bot, block) {
  const botY = bot.entity?.position?.y
  if (typeof botY !== 'number') return false

  return block.position.y - Math.floor(botY) > 2 && !isBlockReachableForDig(bot, block)
}

function createLogApproachGoal (bot, block) {
  if (shouldApproachLogColumn(bot, block)) {
    return new GoalNearXZ(block.position.x, block.position.z, 2)
  }

  return new GoalGetToBlock(block.position.x, block.position.y, block.position.z)
}

function findScaffoldItem (bot) {
  const items = typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []

  for (const name of SCAFFOLD_ITEM_PRIORITY) {
    const item = items.find(candidate => candidate.name === name)
    if (item) return item
  }

  return null
}

async function placeScaffoldBelowBot (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const scaffoldItem = findScaffoldItem(bot)
  const referencePosition = offsetPosition(bot.entity?.position, 0, -1, 0)
  const referenceBlock = referencePosition ? bot.blockAt(referencePosition) : null

  if (isWoodcuttingStopped(bot, options)) return false

  if (!scaffoldItem || !referenceBlock || typeof bot.placeBlock !== 'function') {
    debugLog('automation.woodcutting.scaffoldUnavailable', {
      hasItem: Boolean(scaffoldItem),
      hasReferenceBlock: Boolean(referenceBlock),
      canPlaceBlock: typeof bot.placeBlock === 'function'
    })
    return false
  }

  let placed = false
  try {
    await bot.equip(scaffoldItem, 'hand')

    if (typeof bot.setControlState === 'function') {
      bot.setControlState('jump', true)
    }

    const jumpY = Math.floor(bot.entity?.position?.y ?? 0) + 0.9
    for (let attempt = 0; attempt < 10; attempt++) {
      if (isWoodcuttingStopped(bot, options)) return false
      if ((bot.entity?.position?.y ?? 0) > jumpY) break
      await wait(randomizedWoodcuttingDelayMs(100, options))
    }

    if (isWoodcuttingStopped(bot, options)) return false
    await bot.placeBlock(referenceBlock, vec3(0, 1, 0))
    placed = true
  } catch (err) {
    debugLog('automation.woodcutting.scaffoldFailed', {
      item: scaffoldItem.name,
      message: err.message
    })
    return false
  } finally {
    if (typeof bot.setControlState === 'function') {
      bot.setControlState('jump', false)
    }
  }

  if (placed) {
    debugLog('automation.woodcutting.scaffoldPlaced', {
      item: scaffoldItem.name,
      reference: positionData(referenceBlock.position)
    })
    if (!isWoodcuttingStopped(bot, options)) {
      await wait(randomizedWoodcuttingDelayMs(WOODCUTTING_ACTION_DELAY_MS, options))
    }
  }

  return placed
}

async function buildScaffoldUntilReachable (bot, block, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const maxScaffoldBlocks = options.maxScaffoldBlocks ?? WOODCUTTING_MAX_SCAFFOLD_BLOCKS

  if (isBlockReachableForDig(bot, block)) return true

  for (let placedBlocks = 0; placedBlocks < maxScaffoldBlocks; placedBlocks++) {
    if (isWoodcuttingStopped(bot, options)) return false
    const placed = await placeScaffoldBelowBot(bot, options)
    if (!placed) break
    if (isBlockReachableForDig(bot, block)) return true
  }

  debugLog('automation.woodcutting.unreachableLog', {
    block: block.name,
    position: positionData(block.position),
    maxScaffoldBlocks
  })
  return isBlockReachableForDig(bot, block)
}

async function prepareForManualDig (bot, block, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const baseActionDelayMs = options.actionDelayMs ?? WOODCUTTING_ACTION_DELAY_MS
  const actionDelayMs = randomizedWoodcuttingDelayMs(baseActionDelayMs, options)

  if (isWoodcuttingStopped(bot, options)) return false

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

  if (isWoodcuttingStopped(bot, options)) return false

  if (actionDelayMs > 0) {
    await wait(actionDelayMs)
  }

  if (isWoodcuttingStopped(bot, options)) return false

  debugLog('automation.woodcutting.preparedDig', {
    block: block.name,
    position: positionData(block.position),
    actionDelayMs
  })
  return true
}

async function waitAfterDig (block, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const basePostDigDelayMs = options.postDigDelayMs ?? WOODCUTTING_POST_DIG_DELAY_MS
  const postDigDelayMs = randomizedWoodcuttingDelayMs(basePostDigDelayMs, options)

  if (isWoodcuttingStopped(null, options)) return false

  if (postDigDelayMs > 0) {
    await wait(postDigDelayMs)
  }

  if (isWoodcuttingStopped(null, options)) return false

  debugLog('automation.woodcutting.postDigDelay', {
    block: block.name,
    position: positionData(block.position),
    postDigDelayMs
  })
  return true
}

function isDroppedItemEntity (entity) {
  const name = String(entity?.name || entity?.displayName || '').toLowerCase()
  return Boolean(
    entity &&
    entity.isValid !== false &&
    entity.position &&
    (name === 'item' || name === 'item_stack')
  )
}

function findNearbyDroppedItems (bot, originPosition, options = {}) {
  const radius = options.dropSearchRadius ?? WOODCUTTING_DROP_SEARCH_RADIUS
  const drops = Object.values(bot.entities || {})
    .filter(isDroppedItemEntity)
    .filter(entity => distanceBetween(originPosition, entity.position) <= radius)

  return drops.sort((a, b) =>
    distanceBetween(bot.entity.position, a.position) - distanceBetween(bot.entity.position, b.position)
  )
}

async function collectNearbyDrops (bot, originPosition, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const basePickupWaitMs = options.dropPickupWaitMs ?? WOODCUTTING_DROP_PICKUP_WAIT_MS
  const collectCount = options.dropCollectCount ?? WOODCUTTING_DROP_COLLECT_COUNT

  if (!bot.pathfinder || !originPosition) return 0
  if (isWoodcuttingStopped(bot, options)) return 0

  let collected = 0
  const drops = findNearbyDroppedItems(bot, originPosition, options).slice(0, collectCount)
  for (const drop of drops) {
    if (isWoodcuttingStopped(bot, options)) break
    const reached = await gotoGoal(
      bot,
      new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1),
      options,
      {
        mode: 'pickup',
        entity: drop.name,
        position: positionData(drop.position)
      }
    )

    if (isWoodcuttingStopped(bot, options)) break
    if (!reached) continue
    collected++
    const pickupWaitMs = randomizedWoodcuttingDelayMs(basePickupWaitMs, options)
    if (pickupWaitMs > 0 && !isWoodcuttingStopped(bot, options)) await wait(pickupWaitMs)
  }

  if (collected > 0) {
    debugLog('automation.woodcutting.collectDrops', { count: collected })
  }

  return collected
}

function findReachableLeafBlocker (bot, block, attempted = new Set(), options = {}) {
  if (!hasUsablePosition(block)) return null

  const radius = options.leafBlockerSearchRadius ?? WOODCUTTING_LEAF_BLOCKER_SEARCH_RADIUS
  const candidates = []

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        if (x === 0 && y === 0 && z === 0) continue
        const position = block.position.offset(x, y, z)
        const nearby = bot.blockAt(position)
        if (!nearby || !isLeafName(nearby.name)) continue
        if (attempted.has(positionKey(nearby.position))) continue
        if (!isBlockReachableForDig(bot, nearby)) continue
        candidates.push(nearby)
      }
    }
  }

  return candidates
    .sort((a, b) => distanceBetween(bot.entity.position, a.position) - distanceBetween(bot.entity.position, b.position))[0] || null
}

async function digTreeLogWithLeafFallback (bot, treeLog, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const maxLeafBlockers = options.leafBlockerClearCount ?? WOODCUTTING_LEAF_BLOCKER_CLEAR_COUNT
  const attemptedLeafPositions = new Set()

  for (let blockersCleared = 0; blockersCleared <= maxLeafBlockers; blockersCleared++) {
    if (isWoodcuttingStopped(bot, options)) return false
    try {
      await digBlockWithSafeEnchantments(bot, treeLog, debugLog)
      return true
    } catch (err) {
      if (isWoodcuttingStopped(bot, options)) return false
      if (!isBlockNotInViewError(err)) throw err

      const leafBlocker = findReachableLeafBlocker(bot, treeLog, attemptedLeafPositions, options)
      if (!leafBlocker || blockersCleared === maxLeafBlockers) {
        debugLog('automation.woodcutting.blockedLog', {
          block: treeLog.name,
          position: positionData(treeLog.position),
          message: err.message,
          blockersCleared
        })
        return false
      }

      attemptedLeafPositions.add(positionKey(leafBlocker.position))
      debugLog('automation.woodcutting.clearLeafBlocker', {
        block: leafBlocker.name,
        position: positionData(leafBlocker.position),
        target: positionData(treeLog.position)
      })

      try {
        const prepared = await prepareForManualDig(bot, leafBlocker, options)
        if (!prepared) return false
        await digBlockWithSafeEnchantments(bot, leafBlocker, debugLog)
        await waitAfterDig(leafBlocker, options)
      } catch (leafErr) {
        debugLog('automation.woodcutting.clearLeafBlockerFailed', {
          block: leafBlocker.name,
          position: positionData(leafBlocker.position),
          message: leafErr.message
        })
      }
    }
  }

  return false
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
      .filter(block => !isIgnoredTreeLog(bot, block, options))
      .sort((a, b) => distanceBetween(bot.entity.position, a.position) - distanceBetween(bot.entity.position, b.position))[0] || null
  }

  return findNearestBlock(
    bot,
    block => isNaturalTreeLog(bot, block) && !isIgnoredTreeLog(bot, block, options),
    searchRadius
  )
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
  if (isWoodcuttingStopped(bot, options)) return false

  let result
  try {
    result = await withTimeout(bot.pathfinder.goto(goal), timeoutMs)
  } catch (err) {
    if (isWoodcuttingStopped(bot, options)) return false
    if (typeof bot.pathfinder?.setGoal === 'function') {
      bot.pathfinder.setGoal(null)
    }
    debugLog('automation.woodcutting.pathError', {
      ...pathContext,
      message: err.message
    })
    return false
  }

  if (isWoodcuttingStopped(bot, options)) return false

  if (result === 'timeout') {
    if (isWoodcuttingStopped(bot, options)) return false
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
  if (isWoodcuttingStopped(bot, options)) return false

  const target = pickRoamTarget(bot, options)
  if (!target) return false

  const reached = await gotoGoal(
    bot,
    new GoalNearXZ(target.x, target.z, 5),
    options,
    { mode: 'roam', target: positionData(target) }
  )
  if (isWoodcuttingStopped(bot, options)) return false
  if (!reached) return false
  debugLog('automation.woodcutting.roam', { target: positionData(target) })
  return true
}

function findAxe (bot) {
  const items = typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
  return items.find(item => /_axe$/i.test(item.name || '')) || null
}

function saplingNameForLog (logName = '') {
  const match = logName.match(/^(.+?)_(?:log|wood|stem|hyphae)$/i)
  if (!match) return null
  const treeName = match[1]
  if (treeName === 'mangrove') return 'mangrove_propagule'
  if (treeName === 'crimson') return 'crimson_fungus'
  if (treeName === 'warped') return 'warped_fungus'
  return `${treeName}_sapling`
}

function findSaplingForLog (bot, logName) {
  const preferredName = saplingNameForLog(logName)
  const items = typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
  return items.find(item => item.name === preferredName) ||
    items.find(item => isSaplingItemName(item.name)) ||
    null
}

function isSaplingSoilName (name = '') {
  return /^(dirt|grass_block|podzol|coarse_dirt|rooted_dirt|moss_block|mud|mycelium|netherrack|crimson_nylium|warped_nylium)$/i.test(name)
}

async function replantSaplingNearTree (bot, treeLog, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const sapling = findSaplingForLog(bot, treeLog?.name)
  if (!sapling || !treeLog?.position || typeof bot.placeBlock !== 'function') return false

  const offsets = [
    [0, -1, 0],
    [1, -1, 0],
    [-1, -1, 0],
    [0, -1, 1],
    [0, -1, -1]
  ]

  for (const [x, y, z] of offsets) {
    const referenceBlock = bot.blockAt(treeLog.position.offset(x, y, z))
    if (!referenceBlock || !isSaplingSoilName(referenceBlock.name)) continue

    try {
      await bot.equip(sapling, 'hand')
      await bot.placeBlock(referenceBlock, vec3(0, 1, 0))
      debugLog('automation.woodcutting.replant', {
        item: sapling.name,
        reference: positionData(referenceBlock.position)
      })
      return true
    } catch (err) {
      debugLog('automation.woodcutting.replantFailed', {
        item: sapling.name,
        reference: positionData(referenceBlock.position),
        message: err.message
      })
    }
  }

  return false
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
  if (isWoodcuttingStopped(bot, options)) return false
  if (!isNaturalTreeLog(bot, treeLog)) return false

  if (!bot.pathfinder) {
    throw new Error('Wood cutting requires mineflayer-pathfinder to be loaded.')
  }

  const reached = await gotoGoal(
    bot,
    createLogApproachGoal(bot, treeLog),
    options,
    {
      mode: 'cut',
      block: treeLog.name,
      position: positionData(treeLog.position)
    }
  )
  if (isWoodcuttingStopped(bot, options)) return false
  if (!reached) {
    ignoreTreeLog(bot, treeLog, options, 'path-failed')
    return false
  }
  const reachable = await buildScaffoldUntilReachable(bot, treeLog, options)
  if (isWoodcuttingStopped(bot, options)) return false
  if (!reachable) {
    ignoreTreeLog(bot, treeLog, options, 'unreachable')
    return false
  }
  if (isWoodcuttingStopped(bot, options)) return false
  await clearOffhand(bot, debugLog)
  if (isWoodcuttingStopped(bot, options)) return false
  await equipBestWoodTool(bot, treeLog)
  if (isWoodcuttingStopped(bot, options)) return false
  normalizeDigEquipmentEnchants(bot, debugLog)
  const prepared = await prepareForManualDig(bot, treeLog, options)
  if (!prepared || isWoodcuttingStopped(bot, options)) return false
  const dug = await digTreeLogWithLeafFallback(bot, treeLog, options)
  if (isWoodcuttingStopped(bot, options)) return false
  if (!dug) {
    ignoreTreeLog(bot, treeLog, options, 'blocked')
    return false
  }
  await waitAfterDig(treeLog, options)
  if (isWoodcuttingStopped(bot, options)) return false
  await collectNearbyDrops(bot, treeLog.position, options)
  if (isWoodcuttingStopped(bot, options)) return false
  await replantSaplingNearTree(bot, treeLog, options)
  if (isWoodcuttingStopped(bot, options)) return false
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
  const baseHomeWaitMs = options.homeWaitMs ?? WOODCUTTING_HOME_WAIT_MS

  if (isWoodcuttingStopped(bot, options)) return false
  bot.chat(homeCommand)
  await wait(randomizedWoodcuttingDelayMs(baseHomeWaitMs, options))
  if (isWoodcuttingStopped(bot, options)) return false

  const containerBlock = findNearbyContainer(bot, options)
  if (!containerBlock) {
    debugLog('automation.woodcutting.deposit.missingContainer')
    return false
  }

  const container = await bot.openContainer(containerBlock)
  try {
    const woodItems = bot.inventory.items().filter(item => isWoodItemName(item.name))
    for (const item of woodItems) {
      if (isWoodcuttingStopped(bot, options)) break
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

  if (isWoodcuttingStopped(bot, options)) return false

  if (bot.__combatActiveUntil && bot.__combatActiveUntil > Date.now()) {
    debugLog('automation.woodcutting.pausedForCombat')
    return false
  }

  if (isInventoryAlmostFull(bot, options.emptySlotThreshold)) {
    return depositWoodAtHome(bot, options)
  }

  if (isWoodcuttingStopped(bot, options)) return false
  const treeLog = findNaturalTreeLog(bot, options)
  if (!treeLog) {
    debugLog('automation.woodcutting.noTree')
    return roamForTrees(bot, options)
  }

  return cutTreeLog(bot, treeLog, options)
}

function countWoodItems (bot) {
  return (typeof bot.inventory?.items === 'function' ? bot.inventory.items() : [])
    .filter(item => isWoodItemName(item.name))
    .reduce((sum, item) => sum + item.count, 0)
}

function woodcuttingLoopDelay (options, emptyCycles) {
  const loopDelayMs = options.loopDelayMs ?? WOODCUTTING_LOOP_DELAY_MS
  if (emptyCycles <= 0) return loopDelayMs

  const maxMultiplier = options.maxEmptyCycleBackoffMultiplier ?? 5
  return loopDelayMs * Math.min(emptyCycles + 1, maxMultiplier)
}

async function runWoodCuttingQuotaTask (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const targetWoodCount = options.targetWoodCount ?? 256
  const wait = options.sleep || sleep
  const cycle = options.runWoodCuttingCycle || runWoodCuttingCycle
  const deposit = options.depositWoodAtHome || depositWoodAtHome
  const woodCounter = options.countWoodItems || countWoodItems
  let lastCount = woodCounter(bot)
  let collected = 0
  let emptyCycles = 0

  while (!bot._ended && !options.shouldStop?.() && collected < targetWoodCount) {
    const before = woodCounter(bot)
    const ran = await cycle(bot, options)
    const after = woodCounter(bot)
    collected += Math.max(0, after - before)
    lastCount = after

    if (!ran || after <= before) {
      emptyCycles++
      if (emptyCycles > 0) {
        options.roamRadius = (options.roamRadius || WOODCUTTING_ROAM_RADIUS) + WOODCUTTING_ROAM_RADIUS
      }
    } else {
      emptyCycles = 0
    }

    if (collected >= targetWoodCount || lastCount >= targetWoodCount) break
    await wait(randomizedWoodcuttingDelayMs(woodcuttingLoopDelay(options, emptyCycles), options))
  }

  if (!bot._ended && !options.shouldStop?.()) await deposit(bot, options)
  debugLog('automation.woodcutting.quota.done', {
    collected,
    inventoryWood: lastCount,
    targetWoodCount
  })
  return collected >= targetWoodCount || lastCount >= targetWoodCount
}

function startWoodCuttingAutomation (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const output = options.output || console.log
  const loopDelayMs = options.loopDelayMs ?? WOODCUTTING_LOOP_DELAY_MS
  const externalShouldStop = options.shouldStop
  let stopped = false
  const shouldStop = () => stopped ||
    bot._ended ||
    (typeof externalShouldStop === 'function' && externalShouldStop())
  const activeOptions = {
    ...options,
    shouldStop
  }

  ensureWoodcuttingMovementEnabled(bot, debugLog)

  async function run () {
    output('Started wood cutting automation.')
    debugLog('automation.woodcutting.start')
    for (;;) {
      if (shouldStop()) break
      try {
        await runWoodCuttingCycle(bot, activeOptions)
      } catch (err) {
        output(`Wood cutting error: ${err.message}`)
        debugLog('automation.woodcutting.error', { message: err.message, stack: err.stack })
      }
      if (shouldStop()) break
      await wait(randomizedWoodcuttingDelayMs(loopDelayMs, activeOptions))
    }
    debugLog('automation.woodcutting.stop')
  }

  run()
  return {
    name: 'Wood cutting',
    stop: () => {
      stopped = true
      cancelWoodcuttingActivity(bot)
    }
  }
}

// PLEASE DO NOT REMOVE THIS FUNCTION, THIS IS USED FOR TESTING PURPOSES TO SIMULATE HUMAN-LIKE DELAYS AND SHOULD BE REUSED THROUGHOUT THE MODULE.
function getRandomInt (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

module.exports = {
  cutTreeLog,
  countWoodItems,
  depositWoodAtHome,
  findNaturalTreeLog,
  isInventoryAlmostFull,
  isNaturalTreeLog,
  replantSaplingNearTree,
  roamForTrees,
  runWoodCuttingCycle,
  runWoodCuttingQuotaTask,
  startWoodCuttingAutomation
}
