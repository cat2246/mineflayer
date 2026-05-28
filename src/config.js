const path = require('path')

const DEFAULT_HOST = 'play.holocraft.xyz'
const DEFAULT_PORT = 25565
const DEFAULT_USERNAME = 'limwilson2013@gmail.com'
const DEFAULT_BOT_VERSION = '1.21.10'
const VIEWER_PORT = 3007
const SURVIVAL_COMMAND_DELAY_MS = 5000
const PHYSICS_ENABLE_DELAY_MS = 10000
const WINDOW_OPEN_TIMEOUT_MS = 10000
const DEBUG_LOG_PATH = path.join(__dirname, '..', 'logs', 'bot-debug.log')

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

module.exports = {
  DEBUG_LOG_PATH,
  DEFAULT_BOT_VERSION,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_USERNAME,
  PHYSICS_ENABLE_DELAY_MS,
  SURVIVAL_COMMAND_DELAY_MS,
  VIEWER_PORT,
  WINDOW_OPEN_TIMEOUT_MS,
  buildBotOptions,
  buildViewerOptions
}
