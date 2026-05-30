const { goals: { GoalNear } } = require('mineflayer-pathfinder')
const {
  WOODCUTTING_HOME_COMMAND,
  WOODCUTTING_HOME_WAIT_MS,
  WOODCUTTING_CHEST_SEARCH_RADIUS
} = require('./config')
const { stopBotMovement } = require('./deathRecovery')
const { sleep } = require('./time')
const { runDaytimeAutomationSequence } = require('./daytimeTasks')

const NIGHT_SAFETY_CHECK_INTERVAL_MS = 5000
const NIGHT_SAFETY_HOME_RETRY_RADIUS = 24
const NIGHT_SAFETY_DOOR_OPEN_WAIT_MS = 300
const NIGHT_SAFETY_DOOR_WALK_MS = 1200
const NIGHT_SAFETY_RETRY_DELAY_MS = 10000
const NIGHT_SAFETY_HOUSE_SEARCH_RADIUS = 16
const NIGHT_SAFETY_SLEEP_EVENT_TIMEOUT_MS = 3500

const RAW_COOKABLE_FOOD_NAMES = new Set([
  'beef',
  'porkchop',
  'chicken',
  'rabbit',
  'mutton',
  'cod',
  'salmon',
  'potato',
  'kelp'
])

const FUEL_ITEM_NAMES = new Set([
  'coal',
  'charcoal',
  'lava_bucket',
  'blaze_rod',
  'dried_kelp_block'
])

const FOOD_ITEM_NAMES = new Set([
  'apple',
  'baked_potato',
  'bread',
  'carrot',
  'cooked_beef',
  'cooked_chicken',
  'cooked_cod',
  'cooked_mutton',
  'cooked_porkchop',
  'cooked_rabbit',
  'cooked_salmon',
  'dried_kelp',
  'golden_apple',
  'melon_slice',
  'potato',
  'pumpkin_pie',
  'sweet_berries'
])

function normalizeTimeOfDay (timeOfDay) {
  if (typeof timeOfDay !== 'number' || !Number.isFinite(timeOfDay)) return null
  return ((timeOfDay % 24000) + 24000) % 24000
}

function isNightTime (bot) {
  const timeOfDay = bot.time?.timeOfDay
  const normalizedTimeOfDay = normalizeTimeOfDay(timeOfDay)
  if (normalizedTimeOfDay !== null) return normalizedTimeOfDay >= 13000
  return bot.time?.isDay === false
}

function isDayTime (bot) {
  const timeOfDay = bot.time?.timeOfDay
  const normalizedTimeOfDay = normalizeTimeOfDay(timeOfDay)
  if (normalizedTimeOfDay !== null) return normalizedTimeOfDay < 13000
  return bot.time?.isDay === true
}

function inventoryItems (bot) {
  return typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
}

function containerItems (container) {
  if (typeof container.containerItems === 'function') return container.containerItems()
  if (typeof container.items === 'function') return container.items()
  return []
}

function isFoodItem (bot, item) {
  return Boolean(
    item?.name &&
    (bot.registry?.foodsByName?.[item.name] ||
      FOOD_ITEM_NAMES.has(item.name) ||
      RAW_COOKABLE_FOOD_NAMES.has(item.name))
  )
}

function isFuelItem (item) {
  return Boolean(item?.name && FUEL_ITEM_NAMES.has(item.name))
}

function isToolOrWeaponItem (item) {
  return Boolean(item?.name && (
    /_(sword|axe|pickaxe|shovel|hoe)$/i.test(item.name) ||
    /^(bow|crossbow|trident|shield|fishing_rod|shears|flint_and_steel)$/i.test(item.name)
  ))
}

function isArmorItem (item) {
  return Boolean(item?.name && /_(helmet|chestplate|leggings|boots)$/i.test(item.name))
}

function shouldKeepInventoryItem (bot, item) {
  return isToolOrWeaponItem(item) || isArmorItem(item) || isFoodItem(bot, item) || isFuelItem(item)
}

function isContainerBlockName (name = '') {
  return /^(chest|trapped_chest|barrel)$/i.test(name)
}

function isFurnaceBlockName (name = '') {
  return /^(furnace|smoker)$/i.test(name)
}

function isDoorBlockName (name = '') {
  return /_door$/i.test(name)
}

function isBedBlockName (name = '') {
  return /_bed$/i.test(name) || name === 'bed'
}

function hasOpenProperty (block) {
  return Object.prototype.hasOwnProperty.call(block?._properties || {}, 'open') ||
    Object.prototype.hasOwnProperty.call(block?.properties || {}, 'open')
}

function isOpenDoor (block) {
  if (!hasOpenProperty(block)) return false
  return block._properties?.open === true || block.properties?.open === true
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
  if (typeof position.clone === 'function') return position.clone()
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    distanceTo: position.distanceTo,
    offset: position.offset
  }
}

function findNearbyBlock (bot, predicate, options = {}) {
  const searchRadius = options.searchRadius ?? WOODCUTTING_CHEST_SEARCH_RADIUS
  const originPosition = options.originPosition || bot.entity?.position

  if (!options.originPosition && typeof bot.findBlock === 'function') {
    return bot.findBlock({ matching: predicate, maxDistance: searchRadius })
  }

  if (typeof bot.findBlocks !== 'function') return null
  const positions = bot.findBlocks({ matching: predicate, maxDistance: searchRadius, count: 32 })
  return positions
    .map(position => bot.blockAt(position))
    .filter(Boolean)
    .filter(block => !originPosition || distanceBetween(originPosition, block.position) <= searchRadius)
    .sort((a, b) => distanceBetween(originPosition, a.position) - distanceBetween(originPosition, b.position))[0] || null
}

async function goNearBlock (bot, block, options = {}) {
  if (!block?.position || typeof bot.pathfinder?.goto !== 'function') return false

  try {
    await bot.pathfinder.goto(new GoalNear(block.position.x, block.position.y, block.position.z, options.range ?? 2))
    return true
  } catch (err) {
    if (options.logPathErrors !== false) {
      const debugLog = options.debugLog || (() => {})
      debugLog('nightSafety.pathError', {
        block: block.name,
        message: err.message
      })
    }
    return false
  }
}

async function approachDoor (bot, door, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const reached = await goNearBlock(bot, door, {
    ...options,
    range: options.doorRange ?? 2,
    logPathErrors: false
  })

  if (!reached) {
    debugLog('nightSafety.door.approachFailed', {
      block: door.name,
      position: door.position
    })
  }

  return reached
}

function doorInteriorPosition (door, originPosition) {
  if (!door?.position || !originPosition) return null
  const dx = door.position.x - originPosition.x
  const dz = door.position.z - originPosition.z
  if (Math.abs(dx) >= Math.abs(dz) && Math.abs(dx) > 0.1) {
    return door.position.offset(dx > 0 ? 1 : -1, 0, 0)
  }
  if (Math.abs(dz) > 0.1) {
    return door.position.offset(0, 0, dz > 0 ? 1 : -1)
  }
  return null
}

function centerLookPosition (position) {
  if (!position) return null
  if (typeof position.offset === 'function') return position.offset(0.5, 1.6, 0.5)
  return {
    x: position.x + 0.5,
    y: position.y + 1.6,
    z: position.z + 0.5
  }
}

async function moveThroughOpenedDoor (bot, door, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const wait = options.sleep || sleep
  const target = doorInteriorPosition(door, options.originPosition)
  if (!target || typeof bot.setControlState !== 'function') return false

  if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)
  if (typeof bot.pathfinder?.stop === 'function') bot.pathfinder.stop()

  let entered = false
  try {
    if (typeof bot.lookAt === 'function') await bot.lookAt(centerLookPosition(target), true)
    bot.setControlState('forward', true)
    await wait(options.doorWalkMs ?? NIGHT_SAFETY_DOOR_WALK_MS)
    entered = true
  } catch (err) {
    debugLog('nightSafety.pathError', {
      block: door.name,
      message: err.message
    })
  } finally {
    bot.setControlState('forward', false)
  }

  debugLog('nightSafety.door.entered', {
    block: door.name,
    position: target,
    entered
  })
  return entered
}

async function openNearbyDoor (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const wait = options.sleep || sleep
  const door = findNearbyBlock(bot, block => isDoorBlockName(block.name), options)
  if (!door || typeof bot.activateBlock !== 'function') return false

  await approachDoor(bot, door, options)
  if (!isOpenDoor(door)) {
    await bot.activateBlock(door)
    debugLog('nightSafety.door.opened', {
      block: door.name,
      position: door.position
    })
    await wait(options.doorOpenWaitMs ?? NIGHT_SAFETY_DOOR_OPEN_WAIT_MS)
  }
  await moveThroughOpenedDoor(bot, door, options)
  return true
}

function findRawCookableFood (bot) {
  return inventoryItems(bot).find(item => RAW_COOKABLE_FOOD_NAMES.has(item.name))
}

function findFuelItem (bot) {
  return inventoryItems(bot).find(isFuelItem)
}

async function cookFoodIfNeeded (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const rawFood = findRawCookableFood(bot)
  const fuel = findFuelItem(bot)
  const reservedTypes = new Set()

  if (!rawFood || !fuel || typeof bot.openFurnace !== 'function') return reservedTypes

  const furnaceBlock = findNearbyBlock(bot, block => isFurnaceBlockName(block.name), options)
  if (!furnaceBlock) {
    debugLog('nightSafety.cook.missingFurnace')
    return reservedTypes
  }

  await goNearBlock(bot, furnaceBlock, options)
  const furnace = await bot.openFurnace(furnaceBlock)
  try {
    if (typeof furnace.outputItem === 'function' && furnace.outputItem() && typeof furnace.takeOutput === 'function') {
      await furnace.takeOutput()
    }

    if (typeof furnace.fuelItem === 'function' && !furnace.fuelItem()) {
      await furnace.putFuel(fuel.type, null, 1)
    }

    if (typeof furnace.inputItem === 'function' && !furnace.inputItem()) {
      await furnace.putInput(rawFood.type, null, rawFood.count)
      reservedTypes.add(rawFood.type)
      debugLog('nightSafety.cook.started', {
        item: rawFood.name,
        count: rawFood.count,
        fuel: fuel.name
      })
    }
  } finally {
    if (typeof furnace.close === 'function') furnace.close()
  }

  return reservedTypes
}

async function depositLoot (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const skipTypes = options.skipTypes || new Set()
  if (typeof bot.openContainer !== 'function') return false

  const containerBlock = findNearbyBlock(bot, block => isContainerBlockName(block.name), options)
  if (!containerBlock) {
    debugLog('nightSafety.deposit.missingContainer')
    return false
  }

  await goNearBlock(bot, containerBlock, options)
  const container = await bot.openContainer(containerBlock)
  try {
    for (const item of inventoryItems(bot)) {
      if (skipTypes.has(item.type) || shouldKeepInventoryItem(bot, item)) continue
      await container.deposit(item.type, null, item.count)
      debugLog('nightSafety.deposit.item', {
        item: item.name,
        count: item.count
      })
    }
  } finally {
    if (typeof container.close === 'function') container.close()
  }

  return true
}

function findNearbyBed (bot, options = {}) {
  return findNearbyBlock(bot, block => isBedBlockName(block.name), options)
}

function sleepTimeSnapshot (bot) {
  const normalizedTimeOfDay = normalizeTimeOfDay(bot.time?.timeOfDay)
  return {
    timeOfDay: bot.time?.timeOfDay,
    normalizedTimeOfDay,
    isDay: bot.time?.isDay,
    isRaining: bot.isRaining,
    thunderState: bot.thunderState
  }
}

function isSleepTime (bot) {
  const thunderstorm = bot.isRaining && bot.thunderState > 0
  const normalizedTimeOfDay = normalizeTimeOfDay(bot.time?.timeOfDay)
  if (normalizedTimeOfDay !== null) {
    return thunderstorm || (normalizedTimeOfDay >= 12541 && normalizedTimeOfDay <= 23458)
  }
  return thunderstorm || bot.time?.isDay === false
}

function isMineflayerNightPrecheckError (err) {
  return String(err?.message || '').includes("it's not night and it's not a thunderstorm")
}

function waitForSleepEvent (bot, timeoutMs = NIGHT_SAFETY_SLEEP_EVENT_TIMEOUT_MS) {
  if (bot.isSleeping) return Promise.resolve(true)
  if (typeof bot.once !== 'function') return Promise.resolve(false)

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(Boolean(bot.isSleeping))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    function onSleep () {
      cleanup()
      resolve(true)
    }

    function cleanup () {
      clearTimeout(timer)
      if (typeof bot.removeListener === 'function') bot.removeListener('sleep', onSleep)
    }

    bot.once('sleep', onSleep)
  })
}

async function activateBedDirectly (bot, bed, options = {}) {
  if (typeof bot.activateBlock !== 'function') return false
  const sleepPromise = waitForSleepEvent(bot, options.sleepEventTimeoutMs)
  await bot.activateBlock(bed)
  return sleepPromise
}

async function sleepInNearbyBed (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (typeof bot.sleep !== 'function') return false

  const bed = options.bedBlock || findNearbyBed(bot, options)
  if (!bed) {
    debugLog('nightSafety.sleep.missingBed')
    return false
  }

  await goNearBlock(bot, bed, options)
  try {
    await bot.sleep(bed)
    debugLog('nightSafety.sleep.started', { block: bed.name, ...sleepTimeSnapshot(bot) })
    return true
  } catch (err) {
    debugLog('nightSafety.sleep.failed', { message: err.message, ...sleepTimeSnapshot(bot) })
    if (isMineflayerNightPrecheckError(err)) {
      if (!isSleepTime(bot)) {
        debugLog('nightSafety.sleep.skippedDaytimeFallback', {
          block: bed.name,
          ...sleepTimeSnapshot(bot)
        })
        return false
      }
      const activated = await activateBedDirectly(bot, bed, options)
      debugLog(activated ? 'nightSafety.sleep.fallbackActivated' : 'nightSafety.sleep.fallbackFailed', {
        block: bed.name,
        ...sleepTimeSnapshot(bot)
      })
      return activated
    }
    return false
  }
}

function hasItemMatching (bot, matcher) {
  return inventoryItems(bot).some(matcher)
}

function foodCount (bot) {
  return inventoryItems(bot)
    .filter(item => isFoodItem(bot, item))
    .reduce((sum, item) => sum + item.count, 0)
}

function missingGearNeeds (bot, options = {}) {
  const minimumFood = options.minimumFood ?? 4
  const needs = []

  if (!hasItemMatching(bot, item => /_sword$/i.test(item.name))) needs.push({ name: 'sword', matcher: item => /_sword$/i.test(item.name), count: 1 })
  if (!hasItemMatching(bot, item => /_axe$/i.test(item.name))) needs.push({ name: 'axe', matcher: item => /_axe$/i.test(item.name), count: 1 })
  if (!hasItemMatching(bot, item => /_pickaxe$/i.test(item.name))) needs.push({ name: 'pickaxe', matcher: item => /_pickaxe$/i.test(item.name), count: 1 })
  if (foodCount(bot) < minimumFood) {
    needs.push({
      name: 'food',
      matcher: item => isFoodItem(bot, item),
      count: item => Math.max(minimumFood - foodCount(bot), item.count)
    })
  }

  return needs
}

async function runDayGearCycle (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})

  if (bot.isSleeping && typeof bot.wake === 'function') {
    await bot.wake()
    debugLog('nightSafety.wake')
  }

  const needs = missingGearNeeds(bot, options)
  if (needs.length === 0) return true

  if (typeof bot.openContainer !== 'function') return false
  const containerBlock = findNearbyBlock(bot, block => isContainerBlockName(block.name), options)
  if (!containerBlock) {
    debugLog('nightSafety.gear.missingContainer', { needs: needs.map(need => need.name) })
    return false
  }

  await goNearBlock(bot, containerBlock, options)
  const container = await bot.openContainer(containerBlock)
  try {
    for (const need of needs) {
      const item = containerItems(container).find(need.matcher)
      if (!item) {
        debugLog('nightSafety.gear.missingItem', { item: need.name })
        continue
      }

      const count = typeof need.count === 'function' ? need.count(item) : need.count
      await container.withdraw(item.type, null, Math.min(count, item.count))
      debugLog('nightSafety.gear.withdraw', {
        item: item.name,
        count: Math.min(count, item.count)
      })
    }
  } finally {
    if (typeof container.close === 'function') container.close()
  }

  return true
}

async function runNightSafetyCycle (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const homeCommand = options.homeCommand || WOODCUTTING_HOME_COMMAND
  const homeWaitMs = options.homeWaitMs ?? WOODCUTTING_HOME_WAIT_MS

  if (bot._ended) return false
  bot.__nightSafetyActive = true

  try {
    options.automationManager?.stopActive?.()
    if (bot.pvp?.target && typeof bot.pvp.stop === 'function') await bot.pvp.stop()
    stopBotMovement(bot)
    if (!options.skipHomeTeleport) {
      bot.chat(homeCommand)
      debugLog('nightSafety.home', { command: homeCommand })
      await wait(homeWaitMs)
      if (bot._ended) return false
    } else {
      debugLog('nightSafety.home.skip', { command: homeCommand })
    }
    const originPosition = clonePosition(options.originPosition || bot.entity?.position)
    bot.__nightSafetyHomeAnchor = originPosition
    const homeOptions = {
      ...options,
      originPosition,
      searchRadius: options.searchRadius ?? NIGHT_SAFETY_HOUSE_SEARCH_RADIUS
    }
    const closeHomeOptions = { ...homeOptions, range: 1 }

    debugLog('nightSafety.home.anchor', { position: originPosition })
    await openNearbyDoor(bot, homeOptions)
    const bedBlock = findNearbyBed(bot, closeHomeOptions)
    if (!bedBlock) {
      debugLog('nightSafety.sleep.missingBed')
      return false
    }
    const cookedTypes = await cookFoodIfNeeded(bot, closeHomeOptions)
    await depositLoot(bot, { ...closeHomeOptions, skipTypes: cookedTypes })
    return sleepInNearbyBed(bot, { ...closeHomeOptions, bedBlock })
  } finally {
    bot.__nightSafetyActive = false
  }
}

async function leaveHomeForDaytime (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const originPosition = clonePosition(bot.entity?.position || options.originPosition)
  const leftHome = await openNearbyDoor(bot, {
    ...options,
    originPosition,
    searchRadius: options.searchRadius ?? NIGHT_SAFETY_HOUSE_SEARCH_RADIUS
  })

  debugLog(leftHome ? 'nightSafety.day.exit' : 'nightSafety.day.exit.missingDoor', {
    originPosition
  })
  return leftHome
}

function isNearHomeAnchor (bot, anchor, options = {}) {
  const position = bot.entity?.position
  if (!position || !anchor) return false
  return distanceBetween(position, anchor) <= (options.homeRetryRadius ?? NIGHT_SAFETY_HOME_RETRY_RADIUS)
}

function attachNightSafety (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const setTimer = options.setInterval || setInterval
  const clearTimer = options.clearInterval || clearInterval
  const checkIntervalMs = options.checkIntervalMs ?? NIGHT_SAFETY_CHECK_INTERVAL_MS
  const nightSafetyRunner = options.runNightSafetyCycle || runNightSafetyCycle
  const dayGearRunner = options.runDayGearCycle || runDayGearCycle
  const dayExitRunner = options.leaveHomeForDaytime || leaveHomeForDaytime
  const daytimeAutomationRunner = options.runDaytimeAutomationSequence || runDaytimeAutomationSequence
  const now = options.now || Date.now
  const nightRetryDelayMs = options.nightRetryDelayMs ?? NIGHT_SAFETY_RETRY_DELAY_MS
  const autoStartDaytimeAutomation = options.autoStartDaytimeAutomation === true
  let enabled = options.enabled !== false
  let running = false
  let lastPeriod = null
  let nightHomeAnchor = null
  let nextNightRetryAt = 0

  async function checkTime () {
    if (!enabled) return
    if (running || bot._ended) return
    if (bot.physicsEnabled === false) return

    const period = isNightTime(bot) ? 'night' : isDayTime(bot) ? 'day' : null
    if (!period || period === lastPeriod) return
    if (period === 'night' && now() < nextNightRetryAt) return
    running = true
    let completed = false

    try {
      if (period === 'night') {
        const skipHomeTeleport = isNearHomeAnchor(bot, nightHomeAnchor, options)
        completed = await nightSafetyRunner(bot, {
          ...options,
          originPosition: nightHomeAnchor || options.originPosition,
          skipHomeTeleport
        }) !== false
        if (bot.__nightSafetyHomeAnchor) nightHomeAnchor = clonePosition(bot.__nightSafetyHomeAnchor)
      } else {
        nightHomeAnchor = null
        bot.__nightSafetyHomeAnchor = null
        nextNightRetryAt = 0
        const originPosition = clonePosition(bot.entity?.position)
        debugLog('nightSafety.day.start', { originPosition })
        const gearedUp = await dayGearRunner(bot, { ...options, originPosition })
        if (!isNightTime(bot) && !bot._ended) {
          await dayExitRunner(bot, {
            ...options,
            originPosition: clonePosition(bot.entity?.position) || originPosition
          })
        }
        if (autoStartDaytimeAutomation && !isNightTime(bot) && !bot._ended) {
          await daytimeAutomationRunner(bot, {
            ...options,
            originPosition,
            openNearbyDoor: options.openNearbyDoor || ((doorBot, doorOptions = {}) => openNearbyDoor(doorBot, {
              ...options,
              ...doorOptions,
              originPosition: doorOptions.originPosition || clonePosition(doorBot.entity?.position) || originPosition,
              searchRadius: doorOptions.searchRadius ?? options.searchRadius ?? NIGHT_SAFETY_HOUSE_SEARCH_RADIUS
            }))
          })
        }
        debugLog('nightSafety.day.done', {
          gearedUp: gearedUp !== false,
          stillDay: !isNightTime(bot),
          ended: Boolean(bot._ended)
        })
        completed = gearedUp !== false && !isNightTime(bot) && !bot._ended
      }
    } catch (err) {
      completed = false
      debugLog('nightSafety.error', { period, message: err.message, stack: err.stack })
    } finally {
      lastPeriod = completed ? period : null
      if (period === 'night') nextNightRetryAt = completed ? 0 : now() + nightRetryDelayMs
      running = false
    }
  }

  function isEnabled () {
    return enabled
  }

  function setEnabled (value) {
    enabled = Boolean(value)
    lastPeriod = null
    nextNightRetryAt = 0
    debugLog('nightSafety.toggle', { enabled })
    if (enabled) Promise.resolve().then(checkTime)
    return {
      enabled,
      message: `Night safety ${enabled ? 'enabled' : 'disabled'}.`
    }
  }

  function toggleEnabled () {
    return setEnabled(!enabled)
  }

  bot.on('time', () => {
    checkTime()
  })
  bot.on('spawn', () => {
    checkTime()
  })
  bot.on('physicsEnabled', () => {
    checkTime()
  })

  let timer = null
  if (checkIntervalMs > 0) {
    timer = setTimer(checkTime, checkIntervalMs)
    if (typeof timer?.unref === 'function') timer.unref()
  }

  Promise.resolve().then(checkTime)

  function stop () {
    if (timer) {
      clearTimer(timer)
      timer = null
    }
  }

  bot.once?.('end', stop)
  bot.once?.('kicked', stop)

  return {
    check: checkTime,
    isEnabled,
    setEnabled,
    toggleEnabled,
    stop
  }
}

module.exports = {
  attachNightSafety,
  cookFoodIfNeeded,
  depositLoot,
  isDayTime,
  isNightTime,
  leaveHomeForDaytime,
  missingGearNeeds,
  moveThroughOpenedDoor,
  NIGHT_SAFETY_CHECK_INTERVAL_MS,
  NIGHT_SAFETY_RETRY_DELAY_MS,
  normalizeTimeOfDay,
  openNearbyDoor,
  runDayGearCycle,
  runNightSafetyCycle,
  sleepInNearbyBed
}
