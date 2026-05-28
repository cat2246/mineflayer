const { WINDOW_OPEN_TIMEOUT_MS } = require('./config')
const { itemTexts } = require('./text')

function waitForWindowOpen (bot, timeoutMs = WINDOW_OPEN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for a window to open.'))
    }, timeoutMs)

    function cleanup () {
      clearTimeout(timer)
      bot.removeListener('windowOpen', onWindowOpen)
    }

    function onWindowOpen (window) {
      cleanup()
      resolve(window)
    }

    bot.once('windowOpen', onWindowOpen)
  })
}

function summarizeWindowItems (window) {
  if (!window || !Array.isArray(window.slots)) return []

  return window.slots
    .map((item, slot) => ({ item, slot }))
    .filter(({ item }) => item)
    .map(({ item, slot }) => {
      const texts = itemTexts(item)
      const label = texts.slice(0, 6).join(' | ') || item.displayName || item.name || 'unknown'
      return `slot ${slot}: ${item.name || 'unknown'} - ${label}`
    })
}

module.exports = {
  summarizeWindowItems,
  waitForWindowOpen
}
