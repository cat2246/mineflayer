const fs = require('fs')
const path = require('path')
const vec3 = require('vec3')
const { goals: { GoalNear } } = require('mineflayer-pathfinder')
const {
  CONTAINER_HOUSE_SIZE,
  CONTAINER_INTERACTION_DELAY_MAX_MS,
  CONTAINER_INTERACTION_DELAY_MIN_MS,
  CONTAINER_MEMORY_PATH,
  WOODCUTTING_CHEST_SEARCH_RADIUS
} = require('./config')
const { sleep } = require('./time')

const MEMORY_VERSION = 1
const CARDINAL_DIRECTIONS = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  west: { x: -1, z: 0 },
  east: { x: 1, z: 0 }
}

function distanceBetween (a, b) {
  if (typeof a?.distanceTo === 'function') return a.distanceTo(b)
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

function clonePosition (position) {
  if (!position) return null
  return {
    x: position.x,
    y: position.y,
    z: position.z
  }
}

function sameBlockPosition (a, b) {
  return Math.floor(a?.x) === Math.floor(b?.x) &&
    Math.floor(a?.y) === Math.floor(b?.y) &&
    Math.floor(a?.z) === Math.floor(b?.z)
}

function blockCenterPosition (block) {
  return vec3(block.position.x + 0.5, block.position.y + 0.5, block.position.z + 0.5)
}

function entityEyePosition (bot) {
  const position = bot.entity?.position
  if (!position) return null
  return vec3(position.x, position.y + (bot.entity.eyeHeight ?? 1.62), position.z)
}

function isContainerBlockName (name = '') {
  return /^(chest|trapped_chest|barrel)$/i.test(name)
}

function isChestBlockName (name = '') {
  return /^(chest|trapped_chest)$/i.test(name)
}

function chestConnectionType (block) {
  const type = block?._properties?.type || block?.properties?.type
  return typeof type === 'string' ? type.toLowerCase() : null
}

function isLargeChestHalf (block) {
  return Boolean(isChestBlockName(block?.name) && ['left', 'right'].includes(chestConnectionType(block)))
}

function isAdjacentHorizontalBlock (a, b) {
  if (!a?.position || !b?.position) return false
  const dx = Math.abs(Math.round(a.position.x) - Math.round(b.position.x))
  const dz = Math.abs(Math.round(a.position.z) - Math.round(b.position.z))
  return Math.round(a.position.y) === Math.round(b.position.y) && dx + dz === 1
}

function areLargeChestHalves (a, b) {
  if (!isLargeChestHalf(a) || !isLargeChestHalf(b)) return false
  if (a.name !== b.name) return false
  if (chestConnectionType(a) === chestConnectionType(b)) return false
  const aFacing = containerFacing(a)
  const bFacing = containerFacing(b)
  if (aFacing && bFacing && aFacing !== bFacing) return false
  return isAdjacentHorizontalBlock(a, b)
}

function findLargeChestPair (block, blocks) {
  return blocks.find(candidate => candidate !== block && areLargeChestHalves(block, candidate)) || null
}

function largeChestPairKey (a, b) {
  return [positionKey(a.position), positionKey(b.position)].sort().join('|')
}

function closestInteractionDistance (bot, block) {
  const botPosition = bot.entity?.position
  if (!botPosition) return 0
  const targets = containerInteractionTargets(bot, block)
  if (targets.length === 0) return distanceBetween(botPosition, block.position)
  return Math.min(...targets.map(target => distanceBetween(botPosition, target)))
}

function chooseLargeChestRepresentative (bot, blocks) {
  const botPosition = bot.entity?.position
  return blocks.slice().sort((a, b) =>
    closestInteractionDistance(bot, a) - closestInteractionDistance(bot, b) ||
    (botPosition ? distanceBetween(botPosition, a.position) - distanceBetween(botPosition, b.position) : 0)
  )[0]
}

function dedupeLargeChestBlocks (bot, blocks) {
  if (!Array.isArray(blocks) || blocks.length < 2) return blocks

  const seenPairs = new Set()
  const uniqueBlocks = []
  for (const block of blocks) {
    const pair = findLargeChestPair(block, blocks)
    if (!pair) {
      uniqueBlocks.push(block)
      continue
    }

    const key = largeChestPairKey(block, pair)
    if (seenPairs.has(key)) continue
    seenPairs.add(key)
    uniqueBlocks.push(chooseLargeChestRepresentative(bot, [block, pair]))
  }

  return uniqueBlocks
}

function containerItems (container) {
  if (typeof container.containerItems === 'function') return container.containerItems()
  if (typeof container.items === 'function') return container.items()
  return []
}

function isDestinationFullError (err) {
  return /destination full/i.test(err?.message || '')
}

function dimensionName (bot, options = {}) {
  return String(options.dimension || bot.game?.dimension || 'overworld')
}

function positionKey (position) {
  return `${Math.round(position.x)},${Math.round(position.y)},${Math.round(position.z)}`
}

function containerKey (bot, blockOrPosition, options = {}) {
  const position = blockOrPosition.position || blockOrPosition
  return `${dimensionName(bot, options)}:${positionKey(position)}`
}

function emptyContainerMemory () {
  return {
    version: MEMORY_VERSION,
    home: null,
    containers: {}
  }
}

function normalizeContainerMemory (memory) {
  if (!memory || typeof memory !== 'object') return emptyContainerMemory()
  return {
    version: MEMORY_VERSION,
    home: memory.home || null,
    containers: memory.containers && typeof memory.containers === 'object' ? memory.containers : {}
  }
}

function containerMemoryPath (options = {}) {
  if (options.containerMemoryPath === false) return null
  return options.containerMemoryPath || CONTAINER_MEMORY_PATH
}

function readContainerMemory (options = {}) {
  const filePath = containerMemoryPath(options)
  if (!filePath || !fs.existsSync(filePath)) return emptyContainerMemory()

  try {
    return normalizeContainerMemory(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch (err) {
    return emptyContainerMemory()
  }
}

function writeContainerMemory (memory, options = {}) {
  const filePath = containerMemoryPath(options)
  if (!filePath) return

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(normalizeContainerMemory(memory), null, 2)}\n`)
  } catch (err) {
    // Memory is an optimization. Chest actions should keep working if the file is unavailable.
  }
}

function updateContainerMemory (options, updater) {
  const memory = readContainerMemory(options)
  const nextMemory = updater(memory) || memory
  writeContainerMemory(nextMemory, options)
  return nextMemory
}

function rememberedHomeAnchor (bot, options = {}) {
  if (options.originPosition) return clonePosition(options.originPosition)
  if (bot.__containerHomeAnchor) return clonePosition(bot.__containerHomeAnchor)
  if (bot.__nightSafetyHomeAnchor) return clonePosition(bot.__nightSafetyHomeAnchor)

  const memory = readContainerMemory(options)
  return clonePosition(memory.home?.position)
}

function rememberHouseAnchor (bot, position, options = {}) {
  const anchor = clonePosition(position)
  if (!anchor) return null

  bot.__containerHomeAnchor = anchor
  updateContainerMemory(options, memory => {
    memory.home = {
      dimension: dimensionName(bot, options),
      position: anchor,
      updatedAt: Date.now()
    }
    return memory
  })
  return anchor
}

function shouldUseHouseBounds (bot, options = {}) {
  if (options.houseOnly === false) return false
  if (options.houseOnly === true) return true
  return Boolean(options.originPosition || bot.__containerHomeAnchor || bot.__nightSafetyHomeAnchor)
}

function houseHalfSize (options = {}) {
  return (options.houseSize ?? CONTAINER_HOUSE_SIZE) / 2
}

function isWithinHouseBounds (position, anchor, options = {}) {
  if (!position || !anchor) return false
  const halfSize = houseHalfSize(options)
  return Math.abs(position.x - anchor.x) <= halfSize &&
    Math.abs(position.y - anchor.y) <= halfSize &&
    Math.abs(position.z - anchor.z) <= halfSize
}

function searchRadiusForOptions (bot, options = {}) {
  if (shouldUseHouseBounds(bot, options) && rememberedHomeAnchor(bot, options)) {
    const cubeRadius = Math.ceil(Math.sqrt(3) * houseHalfSize(options))
    return options.chestSearchRadius ?? options.searchRadius ?? cubeRadius
  }
  return options.chestSearchRadius ?? options.searchRadius ?? WOODCUTTING_CHEST_SEARCH_RADIUS
}

function itemSnapshot (item) {
  return {
    name: item.name,
    type: item.type,
    metadata: item.metadata ?? null,
    count: item.count
  }
}

function rememberContainerBlocks (bot, blocks, options = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) return

  const anchor = rememberedHomeAnchor(bot, options)
  updateContainerMemory(options, memory => {
    if (anchor) {
      memory.home = memory.home || {
        dimension: dimensionName(bot, options),
        position: anchor,
        updatedAt: Date.now()
      }
    }

    for (const block of blocks) {
      if (!block?.position) continue
      const key = containerKey(bot, block, options)
      const existing = memory.containers[key] || {}
      memory.containers[key] = {
        ...existing,
        dimension: dimensionName(bot, options),
        name: block.name,
        position: clonePosition(block.position),
        discoveredAt: existing.discoveredAt || Date.now(),
        lastSeenAt: Date.now(),
        searchedAt: existing.searchedAt || null,
        items: Array.isArray(existing.items) ? existing.items : []
      }
    }
    return memory
  })
}

function rememberContainerContents (bot, block, container, options = {}) {
  if (!block?.position) return

  updateContainerMemory(options, memory => {
    const key = containerKey(bot, block, options)
    const existing = memory.containers[key] || {}
    memory.containers[key] = {
      ...existing,
      dimension: dimensionName(bot, options),
      name: block.name,
      position: clonePosition(block.position),
      discoveredAt: existing.discoveredAt || Date.now(),
      lastSeenAt: Date.now(),
      searchedAt: Date.now(),
      items: containerItems(container)
        .filter(item => item && item.count > 0)
        .map(itemSnapshot)
    }
    return memory
  })
}

function containerMemoryRecord (bot, block, options = {}) {
  if (!block?.position) return null
  return readContainerMemory(options).containers[containerKey(bot, block, options)] || null
}

function itemMatchesAnyNeed (item, needs = []) {
  return needs.some(need => typeof need.matcher === 'function' && need.matcher(item))
}

function containerRecordHasDesiredItems (record, desiredItems = []) {
  if (!record?.searchedAt || desiredItems.length === 0) return false
  return (record.items || []).some(item => itemMatchesAnyNeed(item, desiredItems))
}

function sortContainerBlocksByMemory (bot, blocks, options = {}) {
  const desiredItems = options.desiredItems || []
  if (desiredItems.length === 0) return blocks

  const memory = readContainerMemory(options)
  return blocks
    .map((block, index) => {
      const record = memory.containers[containerKey(bot, block, options)]
      const hasDesiredItems = containerRecordHasDesiredItems(record, desiredItems)
      const searched = Boolean(record?.searchedAt)
      return {
        block,
        index,
        rank: hasDesiredItems ? 0 : searched ? 2 : 1
      }
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ block }) => block)
}

function filterContainerBlocksForDesiredItems (bot, blocks, desiredItems = [], options = {}) {
  if (desiredItems.length === 0) return blocks
  const memory = readContainerMemory(options)
  return blocks.filter(block => {
    const record = memory.containers[containerKey(bot, block, options)]
    if (!record?.searchedAt) return true
    return containerRecordHasDesiredItems(record, desiredItems)
  })
}

function allContainersSearchedWithoutDesiredItems (bot, blocks, desiredItems = [], options = {}) {
  if (blocks.length === 0 || desiredItems.length === 0) return false

  const memory = readContainerMemory(options)
  return blocks.every(block => {
    const record = memory.containers[containerKey(bot, block, options)]
    return Boolean(record?.searchedAt) && !containerRecordHasDesiredItems(record, desiredItems)
  })
}

function findNearbyContainerBlocks (bot, options = {}) {
  const searchRadius = searchRadiusForOptions(bot, options)
  const houseOnly = shouldUseHouseBounds(bot, options)
  const homeAnchor = houseOnly ? rememberedHomeAnchor(bot, options) : null
  const originPosition = homeAnchor || options.originPosition || bot.entity?.position

  if (typeof bot.findBlocks === 'function' && typeof bot.blockAt === 'function') {
    const positions = bot.findBlocks({
      matching: block => isContainerBlockName(block.name),
      maxDistance: searchRadius,
      count: options.containerCandidateCount ?? 64
    })
    const blocks = positions
      .map(position => bot.blockAt(position))
      .filter(Boolean)
      .filter(block => {
        if (houseOnly && homeAnchor) return isWithinHouseBounds(block.position, homeAnchor, options)
        return !originPosition || distanceBetween(originPosition, block.position) <= searchRadius
      })
      .sort((a, b) => {
        if (!originPosition) return 0
        return distanceBetween(originPosition, a.position) - distanceBetween(originPosition, b.position)
      })
    const uniqueBlocks = dedupeLargeChestBlocks(bot, blocks)

    rememberContainerBlocks(bot, uniqueBlocks, options)
    return sortContainerBlocksByMemory(bot, uniqueBlocks, options)
  }

  if (typeof bot.findBlock !== 'function') return []
  const block = bot.findBlock({
    matching: block => isContainerBlockName(block.name),
    maxDistance: searchRadius
  })
  const blocks = block && (!houseOnly || !homeAnchor || isWithinHouseBounds(block.position, homeAnchor, options)) ? [block] : []
  rememberContainerBlocks(bot, blocks, options)
  return sortContainerBlocksByMemory(bot, blocks, options)
}

async function approachContainerBlock (bot, block, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (options.approachContainers === false) return true
  if (!block?.position) return false

  const target = containerInteractionTarget(bot, block, options)
  if (!target) return false
  if (isAtContainerInteractionTarget(bot, target, options)) return true
  if (typeof bot.pathfinder?.goto !== 'function') return true

  try {
    if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)
    await bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, options.containerApproachRange ?? 1))
    return true
  } catch (err) {
    debugLog('container.pathError', {
      block: block.name,
      position: block.position,
      target,
      message: err.message
    })
    return false
  }
}

function containerFacing (block) {
  const facing = block?._properties?.facing || block?.properties?.facing
  return typeof facing === 'string' ? facing.toLowerCase() : null
}

function containerInteractionPoint (block, direction) {
  return {
    x: block.position.x + direction.x,
    y: block.position.y,
    z: block.position.z + direction.z
  }
}

function containerInteractionTargets (bot, block) {
  const facing = containerFacing(block)
  const frontDirection = CARDINAL_DIRECTIONS[facing]
  const directions = Object.values(CARDINAL_DIRECTIONS)
  const botPosition = bot.entity?.position
  const frontTarget = frontDirection ? containerInteractionPoint(block, frontDirection) : null
  const targets = directions
    .map(direction => containerInteractionPoint(block, direction))
    .filter(target => !frontTarget || !sameBlockPosition(target, frontTarget))
    .sort((a, b) => {
      if (!botPosition) return 0
      return distanceBetween(botPosition, a) - distanceBetween(botPosition, b)
    })

  return frontTarget ? [frontTarget, ...targets] : targets
}

function containerInteractionTarget (bot, block, options = {}) {
  return containerInteractionTargets(bot, block, options)[0] || null
}

function isAtContainerInteractionTarget (bot, target, options = {}) {
  const botPosition = bot.entity?.position
  if (!botPosition || !target) return false
  return distanceBetween(botPosition, target) <= (options.containerApproachRange ?? 1)
}

async function lookAtContainerBlock (bot, block) {
  if (typeof bot.lookAt !== 'function') return true
  await bot.lookAt(blockCenterPosition(block), true)
  return true
}

function canSeeContainerBlock (bot, block, options = {}) {
  if (options.checkContainerLineOfSight === false) return true
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

async function prepareContainerBlock (bot, block, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const approached = await approachContainerBlock(bot, block, options)
  if (!approached) return false

  await lookAtContainerBlock(bot, block)
  if (!canSeeContainerBlock(bot, block, options)) {
    debugLog('container.blockedLineOfSight', {
      block: block.name,
      position: block.position
    })
    return false
  }

  return true
}

function containerInteractionDelayMs (options = {}) {
  if (typeof options.containerInteractionDelayMs === 'number') return Math.max(0, options.containerInteractionDelayMs)

  const range = options.containerDelayRangeMs || [
    CONTAINER_INTERACTION_DELAY_MIN_MS,
    CONTAINER_INTERACTION_DELAY_MAX_MS
  ]
  const min = Math.max(0, range[0] ?? CONTAINER_INTERACTION_DELAY_MIN_MS)
  const max = Math.max(min, range[1] ?? CONTAINER_INTERACTION_DELAY_MAX_MS)
  const random = options.random || Math.random
  return Math.round(min + random() * (max - min))
}

async function waitForContainerInteraction (options = {}, phase = 'container') {
  const delayMs = containerInteractionDelayMs(options)
  if (delayMs <= 0) return

  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  debugLog('container.delay', { phase, delayMs })
  await wait(delayMs)
}

async function visitContainerBlocks (bot, blocks, options = {}, visitor) {
  if (typeof bot.openContainer !== 'function') return false

  const uniqueBlocks = dedupeLargeChestBlocks(bot, blocks)
  rememberContainerBlocks(bot, uniqueBlocks, options)
  for (const block of uniqueBlocks) {
    if (!await prepareContainerBlock(bot, block, options)) continue
    const container = await bot.openContainer(block)
    try {
      await waitForContainerInteraction(options, 'open')
      const visited = await visitor(container, block)
      rememberContainerContents(bot, block, container, options)
      if (visited) return true
    } finally {
      try {
        await waitForContainerInteraction(options, 'close')
      } finally {
        if (typeof container.close === 'function') container.close()
      }
    }
  }

  return false
}

async function visitNearbyContainers (bot, options = {}, visitor) {
  const blocks = findNearbyContainerBlocks(bot, options)
  return visitContainerBlocks(bot, blocks, options, visitor)
}

async function visitKnownContainers (bot, blocks, options = {}, visitor) {
  if (typeof bot.openContainer !== 'function') return false

  for (const block of dedupeLargeChestBlocks(bot, blocks)) {
    if (!await prepareContainerBlock(bot, block, options)) continue
    const container = await bot.openContainer(block)
    try {
      if (await visitor(container, block)) return true
    } finally {
      if (typeof container.close === 'function') container.close()
    }
  }

  return false
}

module.exports = {
  allContainersSearchedWithoutDesiredItems,
  containerItems,
  containerMemoryRecord,
  filterContainerBlocksForDesiredItems,
  findNearbyContainerBlocks,
  isContainerBlockName,
  isDestinationFullError,
  isWithinHouseBounds,
  readContainerMemory,
  rememberContainerContents,
  rememberHouseAnchor,
  sortContainerBlocksByMemory,
  visitContainerBlocks,
  visitKnownContainers,
  visitNearbyContainers,
  writeContainerMemory
}
