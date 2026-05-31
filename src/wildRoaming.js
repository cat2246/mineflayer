const { goals: { GoalNear, GoalNearXZ } } = require('mineflayer-pathfinder')
const vec3 = require('vec3')
const {
  WOODCUTTING_LOOP_DELAY_MS,
  WOODCUTTING_ROAM_RADIUS
} = require('./config')
const { readPlaceCoordinates } = require('./places')
const { sleep } = require('./time')

const PASSIVE_MOB_NAMES = new Set([
  'chicken',
  'cow',
  'mooshroom',
  'pig',
  'rabbit',
  'sheep'
])
const HOUSE_PROTECTED_MOB_NAMES = new Set([
  'chicken',
  'cow',
  'dog',
  'sheep',
  'wolf'
])
const OWNED_MOB_MESSAGE_RE = /^That belongs to .+\.$/

function distanceBetween (a, b) {
  if (typeof a?.distanceTo === 'function') return a.distanceTo(b)
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

function horizontalDistanceBetween (a, b) {
  if (!a || !b) return 0
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

function positionData (position) {
  if (!position) return null
  return {
    x: position.x,
    y: position.y,
    z: position.z
  }
}

function isPassiveMob (entity) {
  return Boolean(
    entity &&
    (entity.type === 'mob' || entity.type === 'animal' || entity.type === 'passive') &&
    PASSIVE_MOB_NAMES.has(String(entity.name || '').toLowerCase())
  )
}

function sameBlockPosition (a, b) {
  return Math.floor(a?.x) === Math.floor(b?.x) &&
    Math.floor(a?.y) === Math.floor(b?.y) &&
    Math.floor(a?.z) === Math.floor(b?.z)
}

function entityEyePosition (bot) {
  const position = bot.entity?.position
  if (!position) return null
  return vec3(position.x, position.y + (bot.entity.eyeHeight ?? 1.62), position.z)
}

function targetLookPosition (target) {
  return vec3(
    target.position.x,
    target.position.y + ((target.height || 1.4) / 2),
    target.position.z
  )
}

function inventoryItems (bot) {
  return typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
}

function findSword (bot) {
  return inventoryItems(bot).find(item => /_sword$/i.test(item.name || '')) || null
}

function messageText (message) {
  if (typeof message === 'string') return message
  if (typeof message?.toString === 'function') return message.toString()
  return ''
}

function isOwnedMobMessage (message) {
  return OWNED_MOB_MESSAGE_RE.test(messageText(message))
}

function stopPassiveMobAttacks (bot, message, options = {}) {
  const debugLog = options.debugLog || (() => {})
  bot.__wildRoamingPassiveMobAttacksBlocked = true
  if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)
  if (typeof bot.pvp?.stop === 'function') bot.pvp.stop()
  debugLog('automation.wildRoaming.ownedMob', { message: messageText(message) })
}

function attachOwnedMobMessageHandler (bot, options = {}) {
  bot.__wildRoamingOwnedMobDebugLog = options.debugLog || (() => {})
  if (bot.__wildRoamingOwnedMobMessageHandler || typeof bot.on !== 'function') return

  bot.__wildRoamingOwnedMobMessageHandler = (message) => {
    if (!isOwnedMobMessage(message)) return
    stopPassiveMobAttacks(bot, message, {
      debugLog: bot.__wildRoamingOwnedMobDebugLog
    })
  }
  bot.on('message', bot.__wildRoamingOwnedMobMessageHandler)
}

function findPassiveMobBeyondHomeRadius (bot, originPosition, options = {}) {
  const minimumHuntDistance = options.minimumHuntDistance ?? 100
  return Object.values(bot.entities || {})
    .filter(isPassiveMob)
    .filter(entity => !isPassiveMobProtectedNearHome(entity, originPosition, options))
    .filter(entity => entity.position && distanceBetween(originPosition, entity.position) >= minimumHuntDistance)
    .sort((a, b) => distanceBetween(bot.entity.position, a.position) - distanceBetween(bot.entity.position, b.position))[0] || null
}

function savedHomePosition (bot, options = {}) {
  return readPlaceCoordinates('home', options)?.position ||
    bot.__containerHomeAnchor ||
    bot.__nightSafetyHomeAnchor ||
    options.originPosition ||
    bot.entity?.position ||
    null
}

function isProtectedHouseMob (entity) {
  return HOUSE_PROTECTED_MOB_NAMES.has(String(entity?.name || '').toLowerCase())
}

function isInsideHouseProtectionArea (position, homePosition, options = {}) {
  if (!position || !homePosition) return false
  const range = options.homeProtectionRange ?? 50
  return Math.abs(position.x - homePosition.x) <= range &&
    Math.abs(position.z - homePosition.z) <= range
}

function isPassiveMobProtectedNearHome (entity, homePosition, options = {}) {
  return isProtectedHouseMob(entity) && isInsideHouseProtectionArea(entity.position, homePosition, options)
}

function passiveMobRaycast (bot, target, options = {}) {
  if (options.checkPassiveMobLineOfSight === false) return { visible: true, hit: null }
  if (typeof bot.world?.raycast !== 'function') return { visible: true, hit: null }

  const eye = entityEyePosition(bot)
  if (!eye || !target?.position) return { visible: true, hit: null }
  const targetPoint = targetLookPosition(target)
  const direction = targetPoint.minus(eye)
  const range = Math.sqrt(
    Math.pow(direction.x, 2) +
    Math.pow(direction.y, 2) +
    Math.pow(direction.z, 2)
  )
  if (range <= 0) return { visible: true, hit: null }

  const hit = bot.world.raycast(eye, direction.scaled(1 / range), range + 0.25)
  return {
    hit,
    visible: !hit || sameBlockPosition(hit.position, target.position)
  }
}

async function attackPassiveMob (bot, target, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (!target) return false
  if (typeof bot.pathfinder?.goto === 'function') {
    await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2))
  }

  if (typeof bot.lookAt === 'function') await bot.lookAt(targetLookPosition(target), true)
  const lineOfSight = passiveMobRaycast(bot, target, options)
  if (!lineOfSight.visible) {
    const blocker = lineOfSight.hit
    debugLog('automation.wildRoaming.blockedLineOfSight', {
      target: target.name,
      blocker: blocker?.name || blocker?.displayName || blocker?.position
    })
    return false
  }

  const sword = findSword(bot)
  if (sword && typeof bot.equip === 'function') await bot.equip(sword, 'hand')
  if (typeof bot.attack === 'function') bot.attack(target)

  debugLog('automation.wildRoaming.attack', {
    target: target.name,
    position: target.position
  })
  return true
}

function pickOutwardRoamTarget (bot, originPosition, options = {}) {
  const random = options.random || Math.random
  const currentPosition = bot.entity?.position || originPosition
  const currentDistance = horizontalDistanceBetween(originPosition, currentPosition)
  const previousDistance = bot.__wildRoamingExploreDistance || 0
  const minimumDistance = options.minimumHuntDistance ?? 100
  const stepDistance = options.exploreStepDistance ?? options.roamRadius ?? WOODCUTTING_ROAM_RADIUS
  const distance = options.roamDistance ?? (Math.max(currentDistance, previousDistance, minimumDistance) + stepDistance)
  const dx = currentPosition.x - originPosition.x
  const dz = currentPosition.z - originPosition.z
  const currentAngle = horizontalDistanceBetween(originPosition, currentPosition) > 1
    ? Math.atan2(dz, dx)
    : null
  const angle = Number.isFinite(options.roamAngle)
    ? options.roamAngle
    : currentAngle ?? bot.__wildRoamingExploreAngle ?? (random() * Math.PI * 2)
  const x = Math.round(originPosition.x + Math.cos(angle) * distance)
  const z = Math.round(originPosition.z + Math.sin(angle) * distance)
  return {
    x,
    y: originPosition.y,
    z,
    angle,
    distanceFromHome: Math.round(distance)
  }
}

async function roamOutward (bot, originPosition, options = {}) {
  const target = options.roamTarget || pickOutwardRoamTarget(bot, originPosition, options)
  if (typeof bot.pathfinder?.goto !== 'function') return false
  await bot.pathfinder.goto(new GoalNearXZ(target.x, target.z, 8))
  bot.__wildRoamingLastRoamTarget = target
  bot.__wildRoamingLastRoamDistanceFromHome = Math.round(horizontalDistanceBetween(originPosition, target))
  if (!options.roamTarget) {
    bot.__wildRoamingExploreAngle = target.angle
    bot.__wildRoamingExploreDistance = target.distanceFromHome
  }
  return true
}

async function runWildRoamingTask (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const originPosition = savedHomePosition(bot, options)
  if (!originPosition) return false

  attachOwnedMobMessageHandler(bot, { debugLog })
  const protectedMob = Object.values(bot.entities || {})
    .filter(isPassiveMob)
    .find(entity => isPassiveMobProtectedNearHome(entity, originPosition, options))
  if (protectedMob) {
    debugLog('automation.wildRoaming.protectedMob', {
      name: protectedMob.name,
      position: protectedMob.position
    })
  }
  const target = bot.__wildRoamingPassiveMobAttacksBlocked ? null : findPassiveMobBeyondHomeRadius(bot, originPosition, options)
  if (target) return attackPassiveMob(bot, target, options)

  if (bot._ended || options.shouldStop?.()) return false
  const roamed = await roamOutward(bot, originPosition, options)
  if (roamed) {
    debugLog('automation.wildRoaming.roam', {
      position: positionData(bot.__wildRoamingLastRoamTarget),
      distanceFromHome: bot.__wildRoamingLastRoamDistanceFromHome
    })
    await wait(options.loopDelayMs ?? WOODCUTTING_LOOP_DELAY_MS)
  }
  return roamed
}

module.exports = {
  attackPassiveMob,
  findPassiveMobBeyondHomeRadius,
  isOwnedMobMessage,
  isPassiveMob,
  runWildRoamingTask
}
