const fs = require('fs')
const path = require('path')
const { NPC_LIFE_PATH } = require('./config')

const NPC_LIFE_VERSION = 1
const MAX_RECENT_EVENTS = 30
const MAX_LIFE_STORY = 12

const DEFAULT_TRAITS = {
  curious: 25,
  cautious: 25,
  social: 20,
  independent: 30,
  ambitious: 20
}

const DEFAULT_LIFESTYLES = {
  survivalist: 40,
  homesteader: 25,
  explorer: 20,
  miner: 15,
  trader: 10,
  protector: 10
}

function clampScore (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

function normalizeScores (value, defaults) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => [
    name,
    clampScore(Object.prototype.hasOwnProperty.call(input, name) ? input[name] : fallback)
  ]))
}

function cleanString (value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, maxLength)
}

function cleanOptionalString (value, maxLength) {
  return cleanString(value, null, maxLength)
}

function defaultGoal (now = Date.now()) {
  return {
    id: 'survive-and-settle',
    title: 'Survive and find a stable routine',
    reason: 'The NPC is new and needs food, safety, and a sense of home.',
    priority: 'safety',
    selectedAt: now,
    suggestedAutomations: ['Wood cutting', 'Farming']
  }
}

function emptyNpcLife (options = {}) {
  const now = options.now ? options.now() : Date.now()
  return {
    version: NPC_LIFE_VERSION,
    identity: {
      name: null,
      origin: 'new survival NPC',
      selfImage: 'I am learning what kind of life I want in this world.'
    },
    traits: { ...DEFAULT_TRAITS },
    lifestyles: { ...DEFAULT_LIFESTYLES },
    currentLifestyle: 'survivalist',
    previousLifestyle: null,
    currentGoal: defaultGoal(now),
    recentEvents: [],
    lifeStory: ['I arrived with no settled purpose yet.'],
    updatedAt: now
  }
}

function normalizeGoal (goal, fallback) {
  if (!goal || typeof goal !== 'object' || !cleanOptionalString(goal.id, 80)) return fallback

  return {
    id: cleanString(goal.id, fallback.id, 80),
    title: cleanString(goal.title, fallback.title, 120),
    reason: cleanString(goal.reason, fallback.reason, 220),
    priority: cleanString(goal.priority, fallback.priority, 60),
    selectedAt: typeof goal.selectedAt === 'number' && Number.isFinite(goal.selectedAt)
      ? goal.selectedAt
      : fallback.selectedAt,
    suggestedAutomations: Array.isArray(goal.suggestedAutomations)
      ? goal.suggestedAutomations
        .filter(automation => typeof automation === 'string' && automation.trim())
        .map(automation => automation.trim().slice(0, 80))
      : fallback.suggestedAutomations
  }
}

function normalizeNpcLife (life, options = {}) {
  const base = emptyNpcLife(options)
  if (!life || typeof life !== 'object' || Array.isArray(life)) return base

  const lifestyles = normalizeScores(life.lifestyles, DEFAULT_LIFESTYLES)
  const currentLifestyle = Object.prototype.hasOwnProperty.call(lifestyles, life.currentLifestyle)
    ? life.currentLifestyle
    : base.currentLifestyle

  return {
    version: NPC_LIFE_VERSION,
    identity: {
      name: cleanOptionalString(life.identity?.name, 80),
      origin: cleanString(life.identity?.origin, base.identity.origin, 120),
      selfImage: cleanString(life.identity?.selfImage, base.identity.selfImage, 180)
    },
    traits: normalizeScores(life.traits, DEFAULT_TRAITS),
    lifestyles,
    currentLifestyle,
    previousLifestyle: Object.prototype.hasOwnProperty.call(lifestyles, life.previousLifestyle)
      ? life.previousLifestyle
      : null,
    currentGoal: normalizeGoal(life.currentGoal, base.currentGoal),
    recentEvents: Array.isArray(life.recentEvents)
      ? life.recentEvents.filter(event => event && typeof event === 'object' && !Array.isArray(event)).slice(-MAX_RECENT_EVENTS)
      : [],
    lifeStory: Array.isArray(life.lifeStory)
      ? life.lifeStory
        .filter(entry => typeof entry === 'string' && entry.trim())
        .map(entry => entry.trim().slice(0, 180))
        .slice(-MAX_LIFE_STORY)
      : base.lifeStory,
    updatedAt: typeof life.updatedAt === 'number' && Number.isFinite(life.updatedAt)
      ? life.updatedAt
      : base.updatedAt
  }
}

function npcLifePath (options = {}) {
  if (options.npcLifePath === false) return null
  return options.npcLifePath || NPC_LIFE_PATH
}

function readNpcLife (options = {}) {
  const filePath = npcLifePath(options)
  if (!filePath || !fs.existsSync(filePath)) return emptyNpcLife(options)

  try {
    return normalizeNpcLife(JSON.parse(fs.readFileSync(filePath, 'utf8')), options)
  } catch (err) {
    return emptyNpcLife(options)
  }
}

function writeNpcLife (life, options = {}) {
  const filePath = npcLifePath(options)
  if (!filePath) return

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(normalizeNpcLife(life, options), null, 2)}\n`)
  } catch (err) {
    // NPC life memory is advisory; gameplay should continue if persistence is unavailable.
  }
}

function updateNpcLife (options, updater) {
  const life = readNpcLife(options)
  const nextLife = normalizeNpcLife(updater(life) || life, options)
  writeNpcLife(nextLife, options)
  return nextLife
}

module.exports = {
  DEFAULT_LIFESTYLES,
  DEFAULT_TRAITS,
  MAX_LIFE_STORY,
  MAX_RECENT_EVENTS,
  NPC_LIFE_VERSION,
  clampScore,
  defaultGoal,
  emptyNpcLife,
  normalizeGoal,
  normalizeNpcLife,
  normalizeScores,
  npcLifePath,
  readNpcLife,
  updateNpcLife,
  writeNpcLife
}
