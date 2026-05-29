const { runFarmingTask } = require('./farming')
const { runWildRoamingTask } = require('./wildRoaming')
const { runWoodCuttingQuotaTask } = require('./woodcutting')

const DAYTIME_WOODCUTTING_TARGET_WOOD_COUNT = 32

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

function shouldStopDaytimeTask (bot, options = {}) {
  return Boolean(bot._ended || isNightTime(bot) || options.shouldStop?.())
}

function createDefaultDaytimeTasks () {
  return [
    {
      name: 'Farming',
      run: (bot, options) => runFarmingTask(bot, options)
    },
    {
      name: 'Wood Cutting',
      run: (bot, options) => runWoodCuttingQuotaTask(bot, {
        ...options,
        targetWoodCount: options.daytimeWoodTargetCount ?? DAYTIME_WOODCUTTING_TARGET_WOOD_COUNT
      })
    },
    {
      name: 'Wild Roaming',
      repeatUntilNight: true,
      run: (bot, options) => runWildRoamingTask(bot, options)
    }
  ]
}

function shuffleTasks (tasks, random = Math.random) {
  const shuffled = tasks.slice()

  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1))
    const task = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = task
  }

  return shuffled
}

function createDaytimeTaskOrder (options = {}) {
  const tasks = shuffleTasks(createDefaultDaytimeTasks(), options.random || Math.random)

  return tasks.map((task, index) => ({
    ...task,
    repeatUntilNight: Boolean(task.repeatUntilNight && index === tasks.length - 1)
  }))
}

async function runDaytimeAutomationSequence (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const originPosition = options.originPosition || clonePosition(bot.entity?.position)
  const tasks = options.tasks || createDaytimeTaskOrder(options)

  for (const task of tasks) {
    if (shouldStopDaytimeTask(bot, options)) break
    debugLog('automation.daytime.task.start', { name: task.name })

    do {
      const ran = await task.run(bot, {
        ...options,
        originPosition,
        shouldStop: () => shouldStopDaytimeTask(bot, options)
      })
      if (!task.repeatUntilNight || ran === false) break
    } while (!shouldStopDaytimeTask(bot, options))

    debugLog('automation.daytime.task.done', { name: task.name })
  }

  return true
}

module.exports = {
  createDefaultDaytimeTasks,
  createDaytimeTaskOrder,
  runDaytimeAutomationSequence,
  shuffleTasks,
  shouldStopDaytimeTask
}
