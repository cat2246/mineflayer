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

const INDIRECT_DAMAGE_VELOCITY_IGNORE_MS = 1500
const DIRECT_DAMAGE_VELOCITY_CORRECTION_MS = 250
const FALLBACK_KNOCKBACK_DELAY_MS = 75
const NO_DIRECT_VELOCITY_DAMAGE_SOURCE_TYPE_IDS = new Set([9, 29])

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

function horizontalVelocityMagnitude (velocity) {
  if (!velocity) return 0
  return Math.sqrt(Math.pow(velocity.x || 0, 2) + Math.pow(velocity.z || 0, 2))
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

function shouldApplyFallbackKnockback (source, damageInfo) {
  if (!source || !damageInfo) return true
  if (damageInfo.sourceCauseId === undefined || damageInfo.sourceDirectId === undefined) return true
  return damageInfo.sourceCauseId > 0 && damageInfo.sourceDirectId === damageInfo.sourceCauseId
}

function isIndirectDamage (damageInfo) {
  return Boolean(damageInfo && damageInfo.sourceDirectId === 0 && (
    damageInfo.sourceCauseId > 0 ||
    (damageInfo.sourceCauseId === 0 && NO_DIRECT_VELOCITY_DAMAGE_SOURCE_TYPE_IDS.has(damageInfo.sourceTypeId))
  ))
}

function isDirectDamage (damageInfo) {
  return Boolean(damageInfo && damageInfo.sourceDirectId > 0)
}

function restoreVelocity (velocity, snapshot) {
  if (!velocity || !snapshot) return
  if (typeof velocity.set === 'function') {
    velocity.set(snapshot.x, snapshot.y, snapshot.z)
    return
  }
  velocity.x = snapshot.x
  velocity.y = snapshot.y
  velocity.z = snapshot.z
}

function horizontalAwayDirection (bot, sourcePosition) {
  const position = bot.entity?.position
  if (!position || !sourcePosition) return null

  const dx = position.x - sourcePosition.x
  const dz = position.z - sourcePosition.z
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length <= 0.001) return null

  return {
    x: dx / length,
    z: dz / length
  }
}

function horizontalDirection (vector) {
  if (!vector) return null
  const length = Math.sqrt(Math.pow(vector.x || 0, 2) + Math.pow(vector.z || 0, 2))
  if (length <= 0.001) return null

  return {
    x: (vector.x || 0) / length,
    z: (vector.z || 0) / length
  }
}

function horizontalKnockbackDirection (bot, source) {
  return horizontalDirection(source?.velocity) || horizontalAwayDirection(bot, source?.position)
}

function velocityDoesNotPointAlongSource (bot, source) {
  const velocity = bot.entity?.velocity
  const direction = horizontalKnockbackDirection(bot, source)
  if (!velocity || !direction) return false

  const dotProduct = (velocity.x || 0) * direction.x + (velocity.z || 0) * direction.z
  if (horizontalDirection(source?.velocity)) return dotProduct <= 0.01
  return dotProduct < -0.01
}

function shouldCorrectDirectVelocity (bot, source) {
  return velocityDoesNotPointAlongSource(bot, source)
}

function setVelocityFromSource (bot, source, options = {}) {
  const velocity = bot.entity?.velocity
  const direction = horizontalKnockbackDirection(bot, source)
  if (!velocity || !direction) return false

  const fallbackHorizontalVelocity = options.horizontalVelocity ?? KNOCKBACK_HORIZONTAL_VELOCITY
  const verticalVelocity = options.verticalVelocity ?? KNOCKBACK_VERTICAL_VELOCITY
  const horizontalVelocity = Math.max(horizontalVelocityMagnitude(velocity), fallbackHorizontalVelocity)
  velocity.x = direction.x * horizontalVelocity
  velocity.y = Math.max(velocity.y || 0, verticalVelocity)
  velocity.z = direction.z * horizontalVelocity
  return true
}

function directDamageCorrectionSource (source, damageInfo) {
  if (!damageInfo || damageInfo.sourceCauseId === undefined || damageInfo.sourceDirectId === undefined) {
    return source?.position ? { position: vectorData(source.position) } : null
  }

  if (damageInfo.sourceDirectId !== damageInfo.sourceCauseId) {
    const velocity = vectorData(damageInfo.sourceDirectVelocity)
    const position = vectorData(damageInfo.sourceDirectPosition || damageInfo.sourcePosition)
    return velocity || position ? { velocity, position } : null
  }

  return source?.position ? { position: vectorData(source.position) } : null
}

function attachKnockbackPause (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const now = options.now || (() => Date.now())
  const debugSampleTicks = options.debugSampleTicks ?? 5
  const indirectDamageVelocityIgnoreMs = options.indirectDamageVelocityIgnoreMs ?? INDIRECT_DAMAGE_VELOCITY_IGNORE_MS
  const directDamageVelocityCorrectionMs = options.directDamageVelocityCorrectionMs ?? DIRECT_DAMAGE_VELOCITY_CORRECTION_MS
  const fallbackKnockbackDelayMs = options.fallbackKnockbackDelayMs ?? FALLBACK_KNOCKBACK_DELAY_MS
  const setFallbackKnockbackTimeout = options.setFallbackKnockbackTimeout || ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearFallbackKnockbackTimeout = options.clearFallbackKnockbackTimeout || (timer => clearTimeout(timer))
  const afterPacketListeners = options.afterPacketListeners || (callback => queueMicrotask(callback))
  let debugEnabled = Boolean(options.debugEnabled)
  let debugTicksRemaining = 0
  let ignoreSelfVelocityUntil = 0
  let velocityBeforeIndirectDamage = null
  let directVelocityCorrectionUntil = 0
  let directVelocityCorrectionSource = null
  let fallbackKnockbackTimer = null
  let fallbackKnockbackSource = null

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

  function cancelFallbackKnockback () {
    if (fallbackKnockbackTimer !== null) {
      clearFallbackKnockbackTimeout(fallbackKnockbackTimer)
      fallbackKnockbackTimer = null
    }
    fallbackKnockbackSource = null
  }

  function scheduleFallbackKnockback (source, damageInfo) {
    cancelFallbackKnockback()
    if (!shouldApplyFallbackKnockback(source, damageInfo) || !source?.position) return

    fallbackKnockbackSource = source
    fallbackKnockbackTimer = setFallbackKnockbackTimeout(() => {
      const scheduledSource = fallbackKnockbackSource
      fallbackKnockbackTimer = null
      fallbackKnockbackSource = null
      if (applyFallbackKnockback(bot, scheduledSource, options)) {
        debugLog('knockback.fallbackVelocity', {
          velocity: bot.entity.velocity
        })
      }
    }, fallbackKnockbackDelayMs)
  }

  function onEntityHurt (entity, source, damageInfo) {
    if (!isBotEntity(bot, entity)) return
    debugTicksRemaining = debugSampleTicks
    logDebug('knockback.debug.hurt', {
      entity: entityData(entity),
      source: entityData(source),
      damageInfo
    })
    cancelFallbackKnockback()
    const indirectDamage = isIndirectDamage(damageInfo)
    const directDamage = isDirectDamage(damageInfo)
    if (!indirectDamage) {
      pauseMovementForKnockback(bot, options)
    }
    if (indirectDamage) {
      ignoreSelfVelocityUntil = now() + indirectDamageVelocityIgnoreMs
      velocityBeforeIndirectDamage = vectorData(bot.entity?.velocity)
      directVelocityCorrectionUntil = 0
      directVelocityCorrectionSource = null
    } else if (directDamage) {
      ignoreSelfVelocityUntil = 0
      velocityBeforeIndirectDamage = null
      const correctionSource = directDamageCorrectionSource(source, damageInfo)
      if (correctionSource) {
        directVelocityCorrectionUntil = now() + directDamageVelocityCorrectionMs
        directVelocityCorrectionSource = correctionSource
      } else {
        directVelocityCorrectionUntil = 0
        directVelocityCorrectionSource = null
      }
    }
    if (!indirectDamage) scheduleFallbackKnockback(source, damageInfo)
  }

  function onEntityVelocity (packet) {
    if (packet.entityId !== bot.entity?.id) return
    cancelFallbackKnockback()
    if (ignoreSelfVelocityUntil > now()) {
      const snapshot = velocityBeforeIndirectDamage
      restoreVelocity(bot.entity?.velocity, snapshot)
      afterPacketListeners(() => restoreVelocity(bot.entity?.velocity, snapshot))
      ignoreSelfVelocityUntil = 0
      debugLog('knockback.ignoredIndirectVelocity', { packet })
    }
    if (directVelocityCorrectionUntil > now()) {
      const correctionSource = directVelocityCorrectionSource
      if (shouldCorrectDirectVelocity(bot, correctionSource, options) && setVelocityFromSource(bot, correctionSource, options)) {
        debugLog('knockback.correctedDirectVelocity', { packet })
      }
      afterPacketListeners(() => {
        if (shouldCorrectDirectVelocity(bot, correctionSource, options) && setVelocityFromSource(bot, correctionSource, options)) {
          debugLog('knockback.correctedDirectVelocity', { packet, late: true })
        }
      })
      directVelocityCorrectionUntil = 0
      directVelocityCorrectionSource = null
    }
    if (!debugEnabled) return
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
      cancelFallbackKnockback()
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
  isIndirectDamage,
  pauseMovementForKnockback,
  shouldApplyFallbackKnockback
}
