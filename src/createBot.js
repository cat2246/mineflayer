const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const { attachAiChat } = require('./aiChat')
const { attachAiNpc } = require('./aiNpc')
const { attachAutoEat } = require('./autoEat')
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
  const debugLog = createDebugLogger()
  const mineflayerOptions = { ...options }
  delete mineflayerOptions.serverLabel
  delete mineflayerOptions.serverLoginPassword
  delete mineflayerOptions.logTerminal
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
  attachDeathRecovery(bot, { debugLog })
  attachAutoEat(bot, { debugLog })
  const automationManager = createAutomationManager(bot, { debugLog })
  const followController = attachFollowController(bot, { debugLog })
  const knockbackController = attachKnockbackPause(bot, { debugLog })
  const nightSafetyController = attachNightSafety(bot, { debugLog, automationManager })
  startConsole(bot, { debugLog, automationManager, followController, knockbackController, nightSafetyController })
  attachCombat(bot, { debugLog })
  attachAiChat(bot, { debugLog, automationManager })
  const npcLife = createNpcLifeController()
  attachAiNpc(bot, { debugLog, automationManager, followController, npcLife })
  attachErrorLogMonitor(bot, { debugLog })
  attachReconnectHandler(bot, {
    debugLog,
    reconnect: () => createBot(options, runtimeOptions)
  })
  attachShutdownHandlers(bot)
  return bot
}

function start (options = {}) {
  const logTerminal = startLogTerminal()
  const { startInteractiveMenu } = require('./startMenu')
  return startInteractiveMenu({
    ...options,
    createBot: (botOptions, runtimeOptions = {}) => {
      const bot = createBot(botOptions, {
        ...runtimeOptions,
        logTerminal
      })
      if (bot) bot.__logTerminal = logTerminal
      return bot
    },
    logTerminal
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
