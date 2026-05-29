const {
  KNOCKBACK_HORIZONTAL_VELOCITY,
  KNOCKBACK_MOVEMENT_PAUSE_MS,
  KNOCKBACK_VERTICAL_VELOCITY
} = require('./config')

const MOVEMENT_CONTROLS = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'sprint',
  'sneak'
]

function isMovementPaused (bot, now = Date.now()) {
  return Boolean(bot.__movementPausedUntil && bot.__movementPausedUntil > now)
}

function clearMovementControls (bot) {
  if (typeof bot.clearControlStates === 'function') {
    bot.clearControlStates()
    return
  }

  if (typeof bot.setControlState !== 'function') return
  for (const control of MOVEMENT_CONTROLS) {
    bot.setControlState(control, false)
  }
}

function pauseMovementForKnockback (bot, options = {}) {
  const now = options.now || (() => Date.now())
  const debugLog = options.debugLog || (() => {})
  const pauseMs = options.pauseMs ?? KNOCKBACK_MOVEMENT_PAUSE_MS
  bot.__movementPausedUntil = now() + pauseMs

  if (typeof bot.pathfinder?.setGoal === 'function') {
    bot.pathfinder.setGoal(null)
    if (bot.pvp?.target) bot.__movementPauseClearedPathfinder = true
  }

  clearMovementControls(bot)
  debugLog('knockback.movementPause', { pauseMs })
}

function isBotEntity (bot, entity) {
  return Boolean(entity && (
    entity === bot.entity ||
    (entity.id !== undefined && entity.id === bot.entity?.id)
  ))
}

function velocityMagnitudeSquared (velocity) {
  if (!velocity) return 0
  return Math.pow(velocity.x || 0, 2) + Math.pow(velocity.y || 0, 2) + Math.pow(velocity.z || 0, 2)
}

function applyFallbackKnockback (bot, source, options = {}) {
  const position = bot.entity?.position
  const sourcePosition = source?.position
  const velocity = bot.entity?.velocity
  if (!position || !sourcePosition || !velocity) return false
  if (velocityMagnitudeSquared(velocity) > 0.01) return false

  const dx = position.x - sourcePosition.x
  const dz = position.z - sourcePosition.z
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length <= 0.001) return false

  const horizontalVelocity = options.horizontalVelocity ?? KNOCKBACK_HORIZONTAL_VELOCITY
  const verticalVelocity = options.verticalVelocity ?? KNOCKBACK_VERTICAL_VELOCITY
  velocity.x += (dx / length) * horizontalVelocity
  velocity.y = Math.max(velocity.y || 0, verticalVelocity)
  velocity.z += (dz / length) * horizontalVelocity
  return true
}

function attachKnockbackPause (bot, options = {}) {
  function onEntityHurt (entity, source) {
    if (!isBotEntity(bot, entity)) return
    pauseMovementForKnockback(bot, options)
    if (applyFallbackKnockback(bot, source, options)) {
      ;(options.debugLog || (() => {}))('knockback.fallbackVelocity', {
        velocity: bot.entity.velocity
      })
    }
  }

  bot.on('entityHurt', onEntityHurt)

  return {
    pause: () => pauseMovementForKnockback(bot, options),
    stop: () => bot.off?.('entityHurt', onEntityHurt)
  }
}

module.exports = {
  applyFallbackKnockback,
  attachKnockbackPause,
  clearMovementControls,
  isMovementPaused,
  pauseMovementForKnockback
}
