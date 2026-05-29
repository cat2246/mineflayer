const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { attachAutoEat } = require('./autoEat')
const { buildBotOptions } = require('./config')
const { attachCombat } = require('./combat')
const { startConsole } = require('./commandConsole')
const { createDebugLogger } = require('./debugLogger')
const { attachDeathRecovery } = require('./deathRecovery')
const { attachEventLogging } = require('./eventLogging')
const { closeViewer } = require('./viewer')

function configureConservativeMovements (movements) {
  movements.canDig = false
  movements.allowSprinting = false
  movements.allowParkour = false
  movements.allow1by1towers = false
  movements.maxDropDown = 2
  return movements
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
  const bot = attachEventLogging(rawBot, { debugLog })
  bot.once('spawn', () => {
    const movements = configureConservativeMovements(new Movements(bot))
    bot.pathfinder.setMovements(movements)
  })
  attachDeathRecovery(bot, { debugLog })
  attachAutoEat(bot, { debugLog })
  startConsole(bot, { debugLog })
  attachCombat(bot, { debugLog })
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
  start
}
