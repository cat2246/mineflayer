const {
  DEFAULT_HOST,
  PHYSICS_ENABLE_DELAY_MS,
  PLAYER_GREETING_COOLDOWN_MS,
  PLAYER_GREETING_STARTUP_DELAY_MS
} = require('./config')
const { createDebugLogger } = require('./debugLogger')
const { joinSurvivalWorld, loginToServer } = require('./survival')
const { sleep } = require('./time')
const { startViewer } = require('./viewer')
const { summarizeWindowItems } = require('./windows')

function isIgnorableParticleDecodeError (err) {
  const text = [
    err?.name,
    err?.message,
    err?.stack
  ].filter(Boolean).join('\n')

  return text.includes('PartialReadError') && text.includes('packet_world_particles')
}

function enablePhysics (bot, debugLog, spawnCount) {
  if (!bot._ended) {
    bot.physicsEnabled = true
    console.log('Physics enabled')
    debugLog('physics.enabled', { spawnCount })
    if (typeof bot.emit === 'function') bot.emit('physicsEnabled', { spawnCount })
  }
}

function isSafeMinecraftUsername (username) {
  return /^[A-Za-z0-9_]{3,16}$/.test(String(username || ''))
}

async function enablePhysicsAfterDelay (bot, wait, debugLog, spawnCount) {
  await wait(PHYSICS_ENABLE_DELAY_MS)
  enablePhysics(bot, debugLog, spawnCount)
}

function attachEventLogging (bot, options = {}) {
  const joinWorld = options.joinSurvivalWorld || joinSurvivalWorld
  const loginServer = options.loginToServer || loginToServer
  const showViewer = options.startViewer || startViewer
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || createDebugLogger()
  const greetingCooldownMs = options.playerGreetingCooldownMs ?? PLAYER_GREETING_COOLDOWN_MS
  const greetingStartupDelayMs = options.playerGreetingStartupDelayMs ?? PLAYER_GREETING_STARTUP_DELAY_MS
  const now = options.now || Date.now
  const setGreetingTimeout = options.setTimeout || setTimeout
  let spawnCount = 0
  let playerGreetingEnabled = false
  let lastPlayerGreetingAt = null
  let playerGreetingTimer = null
  let playerGreetingStartupTimer = null
  const knownPlayers = new Set(Object.keys(bot.players || {}).filter(Boolean))
  const queuedGreetings = []
  const queuedGreetingUsernames = new Set()

  function rememberCurrentPlayers () {
    for (const username of Object.keys(bot.players || {})) {
      if (username) knownPlayers.add(username)
    }
    if (bot.username) knownPlayers.add(bot.username)
  }

  function sendPlayerGreeting (username) {
    bot.chat(`hi ${username}`)
    lastPlayerGreetingAt = now()
    debugLog('playerJoined.greeted', { username, cooldownMs: greetingCooldownMs })
  }

  function schedulePlayerGreeting () {
    if (playerGreetingTimer || queuedGreetings.length === 0) return

    const elapsedMs = lastPlayerGreetingAt === null ? Infinity : now() - lastPlayerGreetingAt
    const waitMs = Math.max(0, greetingCooldownMs - elapsedMs)
    if (waitMs <= 0) {
      const username = queuedGreetings.shift()
      queuedGreetingUsernames.delete(username)
      sendPlayerGreeting(username)
      schedulePlayerGreeting()
      return
    }

    playerGreetingTimer = setGreetingTimeout(() => {
      playerGreetingTimer = null
      schedulePlayerGreeting()
    }, waitMs)
    if (typeof playerGreetingTimer?.unref === 'function') playerGreetingTimer.unref()
  }

  function queuePlayerGreeting (username) {
    if (queuedGreetingUsernames.has(username)) return
    queuedGreetingUsernames.add(username)
    queuedGreetings.push(username)
    schedulePlayerGreeting()
  }

  function removeQueuedGreeting (username) {
    if (!queuedGreetingUsernames.delete(username)) return

    const index = queuedGreetings.indexOf(username)
    if (index !== -1) queuedGreetings.splice(index, 1)
  }

  function enablePlayerGreeting () {
    rememberCurrentPlayers()
    playerGreetingEnabled = true
    debugLog('playerGreeting.enabled', { knownPlayers: knownPlayers.size, cooldownMs: greetingCooldownMs })
  }

  function startPlayerGreetingSync () {
    rememberCurrentPlayers()
    debugLog('playerGreeting.syncing', {
      knownPlayers: knownPlayers.size,
      cooldownMs: greetingCooldownMs,
      startupDelayMs: greetingStartupDelayMs
    })

    if (greetingStartupDelayMs <= 0) {
      enablePlayerGreeting()
      return
    }

    playerGreetingStartupTimer = setGreetingTimeout(() => {
      playerGreetingStartupTimer = null
      enablePlayerGreeting()
    }, greetingStartupDelayMs)
    if (typeof playerGreetingStartupTimer?.unref === 'function') playerGreetingStartupTimer.unref()
  }

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
      await showViewer(bot)

      try {
        const sentLogin = await loginServer(bot)
        if (sentLogin !== false) {
          console.log('Sent server login command')
          debugLog('command.sent', { command: '/login ***' })
        }
      } catch (err) {
        console.log('Could not send server login command:', err.message)
        debugLog('command.error', { command: '/login ***', error: err.message })
      }

      try {
        enablePhysics(bot, debugLog, spawnCount)
        await joinWorld(bot)
        console.log('Sent /survival command')
        debugLog('command.sent', { command: '/survival' })
      } catch (err) {
        console.log('Could not join Survival world:', err.message)
        debugLog('command.error', { command: '/survival', error: err.message })
      }

      startPlayerGreetingSync()
      return
    }

    await enablePhysicsAfterDelay(bot, wait, debugLog, spawnCount)
    try {
      await joinWorld(bot)
      console.log('Sent /survival command')
      debugLog('command.sent', { command: '/survival', reason: 'spawn-recovery' })
    } catch (err) {
      console.log('Could not return to Survival world:', err.message)
      debugLog('command.error', { command: '/survival', reason: 'spawn-recovery', error: err.message })
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

  bot.on('playerJoined', (player) => {
    const username = player?.username
    if (!username || username === bot.username || typeof bot.chat !== 'function') return
    if (!isSafeMinecraftUsername(username)) {
      debugLog('playerJoined.greetingSkipped', { username, reason: 'unsafe-username' })
      return
    }

    if (!playerGreetingEnabled) {
      knownPlayers.add(username)
      debugLog('playerJoined.greetingSkipped', { username, reason: 'startup' })
      return
    }

    if (knownPlayers.has(username)) {
      debugLog('playerJoined.greetingSkipped', { username, reason: 'already-present' })
      return
    }

    knownPlayers.add(username)
    queuePlayerGreeting(username)
  })

  bot.on('playerLeft', (player) => {
    const username = player?.username
    if (!username || username === bot.username) return

    knownPlayers.delete(username)
    removeQueuedGreeting(username)
  })

  bot.on('message', (message) => {
    debugLog('message', { message: message.toString() })
  })

  bot.on('kicked', (reason) => {
    console.log('Kicked from server:', reason)
    debugLog('kicked', { reason })
  })

  bot.on('error', (err) => {
    if (isIgnorableParticleDecodeError(err)) {
      debugLog('protocol.particleDecodeIgnored', { message: err.message })
      return
    }

    console.log('Bot error:', err)
    debugLog('error', { message: err.message, stack: err.stack })
  })

  return bot
}

module.exports = {
  attachEventLogging,
  isIgnorableParticleDecodeError,
  isSafeMinecraftUsername
}
