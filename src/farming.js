const vec3 = require('vec3')
const { goals: { GoalNear } } = require('mineflayer-pathfinder')
const { sleep } = require('./time')

const FARMING_SEARCH_RADIUS = 32
const FARMING_COMBAT_POLL_MS = 250

const CROP_REPLANT_ITEMS = {
  wheat: 'wheat_seeds',
  carrots: 'carrot',
  potatoes: 'potato',
  beetroots: 'beetroot_seeds',
  nether_wart: 'nether_wart'
}

const CROP_MATURE_AGES = {
  wheat: 7,
  carrots: 7,
  potatoes: 7,
  beetroots: 3,
  nether_wart: 3
}

function distanceBetween (a, b) {
  if (typeof a?.distanceTo === 'function') return a.distanceTo(b)
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2) +
    Math.pow(a.z - b.z, 2)
  )
}

function blockAge (block) {
  const age = block?._properties?.age ?? block?.properties?.age
  const parsed = Number.parseInt(age, 10)
  return Number.isInteger(parsed) ? parsed : null
}

function isMatureCrop (block) {
  const matureAge = CROP_MATURE_AGES[block?.name]
  if (typeof matureAge !== 'number') return false
  return blockAge(block) >= matureAge
}

function inventoryItems (bot) {
  return typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
}

function findReplantItem (bot, cropName) {
  const itemName = CROP_REPLANT_ITEMS[cropName]
  if (!itemName) return null
  return inventoryItems(bot).find(item => item.name === itemName) || null
}

function findMatureCrops (bot, options = {}) {
  if (typeof bot.findBlocks !== 'function') return []

  const originPosition = options.originPosition || bot.entity?.position
  const searchRadius = options.searchRadius ?? FARMING_SEARCH_RADIUS
  const positions = bot.findBlocks({
    matching: block => isMatureCrop(block),
    maxDistance: searchRadius,
    count: options.cropCount ?? 64
  })

  return positions
    .map(position => bot.blockAt(position))
    .filter(Boolean)
    .filter(block => !originPosition || distanceBetween(originPosition, block.position) <= searchRadius)
    .sort((a, b) => distanceBetween(originPosition, a.position) - distanceBetween(originPosition, b.position))
}

function positionKey (position) {
  return `${position.x},${position.y},${position.z}`
}

async function goNearBlock (bot, block) {
  if (!block?.position || typeof bot.pathfinder?.goto !== 'function') return false
  await bot.pathfinder.goto(new GoalNear(block.position.x, block.position.y, block.position.z, 1))
  return true
}

function isCombatBusy (bot, options = {}) {
  const now = options.now || Date.now
  return Boolean(bot.__combatActiveUntil && bot.__combatActiveUntil > now())
}

function isInterruptedPathError (err) {
  const message = String(err?.message || '')
  return message.includes('Path was stopped before it could be completed') ||
    message.includes('The goal was changed before it could be completed')
}

function isDoorBlockedPathError (err) {
  const message = String(err?.message || '')
  return message.includes('No path to the goal') || isInterruptedPathError(err)
}

async function waitForCombatToClear (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const wait = options.sleep || sleep
  const now = options.now || Date.now
  let paused = false

  while (isCombatBusy(bot, options)) {
    if (bot._ended || options.shouldStop?.()) return false
    if (!paused) {
      debugLog('automation.farming.pausedForCombat', {
        activeUntil: bot.__combatActiveUntil
      })
      paused = true
    }

    const remainingMs = Math.max(1, bot.__combatActiveUntil - now())
    await wait(Math.min(remainingMs, options.combatPollMs ?? FARMING_COMBAT_POLL_MS))
  }

  return true
}

async function harvestAndReplantCrop (bot, crop, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const replantItem = findReplantItem(bot, crop.name)
  const referenceBlock = bot.blockAt(crop.position.offset(0, -1, 0))

  await goNearBlock(bot, crop)
  await bot.dig(crop)
  debugLog('automation.farming.harvest', {
    crop: crop.name,
    position: crop.position
  })

  if (!replantItem || !referenceBlock || typeof bot.placeBlock !== 'function') return false
  await bot.equip(replantItem, 'hand')
  await bot.placeBlock(referenceBlock, vec3(0, 1, 0))
  debugLog('automation.farming.replant', {
    crop: crop.name,
    item: replantItem.name,
    position: crop.position
  })
  return true
}

async function runFarmingTask (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const attempted = new Set()
  const doorRetries = new Set()
  let harvested = 0

  for (;;) {
    if (bot._ended || options.shouldStop?.()) break
    if (!await waitForCombatToClear(bot, options)) break
    const crop = findMatureCrops(bot, options).find(candidate => !attempted.has(positionKey(candidate.position)))
    if (!crop) break
    const cropKey = positionKey(crop.position)
    attempted.add(cropKey)

    try {
      await harvestAndReplantCrop(bot, crop, options)
      harvested++
    } catch (err) {
      debugLog('automation.farming.error', {
        crop: crop.name,
        message: err.message
      })
      if (isInterruptedPathError(err) && isCombatBusy(bot, options)) {
        attempted.delete(cropKey)
        continue
      }
      if (
        isDoorBlockedPathError(err) &&
        !doorRetries.has(cropKey) &&
        typeof options.openNearbyDoor === 'function'
      ) {
        doorRetries.add(cropKey)
        const openedDoor = await options.openNearbyDoor(bot, {
          ...options,
          originPosition: options.originPosition || bot.entity?.position
        })
        debugLog(openedDoor ? 'automation.farming.door.retry' : 'automation.farming.door.missing', {
          crop: crop.name,
          position: crop.position
        })
        if (openedDoor) {
          attempted.delete(cropKey)
          continue
        }
      }
      break
    }
  }

  debugLog('automation.farming.done', { harvested })
  return harvested
}

module.exports = {
  findMatureCrops,
  FARMING_SEARCH_RADIUS,
  harvestAndReplantCrop,
  isMatureCrop,
  runFarmingTask
}
