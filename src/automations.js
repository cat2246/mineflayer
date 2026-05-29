const { WOODCUTTING_LOOP_DELAY_MS } = require('./config')
const { runFarmingTask } = require('./farming')
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
        await options.runTask(bot, activeOptions)
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
  let activeAutomation = null

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

    if (activeAutomation?.stop) activeAutomation.stop()
    activeAutomation = await automation.start()
    debugLog('automation.start', { name: automation.name })
    return true
  }

  function stopActive () {
    if (!activeAutomation?.stop) return false
    if (activeAutomation?.stop) activeAutomation.stop()
    activeAutomation = null
    debugLog('automation.stop')
    return true
  }

  bot.once?.('end', stopActive)
  bot.once?.('kicked', stopActive)

  return {
    list,
    startByIndex,
    stopActive
  }
}

module.exports = {
  createAutomationManager,
  startFarmingAutomation,
  startWildRoamingAutomation
}
