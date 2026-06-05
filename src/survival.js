const {
  SERVER_LOGIN_DELAY_MS,
  SURVIVAL_COMMAND_DELAY_MS,
  buildServerLoginCommand
} = require('./config')
const { sleep } = require('./time')

function isServerLoginPrompt (message) {
  const text = String(message || '').toLowerCase()
  if (text.includes('/register') || text.includes(' register')) return false
  return text.includes('/login') || text.includes('log in') || text.includes('login')
}

async function loginToServer (bot, options = {}) {
  const wait = options.sleep || sleep
  const commandDelayMs = options.commandDelayMs ?? SERVER_LOGIN_DELAY_MS
  const command = options.loginCommand ?? buildServerLoginCommand(options.env)

  if (!command) return false
  if (typeof bot.chat !== 'function') return false
  await wait(commandDelayMs)
  bot.chat(command)
  return true
}

function attachServerLoginPromptHandler (bot, options = {}) {
  const password = options.serverLoginPassword
  const debugLog = options.debugLog || (() => {})
  let sentForConnection = false

  if (typeof bot?.on !== 'function') return bot

  async function sendLoginCommand (reason) {
    if (sentForConnection || !password) return false

    sentForConnection = true
    try {
      const sent = await loginToServer(bot, {
        commandDelayMs: options.commandDelayMs,
        loginCommand: `/login ${password}`,
        sleep: options.sleep
      })
      if (sent) debugLog('command.sent', { command: '/login ***', reason })
      return sent
    } catch (err) {
      sentForConnection = false
      debugLog('command.error', { command: '/login ***', reason, error: err.message })
      return false
    }
  }

  bot.on('spawn', async () => {
    sentForConnection = false
    if (options.loginOnSpawn) await sendLoginCommand('spawn')
  })

  bot.on('message', async (message) => {
    const text = message?.toString ? message.toString() : String(message || '')
    if (!isServerLoginPrompt(text)) return

    debugLog('serverLogin.promptDetected', { hasPassword: typeof password === 'string' && password.length > 0 })
    await sendLoginCommand('server-prompt')
  })

  return bot
}

async function joinSurvivalWorld (bot, options = {}) {
  const wait = options.sleep || sleep
  const commandDelayMs = options.commandDelayMs ?? SURVIVAL_COMMAND_DELAY_MS

  if (typeof bot.chat !== 'function') return false
  await wait(commandDelayMs)
  bot.chat('/survival')
  return true
}

module.exports = {
  attachServerLoginPromptHandler,
  isServerLoginPrompt,
  joinSurvivalWorld,
  loginToServer
}
