const { startWoodCuttingAutomation } = require('./woodcutting')

function createAutomationManager (bot, options = {}) {
  const output = options.output || console.log
  const debugLog = options.debugLog || (() => {})
  let activeAutomation = null

  const automations = options.automations || [
    {
      name: 'Wood cutting',
      start: () => startWoodCuttingAutomation(bot, { output, debugLog })
    }
  ]

  function list () {
    return automations.map(({ name }) => ({ name }))
  }

  async function startByIndex (index) {
    const automation = automations[index]
    if (!automation) {
      output('Choose a valid automation number, or type cancel.')
      return false
    }

    if (activeAutomation?.stop) activeAutomation.stop()
    activeAutomation = await automation.start()
    debugLog('automation.start', { name: automation.name })
    return true
  }

  function stopActive () {
    if (!activeAutomation?.stop) return false
    if (activeAutomation?.stop) activeAutomation.stop()
    activeAutomation = null
    debugLog('automation.stop')
    return true
  }

  bot.once?.('end', stopActive)
  bot.once?.('kicked', stopActive)

  return {
    list,
    startByIndex,
    stopActive
  }
}

module.exports = {
  createAutomationManager
}
