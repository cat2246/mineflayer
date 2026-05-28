const path = require('path')
const readline = require('readline')
const { DEBUG_LOG_PATH } = require('./config')
const { openHomesMenu, teleportHome } = require('./homes')

function createCommandConsole (bot, options = {}) {
  const output = options.output || console.log
  const debugLog = options.debugLog || (() => {})
  let pendingHomes = null

  async function handleLine (line) {
    const command = line.trim()
    if (!command) return
    debugLog('console.line', { command })

    if (pendingHomes) {
      const choice = Number.parseInt(command, 10)
      const home = pendingHomes[choice - 1]
      if (!home) {
        output('Choose a valid home number, or type cancel.')
        return
      }
      await teleportHome(bot, home)
      output(`Teleporting to ${home.name}`)
      pendingHomes = null
      return
    }

    if (command.toLowerCase() === 'cancel') {
      pendingHomes = null
      output('Cancelled.')
      return
    }

    if (command.toLowerCase() === 'quit' || command.toLowerCase() === 'exit') {
      bot.quit()
      return
    }

    if (command.toLowerCase() === '/home' || command.toLowerCase() === '/homes') {
      const menu = await openHomesMenu(bot, { debugLog })
      pendingHomes = menu.homes
      if (pendingHomes.length === 0) {
        pendingHomes = null
        output(`No homes found in the homes menu. Details were written to ${path.relative(process.cwd(), DEBUG_LOG_PATH)}.`)
        return
      }

      output('Homes:')
      pendingHomes.forEach((home, index) => {
        output(`${index + 1}. ${home.name}`)
      })
      output('Type a number to teleport, or cancel.')
      return
    }

    bot.chat(command)
  }

  return { handleLine }
}

function startConsole (bot, options = {}) {
  const commandConsole = createCommandConsole(bot, options)
  const input = options.input || process.stdin
  const output = options.outputStream || process.stdout
  const rl = readline.createInterface({ input, output })

  console.log('Terminal control ready. Type /home to choose a home, any /command to send it, or quit to disconnect.')
  rl.on('line', line => {
    commandConsole.handleLine(line).catch(err => {
      console.log('Command error:', err.message)
    })
  })

  bot.once('end', () => rl.close())
  return rl
}

module.exports = {
  createCommandConsole,
  startConsole
}
