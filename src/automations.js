const { WOODCUTTING_LOOP_DELAY_MS } = require('./config')
const { runFarmingTask } = require('./farming')
const { startMiningAutomation } = require('./mining')
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
  const miningAutomation = options.startMiningAutomation || startMiningAutomation
  let activeAutomation = null
  let pausedNightSafetyAutomation = null

  const automations = options.automations || [
    {
      name: 'Wood cutting',
      start: () => woodCuttingAutomation(bot, { output, debugLog })
    },
    {
      name: 'Farming',
      start: () => farmingAutomation(bot, { output, debugLog })
    },
    {
      name: 'Wild roaming',
      start: () => wildRoamingAutomation(bot, { output, debugLog })
    },
    {
      name: 'Mining',
      resumeAfterNightSafety: true,
      start: () => miningAutomation(bot, { output, debugLog })
    }
  ]

  function list () {
    return automations.map(({ name }) => ({ name }))
  }

  async function startByIndex (index) {
    const automation = automations[index]
    if (!automation) {
      output('Choose a valid automation number, or type cancel.')
      return false
    }

    if (activeAutomation?.instance?.stop) activeAutomation.instance.stop()
    pausedNightSafetyAutomation = null
    activeAutomation = {
      ...automation,
      instance: await automation.start()
    }
    debugLog('automation.start', { name: automation.name })
    return true
  }

  function stopActive () {
    const hadActiveAutomation = Boolean(activeAutomation?.instance?.stop)
    const hadPausedAutomation = Boolean(pausedNightSafetyAutomation)
    if (!hadActiveAutomation && !hadPausedAutomation) return false
    if (activeAutomation?.instance?.stop) activeAutomation.instance.stop()
    activeAutomation = null
    pausedNightSafetyAutomation = null
    debugLog('automation.stop')
    return true
  }

  function pauseActiveForNightSafety () {
    if (!activeAutomation) return false

    const automation = activeAutomation
    if (automation.instance?.stop) automation.instance.stop()
    activeAutomation = null

    if (automation.resumeAfterNightSafety) {
      pausedNightSafetyAutomation = automation
      debugLog('automation.pauseForNightSafety', { name: automation.name })
    } else {
      pausedNightSafetyAutomation = null
      debugLog('automation.stop', { name: automation.name })
    }

    return true
  }

  async function resumePausedAfterNightSafety () {
    if (activeAutomation || !pausedNightSafetyAutomation) return false

    const automation = pausedNightSafetyAutomation
    pausedNightSafetyAutomation = null
    activeAutomation = {
      ...automation,
      instance: await automation.start()
    }
    debugLog('automation.resumeAfterNightSafety', { name: automation.name })
    return true
  }

  bot.once?.('end', stopActive)
  bot.once?.('kicked', stopActive)

  return {
    list,
    pauseActiveForNightSafety,
    resumePausedAfterNightSafety,
    startByIndex,
    stopActive
  }
}

module.exports = {
  createAutomationManager,
  startFarmingAutomation,
  startWildRoamingAutomation
}
