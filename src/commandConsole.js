const path = require('path')
const readline = require('readline')
const { createAutomationManager } = require('./automations')
const { DEBUG_LOG_PATH } = require('./config')
const { createFollowController } = require('./follow')
const { openHomesMenu, teleportHome } = require('./homes')

function parseMessageCommand (command) {
  if (command.toLowerCase() === '/message') return ''

  const match = command.match(/^\/message\s+(.+)$/i)
  return match ? match[1] : null
}

function createCommandConsole (bot, options = {}) {
  const output = options.output || console.log
  const debugLog = options.debugLog || (() => {})
  const automationManager = options.automationManager || createAutomationManager(bot, { output, debugLog })
  const followController = options.followController || createFollowController(bot, { output, debugLog })
  const knockbackController = options.knockbackController
  let pendingHomes = null
  let pendingAutomation = false

  async function handleLine (line) {
    const command = line.trim()
    if (!command) return
    debugLog('console.line', { command })

    if (command.toLowerCase() === 'cancel') {
      pendingHomes = null
      pendingAutomation = false
      output('Cancelled.')
      return
    }

    const message = parseMessageCommand(command)
    if (message !== null) {
      if (!message) {
        output('Usage: /message <message-or-command>')
        return
      }

      bot.chat(message)
      return
    }

    if (pendingAutomation) {
      const choice = Number.parseInt(command, 10)
      if (!Number.isInteger(choice)) {
        output('Choose a valid automation number, or type cancel.')
        return
      }
      const started = await automationManager.startByIndex(choice - 1)
      if (started !== false) pendingAutomation = false
      return
    }

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

    if (command.toLowerCase() === 'quit' || command.toLowerCase() === 'exit') {
      bot.quit()
      return
    }

    if (command.toLowerCase() === '/automation stop' || command.toLowerCase() === '/automations stop') {
      const stopped = automationManager.stopActive()
      output(stopped ? 'Stopped automation.' : 'No automation is running.')
      return
    }

    const followMatch = command.match(/^\/follow\s+(\S+)$/i)
    if (followMatch) {
      const result = await followController.followPlayer(followMatch[1])
      output(result.message)
      return
    }

    if (command.toLowerCase() === '/follow') {
      output('Usage: /follow <player>')
      return
    }

    if (command.toLowerCase() === '/unfollow') {
      const result = followController.unfollow()
      output(result.message)
      return
    }

    if (command.toLowerCase() === '/pickup') {
      const result = followController.togglePickup()
      output(result.message)
      return
    }

    if (command.toLowerCase() === '/unload inventory') {
      const result = await followController.unloadInventory()
      output(result.message)
      return
    }

    if (command.toLowerCase() === '/knockback debug') {
      if (!knockbackController?.toggleDebug) {
        output('Knockback debug is not available.')
        return
      }
      const result = knockbackController.toggleDebug()
      output(result.message)
      if (result.enabled) output(`Hit the bot once, then check ${path.relative(process.cwd(), DEBUG_LOG_PATH)}.`)
      return
    }

    if (command.toLowerCase() === '/help') {
      const helpLines = typeof followController.helpLines === 'function'
        ? followController.helpLines()
        : [
            '/follow <player> - follow a player',
            '/unfollow - stop following',
            '/pickup - toggle dropped item pickup',
            '/unload inventory - unload into a nearby chest',
            '/knockback debug - toggle knockback diagnostics',
            '/help - show commands'
          ]
      output('Commands:')
      helpLines.forEach(line => output(line))
      output('/knockback debug - toggle knockback diagnostics')
      return
    }

    if (command.toLowerCase() === '/automation' || command.toLowerCase() === '/automations') {
      const automations = automationManager.list()
      if (automations.length === 0) {
        output('No automations are available.')
        return
      }

      pendingAutomation = true
      output('Automations:')
      automations.forEach((automation, index) => {
        output(`${index + 1}. ${automation.name}`)
      })
      output('Type a number to start, or cancel.')
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

  console.log('Terminal control ready. Type /home to choose a home, /message <text-or-command> to chat, or quit to disconnect.')
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
  parseMessageCommand,
  startConsole
}
