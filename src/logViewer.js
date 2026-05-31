const fs = require('fs')
const path = require('path')
const { DEBUG_LOG_PATH } = require('./config')

const DEFAULT_POLL_INTERVAL_MS = 500

function parseArgs (argv = process.argv.slice(2)) {
  const args = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--parent-pid') args.parentPid = Number.parseInt(argv[++index], 10)
    if (arg === '--log-path') args.logPath = argv[++index]
    if (arg === '--poll-ms') args.pollIntervalMs = Number.parseInt(argv[++index], 10)
  }
  return args
}

function compactJson (value) {
  if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return ''
  return ` ${JSON.stringify(value)}`
}

function timeLabel (time) {
  if (!time) return ''
  const match = String(time).match(/T(\d{2}:\d{2}:\d{2})/)
  return match ? match[1] : String(time)
}

function formatDebugLogLine (line) {
  try {
    const entry = JSON.parse(line)
    const time = timeLabel(entry.time)
    const prefix = time ? `[${time}] ` : ''
    return `${prefix}${entry.event || 'log'}${compactJson(entry.data)}`
  } catch (err) {
    return line
  }
}

function parentIsAlive (parentPid) {
  if (!parentPid || !Number.isInteger(parentPid)) return true

  try {
    process.kill(parentPid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

function ensureLogFile (logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.closeSync(fs.openSync(logPath, 'a'))
}

function readNewLogLines (state, options = {}) {
  const logPath = options.logPath || DEBUG_LOG_PATH
  const output = options.output || console.log
  ensureLogFile(logPath)

  const stat = fs.statSync(logPath)
  if (stat.size < state.position) state.position = 0
  if (stat.size === state.position) return

  const length = stat.size - state.position
  const buffer = Buffer.alloc(length)
  const fd = fs.openSync(logPath, 'r')
  try {
    fs.readSync(fd, buffer, 0, length, state.position)
  } finally {
    fs.closeSync(fd)
  }

  state.position = stat.size
  state.partial += buffer.toString('utf8')
  const lines = state.partial.split(/\r?\n/)
  state.partial = lines.pop() || ''

  for (const line of lines) {
    if (line.trim()) output(formatDebugLogLine(line))
  }
}

function startLogViewer (options = {}) {
  const logPath = options.logPath || DEBUG_LOG_PATH
  const parentPid = options.parentPid
  const pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS
  const output = options.output || console.log
  const onExit = options.onExit || (() => process.exit(0))

  ensureLogFile(logPath)
  const state = {
    partial: '',
    position: fs.statSync(logPath).size
  }

  output(`Mineflayer bot logs: ${logPath}`)
  if (parentPid) output(`Watching bot process ${parentPid}; this window will close when it exits.`)

  const timer = setInterval(() => {
    if (!parentIsAlive(parentPid)) {
      clearInterval(timer)
      onExit()
      return
    }

    readNewLogLines(state, { logPath, output })
  }, pollIntervalMs)

  return timer
}

if (require.main === module) {
  startLogViewer(parseArgs())
}

module.exports = {
  formatDebugLogLine,
  parentIsAlive,
  parseArgs,
  readNewLogLines,
  startLogViewer
}
