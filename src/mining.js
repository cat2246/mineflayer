const vec3 = require('vec3')
const { goals: { GoalNear, GoalNearXZ } } = require('mineflayer-pathfinder')
const {
  WOODCUTTING_CHEST_SEARCH_RADIUS,
  WOODCUTTING_DROP_PICKUP_WAIT_MS,
  WOODCUTTING_DROP_SEARCH_RADIUS,
  WOODCUTTING_HOME_COMMAND,
  WOODCUTTING_HOME_WAIT_MS,
  WOODCUTTING_LOOP_DELAY_MS,
  WOODCUTTING_PATH_TIMEOUT_MS,
  WOODCUTTING_ROAM_RADIUS
} = require('./config')
const {
  findNearbyContainerBlocks,
  isDestinationFullError,
  rememberHouseAnchor,
  visitContainerBlocks
} = require('./containers')
const { readPlaceCoordinates, rememberPlaceCoordinates } = require('./places')
const { sleep } = require('./time')

const MINING_HOME_RADIUS = 50
const MINING_ORE_SEARCH_RADIUS = 48
const MINING_ORE_CANDIDATE_COUNT = 128
const MINING_EMPTY_SLOT_THRESHOLD = 0
const MINING_POST_DIG_DELAY_MS = 500
const MINING_APPROACH_RANGE = 2
const MINING_DEFAULT_TARGET_Y = 12
const MINING_STRIP_BRANCH_INTERVAL = 4
const MINING_STRIP_BRANCH_DEPTH = 2

const MINING_ORE_BLOCK_NAMES = new Set([
  'coal_ore',
  'deepslate_coal_ore',
  'iron_ore',
  'deepslate_iron_ore',
  'gold_ore',
  'deepslate_gold_ore',
  'nether_gold_ore',
  'diamond_ore',
  'deepslate_diamond_ore',
  'lapis_ore',
  'deepslate_lapis_ore'
])

const MINING_TUNNEL_ITEM_NAMES = new Set([
  'andesite',
  'basalt',
  'blackstone',
  'calcite',
  'cobbled_deepslate',
  'cobblestone',
  'deepslate',
  'diorite',
  'dirt',
  'dripstone_block',
  'flint',
  'granite',
  'gravel',
  'netherrack',
  'stone',
  'tuff'
])

const MINING_ITEM_NAMES = new Set([
  ...MINING_ORE_BLOCK_NAMES,
  ...MINING_TUNNEL_ITEM_NAMES,
  'coal',
  'raw_iron',
  'raw_gold',
  'iron_ingot',
  'gold_ingot',
  'gold_nugget',
  'diamond',
  'lapis_lazuli'
])

function distanceBetween (a, b) {
  if (typeof a?.distanceTo === 'function') return a.distanceTo(b)
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

function horizontalDistanceBetween (a, b) {
  if (!a || !b) return 0
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

function clonePosition (position) {
  if (!position) return null
  if (typeof position.clone === 'function') return position.clone()
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    distanceTo: position.distanceTo,
    offset: position.offset
  }
}

function positionData (position) {
  if (!position) return null
  return {
    x: position.x,
    y: position.y,
    z: position.z
  }
}

function floorPosition (position) {
  if (!position) return null
  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z)
  }
}

function offsetPosition (position, x, y, z) {
  if (!position) return null
  return {
    x: position.x + x,
    y: position.y + y,
    z: position.z + z
  }
}

function sameBlockPosition (a, b) {
  return Math.floor(a?.x) === Math.floor(b?.x) &&
    Math.floor(a?.y) === Math.floor(b?.y) &&
    Math.floor(a?.z) === Math.floor(b?.z)
}

function blockCenterPosition (block) {
  if (typeof block.position?.offset === 'function') {
    return block.position.offset(0.5, 0.5, 0.5)
  }

  return vec3(block.position.x + 0.5, block.position.y + 0.5, block.position.z + 0.5)
}

function entityEyePosition (bot) {
  const position = bot.entity?.position
  if (!position) return null
  return vec3(position.x, position.y + (bot.entity.eyeHeight ?? 1.62), position.z)
}

function inventoryItems (bot) {
  return typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
}

function isMineableOreBlock (block) {
  return MINING_ORE_BLOCK_NAMES.has(block?.name)
}

function isPassableMiningBlock (block) {
  return !block || /^(air|cave_air|void_air)$/i.test(block.name || '')
}

function isUnsafeTunnelBlock (block) {
  return /^(bedrock|water|flowing_water|lava|flowing_lava)$/i.test(block?.name || '') ||
    /(chest|barrel|furnace|bed|door|glass|pane|log|wood|leaves|torch|lantern|sign|rail|spawner)/i.test(block?.name || '')
}

function canDigTunnelBlock (bot, block) {
  if (isPassableMiningBlock(block)) return true
  if (isUnsafeTunnelBlock(block)) return false
  if (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(block)) return false
  return true
}

function isMiningItem (item) {
  return MINING_ITEM_NAMES.has(item?.name)
}

function miningItems (bot) {
  return inventoryItems(bot).filter(isMiningItem)
}

function isInventoryFull (bot, threshold = MINING_EMPTY_SLOT_THRESHOLD) {
  if (typeof bot.inventory?.emptySlotCount !== 'function') return false
  return bot.inventory.emptySlotCount() <= threshold
}

function savedHomePosition (bot, options = {}) {
  return clonePosition(options.homePosition) ||
    clonePosition(readPlaceCoordinates('home', options)?.position) ||
    clonePosition(bot.__containerHomeAnchor) ||
    clonePosition(bot.__nightSafetyHomeAnchor) ||
    null
}

function isOutsideHomeRadius (position, homePosition, options = {}) {
  return horizontalDistanceBetween(homePosition, position) > (options.minimumHomeDistance ?? MINING_HOME_RADIUS)
}

function findOreBlock (bot, homePosition, options = {}) {
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return null

  const originPosition = bot.entity?.position
  const searchRadius = options.oreSearchRadius ?? MINING_ORE_SEARCH_RADIUS
  const positions = bot.findBlocks({
    matching: block => isMineableOreBlock(block),
    maxDistance: searchRadius,
    count: options.oreCandidateCount ?? MINING_ORE_CANDIDATE_COUNT
  })

  return positions
    .map(position => bot.blockAt(position))
    .filter(Boolean)
    .filter(block => isMineableOreBlock(block))
    .filter(block => isOutsideHomeRadius(block.position, homePosition, options))
    .filter(block => !originPosition || distanceBetween(originPosition, block.position) <= searchRadius)
    .sort((a, b) => distanceBetween(originPosition, a.position) - distanceBetween(originPosition, b.position))[0] || null
}

function pickOutwardMiningTarget (bot, homePosition, options = {}) {
  if (options.roamTarget) return options.roamTarget

  const random = options.random || Math.random
  const currentPosition = bot.entity?.position || homePosition
  const currentDistance = horizontalDistanceBetween(homePosition, currentPosition)
  const previousDistance = bot.__miningExploreDistance || 0
  const minimumDistance = options.minimumHomeDistance ?? MINING_HOME_RADIUS
  const stepDistance = options.exploreStepDistance ?? options.roamRadius ?? WOODCUTTING_ROAM_RADIUS
  const distance = Math.max(currentDistance, previousDistance, minimumDistance) + stepDistance
  const dx = currentPosition.x - homePosition.x
  const dz = currentPosition.z - homePosition.z
  const currentAngle = horizontalDistanceBetween(homePosition, currentPosition) > 1
    ? Math.atan2(dz, dx)
    : null
  const angle = Number.isFinite(options.roamAngle)
    ? options.roamAngle
    : currentAngle ?? bot.__miningExploreAngle ?? (random() * Math.PI * 2)

  return {
    x: Math.round(homePosition.x + Math.cos(angle) * distance),
    y: homePosition.y,
    z: Math.round(homePosition.z + Math.sin(angle) * distance),
    angle,
    distanceFromHome: Math.round(distance)
  }
}

function namedDirection (name) {
  if (name === 'east') return { x: 1, z: 0, name }
  if (name === 'west') return { x: -1, z: 0, name }
  if (name === 'south') return { x: 0, z: 1, name }
  if (name === 'north') return { x: 0, z: -1, name }
  return null
}

function cardinalDirectionFromVector (x, z) {
  if (Math.abs(x) >= Math.abs(z)) return x >= 0 ? namedDirection('east') : namedDirection('west')
  return z >= 0 ? namedDirection('south') : namedDirection('north')
}

function normalizeTunnelDirection (direction) {
  if (typeof direction === 'string') return namedDirection(direction.toLowerCase())
  if (!direction || typeof direction !== 'object') return null
  const x = Number(direction.x || 0)
  const z = Number(direction.z || 0)
  if (x === 0 && z === 0) return null
  return cardinalDirectionFromVector(x, z)
}

function miningTunnelDirection (bot, homePosition, options = {}) {
  const optionDirection = normalizeTunnelDirection(options.tunnelDirection)
  if (optionDirection) return optionDirection
  if (bot.__miningTunnelDirection) return bot.__miningTunnelDirection

  const currentPosition = bot.entity?.position || homePosition
  const direction = cardinalDirectionFromVector(
    currentPosition.x - homePosition.x,
    currentPosition.z - homePosition.z
  )
  bot.__miningTunnelDirection = direction
  return direction
}

function branchDirection (direction, side) {
  if (side === 'left') return { x: direction.z, z: -direction.x }
  return { x: -direction.z, z: direction.x }
}

function nextBranchSide (bot) {
  return bot.__miningNextBranchSide || 'right'
}

function flipBranchSide (bot, side) {
  bot.__miningNextBranchSide = side === 'right' ? 'left' : 'right'
}

function isMiningStopped (bot, options = {}) {
  return Boolean(bot?._ended || (typeof options.shouldStop === 'function' && options.shouldStop()))
}

function cancelMiningActivity (bot) {
  if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)

  if (typeof bot.stopDigging === 'function') {
    try {
      bot.stopDigging()
    } catch {
      // stopDigging can throw when there is no active dig.
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

function withTimeout (promise, timeoutMs) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise(resolve => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
  ])
}

async function gotoGoal (bot, goal, options = {}, context = {}) {
  const debugLog = options.debugLog || (() => {})
  if (isMiningStopped(bot, options)) return false
  if (typeof bot.pathfinder?.goto !== 'function') return false

  const timeoutMs = options.pathTimeoutMs ?? WOODCUTTING_PATH_TIMEOUT_MS
  let result
  try {
    result = await withTimeout(bot.pathfinder.goto(goal), timeoutMs)
  } catch (err) {
    if (isMiningStopped(bot, options)) return false
    if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)
    debugLog('automation.mining.pathError', {
      ...context,
      message: err.message
    })
    return false
  }

  if (isMiningStopped(bot, options)) return false
  if (result === 'timeout') {
    if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)
    debugLog('automation.mining.pathTimeout', context)
    return false
  }

  return true
}

async function roamAwayFromHome (bot, homePosition, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const target = pickOutwardMiningTarget(bot, homePosition, options)
  if (!target || typeof bot.pathfinder?.goto !== 'function') return false

  const roamed = await gotoGoal(
    bot,
    new GoalNearXZ(target.x, target.z, options.roamGoalRange ?? 8),
    options,
    { mode: 'roam', target: positionData(target) }
  )
  if (!roamed || isMiningStopped(bot, options)) return false

  bot.__miningLastRoamTarget = target
  bot.__miningLastRoamDistanceFromHome = Math.round(horizontalDistanceBetween(homePosition, target))
  if (!options.roamTarget) {
    bot.__miningExploreAngle = target.angle
    bot.__miningExploreDistance = target.distanceFromHome
  }
  debugLog('automation.mining.roam', {
    target: positionData(target),
    distanceFromHome: bot.__miningLastRoamDistanceFromHome
  })
  return true
}

function findPickaxe (bot) {
  return inventoryItems(bot).find(item => /_pickaxe$/i.test(item.name || '')) || null
}

async function equipBestMiningTool (bot, block, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const tool = typeof bot.pathfinder?.bestHarvestTool === 'function'
    ? bot.pathfinder.bestHarvestTool(block)
    : findPickaxe(bot)
  const pickaxe = /_pickaxe$/i.test(tool?.name || '') ? tool : findPickaxe(bot)

  if (!pickaxe) {
    debugLog('automation.mining.missingPickaxe', { block: block.name })
    return false
  }
  if (typeof bot.equip === 'function') await bot.equip(pickaxe, 'hand')
  return true
}

function getEquipmentSlot (bot, destination) {
  if (typeof bot.getEquipmentDestSlot !== 'function') return null

  try {
    const slot = bot.getEquipmentDestSlot(destination)
    return Number.isInteger(slot) ? slot : null
  } catch {
    return null
  }
}

function getEquipmentItem (bot, destination) {
  const slot = getEquipmentSlot(bot, destination)
  return Number.isInteger(slot) ? bot.inventory?.slots?.[slot] : null
}

function safeEnchantments (item, slot, debugLog = () => {}) {
  if (!item) return []

  let enchantments
  try {
    enchantments = item.enchants
  } catch (err) {
    debugLog('automation.mining.ignoredEnchantError', {
      slot,
      item: item.name,
      message: err.message
    })
    return []
  }

  if (Array.isArray(enchantments)) return enchantments

  debugLog('automation.mining.ignoredBadEnchantData', {
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

function canSeeBlock (bot, block, options = {}) {
  if (options.checkMiningLineOfSight === false) return true
  if (typeof bot.world?.raycast !== 'function') return true

  const eye = entityEyePosition(bot)
  if (!eye) return true
  const center = blockCenterPosition(block)
  const direction = center.minus(eye)
  const range = Math.sqrt(
    Math.pow(direction.x, 2) +
    Math.pow(direction.y, 2) +
    Math.pow(direction.z, 2)
  )
  if (range <= 0) return true

  const hit = bot.world.raycast(eye, direction.scaled(1 / range), range + 0.25)
  return !hit || sameBlockPosition(hit.position, block.position)
}

function nearbyDrops (bot, originPosition, options = {}) {
  const searchRadius = options.dropSearchRadius ?? WOODCUTTING_DROP_SEARCH_RADIUS
  return Object.values(bot.entities || {})
    .filter(entity => entity?.position && /^(object|item)$/i.test(entity.type || ''))
    .filter(entity => distanceBetween(originPosition, entity.position) <= searchRadius)
    .sort((a, b) => distanceBetween(originPosition, a.position) - distanceBetween(originPosition, b.position))
}

async function collectNearbyDrops (bot, originPosition, options = {}) {
  const wait = options.sleep || sleep
  const drops = nearbyDrops(bot, originPosition, options).slice(0, options.dropCollectCount ?? 8)
  let collected = 0

  for (const drop of drops) {
    if (isMiningStopped(bot, options)) break
    const reached = await gotoGoal(bot, new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1), options, {
      mode: 'collect-drop',
      target: positionData(drop.position)
    })
    if (!reached || isMiningStopped(bot, options)) continue
    collected++
    const pickupWaitMs = options.dropPickupWaitMs ?? WOODCUTTING_DROP_PICKUP_WAIT_MS
    if (pickupWaitMs > 0) await wait(pickupWaitMs)
  }

  if (collected > 0) {
    const debugLog = options.debugLog || (() => {})
    debugLog('automation.mining.collectDrops', { count: collected })
  }
  return collected
}

function blockAtMiningPosition (bot, position) {
  return typeof bot.blockAt === 'function' ? bot.blockAt(position) : null
}

async function digTunnelBlock (bot, block, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  if (isPassableMiningBlock(block)) return true
  if (!canDigTunnelBlock(bot, block)) {
    debugLog('automation.mining.tunnel.blocked', {
      block: block?.name,
      position: block?.position
    })
    return false
  }

  if (!await equipBestMiningTool(bot, block, options)) return false
  if (typeof bot.lookAt === 'function') await bot.lookAt(blockCenterPosition(block), true)

  if (!canSeeBlock(bot, block, options)) {
    debugLog('automation.mining.tunnel.blockedLineOfSight', {
      block: block.name,
      position: block.position
    })
    return false
  }

  await digBlockWithSafeEnchantments(bot, block, debugLog)
  const postDigDelayMs = options.postDigDelayMs ?? MINING_POST_DIG_DELAY_MS
  if (postDigDelayMs > 0 && !isMiningStopped(bot, options)) await wait(postDigDelayMs)
  return true
}

async function clearTunnelColumn (bot, basePosition, options = {}) {
  let dug = 0
  for (const target of [basePosition, offsetPosition(basePosition, 0, 1, 0)]) {
    if (isMiningStopped(bot, options)) return { completed: false, dug }
    const block = blockAtMiningPosition(bot, target)
    if (isPassableMiningBlock(block)) continue
    const cleared = await digTunnelBlock(bot, block, options)
    if (!cleared) return { completed: false, dug }
    dug++
  }

  return { completed: true, dug }
}

async function digStripMineBranch (bot, tunnelTarget, direction, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const interval = options.stripMineBranchInterval ?? MINING_STRIP_BRANCH_INTERVAL
  if (interval <= 0) return { completed: true, dug: 0 }

  const nextStep = (bot.__miningTunnelSteps || 0) + 1
  if (nextStep % interval !== 0) return { completed: true, dug: 0 }

  const side = nextBranchSide(bot)
  const sideDirection = branchDirection(direction, side)
  const depth = Math.max(1, options.stripMineBranchDepth ?? MINING_STRIP_BRANCH_DEPTH)
  let dug = 0

  for (let index = 1; index <= depth; index++) {
    if (isMiningStopped(bot, options)) return { completed: false, dug, side }
    const branchBase = offsetPosition(tunnelTarget, sideDirection.x * index, 0, sideDirection.z * index)
    const result = await clearTunnelColumn(bot, branchBase, options)
    dug += result.dug
    if (!result.completed) return { completed: false, dug, side }
  }

  flipBranchSide(bot, side)
  debugLog('automation.mining.stripMineBranch', {
    side,
    origin: tunnelTarget,
    depth,
    dug
  })
  return { completed: true, dug, side }
}

function tunnelTargetPosition (bot, homePosition, direction, options = {}) {
  const currentPosition = floorPosition(bot.entity?.position)
  if (!currentPosition) return null
  const targetMiningY = options.targetMiningY ?? MINING_DEFAULT_TARGET_Y
  const yStep = currentPosition.y > targetMiningY ? -1 : 0
  return offsetPosition(currentPosition, direction.x, yStep, direction.z)
}

async function runStripMineTunnelStep (bot, homePosition, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const direction = miningTunnelDirection(bot, homePosition, options)
  const target = tunnelTargetPosition(bot, homePosition, direction, options)
  if (!target || !isOutsideHomeRadius(target, homePosition, options)) return false

  const tunnel = await clearTunnelColumn(bot, target, options)
  if (!tunnel.completed && tunnel.dug <= 0) return false

  const reached = await gotoGoal(
    bot,
    new GoalNear(target.x, target.y, target.z, options.tunnelGoalRange ?? 1),
    options,
    { mode: 'strip-mine', target: positionData(target), direction: direction.name }
  )
  if (isMiningStopped(bot, options)) return false

  const branch = await digStripMineBranch(bot, target, direction, options)
  bot.__miningTunnelSteps = (bot.__miningTunnelSteps || 0) + 1
  debugLog('automation.mining.tunnel', {
    target: positionData(target),
    direction: direction.name,
    reached,
    dug: tunnel.dug + branch.dug
  })

  return tunnel.completed || tunnel.dug > 0 || branch.dug > 0 || reached
}

async function mineOreBlock (bot, oreBlock, homePosition, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  if (!oreBlock || !isMineableOreBlock(oreBlock)) return false
  if (!isOutsideHomeRadius(oreBlock.position, homePosition, options)) return false

  const reached = await gotoGoal(
    bot,
    new GoalNear(oreBlock.position.x, oreBlock.position.y, oreBlock.position.z, options.miningApproachRange ?? MINING_APPROACH_RANGE),
    options,
    { mode: 'mine', block: oreBlock.name, position: positionData(oreBlock.position) }
  )
  if (!reached || isMiningStopped(bot, options)) return false

  if (!await equipBestMiningTool(bot, oreBlock, options)) return false
  if (typeof bot.lookAt === 'function') await bot.lookAt(blockCenterPosition(oreBlock), true)

  if (!canSeeBlock(bot, oreBlock, options)) {
    debugLog('automation.mining.blockedLineOfSight', {
      block: oreBlock.name,
      position: oreBlock.position
    })
    return false
  }

  await digBlockWithSafeEnchantments(bot, oreBlock, debugLog)
  const postDigDelayMs = options.postDigDelayMs ?? MINING_POST_DIG_DELAY_MS
  if (postDigDelayMs > 0 && !isMiningStopped(bot, options)) await wait(postDigDelayMs)
  if (!isMiningStopped(bot, options)) await collectNearbyDrops(bot, oreBlock.position, options)
  debugLog('automation.mining.mine', {
    block: oreBlock.name,
    position: oreBlock.position
  })
  return true
}

async function depositMinedItemsAtHome (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const homeCommand = options.homeCommand || WOODCUTTING_HOME_COMMAND
  const homeWaitMs = options.homeWaitMs ?? WOODCUTTING_HOME_WAIT_MS

  if (isMiningStopped(bot, options)) return false
  if (typeof bot.chat === 'function') bot.chat(homeCommand)
  await wait(homeWaitMs)
  if (isMiningStopped(bot, options)) return false

  const homeAnchor = rememberHouseAnchor(bot, bot.entity?.position, options)
  rememberPlaceCoordinates(bot, 'home', homeAnchor || bot.entity?.position, options)
  const containerOptions = {
    ...options,
    houseOnly: options.houseOnly ?? true,
    originPosition: options.originPosition || homeAnchor || bot.entity?.position,
    chestSearchRadius: options.chestSearchRadius ?? WOODCUTTING_CHEST_SEARCH_RADIUS
  }
  const containerBlocks = findNearbyContainerBlocks(bot, containerOptions)
  if (containerBlocks.length === 0) {
    debugLog('automation.mining.deposit.missingContainer')
    return false
  }

  return visitContainerBlocks(bot, containerBlocks, containerOptions, async (container, containerBlock) => {
    const items = miningItems(bot)
    if (items.length === 0) return true

    for (const item of items) {
      if (isMiningStopped(bot, options)) break
      try {
        await container.deposit(item.type, null, item.count)
        debugLog('automation.mining.deposit.item', {
          item: item.name,
          count: item.count,
          container: containerBlock.position
        })
      } catch (err) {
        if (!isDestinationFullError(err)) throw err
        debugLog('automation.mining.deposit.fullContainer', {
          container: containerBlock.position
        })
        return false
      }
    }

    return true
  })
}

async function runMiningCycle (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (isMiningStopped(bot, options)) return false
  if (bot.__nightSafetyActive) {
    debugLog('automation.mining.pausedForNightSafety')
    return true
  }

  if (isInventoryFull(bot, options.emptySlotThreshold)) {
    return depositMinedItemsAtHome(bot, options)
  }

  const homePosition = savedHomePosition(bot, options)
  if (!homePosition) {
    throw new Error('Mining requires a saved home coordinate before it can enforce the 50 block radius.')
  }

  const currentPosition = bot.entity?.position
  if (!currentPosition) return false

  const distanceFromHome = Math.round(horizontalDistanceBetween(homePosition, currentPosition))
  if (!isOutsideHomeRadius(currentPosition, homePosition, options)) {
    debugLog('automation.mining.nearHome', { distanceFromHome })
    return roamAwayFromHome(bot, homePosition, options)
  }

  const oreBlock = findOreBlock(bot, homePosition, options)
  if (!oreBlock) {
    const tunneled = await runStripMineTunnelStep(bot, homePosition, options)
    if (tunneled || isMiningStopped(bot, options)) return tunneled
    debugLog('automation.mining.noOre', { distanceFromHome })
    return roamAwayFromHome(bot, homePosition, options)
  }

  const mined = await mineOreBlock(bot, oreBlock, homePosition, options)
  if (mined || isMiningStopped(bot, options)) return mined

  return roamAwayFromHome(bot, homePosition, options)
}

function ensureMiningMovementEnabled (bot, debugLog = () => {}) {
  if (bot.physicsEnabled === false) {
    bot.physicsEnabled = true
    debugLog('automation.mining.physicsEnabled')
  }
}

function startMiningAutomation (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const output = options.output || console.log
  const wait = options.sleep || sleep
  const runMiningTask = options.runMiningTask || runMiningCycle
  const externalShouldStop = options.shouldStop
  let stopped = false
  const shouldStop = () => stopped ||
    bot._ended ||
    (typeof externalShouldStop === 'function' && externalShouldStop())
  const activeOptions = {
    ...options,
    shouldStop
  }

  ensureMiningMovementEnabled(bot, debugLog)

  async function run () {
    output('Started mining automation.')
    debugLog('automation.mining.start')

    while (!shouldStop()) {
      try {
        await runMiningTask(bot, activeOptions)
      } catch (err) {
        output(`Mining error: ${err.message}`)
        debugLog('automation.mining.error', { message: err.message, stack: err.stack })
        break
      }
      if (shouldStop()) break
      await wait(activeOptions.loopDelayMs ?? WOODCUTTING_LOOP_DELAY_MS)
    }

    debugLog('automation.mining.stop')
  }

  run()
  return {
    name: 'Mining',
    stop: () => {
      stopped = true
      cancelMiningActivity(bot)
    }
  }
}

module.exports = {
  depositMinedItemsAtHome,
  findOreBlock,
  isMineableOreBlock,
  miningItems,
  mineOreBlock,
  runMiningCycle,
  startMiningAutomation
}
