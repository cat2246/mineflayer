const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const { attachAiChat } = require('./aiChat')
const { attachAutoEat } = require('./autoEat')
const { buildBotOptions } = require('./config')
const { attachCombat } = require('./combat')
const { startConsole } = require('./commandConsole')
const { createAutomationManager } = require('./automations')
const { createDebugLogger } = require('./debugLogger')
const { attachDeathRecovery } = require('./deathRecovery')
const { attachEventLogging } = require('./eventLogging')
const { attachFollowController } = require('./follow')
const { attachKnockbackPause } = require('./knockbackPause')
const { attachNightSafety } = require('./nightSafety')
const { closeViewer } = require('./viewer')

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
    closeViewer(bot)
    bot.quit()
  }

  for (const signal of signals) {
    process.once(signal, shutdown)
  }
}

function createBot (options = buildBotOptions()) {
  const debugLog = createDebugLogger()
  debugLog('bot.start', {
    host: options.host,
    port: options.port,
    username: options.username,
    version: options.version
  })
  const rawBot = mineflayer.createBot(options)
  rawBot.loadPlugin(pathfinder)
  loadPvpPlugin(rawBot)
  const bot = attachEventLogging(rawBot, { debugLog })
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
  attachAiChat(bot, { debugLog })
  attachShutdownHandlers(bot)
  return bot
}

function start () {
  try {
    return createBot()
  } catch (err) {
    console.error(err.message)
    console.error('Usage: node bot.js <microsoft-account-email-or-identifier>')
    process.exitCode = 1
    return null
  }
}

module.exports = {
  attachShutdownHandlers,
  configureConservativeMovements,
  createBot,
  loadPvpPlugin,
  start
}
