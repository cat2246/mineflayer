const { cleanText, itemTexts } = require('./text')
const { summarizeWindowItems, waitForWindowOpen } = require('./windows')

function homeNameFromItem (item) {
  const texts = itemTexts(item)
  for (const text of texts) {
    const match = text.match(/click to teleport to\s+(.+)/i)
    if (match) return cleanText(match[1])
  }

  return texts.find(text =>
    text &&
    !/click|shift|right|remove|edit|waypoint|transmit|inventory/i.test(text)
  ) || 'Home'
}

function isFillerMenuItem (item) {
  const text = itemTexts(item).join(' ')
  return /stained glass pane|stained_glass_pane/i.test(text)
}

function isMenuControlItem (item) {
  const name = homeNameFromItem(item)
  return /^(home location|close|back|previous|next)$/i.test(name)
}

function isLikelyHomesMenuSlot (window, slot) {
  const topInventorySlots = Math.min(window.inventoryStart ?? 54, 54)
  return slot < topInventorySlots
}

function isHomeItem (window, item, slot) {
  if (!item || !isLikelyHomesMenuSlot(window, slot)) return false

  const text = itemTexts(item).join(' ')
  if (/click to teleport to/i.test(text)) return true

  if (isFillerMenuItem(item) || isMenuControlItem(item)) return false
  return Boolean(homeNameFromItem(item))
}

function extractHomesFromWindow (window) {
  if (!window || !Array.isArray(window.slots)) return []

  const homes = []
  window.slots.forEach((item, slot) => {
    if (isHomeItem(window, item, slot)) {
      homes.push({
        name: homeNameFromItem(item),
        slot
      })
    }
  })
  return homes
}

async function openHomesMenu (bot, options = {}) {
  const waitForWindow = options.waitForWindowOpen || waitForWindowOpen
  const debugLog = options.debugLog || (() => {})
  const windowPromise = waitForWindow(bot, options.timeoutMs)
  bot.chat('/home')
  const window = await windowPromise
  const summaries = summarizeWindowItems(window)
  const homes = extractHomesFromWindow(window)
  debugLog('homes.window', {
    title: String(window.title || ''),
    slotCount: Array.isArray(window.slots) ? window.slots.length : 0,
    items: summaries
  })
  debugLog('homes.detected', { homes })
  return {
    homes,
    window
  }
}

async function teleportHome (bot, home) {
  await bot.clickWindow(home.slot, 0, 0)
}

module.exports = {
  extractHomesFromWindow,
  homeNameFromItem,
  openHomesMenu,
  teleportHome
}
