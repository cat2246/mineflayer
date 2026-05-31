const path = require('path')
const { spawn } = require('child_process')
const { DEBUG_LOG_PATH } = require('./config')

const LOG_TERMINAL_TITLE = 'Mineflayer Bot Logs'

function logViewerScriptPath () {
  return path.join(__dirname, 'logViewer.js')
}

function logTerminalEnabled (env = process.env) {
  return !/^(0|false|off)$/i.test(String(env.MINEFLAYER_LOG_TERMINAL || '1'))
}

function shouldStartLogTerminal (options = {}) {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  if (options.enabled === false || !logTerminalEnabled(env)) return false
  return platform === 'win32'
}

function buildWindowsLogTerminalArgs (options = {}) {
  return [
    '/c',
    'start',
    LOG_TERMINAL_TITLE,
    options.nodePath || process.execPath,
    options.viewerScriptPath || logViewerScriptPath(),
    '--parent-pid',
    String(options.parentPid || process.pid),
    '--log-path',
    options.logPath || DEBUG_LOG_PATH
  ]
}

function startLogTerminal (options = {}) {
  if (!shouldStartLogTerminal(options)) return null

  const spawnProcess = options.spawn || spawn
  const child = spawnProcess('cmd.exe', buildWindowsLogTerminalArgs(options), {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })

  if (typeof child?.on === 'function') child.on('error', () => {})
  if (typeof child?.unref === 'function') child.unref()
  return child
}

module.exports = {
  buildWindowsLogTerminalArgs,
  logTerminalEnabled,
  shouldStartLogTerminal,
  startLogTerminal
}
