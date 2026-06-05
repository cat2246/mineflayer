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

function normalizeGoal (goal, fallback = defaultGoal(0)) {
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

function applyScoreDelta (scores, deltas) {
  const next = { ...scores }
  for (const [key, delta] of Object.entries(deltas || {})) {
    if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = clampScore(next[key] + delta)
  }
  return next
}

function eventDeltas (event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return {}

  if (event.type === 'automation_started') {
    const automation = String(event.automation || '').toLowerCase()
    if (automation === 'farming' || automation === 'wood cutting') return { lifestyles: { homesteader: 5 }, traits: { ambitious: 1 } }
    if (automation === 'mining') return { lifestyles: { miner: 5 }, traits: { ambitious: 1 } }
    if (automation === 'wild roaming') return { lifestyles: { explorer: 5 }, traits: { curious: 2 } }
    if (automation === 'pyro farming') return { lifestyles: { homesteader: 3 }, traits: { ambitious: 2 } }
  }
  if (event.type === 'follow_started' || event.type === 'player_nearby') return { lifestyles: { protector: 1 }, traits: { social: 3 } }
  if (event.type === 'night' || event.type === 'low_food' || event.type === 'unsafe') return { lifestyles: { survivalist: 3 }, traits: { cautious: 3 } }
  if (event.type === 'planner_noop') return { traits: { cautious: 1 } }
  return {}
}

function updateLifestyleTransition (life) {
  const entries = Object.entries(life.lifestyles).sort((a, b) => b[1] - a[1])
  const [candidate, candidateScore] = entries[0]
  const currentScore = life.lifestyles[life.currentLifestyle] || 0
  if (candidate === life.currentLifestyle || candidateScore < currentScore + 10) return life

  return {
    ...life,
    previousLifestyle: life.currentLifestyle,
    currentLifestyle: candidate,
    lifeStory: [
      ...life.lifeStory,
      `I started living more like a ${candidate} after repeated experiences shaped my routine.`
    ].slice(-MAX_LIFE_STORY)
  }
}

function normalizeNpcLife (life, options = {}) {
  const base = emptyNpcLife(options)
  if (!life || typeof life !== 'object' || Array.isArray(life)) return base

  const lifestyles = normalizeScores(life.lifestyles, DEFAULT_LIFESTYLES)
  const currentLifestyle = Object.prototype.hasOwnProperty.call(lifestyles, life.currentLifestyle)
    ? life.currentLifestyle
    : base.currentLifestyle
  const updatedAt = typeof life.updatedAt === 'number' && Number.isFinite(life.updatedAt)
    ? life.updatedAt
    : base.updatedAt

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
      ? life.recentEvents
        .filter(event => event && typeof event === 'object' && !Array.isArray(event))
        .slice(-MAX_RECENT_EVENTS)
        .map(event => normalizeRecentEvent(event, updatedAt))
      : [],
    lifeStory: Array.isArray(life.lifeStory)
      ? life.lifeStory
        .filter(entry => typeof entry === 'string' && entry.trim())
        .map(entry => entry.trim().slice(0, 180))
        .slice(-MAX_LIFE_STORY)
      : base.lifeStory,
    updatedAt
  }
}

function normalizeRecentEvent (event, now) {
  const input = event && typeof event === 'object' && !Array.isArray(event) ? event : {}
  const next = {
    type: cleanString(input.type, 'unknown', 80),
    at: typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : now
  }

  for (const key of ['automation', 'player', 'reason']) {
    const value = cleanOptionalString(input[key], key === 'reason' ? 180 : 80)
    if (value) next[key] = value
  }

  return next
}

function applyNpcLifeEvent (life, event, options = {}) {
  const now = options.now ? options.now() : Date.now()
  const current = normalizeNpcLife(life, options)
  const deltas = eventDeltas(event || {})
  const nextLife = updateLifestyleTransition({
    ...current,
    traits: applyScoreDelta(current.traits, deltas.traits),
    lifestyles: applyScoreDelta(current.lifestyles, deltas.lifestyles),
    recentEvents: [
      ...current.recentEvents,
      normalizeRecentEvent(event, now)
    ].slice(-MAX_RECENT_EVENTS),
    updatedAt: now
  })
  return normalizeNpcLife(nextLife, options)
}

function goalFor (id, title, reason, priority, suggestedAutomations, now) {
  return normalizeGoal({
    id,
    title,
    reason,
    priority,
    selectedAt: now,
    suggestedAutomations
  })
}

function chooseNpcGoal (life, context = {}, options = {}) {
  const now = options.now ? options.now() : Date.now()
  const current = normalizeNpcLife(life, options)

  if (context.unsafe || context.isNight) {
    return goalFor(
      'stay-safe-until-morning',
      'Stay safe until morning',
      'The world is dangerous right now, so safety comes first.',
      'safety',
      [],
      now
    )
  }

  if (typeof context.food === 'number' && context.food < 12) {
    return goalFor(
      'secure-food',
      'Secure food',
      'Food is running low, so the NPC should rebuild a reliable supply.',
      'survival',
      ['Farming'],
      now
    )
  }

  if (current.currentLifestyle === 'homesteader') {
    return goalFor(
      'improve-home-routine',
      'Improve the home routine',
      'A homesteader grows by making daily home work more reliable.',
      'progress',
      ['Farming', 'Wood cutting', 'Pyro Farming'],
      now
    )
  }

  if (current.currentLifestyle === 'explorer') {
    return goalFor(
      'map-nearby-area',
      'Map nearby area',
      'An explorer needs a clearer picture of nearby places and paths.',
      'curiosity',
      ['Wild roaming'],
      now
    )
  }

  if (current.currentLifestyle === 'miner') {
    return goalFor(
      'gather-underground-resources',
      'Gather underground resources',
      'A miner advances by bringing useful materials back from below.',
      'progress',
      ['Mining'],
      now
    )
  }

  if (current.currentLifestyle === 'trader') {
    return goalFor(
      'build-surplus-for-trading',
      'Build surplus for trading',
      'A trader needs extra goods before useful exchanges can happen.',
      'social',
      ['Farming', 'Mining'],
      now
    )
  }

  if (current.currentLifestyle === 'protector') {
    return goalFor(
      'watch-over-familiar-players',
      'Watch over familiar players',
      'A protector pays attention to the people nearby.',
      'social',
      [],
      now
    )
  }

  return defaultGoal(now)
}

function updateNpcGoal (life, context, options = {}) {
  const now = options.now ? options.now() : Date.now()
  const fixedOptions = { ...options, now: () => now }
  const current = normalizeNpcLife(life, fixedOptions)
  return normalizeNpcLife({
    ...current,
    currentGoal: chooseNpcGoal(current, context, fixedOptions),
    updatedAt: now
  }, fixedOptions)
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
  applyNpcLifeEvent,
  applyScoreDelta,
  clampScore,
  chooseNpcGoal,
  defaultGoal,
  emptyNpcLife,
  eventDeltas,
  normalizeGoal,
  normalizeNpcLife,
  normalizeScores,
  npcLifePath,
  readNpcLife,
  updateLifestyleTransition,
  updateNpcGoal,
  updateNpcLife,
  writeNpcLife
}
