const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  DEBUG_LOG_PATH,
  ERROR_LOG_MONITOR_INTERVAL_MS,
  ERROR_REVIEW_PATH,
  MISSING_FUNCTIONS_PATH
} = require('./config')

function compactText (value, fallback = '') {
  const text = String(value ?? fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

function hashText (value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16)
}

function ensureMarkdownFile (filePath, title, intro, fileSystem = fs) {
  if (!filePath) return false
  if (typeof fileSystem.mkdirSync === 'function') {
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true })
  }
  if (fileSystem.existsSync(filePath)) return true

  fileSystem.writeFileSync(filePath, [
    `# ${title}`,
    '',
    intro,
    '',
    '## Open Items',
    ''
  ].join('\n'))
  return true
}

function appendUniqueMarkdownEntry (options) {
  const fileSystem = options.fs || fs
  const marker = options.marker
  ensureMarkdownFile(options.filePath, options.title, options.intro, fileSystem)
  const current = fileSystem.readFileSync(options.filePath, 'utf8')
  if (current.includes(marker)) return false

  fileSystem.writeFileSync(options.filePath, `${current.replace(/\s+$/g, '')}\n\n${marker}\n${options.body}\n`)
  return true
}

function isErrorDebugEntry (entry) {
  const event = String(entry?.event || '')
  return event === 'error' || /\.error$/i.test(event)
}

function errorEntryMessage (entry) {
  return compactText(entry?.data?.message || entry?.data?.error || entry?.data?.reason || entry?.event, 'No message')
}

function errorEntryKey (entry) {
  return hashText([
    entry?.event,
    errorEntryMessage(entry),
    entry?.data?.stack || '',
    entry?.data?.stderr || ''
  ].join('|'))
}

function formatJsonBlock (value) {
  return JSON.stringify(value || {}, null, 2)
}

function recordDebugErrorEntry (entry, options = {}) {
  const reportPath = options.reportPath || ERROR_REVIEW_PATH
  const key = errorEntryKey(entry)
  const marker = `<!-- bot-error:${key} -->`
  const event = compactText(entry?.event, 'unknown-error')
  const message = errorEntryMessage(entry)
  const body = [
    `## ${compactText(entry?.time, new Date().toISOString())} - ${event}`,
    '',
    `- Event: \`${event}\``,
    `- Message: ${message}`,
    '',
    '```json',
    formatJsonBlock(entry?.data),
    '```'
  ].join('\n')

  return {
    key,
    path: reportPath,
    recorded: appendUniqueMarkdownEntry({
      fs: options.fs,
      filePath: reportPath,
      title: 'Bot Error Review',
      intro: 'Runtime errors copied from the structured debug log. Use this file as a repair backlog.',
      marker,
      body
    })
  }
}

function scanDebugLogForErrors (options = {}) {
  const fileSystem = options.fs || fs
  const logPath = options.logPath || DEBUG_LOG_PATH
  const state = options.state || {}
  const result = {
    scanned: 0,
    recorded: 0,
    position: state.position || 0
  }

  if (!fileSystem.existsSync(logPath)) return result

  const buffer = fileSystem.readFileSync(logPath)
  let position = Number.isFinite(state.position) ? state.position : 0
  if (position < 0 || position > buffer.length) position = 0

  const chunk = buffer.slice(position).toString('utf8')
  state.position = buffer.length
  result.position = state.position

  for (const line of chunk.split(/\r?\n/)) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    result.scanned++
    if (!isErrorDebugEntry(entry)) continue

    const recorded = recordDebugErrorEntry(entry, options)
    if (recorded.recorded) result.recorded++
  }

  return result
}

function missingFunctionKey (entry) {
  return hashText([
    entry.capability,
    entry.requestMessage,
    entry.playerName,
    entry.suggestedTool,
    JSON.stringify(entry.rawTool || {})
  ].join('|'))
}

function recordMissingFunction (entry, options = {}) {
  const missingFunctionsPath = options.missingFunctionsPath || MISSING_FUNCTIONS_PATH
  const capability = compactText(entry.capability, 'Unknown missing function')
  const key = missingFunctionKey({ ...entry, capability })
  const marker = `<!-- missing-function:${key} -->`
  const timestamp = entry.timestamp || options.now?.().toISOString?.() || new Date().toISOString()
  const suggestedTool = compactText(entry.suggestedTool, '')
  const reason = compactText(entry.reason, 'No reason captured')
  const playerName = compactText(entry.playerName, 'unknown')
  const channel = compactText(entry.channel, 'unknown')
  const requestMessage = compactText(entry.requestMessage, '')
  const source = compactText(entry.source, 'unknown')
  const missingToolEntry = {
    capability,
    desiredTool: suggestedTool,
    blockedGoal: entry.blockedGoal || 'Unspecified goal',
    reason,
    context: {
      playerName,
      channel,
      requestMessage,
      source,
      rawTool: entry.rawTool || null
    },
    priority: entry.priority
  }
  let missingTool = null
  let sharedMissingTool = null

  try {
    const { recordMissingTool, recordSharedMissingTool } = require('./missingTools')
    if (options.missingToolsPath) {
      missingTool = recordMissingTool(missingToolEntry, options)
    }
    if (options.sharedMissingToolsPath) {
      sharedMissingTool = recordSharedMissingTool(missingToolEntry, options)
    }
  } catch (err) {
    missingTool = { error: err.message }
  }

  const lines = [
    `## ${timestamp} - ${capability}`,
    '',
    `- Requested by: \`${playerName}\` via \`${channel}\``,
    `- Source: \`${source}\``,
    `- Reason: ${reason}`
  ]

  if (suggestedTool) lines.push(`- Suggested tool/function: \`${suggestedTool}\``)
  if (requestMessage) lines.push(`- Player message: ${requestMessage}`)
  if (entry.rawTool) {
    lines.push('', '```json', formatJsonBlock(entry.rawTool), '```')
  }

  return {
    capability,
    key,
    path: missingFunctionsPath,
    missingTool,
    sharedMissingTool,
    recorded: appendUniqueMarkdownEntry({
      fs: options.fs,
      filePath: missingFunctionsPath,
      title: 'Missing Bot Functions',
      intro: 'Feature backlog captured by the Minecraft AI NPC when players ask for abilities the runtime does not have yet.',
      marker,
      body: lines.join('\n')
    })
  }
}

function attachErrorLogMonitor (bot, options = {}) {
  const setMonitorInterval = options.setInterval || setInterval
  const clearMonitorInterval = options.clearInterval || clearInterval
  const intervalMs = options.intervalMs ?? ERROR_LOG_MONITOR_INTERVAL_MS
  const scan = options.scanDebugLogForErrors || scanDebugLogForErrors
  const state = options.state || { position: 0 }
  const debugLog = options.debugLog || (() => {})
  const errorOutput = options.errorOutput || console.error
  let stopped = false

  function runNow () {
    if (stopped) return { scanned: 0, recorded: 0, stopped: true }
    try {
      const result = scan({ ...options, state })
      debugLog('errorLogMonitor.scan', result)
      return result
    } catch (err) {
      errorOutput(`Error log monitor failed: ${err.message}`)
      debugLog('errorLogMonitor.error', { message: err.message, stack: err.stack })
      return { scanned: 0, recorded: 0, error: err.message }
    }
  }

  const timer = setMonitorInterval(runNow, intervalMs)
  if (typeof timer?.unref === 'function') timer.unref()

  function stop () {
    if (stopped) return
    stopped = true
    clearMonitorInterval(timer)
  }

  bot?.once?.('end', stop)
  bot?.once?.('kicked', stop)

  return {
    runNow,
    stop
  }
}

module.exports = {
  attachErrorLogMonitor,
  recordDebugErrorEntry,
  recordMissingFunction,
  scanDebugLogForErrors
}
