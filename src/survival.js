const { SURVIVAL_COMMAND_DELAY_MS } = require('./config')
const { sleep } = require('./time')

async function joinSurvivalWorld (bot, options = {}) {
  const wait = options.sleep || sleep
  const commandDelayMs = options.commandDelayMs ?? SURVIVAL_COMMAND_DELAY_MS

  await wait(commandDelayMs)
  bot.chat('/survival')
}

module.exports = {
  joinSurvivalWorld
}
