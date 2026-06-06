const { readPlaceCoordinates, rememberPlaceCoordinates } = require('./places')
const { sleep } = require('./time')

const DEFAULT_STARTUP_HOME_NAME = 'home'
const DEFAULT_RTP_SETTLE_MS = 5000

function homeCommand (homeName = DEFAULT_STARTUP_HOME_NAME) {
  return `/home ${homeName}`
}

function setHomeCommand (homeName = DEFAULT_STARTUP_HOME_NAME) {
  return `/sethome ${homeName}`
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
    return { ok: true, action: 'go_home', home: homeName, knownHome }
  }

  bot.chat('/rtp')
  debugLog('startupHome.rtp', { home: homeName })
  await wait(rtpSettleMs)

  if (!isSafeStartupHomeLanding(bot)) {
    debugLog('startupHome.unsafeLanding', { home: homeName })
    return { ok: false, action: 'rtp', reason: 'unsafe-landing', home: homeName }
  }

  bot.chat(setHomeCommand(homeName))
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
  let ran = false
  let running = false

  async function onSurvivalJoined () {
    if (stopped || ran || running) return

    ran = true
    running = true
    try {
      const result = await runFlow(bot, {
        ...options,
        reason: 'survival-joined'
      })
      debugLog('startupHome.complete', result)
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
  DEFAULT_RTP_SETTLE_MS,
  DEFAULT_STARTUP_HOME_NAME,
  attachStartupHomeFlow,
  homeCommand,
  isSafeStartupHomeLanding,
  runStartupHomeFlow,
  setHomeCommand
}
