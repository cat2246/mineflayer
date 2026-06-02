const {
  SERVER_LOGIN_DELAY_MS,
  SURVIVAL_COMMAND_DELAY_MS,
  buildServerLoginCommand
} = require('./config')
const { sleep } = require('./time')

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

async function joinSurvivalWorld (bot, options = {}) {
  const wait = options.sleep || sleep
  const commandDelayMs = options.commandDelayMs ?? SURVIVAL_COMMAND_DELAY_MS

  if (typeof bot.chat !== 'function') return false
  await wait(commandDelayMs)
  bot.chat('/survival')
  return true
}

module.exports = {
  joinSurvivalWorld,
  loginToServer
}
