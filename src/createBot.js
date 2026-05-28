const mineflayer = require('mineflayer')
const { buildBotOptions } = require('./config')
const { startConsole } = require('./commandConsole')
const { createDebugLogger } = require('./debugLogger')
const { attachEventLogging } = require('./eventLogging')

function attachShutdownHandlers (bot, signals = ['SIGINT', 'SIGTERM']) {
  let shuttingDown = false

  function shutdown () {
    if (shuttingDown) return
    shuttingDown = true
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
  const bot = attachEventLogging(mineflayer.createBot(options), { debugLog })
  startConsole(bot, { debugLog })
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
  createBot,
  start
}
