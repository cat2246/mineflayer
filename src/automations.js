const { WOODCUTTING_LOOP_DELAY_MS } = require('./config')
const { runFarmingTask } = require('./farming')
const { startMiningAutomation } = require('./mining')
const { startPyroFarmingAutomation } = require('./pyroFarming')
const { sleep } = require('./time')
const { runWildRoamingTask } = require('./wildRoaming')
const { startWoodCuttingAutomation } = require('./woodcutting')

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

function stopPathfinder (bot) {
  if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)
}

function taskHasMoreWork (result) {
  return Boolean(result)
}

function normalizeTimeOfDay (timeOfDay) {
  if (typeof timeOfDay !== 'number' || !Number.isFinite(timeOfDay)) return null
  return ((timeOfDay % 24000) + 24000) % 24000
}

function automationPeriod (bot) {
  const normalizedTimeOfDay = normalizeTimeOfDay(bot.time?.timeOfDay)
  if (normalizedTimeOfDay !== null) return normalizedTimeOfDay >= 13000 ? 'night' : 'day'
  if (bot.time?.isDay === true) return 'day'
  if (bot.time?.isDay === false) return 'night'
  return null
}

function startLoopAutomation (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const output = options.output || console.log
  const loopDelayMs = options.loopDelayMs ?? WOODCUTTING_LOOP_DELAY_MS
  const originPosition = options.originPosition || clonePosition(bot.entity?.position)
  const externalShouldStop = options.shouldStop
  let stopped = false
  const shouldStop = () => stopped ||
    bot._ended ||
    (typeof externalShouldStop === 'function' && externalShouldStop())
  const activeOptions = {
    ...options,
    originPosition,
    shouldStop
  }

  async function run () {
    output(`Started ${options.name} automation.`)
    debugLog(`${options.eventPrefix}.start`)
    for (;;) {
      if (shouldStop()) break
      try {
        const result = await options.runTask(bot, activeOptions)
        if (!taskHasMoreWork(result)) {
          output(`${options.name} automation task completed.`)
          if (!shouldStop()) options.onComplete?.()
          break
        }
      } catch (err) {
        output(`${options.name} error: ${err.message}`)
        debugLog(`${options.eventPrefix}.error`, { message: err.message, stack: err.stack })
      }
      if (shouldStop()) break
      await wait(loopDelayMs)
    }
    debugLog(`${options.eventPrefix}.stop`)
  }

  run()
  return {
    name: options.name,
    stop: () => {
      stopped = true
      stopPathfinder(bot)
    }
  }
}

function startFarmingAutomation (bot, options = {}) {
  return startLoopAutomation(bot, {
    ...options,
    name: 'Farming',
    eventPrefix: 'automation.farming',
    runTask: options.runFarmingTask || runFarmingTask
  })
}

function startWildRoamingAutomation (bot, options = {}) {
  return startLoopAutomation(bot, {
    ...options,
    name: 'Wild roaming',
    eventPrefix: 'automation.wildRoaming',
    runTask: options.runWildRoamingTask || runWildRoamingTask
  })
}

function createAutomationManager (bot, options = {}) {
  const output = options.output || console.log
  const debugLog = options.debugLog || (() => {})
  const woodCuttingAutomation = options.startWoodCuttingAutomation || startWoodCuttingAutomation
  const farmingAutomation = options.startFarmingAutomation || startFarmingAutomation
  const wildRoamingAutomation = options.startWildRoamingAutomation || startWildRoamingAutomation
  const pyroFarmingAutomation = options.startPyroFarmingAutomation || startPyroFarmingAutomation
  const miningAutomation = options.startMiningAutomation || startMiningAutomation
  let activeAutomation = null
  let pausedNightSafetyAutomation = null
  let waitingNextDayAutomation = null

  const automations = options.automations || [
    {
      name: 'Wood cutting',
      resumeAfterNightSafety: true,
      start: startOptions => woodCuttingAutomation(bot, { output, debugLog, ...startOptions })
    },
    {
      name: 'Farming',
      resumeAfterNightSafety: true,
      start: startOptions => farmingAutomation(bot, { output, debugLog, ...startOptions })
    },
    {
      name: 'Wild roaming',
      resumeAfterNightSafety: true,
      start: startOptions => wildRoamingAutomation(bot, { output, debugLog, ...startOptions })
    },
    {
      name: 'Pyro Farming',
      resumeAfterNightSafety: true,
      start: startOptions => pyroFarmingAutomation(bot, { output, debugLog, ...startOptions })
    },
    {
      name: 'Mining',
      resumeAfterNightSafety: true,
      start: startOptions => miningAutomation(bot, { output, debugLog, ...startOptions })
    }
  ]
  let lastPeriod = automationPeriod(bot)
  let nightSafetyEnabled = false

  function list () {
    return automations.map(({ name }) => ({ name }))
  }

  function automationName (automation) {
    return automation?.name
  }

  function stopAutomationInstance (automation) {
    if (automation?.instance?.stop) automation.instance.stop()
  }

  function markAutomationComplete (automation) {
    if (activeAutomation !== automation || bot._ended) return
    activeAutomation = null
    pausedNightSafetyAutomation = null
    waitingNextDayAutomation = automation.definition
    debugLog('automation.waitForNextDay', { name: automationName(automation.definition) })
  }

  async function startAutomation (automation, debugEvent) {
    const active = {
      definition: automation,
      instance: null
    }
    activeAutomation = active
    const instance = await automation.start({
      onComplete: () => markAutomationComplete(active)
    })
    if (activeAutomation === active) active.instance = instance
    debugLog(debugEvent, { name: automationName(automation) })
    return active
  }

  async function startByIndex (index) {
    const automation = automations[index]
    if (!automation) {
      output('Choose a valid automation number, or type cancel.')
      return false
    }

    stopAutomationInstance(activeAutomation)
    pausedNightSafetyAutomation = null
    waitingNextDayAutomation = null
    await startAutomation(automation, 'automation.start')
    return true
  }

  function stopActive () {
    const hadActiveAutomation = Boolean(activeAutomation)
    const hadPausedAutomation = Boolean(pausedNightSafetyAutomation)
    const hadWaitingAutomation = Boolean(waitingNextDayAutomation)
    if (!hadActiveAutomation && !hadPausedAutomation && !hadWaitingAutomation) return false
    stopAutomationInstance(activeAutomation)
    activeAutomation = null
    pausedNightSafetyAutomation = null
    waitingNextDayAutomation = null
    debugLog('automation.stop')
    return true
  }

  function pauseActiveForNightSafety () {
    if (!activeAutomation) return false

    const automation = activeAutomation
    stopAutomationInstance(automation)
    activeAutomation = null

    if (automation.definition.resumeAfterNightSafety !== false) {
      pausedNightSafetyAutomation = automation.definition
      waitingNextDayAutomation = null
      debugLog('automation.pauseForNightSafety', { name: automationName(automation.definition) })
    } else {
      pausedNightSafetyAutomation = null
      waitingNextDayAutomation = null
      debugLog('automation.stop', { name: automationName(automation.definition) })
    }

    return true
  }

  async function resumePausedAfterNightSafety () {
    if (activeAutomation) return false

    const automation = pausedNightSafetyAutomation || waitingNextDayAutomation
    if (!automation) return false
    const debugEvent = pausedNightSafetyAutomation ? 'automation.resumeAfterNightSafety' : 'automation.restartForDay'
    pausedNightSafetyAutomation = null
    waitingNextDayAutomation = null
    await startAutomation(automation, debugEvent)
    return true
  }

  async function restartForDay () {
    if (bot._ended) return false

    const automation = activeAutomation?.definition || pausedNightSafetyAutomation || waitingNextDayAutomation
    if (!automation) return false

    stopAutomationInstance(activeAutomation)
    activeAutomation = null
    pausedNightSafetyAutomation = null
    waitingNextDayAutomation = null
    await startAutomation(automation, 'automation.restartForDay')
    return true
  }

  async function checkDayTransition () {
    const period = automationPeriod(bot)
    if (!period) return false
    const previousPeriod = lastPeriod
    lastPeriod = period
    if (previousPeriod !== 'night' || period !== 'day' || nightSafetyEnabled) return false
    return restartForDay()
  }

  function setNightSafetyEnabled (enabled) {
    nightSafetyEnabled = Boolean(enabled)
    lastPeriod = automationPeriod(bot) || lastPeriod
  }

  bot.on?.('time', () => {
    checkDayTransition()
  })
  bot.on?.('spawn', () => {
    checkDayTransition()
  })
  bot.on?.('physicsEnabled', () => {
    checkDayTransition()
  })

  bot.once?.('end', stopActive)
  bot.once?.('kicked', stopActive)

  return {
    list,
    pauseActiveForNightSafety,
    restartForDay,
    resumePausedAfterNightSafety,
    setNightSafetyEnabled,
    startByIndex,
    stopActive
  }
}

module.exports = {
  createAutomationManager,
  startFarmingAutomation,
  startPyroFarmingAutomation,
  startWildRoamingAutomation
}
