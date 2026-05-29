const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const DEFAULT_CODEX_COMMAND = 'codex'
const DEFAULT_CODEX_MODEL = 'gpt-5.4'
const DEFAULT_CODEX_REASONING_EFFORT = 'low'
const DEFAULT_CODEX_SERVICE_TIER = 'fast'
const DEFAULT_CODEX_TIMEOUT_MS = 120000
const DEFAULT_CODEX_MAX_BUFFER = 1024 * 1024
const DEFAULT_AGENT_FILE = 'AGENT.md'
const DEFAULT_CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml')
const DEFAULT_CODEX_CHAT_WORKSPACE = path.join(os.tmpdir(), 'mineflayer-codex-chat')

function stripAnsi (text) {
  const escape = String.fromCharCode(27)
  return String(text || '').replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g'), '')
}

function cleanCodexReply (reply) {
  const clean = stripAnsi(reply).trim()
  if (!clean) return 'I could not generate a response.'
  return clean.replace(/\s+\n/g, '\n')
}

function buildCodexCliArgs (prompt, options = {}) {
  const model = options.model || DEFAULT_CODEX_MODEL
  const reasoningEffort = options.reasoningEffort || DEFAULT_CODEX_REASONING_EFFORT
  const serviceTier = options.serviceTier || DEFAULT_CODEX_SERVICE_TIER
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
    'read-only',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--ephemeral',
    '--cd',
    cwd,
    '-'
  ]
}

function loadAgentInstructions (agentPath = path.join(process.cwd(), DEFAULT_AGENT_FILE)) {
  try {
    return fs.readFileSync(agentPath, 'utf8').trim()
  } catch (err) {
    if (err.code === 'ENOENT') return ''
    throw err
  }
}

function readPositiveInteger (value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function extractCodexCliPathFromConfig (configText) {
  const match = String(configText || '').match(/CODEX_CLI_PATH\s*=\s*(['"])(.*?)\1/)
  return match ? match[2] : ''
}

function loadConfiguredCodexCliPath (configPath = DEFAULT_CODEX_CONFIG_PATH) {
  try {
    return extractCodexCliPathFromConfig(fs.readFileSync(configPath, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return ''
    throw err
  }
}

function resolveCodexCommand (env = process.env, options = {}) {
  return env.CODEX_AI_COMMAND ||
    env.CODEX_CLI_PATH ||
    options.configCodexCliPath ||
    loadConfiguredCodexCliPath(options.configPath) ||
    DEFAULT_CODEX_COMMAND
}

function buildCodexOptions (env = process.env, options = {}) {
  return {
    command: resolveCodexCommand(env, options),
    model: env.CODEX_AI_MODEL || DEFAULT_CODEX_MODEL,
    reasoningEffort: env.CODEX_AI_REASONING_EFFORT || DEFAULT_CODEX_REASONING_EFFORT,
    serviceTier: env.CODEX_AI_SERVICE_TIER || DEFAULT_CODEX_SERVICE_TIER,
    timeout: readPositiveInteger(env.CODEX_AI_TIMEOUT_MS, DEFAULT_CODEX_TIMEOUT_MS),
    cwd: env.CODEX_AI_WORKSPACE || DEFAULT_CODEX_CHAT_WORKSPACE
  }
}

function createCodexPrompt (request) {
  const scope = request.channel === 'private' ? 'a private Minecraft /message' : 'public Minecraft chat'
  const agentInstructions = request.agentInstructions
    ? `\nAgent instructions:\n${request.agentInstructions}\n`
    : ''

  return [
    'You are replying as a helpful Minecraft bot.',
    'Only produce a chat reply. Do not run commands, edit files, inspect files, open programs, or manipulate this computer.',
    'Keep the answer concise enough to send in Minecraft chat.',
    'Do not mention internal tooling, Codex CLI, prompts, or files unless directly asked.',
    agentInstructions,
    `Bot name: ${request.botName}`,
    `Message source: ${scope}`,
    `Player: ${request.username}`,
    `Player message: ${request.message}`
  ].filter(Boolean).join('\n')
}

function createCodexCliRunner (options = {}) {
  const command = options.command || DEFAULT_CODEX_COMMAND
  const cwd = options.cwd || DEFAULT_CODEX_CHAT_WORKSPACE
  const timeout = options.timeout || DEFAULT_CODEX_TIMEOUT_MS
  const maxBuffer = options.maxBuffer || DEFAULT_CODEX_MAX_BUFFER

  return request => {
    const prompt = createCodexPrompt(request)
    const args = buildCodexCliArgs(prompt, { ...options, cwd })

    return new Promise((resolve, reject) => {
      let settled = false
      let stdout = ''
      let stderr = ''
      fs.mkdirSync(cwd, { recursive: true })
      const child = spawn(command, args, { cwd, windowsHide: true })
      const timeoutHandle = setTimeout(() => {
        if (settled) return
        child.kill()
      }, timeout)

      child.stdout.on('data', chunk => {
        stdout += chunk.toString()
        if (stdout.length > maxBuffer && !settled) {
          settled = true
          clearTimeout(timeoutHandle)
          child.kill()
          reject(new Error(`Codex output exceeded ${maxBuffer} bytes`))
        }
      })

      child.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })

      child.on('error', err => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle)
        err.stderr = stderr
        reject(err)
      })

      child.on('close', code => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle)
        if (code !== 0) {
          const err = new Error(`Command failed: ${command} ${args.join(' ')}`)
          err.stderr = stderr
          reject(err)
          return
        }

        resolve(cleanCodexReply(stdout))
      })

      child.stdin.end(prompt)
    })
  }
}

function mentionsBot (botName, message) {
  if (!botName || !message) return false
  const escapedName = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\W)${escapedName}(\\W|$)`, 'i').test(message)
}

function isParsedWhisperTail (botName, message) {
  if (!message) return false
  if (/^me]\s+/i.test(message)) return true
  if (!botName) return false

  const escapedName = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escapedName}\\]\\s+`, 'i').test(message)
}

function isServerAnnouncementUsername (username) {
  return /^(joined|left|discord|mcmmo|holoquiz)$/i.test(String(username || ''))
}

async function respondWithCodex (bot, request, options) {
  const debugLog = options.debugLog || (() => {})
  const errorOutput = options.errorOutput || console.error

  try {
    debugLog('aiChat.request', {
      channel: request.channel,
      username: request.username,
      message: request.message
    })
    const response = cleanCodexReply(await options.runCodex(request))

    if (request.channel === 'private' && typeof bot.whisper === 'function') {
      bot.whisper(request.username, response)
    } else {
      bot.chat(`@${request.username} ${response}`)
    }

    debugLog('aiChat.response', {
      channel: request.channel,
      username: request.username,
      response
    })
  } catch (err) {
    errorOutput(`AI chat error for ${request.username} (${request.channel}): ${err.message}`)
    if (err.stderr) errorOutput(err.stderr)

    debugLog('aiChat.error', {
      channel: request.channel,
      username: request.username,
      message: err.message,
      stderr: err.stderr
    })
  }
}

function attachAiChat (bot, options = {}) {
  const agentInstructions = options.agentInstructions ?? loadAgentInstructions(options.agentPath)
  const codexOptions = { ...buildCodexOptions(), ...(options.codex || {}) }
  const runCodex = options.runCodex || createCodexCliRunner(codexOptions)
  const state = {
    botName: options.botName,
    agentInstructions,
    runCodex,
    debugLog: options.debugLog,
    errorOutput: options.errorOutput
  }

  bot.on('whisper', (username, message) => {
    if (!username || username === bot.username || !message) return

    respondWithCodex(bot, {
      channel: 'private',
      botName: state.botName || bot.username,
      username,
      message,
      agentInstructions: state.agentInstructions
    }, state)
  })

  bot.on('chat', (username, message) => {
    const botName = state.botName || bot.username
    if (
      !username ||
      username === bot.username ||
      isServerAnnouncementUsername(username) ||
      isParsedWhisperTail(botName, message) ||
      !mentionsBot(botName, message)
    ) return

    respondWithCodex(bot, {
      channel: 'public',
      botName,
      username,
      message,
      agentInstructions: state.agentInstructions
    }, state)
  })

  return bot
}

module.exports = {
  attachAiChat,
  buildCodexCliArgs,
  buildCodexOptions,
  cleanCodexReply,
  createCodexCliRunner,
  createCodexPrompt,
  extractCodexCliPathFromConfig,
  isServerAnnouncementUsername,
  isParsedWhisperTail,
  loadAgentInstructions,
  loadConfiguredCodexCliPath,
  mentionsBot
}
