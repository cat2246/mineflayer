const fs = require('fs')
const path = require('path')
const vec3 = require('vec3')
const { goals: { GoalNear } } = require('mineflayer-pathfinder')
const {
  PYROFARM_GROWSTATION_VERIFICATION_TIMEOUT_MS,
  PYROFARM_MEMORY_PATH,
  PYROFARM_REFILL_TIMEOUT_MS,
  PYROFARM_SEARCH_RADIUS,
  PYROFARM_WATER_MESSAGE_TIMEOUT_MS,
  WOODCUTTING_LOOP_DELAY_MS
} = require('./config')
const { cleanText, collectTextParts, itemTexts } = require('./text')
const { sleep } = require('./time')

const PYROFARM_MEMORY_VERSION = 1

function clonePosition (position) {
  if (!position) return null
  return {
    x: position.x,
    y: position.y,
    z: position.z
  }
}

function blockCenterPosition (block) {
  return vec3(block.position.x + 0.5, block.position.y + 0.5, block.position.z + 0.5)
}

function distanceBetween (a, b) {
  if (typeof a?.distanceTo === 'function') return a.distanceTo(b)
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

function dimensionName (bot, options = {}) {
  return String(options.dimension || bot.game?.dimension || 'overworld')
}

function positionKey (position) {
  return `${Math.round(position.x)},${Math.round(position.y)},${Math.round(position.z)}`
}

function blockPosition (position) {
  if (!position) return null
  if (typeof position.floored === 'function') return position
  return vec3(position.x, position.y, position.z)
}

function growstationKey (bot, blockOrPosition, options = {}) {
  const position = blockOrPosition.position || blockOrPosition
  return `${dimensionName(bot, options)}:${positionKey(position)}`
}

function pyroFarmMemoryPath (options = {}) {
  if (options.pyroFarmMemoryPath === false) return null
  return options.pyroFarmMemoryPath || PYROFARM_MEMORY_PATH
}

function emptyPyroFarmMemory () {
  return {
    version: PYROFARM_MEMORY_VERSION,
    growstations: {},
    ignoredFlowerPots: {}
  }
}

function normalizePyroFarmMemory (memory) {
  if (!memory || typeof memory !== 'object') return emptyPyroFarmMemory()
  return {
    version: PYROFARM_MEMORY_VERSION,
    growstations: memory.growstations && typeof memory.growstations === 'object' ? memory.growstations : {},
    ignoredFlowerPots: memory.ignoredFlowerPots && typeof memory.ignoredFlowerPots === 'object' ? memory.ignoredFlowerPots : {}
  }
}

function readPyroFarmMemory (options = {}) {
  const filePath = pyroFarmMemoryPath(options)
  if (!filePath || !fs.existsSync(filePath)) return emptyPyroFarmMemory()

  try {
    return normalizePyroFarmMemory(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch (err) {
    return emptyPyroFarmMemory()
  }
}

function writePyroFarmMemory (memory, options = {}) {
  const filePath = pyroFarmMemoryPath(options)
  if (!filePath) return

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(normalizePyroFarmMemory(memory), null, 2)}\n`)
  } catch (err) {
    // PyroFarm memory is advisory. The automation can keep probing nearby pots.
  }
}

function updatePyroFarmMemory (options, updater) {
  const memory = readPyroFarmMemory(options)
  const nextMemory = updater(memory) || memory
  writePyroFarmMemory(nextMemory, options)
  return nextMemory
}

function rememberGrowstation (bot, block, options = {}) {
  if (!block?.position) return null
  return updatePyroFarmMemory(options, memory => {
    const key = growstationKey(bot, block, options)
    const existing = memory.growstations[key] || {}
    memory.growstations[key] = {
      ...existing,
      dimension: dimensionName(bot, options),
      position: clonePosition(block.position),
      verifiedAt: existing.verifiedAt || Date.now(),
      lastSeenAt: Date.now(),
      lastWateredAt: existing.lastWateredAt || null,
      lastFullAt: existing.lastFullAt || null
    }
    delete memory.ignoredFlowerPots[key]
    return memory
  }).growstations[growstationKey(bot, block, options)]
}

function rememberIgnoredFlowerPot (bot, block, options = {}) {
  if (!block?.position) return null
  return updatePyroFarmMemory(options, memory => {
    const key = growstationKey(bot, block, options)
    memory.ignoredFlowerPots[key] = {
      dimension: dimensionName(bot, options),
      position: clonePosition(block.position),
      ignoredAt: Date.now()
    }
    delete memory.growstations[key]
    return memory
  }).ignoredFlowerPots[growstationKey(bot, block, options)]
}

function markGrowstationWatered (bot, block, options = {}) {
  updatePyroFarmMemory(options, memory => {
    const key = growstationKey(bot, block, options)
    const existing = memory.growstations[key] || {}
    memory.growstations[key] = {
      ...existing,
      dimension: dimensionName(bot, options),
      position: clonePosition(block.position),
      verifiedAt: existing.verifiedAt || Date.now(),
      lastSeenAt: Date.now(),
      lastWateredAt: Date.now(),
      lastFullAt: existing.lastFullAt || null
    }
    return memory
  })
}

function markGrowstationFull (bot, block, options = {}) {
  updatePyroFarmMemory(options, memory => {
    const key = growstationKey(bot, block, options)
    const existing = memory.growstations[key] || {}
    memory.growstations[key] = {
      ...existing,
      dimension: dimensionName(bot, options),
      position: clonePosition(block.position),
      verifiedAt: existing.verifiedAt || Date.now(),
      lastSeenAt: Date.now(),
      lastWateredAt: existing.lastWateredAt || null,
      lastFullAt: Date.now()
    }
    return memory
  })
}

function isFlowerPotBlockName (name = '') {
  return /^(flower_pot|potted_.+)$/i.test(name)
}

function isWaterBlockName (name = '') {
  return /^(water|flowing_water)$/i.test(name)
}

function blockWaterLevel (block) {
  const level = block?._properties?.level ?? block?.properties?.level ?? block?.metadata
  if (level === undefined || level === null) return null
  const parsed = Number.parseInt(level, 10)
  return Number.isInteger(parsed) ? parsed : null
}

function isWaterSourceBlock (block) {
  if (block?.name !== 'water') return false
  const level = blockWaterLevel(block)
  return level === null || level === 0
}

function inventoryItems (bot) {
  return typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
}

function findInventoryItem (bot, name) {
  return inventoryItems(bot).find(item => item?.name === name) || null
}

function homeOriginPosition (bot, options = {}) {
  return options.originPosition ||
    bot.__containerHomeAnchor ||
    bot.__nightSafetyHomeAnchor ||
    bot.entity?.position ||
    null
}

function sortByDistanceFrom (blocks, originPosition) {
  if (!originPosition) return blocks
  return blocks.slice().sort((a, b) =>
    distanceBetween(originPosition, a.position) - distanceBetween(originPosition, b.position)
  )
}

function findNearbyFlowerPots (bot, options = {}) {
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return []
  const searchRadius = options.pyroFarmSearchRadius ?? options.searchRadius ?? PYROFARM_SEARCH_RADIUS
  const originPosition = homeOriginPosition(bot, options)
  const positions = bot.findBlocks({
    matching: block => isFlowerPotBlockName(block?.name),
    maxDistance: searchRadius,
    count: options.growstationCandidateCount ?? 128
  })

  const blocks = positions
    .map(position => bot.blockAt(position))
    .filter(Boolean)
    .filter(block => !originPosition || distanceBetween(originPosition, block.position) <= searchRadius)

  return sortByDistanceFrom(blocks, originPosition)
}

function knownGrowstationBlocks (bot, options = {}) {
  if (typeof bot.blockAt !== 'function') return []
  const memory = readPyroFarmMemory(options)
  return Object.values(memory.growstations)
    .map(record => blockPosition(record.position))
    .filter(Boolean)
    .map(position => bot.blockAt(position))
    .filter(block => block && isFlowerPotBlockName(block.name))
}

async function goNearBlock (bot, block, options = {}) {
  if (!block?.position || typeof bot.pathfinder?.goto !== 'function') return false
  const debugLog = options.debugLog || (() => {})

  if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)

  try {
    await bot.pathfinder.goto(new GoalNear(block.position.x, block.position.y, block.position.z, options.range ?? 1))
    return true
  } catch (err) {
    if (!options.shouldStop?.() && !bot._ended) {
      debugLog('automation.pyroFarming.pathError', {
        block: block.name,
        position: block.position,
        message: err.message
      })
    }
    return false
  }
}

async function clearHeldItemForGrowstationCheck (bot) {
  if (!bot.heldItem) return true
  if (typeof bot.unequip === 'function') {
    await bot.unequip('hand')
    return true
  }
  return false
}

function windowTexts (window) {
  const slotTexts = Array.isArray(window?.slots)
    ? window.slots.flatMap(item => itemTexts(item))
    : []
  return collectTextParts([window?.title, slotTexts])
}

function isGrowstationWindow (window) {
  const text = windowTexts(window).join(' ')
  return /growstation/i.test(text) || /pyrofarming/i.test(text)
}

function waitForWindowDuringAction (bot, action, timeoutMs) {
  if (typeof bot.on !== 'function') return Promise.resolve(action()).then(() => null)

  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null

    function finish (window, err) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (typeof bot.removeListener === 'function') bot.removeListener('windowOpen', onWindowOpen)
      if (err) reject(err)
      else resolve(window)
    }

    function onWindowOpen (window) {
      finish(window)
    }

    bot.on('windowOpen', onWindowOpen)
    Promise.resolve()
      .then(action)
      .then(() => {
        if (settled) return
        timer = setTimeout(() => finish(null), Math.max(0, timeoutMs))
        if (typeof timer.unref === 'function') timer.unref()
      }, err => finish(null, err))
  })
}

async function verifyGrowstationBlock (bot, block, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (!block || !isFlowerPotBlockName(block.name) || typeof bot.activateBlock !== 'function') return false

  if (!await goNearBlock(bot, block, options)) return false
  await clearHeldItemForGrowstationCheck(bot)
  const window = await waitForWindowDuringAction(
    bot,
    () => bot.activateBlock(block),
    options.growstationVerificationTimeoutMs ?? PYROFARM_GROWSTATION_VERIFICATION_TIMEOUT_MS
  )
  const verified = isGrowstationWindow(window)

  if (window && typeof bot.closeWindow === 'function') bot.closeWindow(window)
  if (verified) {
    rememberGrowstation(bot, block, options)
    debugLog('automation.pyroFarming.verifyGrowstation', { position: block.position })
    return true
  }

  rememberIgnoredFlowerPot(bot, block, options)
  debugLog('automation.pyroFarming.ignoreFlowerPot', { position: block.position })
  return false
}

async function discoverGrowstations (bot, options = {}) {
  const memory = readPyroFarmMemory(options)
  const known = new Set(Object.keys(memory.growstations))
  const ignored = new Set(Object.keys(memory.ignoredFlowerPots))
  const discovered = []

  for (const block of findNearbyFlowerPots(bot, options)) {
    if (options.shouldStop?.() || bot._ended) break
    const key = growstationKey(bot, block, options)
    if (known.has(key) || ignored.has(key)) continue
    if (await verifyGrowstationBlock(bot, block, options)) discovered.push(block)
  }

  return discovered
}

function isGrowstationFullMessage (message) {
  const text = cleanText(typeof message === 'string' ? message : message?.toString?.() || '')
  return /pyrofarming/i.test(text) && /growstation/i.test(text) && /full of water/i.test(text)
}

function waitForWaterMessageDuringAction (bot, action, timeoutMs) {
  if (typeof bot.on !== 'function') return Promise.resolve(action()).then(() => null)

  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null

    function finish (message, err) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (typeof bot.removeListener === 'function') bot.removeListener('message', onMessage)
      if (err) reject(err)
      else resolve(message)
    }

    function onMessage (message) {
      if (isGrowstationFullMessage(message)) finish({ type: 'full', message: String(message) })
    }

    bot.on('message', onMessage)
    Promise.resolve()
      .then(action)
      .then(() => {
        if (settled) return
        timer = setTimeout(() => finish(null), Math.max(0, timeoutMs))
        if (typeof timer.unref === 'function') timer.unref()
      }, err => finish(null, err))
  })
}

async function waitForInventoryItem (bot, name, options = {}) {
  const wait = options.sleep || sleep
  const timeoutMs = options.timeoutMs ?? PYROFARM_REFILL_TIMEOUT_MS
  const pollMs = options.pollMs ?? 100
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    if (findInventoryItem(bot, name)) return true
    await wait(Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - startedAt))))
  }

  return Boolean(findInventoryItem(bot, name))
}

async function takeWaterFromSource (bot, water, options = {}) {
  if (typeof bot.lookAt === 'function') await bot.lookAt(blockCenterPosition(water), true)

  if (typeof bot.activateItem === 'function') {
    await bot.activateItem()
  } else if (typeof bot.activateBlock === 'function') {
    await bot.activateBlock(water)
  } else {
    return false
  }

  return waitForInventoryItem(bot, 'water_bucket', {
    ...options,
    timeoutMs: options.pyroRefillTimeoutMs ?? PYROFARM_REFILL_TIMEOUT_MS
  })
}

async function refillWaterBucket (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const bucket = findInventoryItem(bot, 'bucket')
  if (!bucket || (typeof bot.activateItem !== 'function' && typeof bot.activateBlock !== 'function')) {
    debugLog('automation.pyroFarming.missingBucket')
    return false
  }

  const water = findNearbyWaterSource(bot, options)
  if (!water) {
    debugLog('automation.pyroFarming.missingWaterSource')
    return false
  }

  if (!await goNearBlock(bot, water, options)) return false
  if (typeof bot.equip === 'function') await bot.equip(bucket, 'hand')
  if (!await takeWaterFromSource(bot, water, options)) {
    debugLog('automation.pyroFarming.refillFailed', { position: water.position })
    return false
  }
  debugLog('automation.pyroFarming.refillBucket', { position: water.position })
  return true
}

function findNearbyWaterSource (bot, options = {}) {
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return null
  const searchRadius = options.waterSearchRadius ?? options.pyroFarmSearchRadius ?? options.searchRadius ?? PYROFARM_SEARCH_RADIUS
  const originPosition = homeOriginPosition(bot, options)
  const positions = bot.findBlocks({
    matching: block => isWaterBlockName(block?.name),
    maxDistance: searchRadius,
    count: options.waterCandidateCount ?? 32
  })

  return sortByDistanceFrom(
    positions.map(position => bot.blockAt(position)).filter(isWaterSourceBlock),
    originPosition
  )[0] || null
}

async function waterGrowstation (bot, block, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const waterBucket = findInventoryItem(bot, 'water_bucket')
  if (!waterBucket || typeof bot.activateBlock !== 'function') return false

  if (!await goNearBlock(bot, block, options)) return false
  if (typeof bot.equip === 'function') await bot.equip(waterBucket, 'hand')
  const message = await waitForWaterMessageDuringAction(
    bot,
    () => bot.activateBlock(block),
    options.pyroWaterMessageTimeoutMs ?? PYROFARM_WATER_MESSAGE_TIMEOUT_MS
  )

  if (message?.type === 'full') {
    markGrowstationFull(bot, block, options)
    debugLog('automation.pyroFarming.full', { position: block.position })
    return true
  }

  markGrowstationWatered(bot, block, options)
  debugLog('automation.pyroFarming.watered', { position: block.position })
  return true
}

async function ensureWaterBucket (bot, options = {}) {
  if (findInventoryItem(bot, 'water_bucket')) return true
  if (!findInventoryItem(bot, 'bucket')) return false
  await refillWaterBucket(bot, options)
  return Boolean(findInventoryItem(bot, 'water_bucket'))
}

function uniqueBlocksByPosition (bot, blocks, options = {}) {
  const seen = new Set()
  const unique = []
  for (const block of blocks) {
    const key = growstationKey(bot, block, options)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(block)
  }
  return unique
}

async function runPyroFarmingCycle (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (bot._ended || options.shouldStop?.()) return false
  if (bot.__nightSafetyActive) {
    debugLog('automation.pyroFarming.pausedForNightSafety')
    return true
  }

  const discovered = await discoverGrowstations(bot, options)
  const growstations = uniqueBlocksByPosition(bot, [
    ...knownGrowstationBlocks(bot, options),
    ...discovered
  ], options)

  if (growstations.length === 0) {
    debugLog('automation.pyroFarming.noGrowstations')
    return true
  }

  for (const growstation of growstations) {
    if (bot._ended || options.shouldStop?.()) break
    if (!await ensureWaterBucket(bot, options)) {
      debugLog('automation.pyroFarming.missingWaterBucket')
      return true
    }
    await waterGrowstation(bot, growstation, options)
  }

  return true
}

function stopPathfinder (bot) {
  if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)
  if (typeof bot.pathfinder?.stop === 'function') bot.pathfinder.stop()
}

function startPyroFarmingAutomation (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const output = options.output || console.log
  const wait = options.sleep || sleep
  const runPyroFarmingTask = options.runPyroFarmingTask || runPyroFarmingCycle
  const externalShouldStop = options.shouldStop
  let stopped = false
  const shouldStop = () => stopped ||
    bot._ended ||
    (typeof externalShouldStop === 'function' && externalShouldStop())
  const activeOptions = {
    ...options,
    shouldStop
  }

  async function run () {
    output('Started Pyro Farming automation.')
    debugLog('automation.pyroFarming.start')
    while (!shouldStop()) {
      try {
        await runPyroFarmingTask(bot, activeOptions)
      } catch (err) {
        output(`Pyro Farming error: ${err.message}`)
        debugLog('automation.pyroFarming.error', { message: err.message, stack: err.stack })
        break
      }
      if (shouldStop()) break
      await wait(activeOptions.loopDelayMs ?? WOODCUTTING_LOOP_DELAY_MS)
    }
    debugLog('automation.pyroFarming.stop')
  }

  run()
  return {
    name: 'Pyro Farming',
    stop: () => {
      stopped = true
      stopPathfinder(bot)
    }
  }
}

module.exports = {
  discoverGrowstations,
  findNearbyFlowerPots,
  findNearbyWaterSource,
  isGrowstationFullMessage,
  readPyroFarmMemory,
  refillWaterBucket,
  runPyroFarmingCycle,
  startPyroFarmingAutomation,
  verifyGrowstationBlock,
  waterGrowstation,
  writePyroFarmMemory
}
