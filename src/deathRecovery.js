const {
  RESPAWN_CLICK_DELAY_MS,
  RESPAWN_HOME_DELAY_MS,
  WOODCUTTING_HOME_COMMAND
} = require('./config')
const { sleep } = require('./time')

function stopBotMovement (bot) {
  if (typeof bot.pathfinder?.setGoal === 'function') {
    bot.pathfinder.setGoal(null)
  }
  if (typeof bot.clearControlStates === 'function') {
    bot.clearControlStates()
  } else if (typeof bot.setControlState === 'function') {
    for (const control of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) {
      bot.setControlState(control, false)
    }
  }
}

function attachDeathRecovery (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const respawnDelayMs = options.respawnDelayMs ?? RESPAWN_CLICK_DELAY_MS
  const homeDelayMs = options.homeDelayMs ?? RESPAWN_HOME_DELAY_MS
  const homeCommand = options.homeCommand || WOODCUTTING_HOME_COMMAND
  let pendingHomeTeleport = false
  let recovering = false

  bot.on('death', async () => {
    if (recovering) return
    recovering = true
    pendingHomeTeleport = true
    stopBotMovement(bot)
    debugLog('death')

    await wait(respawnDelayMs)
    if (!bot._ended && typeof bot.respawn === 'function') {
      bot.respawn()
      debugLog('respawn.requested')
    }
    recovering = false
  })

  bot.on('spawn', async () => {
    if (!pendingHomeTeleport) return
    pendingHomeTeleport = false
    await wait(homeDelayMs)
    if (!bot._ended) {
      bot.chat(homeCommand)
      debugLog('command.sent', { command: homeCommand, reason: 'death-recovery' })
    }
  })

  return bot
}

module.exports = {
  attachDeathRecovery,
  stopBotMovement
}
