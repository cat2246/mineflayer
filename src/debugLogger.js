const fs = require('fs')
const path = require('path')
const {
  DEBUG_LOG_MAX_BYTES,
  DEBUG_LOG_MAX_FILES,
  DEBUG_LOG_PATH
} = require('./config')

function canRotateLogs (fileSystem) {
  return typeof fileSystem.existsSync === 'function' &&
    typeof fileSystem.statSync === 'function' &&
    typeof fileSystem.renameSync === 'function' &&
    typeof fileSystem.unlinkSync === 'function'
}

function rotatedLogPath (logPath, index) {
  return `${logPath}.${index}`
}

function rotateDebugLogIfNeeded (fileSystem, logPath, line, options = {}) {
  const maxBytes = options.maxBytes ?? DEBUG_LOG_MAX_BYTES
  const maxFiles = options.maxFiles ?? DEBUG_LOG_MAX_FILES
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || maxFiles <= 0) return
  if (!canRotateLogs(fileSystem) || !fileSystem.existsSync(logPath)) return

  const currentSize = fileSystem.statSync(logPath).size
  const lineBytes = Buffer.byteLength(line)
  if (currentSize + lineBytes <= maxBytes) return

  const oldestPath = rotatedLogPath(logPath, maxFiles)
  if (fileSystem.existsSync(oldestPath)) fileSystem.unlinkSync(oldestPath)

  for (let index = maxFiles - 1; index >= 1; index--) {
    const source = rotatedLogPath(logPath, index)
    if (fileSystem.existsSync(source)) {
      fileSystem.renameSync(source, rotatedLogPath(logPath, index + 1))
    }
  }

  fileSystem.renameSync(logPath, rotatedLogPath(logPath, 1))
}

function createDebugLogger (fileSystem = fs, logPath = DEBUG_LOG_PATH, options = {}) {
  try {
    if (typeof fileSystem.mkdirSync === 'function') {
      fileSystem.mkdirSync(path.dirname(logPath), { recursive: true })
    }
  } catch {
    // If directory creation fails, appendFileSync below will surface it.
  }

  return function debugLog (event, data = {}) {
    const entry = {
      time: new Date().toISOString(),
      event,
      data
    }

    try {
      const line = `${JSON.stringify(entry)}\n`
      rotateDebugLogIfNeeded(fileSystem, logPath, line, options)
      fileSystem.appendFileSync(logPath, line)
    } catch (err) {
      console.log('Debug log error:', err.message)
    }
  }
}

module.exports = {
  createDebugLogger,
  rotateDebugLogIfNeeded
}
