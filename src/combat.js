const {
  COMBAT_BOW_DISTANCE,
  COMBAT_BOW_DRAW_MS,
  COMBAT_CHECK_INTERVAL_MS,
  COMBAT_FLEE_MS,
  COMBAT_TARGET_RANGE
} = require('./config')
const { sleep } = require('./time')

const COMBAT_BUSY_MS = 3000

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

async function performSwordAttack (bot, action, debugLog) {
  markCombatBusy(bot)
  await bot.equip(action.weapon, 'hand')
  await bot.lookAt(targetHeadPosition(action.target), true)
  bot.attack(action.target)
  debugLog('combat.attack', {
    mode: 'sword',
    target: action.target.name,
    distance: action.distance
  })
}

async function performBowAttack (bot, action, options, debugLog) {
  const wait = options.sleep || sleep
  const drawMs = options.bowDrawMs ?? COMBAT_BOW_DRAW_MS

  markCombatBusy(bot)
  await bot.equip(action.weapon, 'hand')
  await bot.lookAt(targetHeadPosition(action.target), true)
  bot.activateItem()
  await wait(drawMs)
  bot.deactivateItem()
  debugLog('combat.attack', {
    mode: 'bow',
    target: action.target.name,
    distance: action.distance
  })
}

async function fleeFromTarget (bot, action, options, debugLog) {
  const wait = options.sleep || sleep
  const fleeMs = options.fleeMs ?? COMBAT_FLEE_MS

  markCombatBusy(bot)
  await bot.lookAt(targetHeadPosition(action.target), true)
  bot.setControlState('back', true)
  bot.setControlState('jump', true)
  await wait(fleeMs)
  bot.setControlState('back', false)
  bot.setControlState('jump', false)
  debugLog('combat.flee', {
    target: action.target.name,
    distance: action.distance
  })
}

async function performPvpAttack (bot, target, debugLog) {
  markCombatBusy(bot, { stopPathfinder: false })
  const sword = findSword(bot)
  if (sword) await bot.equip(sword, 'hand')

  if (bot.pvp.target !== target) {
    bot.pvp.attack(target)
  }

  debugLog('combat.attack', {
    mode: 'pvp',
    target: target.name,
    distance: distanceToEntity(bot, target)
  })

  return {
    type: 'pvp',
    target,
    weapon: sword || null,
    distance: distanceToEntity(bot, target)
  }
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

  if (typeof bot.pvp?.attack === 'function') {
    return performPvpAttack(bot, target, debugLog)
  }

  const action = chooseCombatAction(bot, target, options)

  if (action.type === 'sword') await performSwordAttack(bot, action, debugLog)
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
