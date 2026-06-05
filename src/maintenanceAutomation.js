const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const {
  BOT_RUNTIME_LOG_PATH,
  ERROR_REVIEW_PATH,
  MAINTENANCE_INTERVAL_MS,
  MAINTENANCE_LOG_PATH,
  MISSING_FUNCTIONS_PATH
} = require('./config')
const {
  buildCodexOptions
} = require('./aiChat')

const DEFAULT_MAINTENANCE_CODEX_TIMEOUT_MS = 20 * 60 * 1000

function readTextFile (filePath, fileSystem = fs) {
  try {
    return fileSystem.readFileSync(filePath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return ''
    throw err
  }
}

function openItemsSection (text) {
  const value = String(text || '')
  const openMatch = /## Open Items\b/i.exec(value)
  if (!openMatch) return ''

  const start = openMatch.index + openMatch[0].length
  const rest = value.slice(start)
  const endMatch = /\n## (?:Resolved|Closed|Done) Items\b/i.exec(rest)
  return (endMatch ? rest.slice(0, endMatch.index) : rest).trim()
}

function hasOpenItems (text) {
  const section = openItemsSection(text)
  return Boolean(section && /<!--\s*(?:bot-error|missing-function):/i.test(section))
}

function hasMaintenanceWork (options = {}) {
  const fileSystem = options.fs || fs
  const errorReview = readTextFile(options.errorReviewPath || ERROR_REVIEW_PATH, fileSystem)
  const missingFunctions = readTextFile(options.missingFunctionsPath || MISSING_FUNCTIONS_PATH, fileSystem)
  return hasOpenItems(errorReview) || hasOpenItems(missingFunctions)
}

function buildMaintenancePrompt (options = {}) {
  const fileSystem = options.fs || fs
  const errorReviewPath = options.errorReviewPath || ERROR_REVIEW_PATH
  const missingFunctionsPath = options.missingFunctionsPath || MISSING_FUNCTIONS_PATH
  const errorReview = readTextFile(errorReviewPath, fileSystem)
  const missingFunctions = readTextFile(missingFunctionsPath, fileSystem)

  return [
    'You are running unattended maintenance for this Mineflayer bot repository.',
    'Fix only issues listed in logs/error-review.md and MISSING_FUNCTIONS.md.',
    'If no actionable issue remains, make no code changes.',
    'For each fixed item, move it out of "## Open Items" and into a "## Resolved Items" section with a short note.',
    'Run focused tests for changed behavior and keep edits scoped.',
    'Do not start the Minecraft bot. The maintenance supervisor will run npm run start after you exit.',
    '',
    'Current logs/error-review.md:',
    '```markdown',
    errorReview || '(file missing or empty)',
    '```',
    '',
    'Current MISSING_FUNCTIONS.md:',
    '```markdown',
    missingFunctions || '(file missing or empty)',
    '```'
  ].join('\n')
}

function buildCodexFixArgs (prompt, options = {}) {
  const codexOptions = { ...buildCodexOptions(), ...(options.codex || {}) }
  const model = codexOptions.model
  const reasoningEffort = options.reasoningEffort || codexOptions.reasoningEffort || 'medium'
  const serviceTier = codexOptions.serviceTier
  const cwd = options.cwd || process.cwd()

  return [
    'exec',
    '--model',
    model,
    '-c',
    `model_reasoning_effort="${reasoningEffort}"`,
    '-c',
    `service_tier="${serviceTier}"`,
    '--sandbox',
    'danger-full-access',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--cd',
    cwd,
    '-'
  ]
}

function runProcess (command, args = [], options = {}) {
  const childProcessExecFile = options.execFile || execFile
  const timeout = options.timeout
  const input = options.input || ''
  const cwd = options.cwd || process.cwd()

  return new Promise((resolve, reject) => {
    const child = childProcessExecFile(command, args, {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024
    }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
        return
      }
      resolve({ stdout, stderr })
    })

    if (input && child?.stdin) child.stdin.end(input)
  })
}

async function runCodexFixer (options = {}) {
  const prompt = options.prompt || buildMaintenancePrompt(options)
  const command = options.command || buildCodexOptions(process.env, options.codex || {}).command
  const args = options.args || buildCodexFixArgs(prompt, options)
  return runProcess(command, args, {
    ...options,
    input: prompt,
    timeout: options.timeout || DEFAULT_MAINTENANCE_CODEX_TIMEOUT_MS
  })
}

function appendMaintenanceLog (message, options = {}) {
  const fileSystem = options.fs || fs
  const logPath = options.logPath || MAINTENANCE_LOG_PATH
  if (typeof fileSystem.mkdirSync === 'function') fileSystem.mkdirSync(path.dirname(logPath), { recursive: true })
  fileSystem.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`)
}

function buildWindowsStartScript (cwd) {
  const escapePowerShell = value => String(value).replace(/'/g, "''")
  const safeCwd = escapePowerShell(cwd)

  return [
    `$npmCommand = (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)`,
    'if ($npmCommand) {',
    `  $process = Start-Process -FilePath $npmCommand -ArgumentList @('run','start') -WorkingDirectory '${safeCwd}' -WindowStyle Hidden -PassThru`,
    '} else {',
    `  $nodeCommand = (Get-Command 'node.exe' -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source)`,
    `  $process = Start-Process -FilePath $nodeCommand -ArgumentList @('bot.js') -WorkingDirectory '${safeCwd}' -WindowStyle Hidden -PassThru`,
    '}',
    '$process.Id'
  ].join('\n')
}

async function startBotProcess (options = {}) {
  const spawn = options.spawn || require('child_process').spawn
  const platform = options.platform || process.platform
  const cwd = options.cwd || process.cwd()
  const fileSystem = options.fs || fs
  const logPath = options.logPath || BOT_RUNTIME_LOG_PATH
  if (typeof fileSystem.mkdirSync === 'function') fileSystem.mkdirSync(path.dirname(logPath), { recursive: true })

  if (platform === 'win32') {
    const errorLogPath = `${logPath}.err`
    const script = buildWindowsStartScript(cwd)
    const result = await runProcess('powershell.exe', ['-NoProfile', '-Command', script], options)
    const pid = Number.parseInt(result.stdout, 10)
    return { pid: Number.isFinite(pid) ? pid : null, logPath, errorLogPath }
  }

  const out = fileSystem.openSync(logPath, 'a')
  const err = fileSystem.openSync(logPath, 'a')
  const command = 'npm'
  const child = spawn(command, ['run', 'start'], {
    cwd,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true
  })
  child.unref()
  return { pid: child.pid, logPath }
}

async function stopBotProcesses (options = {}) {
  if (options.stopCommand) return options.stopCommand()
  if (process.platform !== 'win32') return { stopped: 0 }

  const script = [
    '$self = $PID',
    'Get-CimInstance Win32_Process | Where-Object {',
    '  $_.ProcessId -ne $self -and',
    '  $_.CommandLine -and',
    '  ($_.CommandLine -match "bot\\.js" -or $_.CommandLine -match "npm(\\.cmd)?\\s+run\\s+start") -and',
    '  $_.CommandLine -notmatch "maintenanceAutomation\\.js"',
    '} | ForEach-Object {',
    '  Stop-Process -Id $_.ProcessId -Force',
    '  $_.ProcessId',
    '}'
  ].join('\n')
  const result = await runProcess('powershell.exe', ['-NoProfile', '-Command', script], options)
  return {
    stopped: result.stdout.trim() ? result.stdout.trim().split(/\r?\n/).length : 0,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

async function runMaintenanceCycle (options = {}) {
  const logger = options.logger || (message => appendMaintenanceLog(message, options))
  logger('maintenance cycle starting')
  await (options.stopBot || stopBotProcesses)(options)

  const hasWork = (options.hasMaintenanceWork || hasMaintenanceWork)(options)
  if (hasWork) {
    logger('maintenance work detected; running Codex fixer')
    await (options.runFixer || runCodexFixer)(options)
  } else {
    logger('no maintenance work detected')
  }

  const started = await (options.startBot || startBotProcess)(options)
  logger(`bot start requested${started?.pid ? ` pid=${started.pid}` : ''}`)
  return {
    ok: true,
    fixed: Boolean(hasWork),
    started
  }
}

function attachMaintenanceAutomation (options = {}) {
  const setMaintenanceInterval = options.setInterval || setInterval
  const clearMaintenanceInterval = options.clearInterval || clearInterval
  const intervalMs = options.intervalMs ?? MAINTENANCE_INTERVAL_MS
  const runCycle = options.runMaintenanceCycle || runMaintenanceCycle
  const errorOutput = options.errorOutput || console.error
  let stopped = false
  let running = false

  async function runNow () {
    if (stopped) return { ok: true, skipped: true, reason: 'stopped' }
    if (running) return { ok: true, skipped: true, reason: 'already-running' }
    running = true
    try {
      return await runCycle(options)
    } catch (err) {
      errorOutput(`Maintenance automation error: ${err.message}`)
      appendMaintenanceLog(`error ${err.message}`, options)
      return { ok: false, error: err.message }
    } finally {
      running = false
    }
  }

  const timer = setMaintenanceInterval(() => {
    runNow()
  }, intervalMs)
  if (options.unrefTimer !== false && typeof timer?.unref === 'function') timer.unref()
  if (options.runImmediately !== false) runNow()

  function stop () {
    if (stopped) return
    stopped = true
    clearMaintenanceInterval(timer)
  }

  return {
    runNow,
    stop
  }
}

module.exports = {
  attachMaintenanceAutomation,
  buildWindowsStartScript,
  buildCodexFixArgs,
  buildMaintenancePrompt,
  hasMaintenanceWork,
  runCodexFixer,
  runMaintenanceCycle,
  startBotProcess,
  stopBotProcesses
}
