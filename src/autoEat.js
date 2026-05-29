const {
  AUTO_EAT_FOOD_THRESHOLD,
  AUTO_EAT_HEALTH_THRESHOLD
} = require('./config')

const UNSAFE_FOOD_NAMES = new Set([
  'chicken',
  'chorus_fruit',
  'poisonous_potato',
  'pufferfish',
  'rotten_flesh',
  'spider_eye',
  'suspicious_stew'
])

const HEALING_FOOD_NAMES = new Set([
  'enchanted_golden_apple',
  'golden_apple'
])

function foodInfoForItem (bot, item) {
  if (!item?.name) return null
  return bot.registry?.foodsByName?.[item.name] || null
}

function foodScore (bot, item) {
  const foodInfo = foodInfoForItem(bot, item)
  if (!foodInfo) return 0
  return foodInfo.effectiveQuality ?? ((foodInfo.foodPoints || 0) + (foodInfo.saturation || 0))
}

function isSafeFoodItem (bot, item) {
  return Boolean(foodInfoForItem(bot, item) && !UNSAFE_FOOD_NAMES.has(item.name))
}

function sortFoodByValue (bot, foods) {
  return [...foods].sort((a, b) => foodScore(bot, b) - foodScore(bot, a))
}

function shouldAutoEat (bot, options = {}) {
  if (bot._ended || bot.health <= 0) return false
  if (bot.game?.gameMode === 'creative') return false

  const foodThreshold = options.foodThreshold ?? AUTO_EAT_FOOD_THRESHOLD
  const healthThreshold = options.healthThreshold ?? AUTO_EAT_HEALTH_THRESHOLD
  const food = typeof bot.food === 'number' ? bot.food : foodThreshold
  const health = typeof bot.health === 'number' ? bot.health : 20

  return food < foodThreshold || health <= healthThreshold
}

function findFoodToEat (bot, options = {}) {
  if (!shouldAutoEat(bot, options)) return null

  const foodThreshold = options.foodThreshold ?? AUTO_EAT_FOOD_THRESHOLD
  const food = typeof bot.food === 'number' ? bot.food : foodThreshold
  const healthThreshold = options.healthThreshold ?? AUTO_EAT_HEALTH_THRESHOLD
  const health = typeof bot.health === 'number' ? bot.health : 20
  const hungerNeedsFood = food < foodThreshold
  const healthLow = health <= healthThreshold
  const foods = (typeof bot.inventory?.items === 'function' ? bot.inventory.items() : [])
    .filter(item => isSafeFoodItem(bot, item))

  if (healthLow) {
    const healingFood = sortFoodByValue(bot, foods.filter(item => HEALING_FOOD_NAMES.has(item.name)))[0]
    if (healingFood) return healingFood
  }

  if (!hungerNeedsFood) return null

  const normalFoods = foods.filter(item => !HEALING_FOOD_NAMES.has(item.name))
  return sortFoodByValue(bot, normalFoods)[0] || sortFoodByValue(bot, foods)[0] || null
}

async function runAutoEat (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (bot.__autoEating || bot.usingHeldItem) return false

  const food = findFoodToEat(bot, options)
  if (!food) {
    if (shouldAutoEat(bot, options)) {
      debugLog('autoeat.noFood', {
        health: bot.health,
        food: bot.food
      })
    }
    return false
  }

  bot.__autoEating = true
  try {
    if (typeof bot.pathfinder?.setGoal === 'function') {
      bot.pathfinder.setGoal(null)
    }

    if (typeof bot.setControlState === 'function') {
      bot.setControlState('sprint', false)
      bot.setControlState('jump', false)
    }

    await bot.equip(food, 'hand')
    debugLog('autoeat.start', {
      item: food.name,
      health: bot.health,
      food: bot.food
    })
    await bot.consume()
    debugLog('autoeat.done', {
      item: food.name,
      health: bot.health,
      food: bot.food
    })
    return true
  } catch (err) {
    debugLog('autoeat.error', {
      item: food.name,
      message: err.message
    })
    return false
  } finally {
    bot.__autoEating = false
  }
}

function attachAutoEat (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const eat = options.runAutoEat || runAutoEat

  function checkAutoEat () {
    Promise.resolve(eat(bot, options)).catch(err => {
      debugLog('autoeat.error', { message: err.message })
    })
  }

  bot.on('health', checkAutoEat)
  bot.on('spawn', checkAutoEat)

  return {
    check: checkAutoEat
  }
}

module.exports = {
  attachAutoEat,
  findFoodToEat,
  runAutoEat,
  shouldAutoEat
}
