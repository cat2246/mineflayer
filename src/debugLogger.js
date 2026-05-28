const fs = require('fs')
const path = require('path')
const { DEBUG_LOG_PATH } = require('./config')

function createDebugLogger (fileSystem = fs, logPath = DEBUG_LOG_PATH) {
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
      fileSystem.appendFileSync(logPath, `${JSON.stringify(entry)}\n`)
    } catch (err) {
      console.log('Debug log error:', err.message)
    }
  }
}

module.exports = {
  createDebugLogger
}
