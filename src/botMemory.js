const path = require('path')

const { BOT_MEMORY_ROOT } = require('./config')

function sanitizeBotId (value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return text || 'unknown-bot'
}

function resolveBotId (bot, options = {}) {
  return sanitizeBotId(
    options.botId ||
    bot?.profile?.id ||
    bot?.username ||
    options.username ||
    'unknown-bot'
  )
}

function resolveBotMemoryRoot (bot, options = {}) {
  const root = options.botMemoryRoot || BOT_MEMORY_ROOT
  return path.join(root, resolveBotId(bot, options))
}

function resolveBotMemoryPaths (bot, options = {}) {
  const botId = resolveBotId(bot, options)
  const root = path.join(options.botMemoryRoot || BOT_MEMORY_ROOT, botId)

  return {
    botId,
    root,
    chatMemoryPath: path.join(root, 'memory.md'),
    npcLifePath: path.join(root, 'npc-life.json'),
    placesPath: path.join(root, 'places.json'),
    containersPath: path.join(root, 'containers.json'),
    containerMemoryPath: path.join(root, 'containers.json'),
    pyroFarmMemoryPath: path.join(root, 'pyro-farming.json'),
    learnedRecipesPath: path.join(root, 'learned-recipes.json'),
    projectsPath: path.join(root, 'projects.json'),
    playersPath: path.join(root, 'players.json'),
    craftingPath: path.join(root, 'crafting.json'),
    buildingPath: path.join(root, 'building.json'),
    cookingPath: path.join(root, 'cooking.json'),
    missingToolsPath: path.join(root, 'missing-tools.json'),
    memorySummaryPath: path.join(root, 'memory-summary.json'),
    eventLogPath: path.join(root, 'event-log.jsonl'),
    journalPath: path.join(root, 'daily-journal.md'),
    debugLogPath: path.join(root, 'debug.log')
  }
}

module.exports = {
  resolveBotId,
  resolveBotMemoryPaths,
  resolveBotMemoryRoot,
  sanitizeBotId
}
