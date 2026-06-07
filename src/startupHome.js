const { readPlaceCoordinates, rememberPlaceCoordinates } = require('./places')
const { sleep } = require('./time')

const DEFAULT_STARTUP_HOME_NAME = 'home'
const DEFAULT_RTP_SETTLE_MS = 5000
const DEFAULT_HOME_SETTLE_MS = 5000
const DEFAULT_SET_HOME_SETTLE_MS = 1000
const DEFAULT_WILDERNESS_COMMAND = '/rtp'

function homeCommand (homeName = DEFAULT_STARTUP_HOME_NAME) {
  return `/home ${homeName}`
}

function setHomeCommand (homeName = DEFAULT_STARTUP_HOME_NAME) {
  return `/sethome ${homeName}`
}

function deleteHomeCommand (homeName = DEFAULT_STARTUP_HOME_NAME) {
  return `/delhome ${homeName}`
}

function normalizeStartupCommand (command) {
  const text = String(command || '').trim()
  if (!text) return DEFAULT_WILDERNESS_COMMAND
  return text.startsWith('/') ? text : `/${text}`
}

function isStartupTeleportFailureMessage (message) {
  const text = String(message || '').toLowerCase()
  return text.includes("don't have permission") ||
    text.includes('do not have permission') ||
    text.includes('no permission') ||
    text.includes('unknown or incomplete command') ||
    text.includes('unknown command') ||
    text.includes('home not found') ||
    text.includes('home is not set') ||
    text.includes('no home')
}

function isSetHomeFailureMessage (message) {
  const text = String(message || '').toLowerCase()
  return text.includes("don't have permission") ||
    text.includes('do not have permission') ||
    text.includes('no permission') ||
    text.includes('unknown or incomplete command') ||
    text.includes('unknown command') ||
    text.includes('overwrite existing home') ||
    text.includes('remove old one') ||
    text.includes('pick different home name')
}

async function waitForCommandSettle (bot, wait, settleMs) {
  const messages = []
  const onMessage = message => {
    messages.push(message?.toString ? message.toString() : String(message || ''))
  }

  if (typeof bot?.on === 'function') bot.on('message', onMessage)
  try {
    await wait(settleMs)
  } finally {
    if (typeof bot?.removeListener === 'function') bot.removeListener('message', onMessage)
  }

  return messages
}

function hasUsablePosition (bot) {
  const position = bot?.entity?.position
  return Boolean(
    position &&
    typeof position.x === 'number' &&
    typeof position.y === 'number' &&
    typeof position.z === 'number'
  )
}

function isSafeStartupHomeLanding (bot) {
  if (!hasUsablePosition(bot)) return false
  if (bot._ended || bot.currentWindow || bot.isSleeping) return false
  if (typeof bot.health === 'number' && bot.health <= 0) return false
  return true
}

async function runStartupHomeFlow (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const wait = options.sleep || sleep
  const homeName = options.homeName || DEFAULT_STARTUP_HOME_NAME
  const rtpSettleMs = options.rtpSettleMs ?? DEFAULT_RTP_SETTLE_MS
  const homeSettleMs = options.homeSettleMs ?? DEFAULT_HOME_SETTLE_MS
  const setHomeSettleMs = options.setHomeSettleMs ?? DEFAULT_SET_HOME_SETTLE_MS
  const wildernessCommand = normalizeStartupCommand(options.wildernessCommand || DEFAULT_WILDERNESS_COMMAND)

  if (typeof bot?.chat !== 'function') {
    debugLog('startupHome.skipped', { reason: 'chat-unavailable' })
    return { ok: false, action: 'noop', reason: 'chat-unavailable' }
  }

  const knownHome = readPlaceCoordinates(homeName, options)
  if (knownHome) {
    bot.chat(homeCommand(homeName))
    debugLog('startupHome.goHome', {
      home: homeName,
      remembered: knownHome
    })
    const messages = await waitForCommandSettle(bot, wait, homeSettleMs)
    if (!messages.some(isStartupTeleportFailureMessage)) {
      return { ok: true, action: 'go_home', home: homeName, knownHome }
    }

    debugLog('startupHome.homeFailed', {
      home: homeName,
      messages
    })
  }

  bot.chat(wildernessCommand)
  debugLog('startupHome.rtp', { command: wildernessCommand, home: homeName })
  const messages = await waitForCommandSettle(bot, wait, rtpSettleMs)
  if (messages.some(isStartupTeleportFailureMessage)) {
    debugLog('startupHome.rtpFailed', { command: wildernessCommand, home: homeName, messages })
    return { ok: false, action: 'rtp', reason: 'teleport-command-failed', home: homeName, command: wildernessCommand }
  }

  if (!isSafeStartupHomeLanding(bot)) {
    debugLog('startupHome.unsafeLanding', { home: homeName })
    return { ok: false, action: 'rtp', reason: 'unsafe-landing', home: homeName }
  }

  bot.chat(deleteHomeCommand(homeName))
  debugLog('startupHome.deleteHome', { home: homeName })
  bot.chat(setHomeCommand(homeName))
  const setHomeMessages = await waitForCommandSettle(bot, wait, setHomeSettleMs)
  if (setHomeMessages.some(isSetHomeFailureMessage)) {
    debugLog('startupHome.setHomeFailed', { home: homeName, messages: setHomeMessages })
    return { ok: false, action: 'set_home', reason: 'set-home-failed', home: homeName, messages: setHomeMessages }
  }

  const home = rememberPlaceCoordinates(bot, homeName, bot.entity.position, options)
  debugLog('startupHome.setHome', {
    home: homeName,
    remembered: home
  })

  return { ok: true, action: 'set_home', home: homeName, remembered: home }
}

function attachStartupHomeFlow (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const errorOutput = options.errorOutput || console.error
  const runFlow = options.runStartupHomeFlow || runStartupHomeFlow
  let stopped = false
  let running = false
  let ranWithoutSpawnCount = false
  const completedSpawnCounts = new Set()

  async function onSurvivalJoined (event = {}) {
    const spawnCount = Number(event?.spawnCount)
    const hasSpawnCount = Number.isInteger(spawnCount) && spawnCount > 0
    if (stopped || running) return
    if (hasSpawnCount && completedSpawnCounts.has(spawnCount)) return
    if (!hasSpawnCount && ranWithoutSpawnCount) return

    if (hasSpawnCount) completedSpawnCounts.add(spawnCount)
    else ranWithoutSpawnCount = true
    running = true
    try {
      const result = await runFlow(bot, {
        ...options,
        reason: event?.reason || 'survival-joined',
        spawnCount: hasSpawnCount ? spawnCount : null
      })
      debugLog('startupHome.complete', result)
      if (result?.ok !== false && typeof bot?.emit === 'function') {
        bot.emit('survivalReady', result)
      }
    } catch (err) {
      errorOutput(`Startup home flow error: ${err.message}`)
      debugLog('startupHome.error', {
        message: err.message,
        stack: err.stack
      })
    } finally {
      running = false
    }
  }

  function stop () {
    if (stopped) return
    stopped = true
    bot?.removeListener?.('survivalJoined', onSurvivalJoined)
  }

  bot?.on?.('survivalJoined', onSurvivalJoined)
  bot?.once?.('end', stop)
  bot?.once?.('kicked', stop)

  return {
    stop
  }
}

module.exports = {
  DEFAULT_HOME_SETTLE_MS,
  DEFAULT_RTP_SETTLE_MS,
  DEFAULT_SET_HOME_SETTLE_MS,
  DEFAULT_STARTUP_HOME_NAME,
  DEFAULT_WILDERNESS_COMMAND,
  attachStartupHomeFlow,
  deleteHomeCommand,
  homeCommand,
  isSetHomeFailureMessage,
  isStartupTeleportFailureMessage,
  isSafeStartupHomeLanding,
  normalizeStartupCommand,
  runStartupHomeFlow,
  setHomeCommand
}
