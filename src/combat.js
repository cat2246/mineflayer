const {
  COMBAT_BOW_DISTANCE,
  COMBAT_BOW_DRAW_MS,
  COMBAT_CHECK_INTERVAL_MS,
  COMBAT_FLEE_MS,
  COMBAT_TARGET_RANGE
} = require('./config')
const { isMovementPaused } = require('./knockbackPause')
const { sleep } = require('./time')

const COMBAT_BUSY_MS = 3000
const COMBAT_MIN_HIT_DELAY_MS = 1000
const COMBAT_MAX_HIT_DELAY_MS = 1500
const COMBAT_MIN_MELEE_RANGE = 1
const COMBAT_MAX_MELEE_RANGE = 3
const COMBAT_AIM_MIN_STEPS = 3
const COMBAT_AIM_MAX_STEPS = 5
const COMBAT_AIM_MIN_STEP_MS = 25
const COMBAT_AIM_MAX_STEP_MS = 55
const COMBAT_AIM_MIN_CURVE_PERCENT = 10
const COMBAT_AIM_MAX_CURVE_PERCENT = 30
const COMBAT_ATTACK_FOV_RADIANS = Math.PI / 4

const HOSTILE_MOB_NAMES = new Set([
  'blaze',
  'bogged',
  'breeze',
  'cave_spider',
  'creeper',
  'drowned',
  'elder_guardian',
  'enderman',
  'endermite',
  'evoker',
  'ghast',
  'guardian',
  'hoglin',
  'husk',
  'magma_cube',
  'phantom',
  'piglin_brute',
  'pillager',
  'ravager',
  'shulker',
  'silverfish',
  'skeleton',
  'slime',
  'spider',
  'stray',
  'vex',
  'vindicator',
  'warden',
  'witch',
  'wither',
  'wither_skeleton',
  'zoglin',
  'zombie',
  'zombie_villager'
])

const RANGED_HOSTILE_MOB_NAMES = new Set([
  'blaze',
  'bogged',
  'breeze',
  'elder_guardian',
  'evoker',
  'ghast',
  'guardian',
  'pillager',
  'shulker',
  'skeleton',
  'stray',
  'witch'
])

function isHostileMob (entity) {
  return Boolean(
    entity &&
    (entity.type === 'mob' || entity.type === 'hostile') &&
    HOSTILE_MOB_NAMES.has(String(entity.name || '').toLowerCase())
  )
}

function isRangedHostileMob (entity) {
  return Boolean(entity && RANGED_HOSTILE_MOB_NAMES.has(String(entity.name || '').toLowerCase()))
}

function distanceToEntity (bot, entity) {
  const botPosition = bot.entity?.position
  const entityPosition = entity?.position
  if (!botPosition || !entityPosition) return Infinity
  if (typeof botPosition.distanceTo === 'function') {
    return botPosition.distanceTo(entityPosition)
  }

  return Math.sqrt(
    Math.pow(botPosition.x - entityPosition.x, 2) +
    Math.pow(botPosition.y - entityPosition.y, 2) +
    Math.pow(botPosition.z - entityPosition.z, 2)
  )
}

function getRandomInt (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomCombatInt (min, max, options = {}) {
  const randomInt = options.randomInt || getRandomInt
  return randomInt(min, max)
}

function randomizedCombatDelayMs (baseDelayMs, options = {}) {
  if (!Number.isFinite(baseDelayMs) || baseDelayMs <= 0) return baseDelayMs

  const minDelayMs = Math.max(1, Math.floor(baseDelayMs * 0.7))
  const maxDelayMs = Math.max(minDelayMs, Math.ceil(baseDelayMs * 1.3))
  return randomCombatInt(minDelayMs, maxDelayMs, options)
}

function currentCombatTime (options = {}) {
  return typeof options.now === 'function' ? options.now() : Date.now()
}

function normalizeAngle (angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function randomizedMeleeRange (options = {}) {
  const minRange = options.minMeleeRange ?? COMBAT_MIN_MELEE_RANGE
  const maxRange = options.maxMeleeRange ?? COMBAT_MAX_MELEE_RANGE
  return randomCombatInt(minRange, maxRange, options)
}

function meleeWaitAction (action, reason, data = {}) {
  return {
    type: 'wait',
    reason,
    target: action.target,
    distance: action.distance,
    ...data
  }
}

function checkMeleeHitReadiness (bot, action, options = {}) {
  const now = currentCombatTime(options)
  const nextHitAt = bot.__nextCombatMeleeHitAt || 0
  if (now < nextHitAt) {
    return meleeWaitAction(action, 'cooldown', { nextHitAt })
  }

  const meleeRange = randomizedMeleeRange(options)
  if (action.distance > meleeRange) {
    return meleeWaitAction(action, 'out-of-melee-range', { meleeRange })
  }

  return null
}

function scheduleNextMeleeHit (bot, options = {}) {
  bot.__nextCombatMeleeHitAt = currentCombatTime(options) +
    randomCombatInt(COMBAT_MIN_HIT_DELAY_MS, COMBAT_MAX_HIT_DELAY_MS, options)
}

function yawPitchToPoint (bot, point) {
  const eye = eyePosition(bot)
  const dx = point.x - eye.x
  const dy = point.y - eye.y
  const dz = point.z - eye.z
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))
  }
}

function isFacingCombatTarget (bot, target, options = {}) {
  if (typeof bot.entity?.yaw !== 'number' || typeof bot.entity?.pitch !== 'number') return false

  const targetLook = yawPitchToPoint(bot, targetHeadPosition(target))
  const maxAngle = options.attackFovRadians ?? COMBAT_ATTACK_FOV_RADIANS
  return Math.abs(normalizeAngle(bot.entity.yaw - targetLook.yaw)) <= maxAngle &&
    Math.abs(normalizeAngle(bot.entity.pitch - targetLook.pitch)) <= maxAngle
}

function notFacingAction (action) {
  return meleeWaitAction(action, 'not-facing-target')
}

function sendLegitimateAttack (bot, target) {
  if (typeof bot.swingArm === 'function') {
    bot.swingArm('right', true)
    if (typeof bot.attack === 'function') bot.attack(target, false)
    return
  }

  if (typeof bot.attack === 'function') bot.attack(target)
}

function findNearestHostileMob (bot, maxDistance = COMBAT_TARGET_RANGE) {
  return Object.values(bot.entities || {})
    .filter(isHostileMob)
    .map(entity => ({
      entity,
      distance: distanceToEntity(bot, entity)
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .map(({ entity }) => entity)[0] || null
}

function findInventoryItem (bot, matcher) {
  const items = typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
  return items.find(matcher) || null
}

function findSword (bot) {
  return findInventoryItem(bot, item => /_sword$/i.test(item.name || ''))
}

function findBow (bot) {
  return findInventoryItem(bot, item => item.name === 'bow')
}

function hasArrow (bot) {
  return Boolean(findInventoryItem(bot, item => /(^|_)arrow$/i.test(item.name || '')))
}

function targetHeadPosition (target) {
  if (typeof target.position?.offset === 'function') {
    return target.position.offset(0, target.height || 1, 0)
  }
  return target.position
}

function pointData (point) {
  return {
    x: point.x,
    y: point.y,
    z: point.z
  }
}

function eyePosition (bot) {
  const position = bot.entity?.position || { x: 0, y: 0, z: 0 }
  return {
    x: position.x,
    y: position.y + (bot.entity?.eyeHeight ?? 1.62),
    z: position.z
  }
}

function interpolatePoint (from, to, t) {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t
  }
}

function easeInOutCubic (t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function horizontalDistance (from, to) {
  return Math.sqrt(
    Math.pow(to.x - from.x, 2) +
    Math.pow(to.z - from.z, 2)
  )
}

function curvedAimPoint (from, to, easedT, rawT, curveStrength) {
  const point = interpolatePoint(from, to, easedT)
  const dx = to.x - from.x
  const dz = to.z - from.z
  const horizontal = Math.sqrt(dx * dx + dz * dz)
  if (horizontal === 0) return pointData(point)

  const curve = Math.sin(Math.PI * rawT) * curveStrength
  return {
    x: point.x + (-dz / horizontal) * curve,
    y: point.y,
    z: point.z + (dx / horizontal) * curve
  }
}

async function aimAtCombatTarget (bot, target, options = {}) {
  if (typeof bot.lookAt !== 'function') return

  const wait = options.sleep || sleep
  const targetPoint = pointData(targetHeadPosition(target))
  const startPoint = bot.__combatAimPoint || eyePosition(bot)
  const steps = randomCombatInt(
    options.minAimSteps ?? COMBAT_AIM_MIN_STEPS,
    options.maxAimSteps ?? COMBAT_AIM_MAX_STEPS,
    options
  )
  const curvePercent = randomCombatInt(
    options.minAimCurvePercent ?? COMBAT_AIM_MIN_CURVE_PERCENT,
    options.maxAimCurvePercent ?? COMBAT_AIM_MAX_CURVE_PERCENT,
    options
  )
  const curveStrength = horizontalDistance(startPoint, targetPoint) * (curvePercent / 100)

  for (let step = 1; step <= steps; step++) {
    const rawT = step / steps
    const easedT = easeInOutCubic(rawT)
    const aimPoint = step === steps
      ? targetPoint
      : curvedAimPoint(startPoint, targetPoint, easedT, rawT, curveStrength)

    await bot.lookAt(aimPoint, false)
    if (step < steps) {
      await wait(randomCombatInt(COMBAT_AIM_MIN_STEP_MS, COMBAT_AIM_MAX_STEP_MS, options))
    }
  }

  bot.__combatAimPoint = targetPoint
}

function chooseCombatAction (bot, target, options = {}) {
  if (!isHostileMob(target)) return { type: 'none' }

  const bowDistance = options.bowDistance ?? COMBAT_BOW_DISTANCE
  const distance = distanceToEntity(bot, target)
  const sword = findSword(bot)
  const bow = findBow(bot)
  const canShoot = bow && hasArrow(bot)
  const shouldUseBow = isRangedHostileMob(target) || distance >= bowDistance

  if (shouldUseBow && canShoot) {
    return { type: 'bow', target, weapon: bow, distance }
  }

  if (!shouldUseBow && sword) {
    return { type: 'sword', target, weapon: sword, distance }
  }

  if (sword && !isRangedHostileMob(target)) {
    return { type: 'sword', target, weapon: sword, distance }
  }

  if (sword && distance < bowDistance) {
    return { type: 'sword', target, weapon: sword, distance }
  }

  return { type: 'flee', target, distance }
}

function stopPathfinder (bot) {
  if (typeof bot.pathfinder?.setGoal === 'function') {
    bot.pathfinder.setGoal(null)
  }
}

function markCombatBusy (bot, options = {}) {
  bot.__combatActiveUntil = Date.now() + COMBAT_BUSY_MS
  if (options.stopPathfinder !== false) stopPathfinder(bot)
}

async function performSwordAttack (bot, action, options, debugLog) {
  const waitAction = checkMeleeHitReadiness(bot, action, options)
  if (waitAction) return waitAction

  markCombatBusy(bot)
  await bot.equip(action.weapon, 'hand')
  await aimAtCombatTarget(bot, action.target, options)
  if (!isFacingCombatTarget(bot, action.target, options)) return notFacingAction(action)
  sendLegitimateAttack(bot, action.target)
  scheduleNextMeleeHit(bot, options)
  debugLog('combat.attack', {
    mode: 'sword',
    target: action.target.name,
    distance: action.distance
  })
  return action
}

async function performBowAttack (bot, action, options, debugLog) {
  const wait = options.sleep || sleep
  const baseDrawMs = options.bowDrawMs ?? COMBAT_BOW_DRAW_MS

  markCombatBusy(bot)
  await bot.equip(action.weapon, 'hand')
  await aimAtCombatTarget(bot, action.target, options)
  bot.activateItem()
  await wait(randomizedCombatDelayMs(baseDrawMs, options))
  bot.deactivateItem()
  debugLog('combat.attack', {
    mode: 'bow',
    target: action.target.name,
    distance: action.distance
  })
}

async function fleeFromTarget (bot, action, options, debugLog) {
  const wait = options.sleep || sleep
  const baseFleeMs = options.fleeMs ?? COMBAT_FLEE_MS

  markCombatBusy(bot)
  await aimAtCombatTarget(bot, action.target, options)
  bot.setControlState('back', true)
  bot.setControlState('jump', true)
  await wait(randomizedCombatDelayMs(baseFleeMs, options))
  bot.setControlState('back', false)
  bot.setControlState('jump', false)
  debugLog('combat.flee', {
    target: action.target.name,
    distance: action.distance
  })
}

async function performPvpAttack (bot, target, options, debugLog) {
  const action = {
    type: 'pvp',
    target,
    weapon: findSword(bot) || null,
    distance: distanceToEntity(bot, target)
  }
  const waitAction = checkMeleeHitReadiness(bot, action, options)
  if (waitAction) return waitAction

  markCombatBusy(bot, { stopPathfinder: false })
  const sword = action.weapon
  if (sword) await bot.equip(sword, 'hand')
  await aimAtCombatTarget(bot, target, options)
  if (!isFacingCombatTarget(bot, target, options)) return notFacingAction(action)
  if (bot.pvp) bot.pvp.target = null
  bot.__movementPauseClearedPathfinder = false
  sendLegitimateAttack(bot, target)

  scheduleNextMeleeHit(bot, options)
  debugLog('combat.attack', {
    mode: 'pvp',
    target: target.name,
    distance: action.distance
  })

  return action
}

async function runCombatTick (bot, options = {}) {
  if (bot._ended || bot.currentWindow || bot.__nightSafetyActive || bot.isSleeping) return { type: 'none' }

  const debugLog = options.debugLog || (() => {})
  const targetFinder = options.targetFinder || findNearestHostileMob
  const target = targetFinder(bot, options.targetRange ?? COMBAT_TARGET_RANGE)

  if (!target) {
    if (bot.pvp?.target && typeof bot.pvp.stop === 'function') {
      await bot.pvp.stop()
    }
    return { type: 'none' }
  }

  if (isMovementPaused(bot, options.now?.() ?? Date.now())) {
    const action = chooseCombatAction(bot, target, options)
    if (action.type === 'sword') return performSwordAttack(bot, action, options, debugLog)
    if (action.type === 'bow') await performBowAttack(bot, action, options, debugLog)
    if (action.type === 'flee') return { type: 'paused', target, distance: action.distance }
    return action
  }

  if (typeof bot.pvp?.attack === 'function') {
    return performPvpAttack(bot, target, options, debugLog)
  }

  const action = chooseCombatAction(bot, target, options)

  if (action.type === 'sword') return performSwordAttack(bot, action, options, debugLog)
  if (action.type === 'bow') await performBowAttack(bot, action, options, debugLog)
  if (action.type === 'flee') await fleeFromTarget(bot, action, options, debugLog)

  return action
}

function attachCombat (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const intervalMs = options.intervalMs ?? COMBAT_CHECK_INTERVAL_MS
  let running = false

  const timer = setInterval(() => {
    if (running) return
    running = true
    runCombatTick(bot, options)
      .catch(err => {
        console.log('Combat error:', err.message)
        debugLog('combat.error', { message: err.message, stack: err.stack })
      })
      .finally(() => {
        running = false
      })
  }, intervalMs)

  if (typeof timer.unref === 'function') timer.unref()

  function stop () {
    clearInterval(timer)
  }

  bot.once('end', stop)
  return { stop }
}

module.exports = {
  attachCombat,
  chooseCombatAction,
  findNearestHostileMob,
  isHostileMob,
  runCombatTick
}
