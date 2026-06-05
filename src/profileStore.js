const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { DEFAULT_AUTH, DEFAULT_BOT_VERSION, DEFAULT_PORT } = require('./config')

const DEFAULT_PROFILE_STORE_PATH = path.join(__dirname, '..', 'data', 'bot-profiles.json')
const DEFAULT_AUTH_ROOT = path.join(__dirname, '..', 'data', 'auth')

function emptyProfileStoreData () {
  return {
    bots: [],
    servers: [],
    logins: {}
  }
}

function getLoginKey (botId, serverId) {
  return `${botId}:${serverId}`
}

function normalizeProfileStoreData (data) {
  return {
    bots: Array.isArray(data?.bots) ? data.bots : [],
    servers: Array.isArray(data?.servers) ? data.servers : [],
    logins: data?.logins && typeof data.logins === 'object' && !Array.isArray(data.logins) ? data.logins : {}
  }
}

function assertNonEmptyString (value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing ${name}.`)
  }
}

function normalizePort (port = DEFAULT_PORT) {
  const parsed = Number.parseInt(port, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error('Server port must be a number from 1 to 65535.')
  }
  return parsed
}

function defaultCreateId (prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function createProfileStore (options = {}) {
  const profilePath = options.profilePath || DEFAULT_PROFILE_STORE_PATH
  const fileSystem = options.fs || fs
  const createId = options.createId || defaultCreateId

  function load () {
    if (!fileSystem.existsSync(profilePath)) return emptyProfileStoreData()
    return normalizeProfileStoreData(JSON.parse(fileSystem.readFileSync(profilePath, 'utf8')))
  }

  function save (data) {
    const normalized = normalizeProfileStoreData(data)
    fileSystem.mkdirSync(path.dirname(profilePath), { recursive: true })
    fileSystem.writeFileSync(profilePath, `${JSON.stringify(normalized, null, 2)}\n`)
    return normalized
  }

  function createBotProfile ({ username, auth = DEFAULT_AUTH }) {
    assertNonEmptyString(username, 'bot username')
    if (!['offline', 'microsoft'].includes(auth)) {
      throw new Error('Bot auth must be offline or microsoft.')
    }

    const data = load()
    const botProfile = {
      id: createId('bot'),
      username: username.trim(),
      auth
    }
    data.bots.push(botProfile)
    save(data)
    return botProfile
  }

  function createServerProfile ({ host, port = DEFAULT_PORT }) {
    assertNonEmptyString(host, 'server host')

    const data = load()
    const serverProfile = {
      id: createId('server'),
      host: host.trim(),
      port: normalizePort(port)
    }
    data.servers.push(serverProfile)
    save(data)
    return serverProfile
  }

  function getServerLoginPassword (botId, serverId) {
    const login = load().logins[getLoginKey(botId, serverId)]
    return typeof login?.password === 'string' ? login.password : null
  }

  function setServerLoginPassword (botId, serverId, password) {
    assertNonEmptyString(botId, 'bot id')
    assertNonEmptyString(serverId, 'server id')
    assertNonEmptyString(password, 'server login password')

    const data = load()
    data.logins[getLoginKey(botId, serverId)] = {
      botId,
      serverId,
      password
    }
    save(data)
    return data.logins[getLoginKey(botId, serverId)]
  }

  return {
    createBotProfile,
    createServerProfile,
    getServerLoginPassword,
    load,
    profilePath,
    save,
    setServerLoginPassword
  }
}

function buildBotOptionsFromProfileSelection (options = {}) {
  const botProfile = options.botProfile
  const serverProfile = options.serverProfile
  const env = options.env || process.env
  const authRoot = options.authRoot || DEFAULT_AUTH_ROOT

  if (!botProfile) throw new Error('Missing selected bot profile.')
  if (!serverProfile) throw new Error('Missing selected server profile.')

  const botOptions = {
    host: serverProfile.host,
    port: normalizePort(serverProfile.port),
    username: botProfile.username,
    auth: botProfile.auth || DEFAULT_AUTH,
    version: env.MINECRAFT_VERSION || DEFAULT_BOT_VERSION,
    physicsEnabled: false,
    hideErrors: true,
    logErrors: false,
    checkTimeoutInterval: 30000,
    closeTimeout: 120000,
    respawn: false
  }

  if (botOptions.auth === 'microsoft') {
    botOptions.profilesFolder = path.join(authRoot, botProfile.id)
  }

  return botOptions
}

module.exports = {
  DEFAULT_AUTH_ROOT,
  DEFAULT_PROFILE_STORE_PATH,
  buildBotOptionsFromProfileSelection,
  createProfileStore,
  emptyProfileStoreData,
  getLoginKey,
  normalizePort,
  normalizeProfileStoreData
}
