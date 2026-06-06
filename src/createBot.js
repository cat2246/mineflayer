const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const { attachAiChat } = require('./aiChat')
const { attachAiNpc, isAiNpcIdle } = require('./aiNpc')
const { attachAiNpcScheduler } = require('./aiNpcScheduler')
const { attachAutoEat } = require('./autoEat')
const { resolveBotMemoryPaths } = require('./botMemory')
const { buildBotOptions } = require('./config')
const { attachCombat } = require('./combat')
const { startConsole } = require('./commandConsole')
const { createAutomationManager } = require('./automations')
const { createDebugLogger } = require('./debugLogger')
const { attachDeathRecovery } = require('./deathRecovery')
const { attachEventLogging } = require('./eventLogging')
const { attachFollowController } = require('./follow')
const { attachErrorLogMonitor } = require('./issueRecorder')
const { attachKnockbackPause } = require('./knockbackPause')
const { startLogTerminal } = require('./logTerminal')
const { attachNightSafety } = require('./nightSafety')
const { createNpcLifeController } = require('./npcLife')
const { closeViewer } = require('./viewer')

const RECONNECT_DELAY_MS = 180000

function configureConservativeMovements (movements) {
  movements.canDig = false
  movements.allowSprinting = false
  movements.allowParkour = false
  movements.allow1by1towers = false
  movements.canOpenDoors = false
  movements.maxDropDown = 2
  return movements
}

function loadPvpPlugin (bot, plugin = pvp) {
  const originalOn = bot.on
  bot.on = function onWithoutDeprecatedPhysicsEvent (eventName, ...args) {
    const safeEventName = eventName === 'physicTick' ? 'physicsTick' : eventName
    return originalOn.call(this, safeEventName, ...args)
  }

  try {
    bot.loadPlugin(plugin)
  } finally {
    bot.on = originalOn
  }
}

function attachShutdownHandlers (bot, signals = ['SIGINT', 'SIGTERM']) {
  let shuttingDown = false

  function shutdown () {
    if (shuttingDown) return
    shuttingDown = true
    bot.__manualReconnect = false
    bot.__manualShutdown = true
    closeViewer(bot)
    bot.quit()
  }

  for (const signal of signals) {
    process.once(signal, shutdown)
  }
}

function attachReconnectHandler (bot, options = {}) {
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS
  const reconnect = options.reconnect
  const debugLog = options.debugLog || (() => {})
  const setReconnectTimeout = options.setTimeout || setTimeout
  let scheduled = false

  bot.once('end', () => {
    if (bot.__manualReconnect) {
      bot.__manualReconnect = false
      debugLog('bot.reconnect.immediate', { reason: 'manual-reconnect' })
      if (typeof reconnect === 'function') reconnect()
      return
    }

    if (bot.__manualShutdown) {
      debugLog('bot.reconnect.skipped', { reason: 'manual-shutdown' })
      return
    }

    if (scheduled) return
    scheduled = true
    debugLog('bot.reconnect.scheduled', { reconnectDelayMs })
    const timer = setReconnectTimeout(() => {
      scheduled = false
      if (typeof reconnect === 'function') reconnect()
    }, reconnectDelayMs)
    if (typeof timer?.unref === 'function') timer.unref()
  })
}

function createBot (options = buildBotOptions(), runtimeOptions = {}) {
  const memoryPaths = resolveBotMemoryPaths({
    username: options.username,
    profile: options.profile || runtimeOptions.botProfile
  }, {
    botId: options.botId || runtimeOptions.botId,
    botMemoryRoot: options.botMemoryRoot || runtimeOptions.botMemoryRoot
  })
  const memoryOptions = {
    botId: memoryPaths.botId,
    botMemoryRoot: options.botMemoryRoot || runtimeOptions.botMemoryRoot,
    memoryPath: options.memoryPath || runtimeOptions.memoryPath || memoryPaths.chatMemoryPath,
    containerMemoryPath: options.containerMemoryPath || runtimeOptions.containerMemoryPath || memoryPaths.containerMemoryPath,
    pyroFarmMemoryPath: options.pyroFarmMemoryPath || runtimeOptions.pyroFarmMemoryPath || memoryPaths.pyroFarmMemoryPath,
    placesPath: options.placesPath || runtimeOptions.placesPath || memoryPaths.placesPath,
    npcLifePath: options.npcLifePath || runtimeOptions.npcLifePath || memoryPaths.npcLifePath,
    missingToolsPath: options.missingToolsPath || runtimeOptions.missingToolsPath || memoryPaths.missingToolsPath,
    debugLogPath: options.debugLogPath || runtimeOptions.debugLogPath || memoryPaths.debugLogPath
  }
  const debugLog = createDebugLogger(undefined, memoryOptions.debugLogPath)
  const logTerminal = Object.prototype.hasOwnProperty.call(runtimeOptions, 'logTerminal')
    ? runtimeOptions.logTerminal
    : startLogTerminal({
      ...(runtimeOptions.logTerminalOptions || {}),
      logPath: memoryOptions.debugLogPath
    })
  const mineflayerOptions = { ...options }
  delete mineflayerOptions.serverLabel
  delete mineflayerOptions.serverLoginPassword
  delete mineflayerOptions.logTerminal
  delete mineflayerOptions.botMemoryRoot
  delete mineflayerOptions.botId
  delete mineflayerOptions.memoryPath
  delete mineflayerOptions.containerMemoryPath
  delete mineflayerOptions.pyroFarmMemoryPath
  delete mineflayerOptions.placesPath
  delete mineflayerOptions.npcLifePath
  delete mineflayerOptions.missingToolsPath
  delete mineflayerOptions.debugLogPath
  debugLog('bot.start', {
    host: mineflayerOptions.host,
    port: mineflayerOptions.port,
    username: mineflayerOptions.username,
    version: mineflayerOptions.version
  })
  const rawBot = mineflayer.createBot(mineflayerOptions)
  rawBot.loadPlugin(pathfinder)
  loadPvpPlugin(rawBot)
  const bot = attachEventLogging(rawBot, {
    debugLog,
    serverLabel: runtimeOptions.serverLabel || options.serverLabel || `${mineflayerOptions.host}:${mineflayerOptions.port}`,
    serverLoginPassword: runtimeOptions.serverLoginPassword || options.serverLoginPassword
  })
  bot.once('spawn', () => {
    const movements = configureConservativeMovements(new Movements(bot))
    bot.pathfinder.setMovements(movements)
  })
  attachDeathRecovery(bot, { ...memoryOptions, debugLog })
  attachAutoEat(bot, { debugLog })
  const automationManager = createAutomationManager(bot, { ...memoryOptions, debugLog })
  const followController = attachFollowController(bot, { debugLog })
  const knockbackController = attachKnockbackPause(bot, { debugLog })
  const nightSafetyController = attachNightSafety(bot, { ...memoryOptions, debugLog, automationManager })
  startConsole(bot, { ...memoryOptions, debugLog, automationManager, followController, knockbackController, nightSafetyController })
  attachCombat(bot, { debugLog })
  attachAiChat(bot, { ...memoryOptions, debugLog, automationManager })
  const npcLife = createNpcLifeController(memoryOptions)
  const aiNpcController = attachAiNpc(bot, { ...memoryOptions, debugLog, automationManager, followController, npcLife })
  const aiNpcScheduler = attachAiNpcScheduler(bot, aiNpcController, {
    ...memoryOptions,
    debugLog,
    automationManager,
    followController,
    shouldThink: () => isAiNpcIdle(bot, { automationManager, followController })
  })
  attachErrorLogMonitor(bot, { debugLog, logPath: memoryOptions.debugLogPath })
  attachReconnectHandler(bot, {
    debugLog,
    reconnect: () => createBot(options, { ...runtimeOptions, logTerminal })
  })
  attachShutdownHandlers(bot, runtimeOptions.shutdownSignals)
  if (logTerminal) bot.__logTerminal = logTerminal
  bot.__aiNpcController = aiNpcController
  bot.__aiNpcScheduler = aiNpcScheduler
  return bot
}

function start (options = {}) {
  const { startInteractiveMenu } = require('./startMenu')
  return startInteractiveMenu({
    ...options,
    createBot: (botOptions, runtimeOptions = {}) => {
      return createBot(botOptions, runtimeOptions)
    },
    logTerminal: options.logTerminal
  }).catch(err => {
    console.error(err.message)
    process.exitCode = 1
    return null
  })
}

module.exports = {
  attachReconnectHandler,
  attachShutdownHandlers,
  configureConservativeMovements,
  createBot,
  loadPvpPlugin,
  start
}
