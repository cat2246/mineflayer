const { goals: { GoalNear, GoalNearXZ } } = require('mineflayer-pathfinder')
const {
  WOODCUTTING_LOOP_DELAY_MS,
  WOODCUTTING_ROAM_RADIUS
} = require('./config')
const { sleep } = require('./time')

const PASSIVE_MOB_NAMES = new Set([
  'chicken',
  'cow',
  'mooshroom',
  'pig',
  'rabbit',
  'sheep'
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

function isPassiveMob (entity) {
  return Boolean(
    entity &&
    (entity.type === 'mob' || entity.type === 'animal' || entity.type === 'passive') &&
    PASSIVE_MOB_NAMES.has(String(entity.name || '').toLowerCase())
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
    .filter(entity => entity.position && distanceBetween(originPosition, entity.position) >= minimumHuntDistance)
    .sort((a, b) => distanceBetween(bot.entity.position, a.position) - distanceBetween(bot.entity.position, b.position))[0] || null
}

async function attackPassiveMob (bot, target, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (!target) return false
  if (typeof bot.pathfinder?.goto === 'function') {
    await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2))
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
  const distance = options.roamDistance ?? ((options.minimumHuntDistance ?? 100) + (options.roamRadius ?? WOODCUTTING_ROAM_RADIUS))
  const angle = random() * Math.PI * 2
  const x = Math.round(originPosition.x + Math.cos(angle) * distance)
  const z = Math.round(originPosition.z + Math.sin(angle) * distance)
  return { x, y: originPosition.y, z }
}

async function roamOutward (bot, originPosition, options = {}) {
  const target = options.roamTarget || pickOutwardRoamTarget(bot, originPosition, options)
  if (typeof bot.pathfinder?.goto !== 'function') return false
  await bot.pathfinder.goto(new GoalNearXZ(target.x, target.z, 8))
  return true
}

async function runWildRoamingTask (bot, options = {}) {
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || (() => {})
  const originPosition = options.originPosition || bot.entity?.position
  if (!originPosition) return false

  attachOwnedMobMessageHandler(bot, { debugLog })
  const target = bot.__wildRoamingPassiveMobAttacksBlocked ? null : findPassiveMobBeyondHomeRadius(bot, originPosition, options)
  if (target) return attackPassiveMob(bot, target, options)

  if (bot._ended || options.shouldStop?.()) return false
  const roamed = await roamOutward(bot, originPosition, options)
  if (roamed) {
    debugLog('automation.wildRoaming.roam')
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
