const { DEFAULT_HOST, PHYSICS_ENABLE_DELAY_MS } = require('./config')
const { createDebugLogger } = require('./debugLogger')
const { joinSurvivalWorld } = require('./survival')
const { sleep } = require('./time')
const { startViewer } = require('./viewer')
const { summarizeWindowItems } = require('./windows')

function attachEventLogging (bot, options = {}) {
  const joinWorld = options.joinSurvivalWorld || joinSurvivalWorld
  const showViewer = options.startViewer || startViewer
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || createDebugLogger()
  let spawnCount = 0

  bot.once('login', () => {
    console.log(`Logged in as ${bot.username}`)
    debugLog('login', { username: bot.username })
  })

  bot.on('resourcePack', (url) => {
    console.log(`Accepting resource pack: ${url}`)
    debugLog('resourcePack', { url })
    if (typeof bot.acceptResourcePack === 'function') {
      bot.acceptResourcePack()
    }
  })

  bot.on('spawn', async () => {
    spawnCount++
    console.log(`Spawned on ${DEFAULT_HOST}`)
    debugLog('spawn', {
      spawnCount,
      username: bot.username,
      version: bot.version,
      physicsEnabled: bot.physicsEnabled,
      position: bot.entity?.position
    })

    if (spawnCount === 1) {
      showViewer(bot)

      try {
        await joinWorld(bot)
        console.log('Sent /survival command')
        debugLog('command.sent', { command: '/survival' })
      } catch (err) {
        console.log('Could not join Survival world:', err.message)
        debugLog('command.error', { command: '/survival', error: err.message })
      }

      return
    }

    await wait(PHYSICS_ENABLE_DELAY_MS)
    if (!bot._ended) {
      bot.physicsEnabled = true
      console.log('Physics enabled')
      debugLog('physics.enabled', { spawnCount })
    }
  })

  bot.on('windowOpen', (window) => {
    debugLog('windowOpen', {
      title: String(window.title || ''),
      slotCount: Array.isArray(window.slots) ? window.slots.length : 0,
      items: summarizeWindowItems(window)
    })
  })

  bot.on('chat', (username, message) => {
    debugLog('chat', { username, message })
  })

  bot.on('message', (message) => {
    debugLog('message', { message: message.toString() })
  })

  bot.on('kicked', (reason) => {
    console.log('Kicked from server:', reason)
    debugLog('kicked', { reason })
  })

  bot.on('error', (err) => {
    console.log('Bot error:', err)
    debugLog('error', { message: err.message, stack: err.stack })
  })

  return bot
}

module.exports = {
  attachEventLogging
}
