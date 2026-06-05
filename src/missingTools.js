const fs = require('fs')
const path = require('path')

const {
  SHARED_MISSING_TOOLS_PATH
} = require('./config')

const PRIORITY_RANK = {
  low: 1,
  medium: 2,
  high: 3
}

function compactText (value, fallback = '', maxLength = 200) {
  const text = String(value || fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text.slice(0, maxLength)
}

function slugPart (value) {
  return compactText(value, 'unknown', 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown'
}

function normalizePriority (value) {
  const priority = String(value || '').toLowerCase()
  return PRIORITY_RANK[priority] ? priority : 'medium'
}

function comparePriority (a, b) {
  return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    b.count - a.count ||
    b.lastSeenAt - a.lastSeenAt
}

function missingToolId (entry) {
  return [
    slugPart(entry.capability),
    slugPart(entry.desiredTool),
    slugPart(entry.blockedGoal)
  ].join('-')
}

function readJsonArray (filePath, fileSystem = fs) {
  try {
    const parsed = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    return []
  }
}

function objectRecord (entry) {
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
}

function numericValue (value) {
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const timestamp = Number(value)
    return Number.isFinite(timestamp) ? timestamp : null
  }

  return null
}

function numericTimestamp (value, fallback) {
  return numericValue(value) ?? fallback
}

function positiveCount (value) {
  const count = Number.parseInt(value ?? 1, 10)
  return Number.isFinite(count) && count >= 1 ? count : 1
}

function writeJsonArray (filePath, records, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(filePath), { recursive: true })
  fileSystem.writeFileSync(filePath, `${JSON.stringify(records, null, 2)}\n`)
}

function normalizeMissingToolRecord (entry, options = {}) {
  const record = objectRecord(entry)
  const now = numericTimestamp(options.now?.(), Date.now())
  const capability = compactText(record.capability, 'Unknown missing capability', 120)
  const desiredTool = compactText(record.desiredTool ?? record.suggestedTool ?? record.tool, '', 120)
  const blockedGoal = compactText(record.blockedGoal ?? record.goal, 'Unspecified goal', 160)
  const reason = compactText(record.reason, 'No reason captured', 300)
  const priority = normalizePriority(record.priority)
  const context = objectRecord(record.context)
  const example = {
    at: numericTimestamp(record.at, now),
    reason,
    context
  }

  return {
    id: missingToolId({ capability, desiredTool, blockedGoal }),
    status: compactText(record.status, 'open', 40),
    capability,
    desiredTool,
    blockedGoal,
    reason,
    priority,
    count: positiveCount(record.count),
    firstSeenAt: numericTimestamp(record.firstSeenAt, now),
    lastSeenAt: numericTimestamp(record.lastSeenAt, now),
    suggestedInputs: Array.isArray(record.suggestedInputs) ? record.suggestedInputs.slice(0, 8) : [],
    suggestedResult: compactText(record.suggestedResult, '', 200),
    examples: Array.isArray(record.examples) ? record.examples.slice(-5) : [example]
  }
}

function mergeMissingToolRecord (existing, incoming) {
  const priority = PRIORITY_RANK[incoming.priority] > PRIORITY_RANK[existing.priority]
    ? incoming.priority
    : existing.priority
  const examples = [
    ...(Array.isArray(existing.examples) ? existing.examples : []),
    ...(Array.isArray(incoming.examples) ? incoming.examples : [])
  ].slice(-5)

  return {
    ...existing,
    status: existing.status || incoming.status,
    reason: incoming.reason || existing.reason,
    priority,
    count: Math.max(1, existing.count || 1) + Math.max(1, incoming.count || 1),
    firstSeenAt: Math.min(
      numericTimestamp(existing.firstSeenAt, incoming.firstSeenAt),
      numericTimestamp(incoming.firstSeenAt, existing.firstSeenAt)
    ),
    lastSeenAt: Math.max(
      numericTimestamp(existing.lastSeenAt, incoming.lastSeenAt),
      numericTimestamp(incoming.lastSeenAt, existing.lastSeenAt)
    ),
    suggestedInputs: incoming.suggestedInputs.length ? incoming.suggestedInputs : existing.suggestedInputs,
    suggestedResult: incoming.suggestedResult || existing.suggestedResult,
    examples
  }
}

function readMissingTools (options = {}) {
  const filePath = options.missingToolsPath || SHARED_MISSING_TOOLS_PATH
  return readJsonArray(filePath, options.fs)
    .map(entry => normalizeMissingToolRecord(entry, options))
    .sort(comparePriority)
}

function recordMissingTool (entry, options = {}) {
  const filePath = options.missingToolsPath || SHARED_MISSING_TOOLS_PATH
  const incoming = normalizeMissingToolRecord(entry, options)
  const records = readJsonArray(filePath, options.fs)
    .map(record => normalizeMissingToolRecord(record, options))
  const index = records.findIndex(record => record.id === incoming.id)
  const recorded = index < 0

  if (recorded) {
    records.push(incoming)
  } else {
    records[index] = mergeMissingToolRecord(records[index], incoming)
  }

  records.sort(comparePriority)
  writeJsonArray(filePath, records, options.fs)

  return {
    id: incoming.id,
    capability: incoming.capability,
    path: filePath,
    recorded
  }
}

function recordSharedMissingTool (entry, options = {}) {
  return recordMissingTool(entry, {
    ...options,
    missingToolsPath: options.sharedMissingToolsPath || SHARED_MISSING_TOOLS_PATH
  })
}

function summarizeMissingTools (options = {}) {
  const goal = compactText(options.currentGoal, '', 160).toLowerCase()
  const limit = Math.max(1, Math.min(Number.parseInt(options.limit || 3, 10), 10))

  return readMissingTools(options)
    .filter(record => record.status === 'open')
    .filter(record => !goal ||
      record.blockedGoal.toLowerCase().includes(goal) ||
      record.capability.toLowerCase().includes(goal))
    .slice(0, limit)
    .map(record => {
      const desired = record.desiredTool ? `; desired tool \`${record.desiredTool}\`` : ''
      const times = record.count === 1 ? '1 time' : `${record.count} times`
      return `${record.capability} blocked "${record.blockedGoal}"${desired}; seen ${times}.`
    })
}

module.exports = {
  missingToolId,
  normalizeMissingToolRecord,
  readMissingTools,
  recordMissingTool,
  recordSharedMissingTool,
  summarizeMissingTools
}
