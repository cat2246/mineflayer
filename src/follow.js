const { goals: { GoalFollow, GoalNear } } = require('mineflayer-pathfinder')
const {
  AUTO_EAT_FOOD_THRESHOLD,
  FOLLOW_CHEST_SEARCH_RADIUS,
  FOLLOW_DISTANCE,
  FOLLOW_DROP_PICKUP_RADIUS,
  FOLLOW_INTERVAL_MS,
  FOLLOW_NOTIFY_COOLDOWN_MS,
  FOLLOW_TPA_COOLDOWN_MS
} = require('./config')
const { isMovementPaused } = require('./knockbackPause')
const { openNearbyDoor } = require('./nightSafety')

const CHEST_BLOCK_NAMES = new Set([
  'barrel',
  'chest',
  'trapped_chest'
])

function distanceToPosition (bot, position) {
  const botPosition = bot.entity?.position
  if (!botPosition || !position) return Infinity
  if (typeof botPosition.distanceTo === 'function') return botPosition.distanceTo(position)
  return Math.sqrt(
    Math.pow(botPosition.x - position.x, 2) +
    Math.pow(botPosition.y - position.y, 2) +
    Math.pow(botPosition.z - position.z, 2)
  )
}

function findOnlinePlayerName (bot, playerName) {
  if (!playerName) return null
  if (bot.players?.[playerName]) return playerName
  const requested = playerName.toLowerCase()
  return Object.keys(bot.players || {}).find(name => name.toLowerCase() === requested) || null
}

function isDroppedItem (entity) {
  const name = String(entity?.name || entity?.displayName || '').toLowerCase()
  return Boolean(entity?.position && (
    name === 'item' ||
    name === 'item_stack' ||
    entity.kind === 'Drops'
  ))
}

function inventoryItems (bot) {
  return typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
}

function inventoryEmptySlots (bot) {
  return typeof bot.inventory?.emptySlotCount === 'function' ? bot.inventory.emptySlotCount() : 0
}

function isInventoryFull (bot) {
  return inventoryEmptySlots(bot) <= 0
}

function isFoodNeeded (bot, foodThreshold) {
  return typeof bot.food === 'number' && bot.food < foodThreshold
}

function sendPrivateMessage (bot, playerName, message) {
  if (typeof bot.whisper === 'function') {
    bot.whisper(playerName, message)
    return
  }
  if (typeof bot.chat === 'function') bot.chat(`@${playerName} ${message}`)
}

function shouldPauseMovement (bot, now) {
  return Boolean(
    bot._ended ||
    bot.currentWindow ||
    bot.__autoEating ||
    bot.isSleeping ||
    isMovementPaused(bot, now) ||
    (bot.__combatActiveUntil && bot.__combatActiveUntil > now) ||
    bot.pvp?.target
  )
}

function findNearestDroppedItem (bot, maxDistance) {
  return Object.values(bot.entities || {})
    .filter(isDroppedItem)
    .map(entity => ({
      entity,
      distance: distanceToPosition(bot, entity.position)
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .map(({ entity }) => entity)[0] || null
}

function findNearbyChestBlocks (bot, maxDistance) {
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return []

  return bot.findBlocks({
    matching: block => CHEST_BLOCK_NAMES.has(block.name),
    maxDistance,
    count: 16
  })
    .map(position => bot.blockAt(position))
    .filter(Boolean)
    .map(block => ({
      block,
      distance: distanceToPosition(bot, block.position)
    }))
    .sort((a, b) => a.distance - b.distance)
    .map(({ block }) => block)
}

function findNearestChestBlock (bot, maxDistance) {
  return findNearbyChestBlocks(bot, maxDistance)[0] || null
}

function isDestinationFullError (err) {
  return /destination full/i.test(err?.message || '')
}

function createFollowController (bot, options = {}) {
  const now = options.now || (() => Date.now())
  const debugLog = options.debugLog || (() => {})
  const followDistance = options.followDistance ?? FOLLOW_DISTANCE
  const dropPickupRadius = options.dropPickupRadius ?? FOLLOW_DROP_PICKUP_RADIUS
  const tpaCooldownMs = options.tpaCooldownMs ?? FOLLOW_TPA_COOLDOWN_MS
  const notifyCooldownMs = options.notifyCooldownMs ?? FOLLOW_NOTIFY_COOLDOWN_MS
  const foodThreshold = options.foodThreshold ?? AUTO_EAT_FOOD_THRESHOLD
  const chestSearchRadius = options.chestSearchRadius ?? FOLLOW_CHEST_SEARCH_RADIUS
  const doorOpener = options.openNearbyDoor || openNearbyDoor
  const doorCheckCooldownMs = options.doorCheckCooldownMs ?? 3000
  let followedPlayerName = null
  let collectingDrop = false
  let pickupEnabled = false
  let lastTpaAt = -Infinity
  let lastDoorCheckAt = -Infinity
  const lastNotifyAt = new Map()

  function helpLines () {
    return [
      '/follow <player> - follow a player',
      '/unfollow - stop following',
      `/pickup - toggle dropped item pickup (${pickupEnabled ? 'on' : 'off'})`,
      '/unload inventory - unload carried items into a nearby chest',
      '/automation - choose an automation',
      '/automation stop - stop the active automation',
      '/home - choose a home',
      '/message <text-or-command> - send chat directly',
      '/help - show commands'
    ]
  }

  async function followPlayer (playerName) {
    const onlineName = findOnlinePlayerName(bot, playerName)
    if (!onlineName) {
      return { ok: false, message: `${playerName} is not in the server.` }
    }

    followedPlayerName = onlineName
    lastTpaAt = -Infinity
    debugLog('follow.start', { playerName: onlineName })
    return { ok: true, message: `Following ${onlineName}.` }
  }

  function unfollow () {
    if (typeof bot.pathfinder?.setGoal === 'function') bot.pathfinder.setGoal(null)
    if (followedPlayerName) debugLog('follow.stop', { playerName: followedPlayerName })
    followedPlayerName = null
    collectingDrop = false
    return { ok: true, message: 'Stopped following.' }
  }

  function togglePickup () {
    pickupEnabled = !pickupEnabled
    debugLog('follow.pickupToggle', { enabled: pickupEnabled })
    return {
      ok: true,
      enabled: pickupEnabled,
      message: `Dropped item pickup ${pickupEnabled ? 'enabled' : 'disabled'}.`
    }
  }

  function notifyIfNeeded () {
    if (!followedPlayerName) return
    const currentTime = now()

    function notifyOnce (key, message) {
      if (currentTime - (lastNotifyAt.get(key) || -Infinity) < notifyCooldownMs) return
      lastNotifyAt.set(key, currentTime)
      sendPrivateMessage(bot, followedPlayerName, message)
      debugLog('follow.notify', { playerName: followedPlayerName, key })
    }

    if (isInventoryFull(bot)) notifyOnce('inventoryFull', 'My inventory is full.')
    if (isFoodNeeded(bot, foodThreshold)) notifyOnce('foodNeeded', 'I need food.')
  }

  async function collectNearbyDrop () {
    if (collectingDrop || isInventoryFull(bot) || typeof bot.pathfinder?.goto !== 'function') return false

    const item = findNearestDroppedItem(bot, dropPickupRadius)
    if (!item) return false

    collectingDrop = true
    try {
      await bot.pathfinder.goto(new GoalNear(item.position.x, item.position.y, item.position.z, 1))
      debugLog('follow.pickup', {
        x: item.position.x,
        y: item.position.y,
        z: item.position.z
      })
      return true
    } finally {
      collectingDrop = false
    }
  }

  async function followVisiblePlayer (playerEntity, currentTime) {
    if (typeof bot.pathfinder?.setGoal !== 'function') return false
    if (distanceToPosition(bot, playerEntity.position) > followDistance + 1 &&
      currentTime - lastDoorCheckAt >= doorCheckCooldownMs) {
      lastDoorCheckAt = currentTime
      await doorOpener(bot, {
        debugLog,
        originPosition: bot.entity?.position,
        searchRadius: options.doorSearchRadius ?? 4
      })
    }
    bot.pathfinder.setGoal(new GoalFollow(playerEntity, followDistance), true)
    debugLog('follow.goal', { playerName: followedPlayerName })
    return true
  }

  function requestTeleport () {
    const currentTime = now()
    if (currentTime - lastTpaAt < tpaCooldownMs) return false
    lastTpaAt = currentTime
    if (typeof bot.chat === 'function') bot.chat(`/tpa ${followedPlayerName}`)
    debugLog('follow.tpa', { playerName: followedPlayerName })
    return true
  }

  async function tick () {
    if (!followedPlayerName || bot._ended) return { type: 'none' }

    notifyIfNeeded()
    const currentTime = now()
    if (shouldPauseMovement(bot, currentTime)) return { type: 'paused' }

    if (pickupEnabled && await collectNearbyDrop()) return { type: 'pickup' }

    const player = bot.players?.[followedPlayerName]
    if (!player) return { type: 'missing' }
    if (player.entity?.position) {
      await followVisiblePlayer(player.entity, currentTime)
      return { type: 'follow' }
    }

    requestTeleport()
    return { type: 'tpa' }
  }

  async function unloadInventory () {
    const items = inventoryItems(bot).filter(item => item && item.count > 0)
    if (items.length === 0) return { ok: false, message: 'Inventory is already empty.' }

    const chests = findNearbyChestBlocks(bot, chestSearchRadius)
    if (chests.length === 0) return { ok: false, message: 'No nearby chest found.' }

    if (typeof bot.openContainer !== 'function') return { ok: false, message: 'Cannot open nearby chest.' }

    let triedFullChest = false
    for (const chest of chests) {
      if (typeof bot.pathfinder?.goto === 'function' && distanceToPosition(bot, chest.position) > 4) {
        await bot.pathfinder.goto(new GoalNear(chest.position.x, chest.position.y, chest.position.z, 2))
      }

      const container = await bot.openContainer(chest)
      try {
        const currentItems = inventoryItems(bot).filter(item => item && item.count > 0)
        if (currentItems.length === 0) return { ok: true, message: 'Unloaded inventory.' }
        for (const item of currentItems) {
          await container.deposit(item.type, item.metadata ?? null, item.count)
        }
        debugLog('follow.unload', { itemCount: currentItems.length })
        return { ok: true, message: 'Unloaded inventory.' }
      } catch (err) {
        if (!isDestinationFullError(err)) throw err
        triedFullChest = true
        debugLog('follow.unload.fullChest', {
          x: chest.position.x,
          y: chest.position.y,
          z: chest.position.z
        })
      } finally {
        if (typeof container.close === 'function') container.close()
      }
    }

    return {
      ok: false,
      message: triedFullChest
        ? 'Nearby chests are full. Some items were not unloaded.'
        : 'Could not unload inventory.'
    }
  }

  return {
    followPlayer,
    helpLines,
    tick,
    togglePickup,
    unfollow,
    unloadInventory
  }
}

function attachFollowController (bot, options = {}) {
  const controller = createFollowController(bot, options)
  const intervalMs = options.intervalMs ?? FOLLOW_INTERVAL_MS
  let running = false

  const timer = setInterval(() => {
    if (running) return
    running = true
    controller.tick()
      .catch(err => {
        console.log('Follow error:', err.message)
        ;(options.debugLog || (() => {}))('follow.error', { message: err.message, stack: err.stack })
      })
      .finally(() => {
        running = false
      })
  }, intervalMs)

  if (typeof timer.unref === 'function') timer.unref()

  function stop () {
    clearInterval(timer)
    controller.unfollow()
  }

  bot.once?.('end', stop)
  bot.once?.('kicked', stop)

  return {
    ...controller,
    stop
  }
}

module.exports = {
  attachFollowController,
  createFollowController,
  findNearbyChestBlocks,
  findNearestChestBlock,
  findNearestDroppedItem
}
