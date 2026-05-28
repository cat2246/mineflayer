const readline = require('readline')
const fs = require('fs')
const path = require('path')
const mineflayer = require('mineflayer')

const DEFAULT_HOST = 'play.holocraft.xyz'
const DEFAULT_PORT = 25565
const DEFAULT_USERNAME = 'limwilson2013@gmail.com'
const DEFAULT_BOT_VERSION = '1.21.10'
const VIEWER_PORT = 3007
const SURVIVAL_COMMAND_DELAY_MS = 5000
const PHYSICS_ENABLE_DELAY_MS = 10000
const WINDOW_OPEN_TIMEOUT_MS = 10000
const DEBUG_LOG_PATH = path.join(__dirname, 'logs', 'bot-debug.log')

function createDebugLogger (fileSystem = fs, logPath = DEBUG_LOG_PATH) {
  try {
    if (typeof fileSystem.mkdirSync === 'function') {
      fileSystem.mkdirSync(path.dirname(logPath), { recursive: true })
    }
  } catch {
    // If directory creation fails, appendFileSync below will surface it.
  }

  return function debugLog (event, data = {}) {
    const entry = {
      time: new Date().toISOString(),
      event,
      data
    }

    try {
      fileSystem.appendFileSync(logPath, `${JSON.stringify(entry)}\n`)
    } catch (err) {
      console.log('Debug log error:', err.message)
    }
  }
}

function buildBotOptions (argv = process.argv, env = process.env) {
  const username = env.MINECRAFT_USERNAME || argv[2] || DEFAULT_USERNAME
  const version = env.MINECRAFT_VERSION || argv[3] || DEFAULT_BOT_VERSION

  if (!username) {
    throw new Error('Missing Microsoft account identifier. Set MINECRAFT_USERNAME or pass it as the first argument.')
  }

  return {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    username,
    auth: 'microsoft',
    version,
    physicsEnabled: false,
    hideErrors: false,
    checkTimeoutInterval: 30000,
    closeTimeout: 120000
  }
}

function buildViewerOptions () {
  return {
    port: VIEWER_PORT,
    firstPerson: true
  }
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

function cleanText (text) {
  return String(text).replace(/§[0-9a-fk-or]/gi, '').trim()
}

function collectTextParts (value, parts = [], seen = new WeakSet()) {
  if (value === undefined || value === null) return parts

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        collectTextParts(JSON.parse(trimmed), parts, seen)
        return parts
      } catch {
        // Fall through and treat it as plain text.
      }
    }
    const cleaned = cleanText(value)
    if (cleaned) parts.push(cleaned)
    return parts
  }

  if (typeof value !== 'object') return parts
  if (seen.has(value)) return parts
  seen.add(value)

  if (Array.isArray(value)) {
    for (const entry of value) collectTextParts(entry, parts, seen)
    return parts
  }

  if (Object.prototype.hasOwnProperty.call(value, 'text')) {
    collectTextParts(value.text, parts, seen)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'extra')) {
    collectTextParts(value.extra, parts, seen)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'with')) {
    collectTextParts(value.with, parts, seen)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'value')) {
    collectTextParts(value.value, parts, seen)
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'text') &&
      !Object.prototype.hasOwnProperty.call(value, 'extra') &&
      !Object.prototype.hasOwnProperty.call(value, 'with') &&
      !Object.prototype.hasOwnProperty.call(value, 'value')) {
    for (const entry of Object.values(value)) collectTextParts(entry, parts, seen)
  }

  return parts
}

function itemTexts (item) {
  if (!item) return []
  return collectTextParts([
    item.customName,
    item.displayName,
    item.name,
    item.nbt
  ])
}

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

async function joinSurvivalWorld (bot, options = {}) {
  const wait = options.sleep || sleep
  const commandDelayMs = options.commandDelayMs ?? SURVIVAL_COMMAND_DELAY_MS

  await wait(commandDelayMs)
  bot.chat('/survival')
}

function loadMineflayerViewer () {
  return require('prismarine-viewer').mineflayer
}

function startViewer (bot, mineflayerViewer = loadMineflayerViewer(), options = buildViewerOptions()) {
  const viewer = mineflayerViewer(bot, options)
  console.log(`Viewer running at http://localhost:${options.port}`)
  return viewer
}

function attachEventLogging (bot, options = {}) {
  const joinWorld = options.joinSurvivalWorld || joinSurvivalWorld
  const showViewer = options.startViewer || startViewer
  const wait = options.sleep || sleep
  const debugLog = options.debugLog || createDebugLogger()
  let spawnCount = 0

  bot.once('login', () => {
    console.log(`Logged in as ${bot.username}`)
    debugLog('login', { username: bot.username })
  })

  bot.on('resourcePack', (url) => {
    console.log(`Accepting resource pack: ${url}`)
    debugLog('resourcePack', { url })
    if (typeof bot.acceptResourcePack === 'function') {
      bot.acceptResourcePack()
    }
  })

  bot.on('spawn', async () => {
    spawnCount++
    console.log(`Spawned on ${DEFAULT_HOST}`)
    debugLog('spawn', {
      spawnCount,
      username: bot.username,
      version: bot.version,
      physicsEnabled: bot.physicsEnabled,
      position: bot.entity?.position
    })

    if (spawnCount === 1) {
      showViewer(bot)

      try {
        await joinWorld(bot)
        console.log('Sent /survival command')
        debugLog('command.sent', { command: '/survival' })
      } catch (err) {
        console.log('Could not join Survival world:', err.message)
        debugLog('command.error', { command: '/survival', error: err.message })
      }

      return
    }

    await wait(PHYSICS_ENABLE_DELAY_MS)
    if (!bot._ended) {
      bot.physicsEnabled = true
      console.log('Physics enabled')
      debugLog('physics.enabled', { spawnCount })
    }
  })

  bot.on('windowOpen', (window) => {
    debugLog('windowOpen', {
      title: String(window.title || ''),
      slotCount: Array.isArray(window.slots) ? window.slots.length : 0,
      items: summarizeWindowItems(window)
    })
  })

  bot.on('chat', (username, message) => {
    debugLog('chat', { username, message })
  })

  bot.on('message', (message) => {
    debugLog('message', { message: message.toString() })
  })

  bot.on('kicked', (reason) => {
    console.log('Kicked from server:', reason)
    debugLog('kicked', { reason })
  })

  bot.on('error', (err) => {
    console.log('Bot error:', err)
    debugLog('error', { message: err.message, stack: err.stack })
  })

  return bot
}

function createBot (options = buildBotOptions()) {
  const debugLog = createDebugLogger()
  debugLog('bot.start', {
    host: options.host,
    port: options.port,
    username: options.username,
    version: options.version
  })
  const bot = attachEventLogging(mineflayer.createBot(options), { debugLog })
  startConsole(bot, { debugLog })
  return bot
}

function start () {
  try {
    return createBot()
  } catch (err) {
    console.error(err.message)
    console.error('Usage: node bot.js <microsoft-account-email-or-identifier>')
    process.exitCode = 1
    return null
  }
}

if (require.main === module) {
  start()
}

module.exports = {
  attachEventLogging,
  buildBotOptions,
  buildViewerOptions,
  createCommandConsole,
  createDebugLogger,
  createBot,
  extractHomesFromWindow,
  joinSurvivalWorld,
  loadMineflayerViewer,
  openHomesMenu,
  startConsole,
  startViewer,
  start,
  summarizeWindowItems,
  teleportHome
}
