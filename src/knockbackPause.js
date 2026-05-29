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

function vectorData (vector) {
  if (!vector) return null
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z
  }
}

function entityData (entity) {
  if (!entity) return null
  return {
    id: entity.id,
    name: entity.name,
    username: entity.username,
    type: entity.type,
    position: vectorData(entity.position),
    velocity: vectorData(entity.velocity)
  }
}

function controlStateData (bot) {
  if (typeof bot.getControlState !== 'function') return {}
  return Object.fromEntries(MOVEMENT_CONTROLS.map(control => [control, bot.getControlState(control)]))
}

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
  const debugLog = options.debugLog || (() => {})
  const now = options.now || (() => Date.now())
  const debugSampleTicks = options.debugSampleTicks ?? 5
  let debugEnabled = Boolean(options.debugEnabled)
  let debugTicksRemaining = 0

  function movementSnapshot () {
    return {
      time: now(),
      self: entityData(bot.entity),
      movementPausedUntil: bot.__movementPausedUntil || null,
      movementPaused: isMovementPaused(bot, now()),
      pvpTarget: entityData(bot.pvp?.target),
      controlStates: controlStateData(bot)
    }
  }

  function logDebug (event, data = {}) {
    if (!debugEnabled) return
    debugLog(event, {
      ...data,
      ...movementSnapshot()
    })
  }

  function onEntityHurt (entity, source) {
    if (!isBotEntity(bot, entity)) return
    debugTicksRemaining = debugSampleTicks
    logDebug('knockback.debug.hurt', {
      entity: entityData(entity),
      source: entityData(source)
    })
    pauseMovementForKnockback(bot, options)
    if (applyFallbackKnockback(bot, source, options)) {
      debugLog('knockback.fallbackVelocity', {
        velocity: bot.entity.velocity
      })
    }
  }

  function onEntityVelocity (packet) {
    if (!debugEnabled || packet.entityId !== bot.entity?.id) return
    debugTicksRemaining = Math.max(debugTicksRemaining, debugSampleTicks)
    logDebug('knockback.debug.selfVelocityPacket', { packet })
  }

  function onPhysicsTick () {
    if (!debugEnabled || debugTicksRemaining <= 0) return
    logDebug('knockback.debug.physicsTick')
    debugTicksRemaining--
  }

  function setDebugEnabled (enabled) {
    debugEnabled = Boolean(enabled)
    debugLog('knockback.debug.toggle', { enabled: debugEnabled })
    return {
      enabled: debugEnabled,
      message: `Knockback debug ${debugEnabled ? 'enabled' : 'disabled'}.`
    }
  }

  function toggleDebug () {
    return setDebugEnabled(!debugEnabled)
  }

  bot.on('entityHurt', onEntityHurt)
  bot.on('physicsTick', onPhysicsTick)
  bot._client?.on?.('entity_velocity', onEntityVelocity)

  return {
    pause: () => pauseMovementForKnockback(bot, options),
    setDebugEnabled,
    stop: () => {
      bot.off?.('entityHurt', onEntityHurt)
      bot.off?.('physicsTick', onPhysicsTick)
      bot._client?.off?.('entity_velocity', onEntityVelocity)
    },
    toggleDebug
  }
}

module.exports = {
  applyFallbackKnockback,
  attachKnockbackPause,
  clearMovementControls,
  isMovementPaused,
  pauseMovementForKnockback
}
