const fs = require('fs')
const path = require('path')
const { NPC_MEMORY_REFLECTION_INTERVAL_MS } = require('./config')
const { summarizeMissingTools } = require('./missingTools')

const NPC_MEMORY_SUMMARY_VERSION = 1
const MAX_REFLECTION_EVENTS = 8
const MAX_SUMMARY_LIST_ITEMS = 5

function compactText (value, fallback = '', maxLength = 220) {
  const text = String(value || fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, maxLength)
}

function eventLogPath (options = {}) {
  return options.eventLogPath
}

function memorySummaryPath (options = {}) {
  return options.memorySummaryPath
}

function journalPath (options = {}) {
  return options.journalPath
}

function normalizeNpcMemoryEvent (event, options = {}) {
  const now = options.now || (() => Date.now())
  const data = event?.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data
    : undefined
  const normalized = {
    at: typeof event?.at === 'number' && Number.isFinite(event.at) ? event.at : now(),
    source: compactText(event?.source, 'npc-memory', 80),
    type: compactText(event?.type, 'event', 80),
    message: compactText(event?.message || event?.reason, '', 300)
  }

  if (data) normalized.data = data
  return normalized
}

function appendNpcMemoryEvent (event, options = {}) {
  const filePath = eventLogPath(options)
  if (!filePath) return null

  const normalized = normalizeNpcMemoryEvent(event, options)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(normalized)}\n`)
  return normalized
}

function readNpcMemoryEvents (options = {}) {
  const filePath = eventLogPath(options)
  if (!filePath || !fs.existsSync(filePath)) return []

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try {
        return normalizeNpcMemoryEvent(JSON.parse(line), options)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function emptyNpcMemorySummary (options = {}) {
  const now = options.now || (() => Date.now())
  return {
    version: NPC_MEMORY_SUMMARY_VERSION,
    updatedAt: now(),
    identity: 'A survival NPC building a stable routine.',
    home: 'No home memory has been summarized yet.',
    currentProjects: [],
    knownRisks: [],
    importantMissingTools: [],
    recentImportantEvents: []
  }
}

function normalizeStringList (value, maxItems = MAX_SUMMARY_LIST_ITEMS) {
  return Array.isArray(value)
    ? value
      .map(item => compactText(item, '', 220))
      .filter(Boolean)
      .slice(0, maxItems)
    : []
}

function normalizeNpcMemorySummary (summary, options = {}) {
  const base = emptyNpcMemorySummary(options)
  const input = summary && typeof summary === 'object' && !Array.isArray(summary) ? summary : {}

  return {
    version: NPC_MEMORY_SUMMARY_VERSION,
    updatedAt: typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : base.updatedAt,
    identity: compactText(input.identity, base.identity, 220),
    home: compactText(input.home, base.home, 300),
    currentProjects: normalizeStringList(input.currentProjects),
    knownRisks: normalizeStringList(input.knownRisks),
    importantMissingTools: normalizeStringList(input.importantMissingTools),
    recentImportantEvents: normalizeStringList(input.recentImportantEvents, MAX_REFLECTION_EVENTS)
  }
}

function readNpcMemorySummary (options = {}) {
  const filePath = memorySummaryPath(options)
  if (!filePath || !fs.existsSync(filePath)) return emptyNpcMemorySummary(options)

  try {
    return normalizeNpcMemorySummary(JSON.parse(fs.readFileSync(filePath, 'utf8')), options)
  } catch {
    return emptyNpcMemorySummary(options)
  }
}

function writeNpcMemorySummary (summary, options = {}) {
  const filePath = memorySummaryPath(options)
  if (!filePath) return normalizeNpcMemorySummary(summary, options)

  const normalized = normalizeNpcMemorySummary(summary, options)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`)
  return normalized
}

function recentEventMessages (events) {
  return events
    .slice(-MAX_REFLECTION_EVENTS)
    .map(event => compactText(event.message || event.type, '', 220))
    .filter(Boolean)
}

function riskMessages (events) {
  return events
    .filter(event => /danger|unsafe|death|low_food|night/i.test(event.type))
    .slice(-MAX_SUMMARY_LIST_ITEMS)
    .map(event => compactText(event.message || event.type, '', 220))
    .filter(Boolean)
}

function homeSummary (events, fallback) {
  const reversed = [...events].reverse()
  const homeEvent = reversed.find(event => /home/i.test(event.type)) ||
    reversed.find(event => /home/i.test(event.message) && !/danger|unsafe|risk/i.test(event.type))
  return homeEvent ? compactText(homeEvent.message || 'Home was updated.', fallback, 300) : fallback
}

function appendJournalEntry (summary, options = {}) {
  const filePath = journalPath(options)
  if (!filePath) return false

  const timestamp = new Date(summary.updatedAt).toISOString()
  const lines = [
    `## ${timestamp}`,
    '',
    `Identity: ${summary.identity}`,
    `Home: ${summary.home}`,
    summary.knownRisks.length ? `Risks: ${summary.knownRisks.join('; ')}` : 'Risks: none summarized',
    summary.recentImportantEvents.length ? `Recent: ${summary.recentImportantEvents.join('; ')}` : 'Recent: no important events summarized',
    ''
  ]

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${lines.join('\n')}\n`)
  return true
}

function runNpcMemoryReflection (options = {}) {
  const now = options.now || (() => Date.now())
  const previous = readNpcMemorySummary(options)
  const events = readNpcMemoryEvents(options)
  const missingTools = summarizeMissingTools({
    ...options,
    limit: 3
  })
  const botName = compactText(options.botName, '', 80)
  const summary = writeNpcMemorySummary({
    version: NPC_MEMORY_SUMMARY_VERSION,
    updatedAt: now(),
    identity: botName
      ? `${botName} is a survival NPC building a stable routine.`
      : previous.identity,
    home: homeSummary(events, previous.home),
    currentProjects: previous.currentProjects,
    knownRisks: riskMessages(events),
    importantMissingTools: missingTools,
    recentImportantEvents: recentEventMessages(events)
  }, options)

  appendJournalEntry(summary, options)
  return summary
}

function attachNpcMemoryReflection (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const errorOutput = options.errorOutput || console.error
  const runReflection = options.runReflection || runNpcMemoryReflection
  const intervalMs = options.intervalMs ?? NPC_MEMORY_REFLECTION_INTERVAL_MS
  const setReflectionInterval = options.setInterval || setInterval
  const clearReflectionInterval = options.clearInterval || clearInterval
  let stopped = false
  let running = false

  async function runNow () {
    if (stopped || running) return { ok: true, skipped: true }

    running = true
    try {
      const summary = await runReflection({
        ...options,
        botName: bot?.username || options.botName
      })
      debugLog('npcMemory.reflection', { updatedAt: summary?.updatedAt })
      return { ok: true, summary }
    } catch (err) {
      errorOutput(`NPC memory reflection error: ${err.message}`)
      debugLog('npcMemory.reflection.error', { message: err.message, stack: err.stack })
      return { ok: false, error: err.message }
    } finally {
      running = false
    }
  }

  const timer = setReflectionInterval(runNow, intervalMs)
  if (typeof timer?.unref === 'function') timer.unref()

  function stop () {
    if (stopped) return
    stopped = true
    clearReflectionInterval(timer)
  }

  bot?.once?.('end', stop)
  bot?.once?.('kicked', stop)

  return {
    runNow,
    stop
  }
}

module.exports = {
  MAX_REFLECTION_EVENTS,
  NPC_MEMORY_REFLECTION_INTERVAL_MS,
  NPC_MEMORY_SUMMARY_VERSION,
  appendNpcMemoryEvent,
  attachNpcMemoryReflection,
  emptyNpcMemorySummary,
  normalizeNpcMemoryEvent,
  normalizeNpcMemorySummary,
  readNpcMemoryEvents,
  readNpcMemorySummary,
  runNpcMemoryReflection,
  writeNpcMemorySummary
}
