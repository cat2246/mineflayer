/* eslint-env mocha */

const assert = require('assert')
const EventEmitter = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')

describe('holocraft bot config', function () {
  this.timeout(10000)

  it('profile store starts empty when no local file exists', () => {
    const { createProfileStore } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-profiles-'))
    const store = createProfileStore({
      profilePath: path.join(tempDir, 'bot-profiles.json')
    })

    assert.deepStrictEqual(store.load(), {
      bots: [],
      servers: [],
      logins: {}
    })
  })

  it('creates default NPC life state when no local file exists', () => {
    const { readNpcLife, NPC_LIFE_VERSION } = require('../bot')
    const lifePath = tempNpcLifePath()

    const life = readNpcLife({ npcLifePath: lifePath, now: () => 1000 })

    assert.strictEqual(life.version, NPC_LIFE_VERSION)
    assert.strictEqual(life.currentLifestyle, 'survivalist')
    assert.strictEqual(life.currentGoal.id, 'survive-and-settle')
    assert.deepStrictEqual(life.recentEvents, [])
  })

  it('resolves sanitized per-bot memory paths from bot username', () => {
    const { resolveBotMemoryPaths } = require('../bot')
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-memory-')), 'bots')

    const paths = resolveBotMemoryPaths({
      username: 'Pyro Farm/Bot'
    }, { botMemoryRoot: root })

    assert.strictEqual(paths.botId, 'pyro-farm-bot')
    assert.strictEqual(paths.root, path.join(root, 'pyro-farm-bot'))
    assert.strictEqual(paths.missingToolsPath, path.join(root, 'pyro-farm-bot', 'missing-tools.json'))
    assert.strictEqual(paths.memorySummaryPath, path.join(root, 'pyro-farm-bot', 'memory-summary.json'))
    assert.strictEqual(paths.eventLogPath, path.join(root, 'pyro-farm-bot', 'event-log.jsonl'))
    assert.strictEqual(paths.debugLogPath, path.join(root, 'pyro-farm-bot', 'debug.log'))
  })

  it('uses configured profile id before username for per-bot memory', () => {
    const { resolveBotMemoryPaths } = require('../bot')
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-memory-')), 'bots')

    const paths = resolveBotMemoryPaths({
      username: 'VisibleName',
      profile: { id: '1234-ABCD main' }
    }, { botMemoryRoot: root })

    assert.strictEqual(paths.botId, '1234-abcd-main')
    assert.strictEqual(paths.root, path.join(root, '1234-abcd-main'))
  })

  it('normalizes malformed NPC life state safely', () => {
    const { normalizeNpcLife } = require('../bot')

    const life = normalizeNpcLife({
      traits: { curious: 500, cautious: -10 },
      lifestyles: { homesteader: 120, explorer: -5 },
      currentLifestyle: 'unknown',
      currentGoal: { id: '' },
      recentEvents: [
        {
          type: 'player_nearby',
          player: ' Steve ',
          reason: 'hello'.repeat(80),
          ignored: 'drop me',
          at: 1500
        }
      ],
      lifeStory: [123, 'I built a fence.']
    }, { now: () => 2000 })

    assert.strictEqual(life.traits.curious, 100)
    assert.strictEqual(life.traits.cautious, 0)
    assert.strictEqual(life.lifestyles.homesteader, 100)
    assert.strictEqual(life.lifestyles.explorer, 0)
    assert.strictEqual(life.currentLifestyle, 'survivalist')
    assert.strictEqual(life.currentGoal.id, 'survive-and-settle')
    assert.strictEqual(life.recentEvents[0].player, 'Steve')
    assert.strictEqual(life.recentEvents[0].reason.length, 180)
    assert.strictEqual(life.recentEvents[0].ignored, undefined)
    assert.deepStrictEqual(life.lifeStory, ['I built a fence.'])
  })

  it('normalizes goals safely without an explicit fallback', () => {
    const { normalizeGoal } = require('../bot')

    assert.strictEqual(normalizeGoal({ id: '' }).id, 'survive-and-settle')
    assert.strictEqual(normalizeGoal({ id: 'custom' }).selectedAt, 0)
  })

  it('normalizes recent event timestamps from persisted updatedAt', () => {
    const { normalizeNpcLife } = require('../bot')
    const rawLife = {
      updatedAt: 7777,
      recentEvents: [{
        type: 'automation_started',
        automation: 'Farming'
      }]
    }

    const first = normalizeNpcLife(rawLife, { now: () => 8888 })
    const second = normalizeNpcLife(rawLife, { now: () => 9999 })

    assert.strictEqual(first.recentEvents[0].at, 7777)
    assert.strictEqual(second.recentEvents[0].at, 7777)
  })

  it('evolves toward homesteader after repeated homesteader events', () => {
    const { applyNpcLifeEvent, emptyNpcLife } = require('../bot')
    let life = emptyNpcLife({ now: () => 1000 })

    for (let i = 0; i < 6; i++) {
      life = applyNpcLifeEvent(life, {
        type: 'automation_started',
        automation: 'Farming',
        at: 1000 + i
      }, { now: () => 1000 + i })
    }

    assert.strictEqual(life.currentLifestyle, 'homesteader')
    assert.strictEqual(life.previousLifestyle, 'survivalist')
    assert(life.lifeStory.some(entry => entry.includes('homesteader')))
  })

  it('preserves bounded recent event payload fields', () => {
    const { applyNpcLifeEvent, emptyNpcLife, eventDeltas } = require('../bot')

    const life = applyNpcLifeEvent(emptyNpcLife({ now: () => 1000 }), {
      type: 'automation_started',
      automation: 'Farming',
      reason: 'farm life',
      extra: 'drop me',
      at: 1234
    }, { now: () => 2000 })

    assert.deepStrictEqual(life.recentEvents[0], {
      type: 'automation_started',
      at: 1234,
      automation: 'Farming',
      reason: 'farm life'
    })
    assert.deepStrictEqual(eventDeltas(null), {})
  })

  it('selects food and night safety goals from current needs', () => {
    const { chooseNpcGoal, emptyNpcLife } = require('../bot')
    const life = emptyNpcLife({ now: () => 1000 })

    assert.strictEqual(chooseNpcGoal(life, { food: 8, isNight: false, unsafe: false }, { now: () => 2000 }).id, 'secure-food')
    assert.strictEqual(chooseNpcGoal(life, { food: 20, isNight: true, unsafe: false }, { now: () => 3000 }).id, 'stay-safe-until-morning')
  })

  it('updates NPC life with a selected goal', () => {
    const { emptyNpcLife, updateNpcGoal } = require('../bot')
    const life = emptyNpcLife({ now: () => 1000 })

    const updated = updateNpcGoal(life, { food: 8 }, { now: () => 2000 })

    assert.strictEqual(updated.currentGoal.id, 'secure-food')
    assert.strictEqual(updated.updatedAt, 2000)
  })

  it('uses one timestamp when updating the selected goal', () => {
    const { emptyNpcLife, updateNpcGoal } = require('../bot')
    let now = 2000
    const clock = () => now++
    const life = emptyNpcLife({ now: () => 1000 })

    const updated = updateNpcGoal(life, { food: 8 }, { now: clock })

    assert.strictEqual(updated.updatedAt, updated.currentGoal.selectedAt)
  })

  it('profile store creates offline and online bot profiles locally', () => {
    const { createProfileStore } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-profiles-'))
    const store = createProfileStore({
      createId: value => `id-${value}`,
      profilePath: path.join(tempDir, 'bot-profiles.json')
    })

    const offlineBot = store.createBotProfile({
      username: 'OfflineSteve',
      auth: 'offline'
    })
    const onlineBot = store.createBotProfile({
      username: 'player@example.com',
      auth: 'microsoft'
    })

    assert.strictEqual(offlineBot.id, 'id-bot')
    assert.strictEqual(onlineBot.auth, 'microsoft')
    assert.deepStrictEqual(store.load().bots.map(bot => bot.username), [
      'OfflineSteve',
      'player@example.com'
    ])
  })

  it('profile store creates servers and saves a password per bot/server pair', () => {
    const { createProfileStore } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-profiles-'))
    let nextId = 0
    const store = createProfileStore({
      createId: prefix => `${prefix}-${++nextId}`,
      profilePath: path.join(tempDir, 'bot-profiles.json')
    })

    const bot = store.createBotProfile({ username: 'OfflineSteve', auth: 'offline' })
    const server = store.createServerProfile({ host: 'localhost', port: 25566 })

    assert.deepStrictEqual(server, {
      id: 'server-2',
      host: 'localhost',
      port: 25566
    })
    assert.strictEqual(store.getServerLoginPassword(bot.id, server.id), null)

    store.setServerLoginPassword(bot.id, server.id, 'secret-password')

    assert.strictEqual(store.getServerLoginPassword(bot.id, server.id), 'secret-password')
    assert.strictEqual(store.load().logins[`${bot.id}:${server.id}`].password, 'secret-password')
  })

  it('builds Mineflayer options from selected local bot and server profiles', () => {
    const { buildBotOptionsFromProfileSelection } = require('../bot')

    const options = buildBotOptionsFromProfileSelection({
      botProfile: {
        id: 'bot-1',
        username: 'player@example.com',
        auth: 'microsoft'
      },
      serverProfile: {
        id: 'server-1',
        host: 'mc.example.test',
        port: 25570
      },
      env: {
        MINECRAFT_VERSION: '1.21.5'
      },
      authRoot: 'C:\\local\\auth'
    })

    assert.strictEqual(options.host, 'mc.example.test')
    assert.strictEqual(options.port, 25570)
    assert.strictEqual(options.username, 'player@example.com')
    assert.strictEqual(options.auth, 'microsoft')
    assert.strictEqual(options.version, '1.21.5')
    assert.strictEqual(options.profilesFolder, path.join('C:\\local\\auth', 'bot-1'))
    assert.strictEqual(options.physicsEnabled, false)
  })

  it('start menu hides select-bot until a bot exists', () => {
    const { getMainMenuOptions } = require('../bot')

    assert.deepStrictEqual(getMainMenuOptions({ bots: [] }), ['Create new bot'])
    assert.deepStrictEqual(getMainMenuOptions({ bots: [{ id: 'bot-1' }] }), [
      'Create new bot',
      'Select a bot'
    ])
  })

  it('start menu hides select-server until a server exists', () => {
    const { getServerMenuOptions } = require('../bot')

    assert.deepStrictEqual(getServerMenuOptions({ servers: [] }), ['Create a new server'])
    assert.deepStrictEqual(getServerMenuOptions({ servers: [{ id: 'server-1' }] }), [
      'Create a new server',
      'Select a server'
    ])
  })

  it('start menu starts a selected bot on a selected server with a saved password', async () => {
    const { createProfileStore, startInteractiveMenu } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-profiles-'))
    let nextId = 0
    const store = createProfileStore({
      createId: prefix => `${prefix}-${++nextId}`,
      profilePath: path.join(tempDir, 'bot-profiles.json')
    })
    const botProfile = store.createBotProfile({ username: 'OfflineSteve', auth: 'offline' })
    const serverProfile = store.createServerProfile({ host: 'localhost', port: 25566 })
    store.setServerLoginPassword(botProfile.id, serverProfile.id, 'secret-password')
    const answers = ['2', '1', '2', '1']
    const started = []

    const result = await startInteractiveMenu({
      authRoot: path.join(tempDir, 'auth'),
      createBot: (botOptions, runtimeOptions) => {
        started.push({ botOptions, runtimeOptions })
        return { username: botOptions.username }
      },
      env: {},
      output: { write: () => {} },
      prompt: async () => answers.shift(),
      store
    })

    assert.deepStrictEqual(result, { username: 'OfflineSteve' })
    assert.strictEqual(started[0].botOptions.host, 'localhost')
    assert.strictEqual(started[0].botOptions.port, 25566)
    assert.strictEqual(started[0].botOptions.username, 'OfflineSteve')
    assert.strictEqual(started[0].runtimeOptions.serverLoginPassword, 'secret-password')
    assert.strictEqual(started[0].runtimeOptions.serverLabel, 'localhost:25566')
  })

  it('start menu asks for and saves a missing bot/server password before joining', async () => {
    const { createProfileStore, startInteractiveMenu } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-profiles-'))
    let nextId = 0
    const store = createProfileStore({
      createId: prefix => `${prefix}-${++nextId}`,
      profilePath: path.join(tempDir, 'bot-profiles.json')
    })
    const botProfile = store.createBotProfile({ username: 'OfflineSteve', auth: 'offline' })
    const serverProfile = store.createServerProfile({ host: 'localhost', port: 25566 })
    const answers = ['2', '1', '2', '1', 'new-secret-password']
    const started = []

    await startInteractiveMenu({
      createBot: (botOptions, runtimeOptions) => {
        started.push({ botOptions, runtimeOptions })
        return botOptions
      },
      env: {},
      output: { write: () => {} },
      prompt: async () => answers.shift(),
      store
    })

    assert.strictEqual(started[0].runtimeOptions.serverLoginPassword, 'new-secret-password')
    assert.strictEqual(store.getServerLoginPassword(botProfile.id, serverProfile.id), 'new-secret-password')
  })

  it('requires explicit host and username when building bot options directly', () => {
    const { buildBotOptions } = require('../bot')

    assert.throws(() => buildBotOptions(['node', 'bot.js'], {}), /Missing Minecraft host/)
  })

  it('builds direct bot options from explicit environment credentials', () => {
    const { buildBotOptions } = require('../bot')

    const options = buildBotOptions(['node', 'bot.js'], {
      MINECRAFT_HOST: 'mc.example.test',
      MINECRAFT_USERNAME: 'OfflineSteve'
    })

    assert.deepStrictEqual(options, {
      host: 'mc.example.test',
      port: 25565,
      username: 'OfflineSteve',
      auth: 'offline',
      version: '1.21.10',
      physicsEnabled: false,
      hideErrors: true,
      logErrors: false,
      checkTimeoutInterval: 30000,
      closeTimeout: 120000,
      respawn: false
    })
  })

  it('allows overriding the Minecraft version from the environment', () => {
    const { buildBotOptions } = require('../bot')

    const options = buildBotOptions(['node', 'bot.js'], {
      MINECRAFT_HOST: 'mc.example.test',
      MINECRAFT_USERNAME: 'env@example.com',
      MINECRAFT_VERSION: '1.21.5'
    })

    assert.strictEqual(options.version, '1.21.5')
  })

  it('reads the host and username from the environment first', () => {
    const { buildBotOptions } = require('../bot')

    const options = buildBotOptions(['node', 'bot.js', 'cli.example.test', 'cli@example.com'], {
      MINECRAFT_HOST: 'env.example.test',
      MINECRAFT_USERNAME: 'env@example.com'
    })

    assert.strictEqual(options.host, 'env.example.test')
    assert.strictEqual(options.username, 'env@example.com')
  })

  it('allows overriding Minecraft auth mode from the environment', () => {
    const { buildBotOptions } = require('../bot')

    const options = buildBotOptions(['node', 'bot.js'], {
      MINECRAFT_HOST: 'mc.example.test',
      MINECRAFT_USERNAME: 'premium@example.com',
      MINECRAFT_AUTH: 'microsoft'
    })

    assert.strictEqual(options.auth, 'microsoft')
  })

  it('uses first-person viewer defaults on port 3007', () => {
    const { buildViewerOptions } = require('../bot')

    assert.deepStrictEqual(buildViewerOptions(), {
      port: 3007,
      firstPerson: true
    })
  })

  it('configures conservative pathfinder movements without using pathfinder door placement', () => {
    const { configureConservativeMovements } = require('../bot')
    const movements = {
      canDig: true,
      allowSprinting: true,
      allowParkour: true,
      allow1by1towers: true,
      maxDropDown: 4
    }

    assert.strictEqual(configureConservativeMovements(movements), movements)
    assert.strictEqual(movements.canDig, false)
    assert.strictEqual(movements.allowSprinting, false)
    assert.strictEqual(movements.allowParkour, false)
    assert.strictEqual(movements.allow1by1towers, false)
    assert.strictEqual(movements.canOpenDoors, false)
    assert.strictEqual(movements.maxDropDown, 2)
  })

  it('disconnects the bot when the process receives a shutdown signal', () => {
    const { attachShutdownHandlers } = require('../bot')
    const bot = {
      quitCalls: 0,
      viewer: { closeCalls: 0, close: () => { bot.viewer.closeCalls++ } },
      quit: () => { bot.quitCalls++ }
    }
    const signals = ['bot-test-shutdown']

    attachShutdownHandlers(bot, signals)
    process.emit('bot-test-shutdown')
    process.emit('bot-test-shutdown')

    assert.strictEqual(bot.quitCalls, 1)
    assert.strictEqual(bot.viewer.closeCalls, 1)
    assert.strictEqual(bot.__manualShutdown, true)
  })

  it('reconnects the bot three minutes after an unexpected disconnect', () => {
    const { attachReconnectHandler } = require('../bot')
    const events = []
    const bot = new EventEmitter()

    attachReconnectHandler(bot, {
      reconnectDelayMs: 180000,
      reconnect: () => events.push(['reconnect']),
      debugLog: (event, data) => events.push(['debug', event, data]),
      setTimeout: (callback, delayMs) => {
        events.push(['setTimeout', delayMs])
        callback()
        return { unref: () => events.push(['unref']) }
      }
    })

    bot.emit('end')
    bot.emit('end')

    assert.deepStrictEqual(events, [
      ['debug', 'bot.reconnect.scheduled', { reconnectDelayMs: 180000 }],
      ['setTimeout', 180000],
      ['reconnect'],
      ['unref']
    ])
  })

  it('does not reconnect after an intentional shutdown', () => {
    const { attachReconnectHandler } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    bot.__manualShutdown = true

    attachReconnectHandler(bot, {
      reconnect: () => events.push(['reconnect']),
      debugLog: (event, data) => events.push(['debug', event, data]),
      setTimeout: () => {
        events.push(['setTimeout'])
      }
    })

    bot.emit('end')

    assert.deepStrictEqual(events, [
      ['debug', 'bot.reconnect.skipped', { reason: 'manual-shutdown' }]
    ])
  })

  it('reconnects immediately after an intentional reconnect request', () => {
    const { attachReconnectHandler } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    bot.__manualReconnect = true

    attachReconnectHandler(bot, {
      reconnectDelayMs: 180000,
      reconnect: () => events.push(['reconnect']),
      debugLog: (event, data) => events.push(['debug', event, data]),
      setTimeout: () => {
        events.push(['setTimeout'])
      }
    })

    bot.emit('end')

    assert.deepStrictEqual(events, [
      ['debug', 'bot.reconnect.immediate', { reason: 'manual-reconnect' }],
      ['reconnect']
    ])
    assert.strictEqual(bot.__manualReconnect, false)
  })

  it('starts prismarine-viewer with the bot and viewer options', async () => {
    const { startViewer } = require('../bot')
    const calls = []
    const bot = {}

    const viewer = await startViewer(bot, (viewerBot, options) => {
      calls.push({ viewerBot, options })
      bot.viewer = 'viewer'
    }, {
      port: 3007,
      firstPerson: true,
      isPortAvailable: async () => true
    })

    assert.deepStrictEqual(calls, [{
      viewerBot: bot,
      options: {
        port: 3007,
        firstPerson: true
      }
    }])
    assert.strictEqual(viewer, 'viewer')
  })

  it('skips prismarine-viewer when the viewer port is already in use', async () => {
    const { startViewer } = require('../bot')
    const calls = []

    const viewer = await startViewer({}, () => {
      calls.push('start')
    }, {
      port: 3007,
      firstPerson: false,
      isPortAvailable: async () => false
    })

    assert.strictEqual(viewer, null)
    assert.deepStrictEqual(calls, [])
  })

  it('closes prismarine-viewer only once', () => {
    const { closeViewer } = require('../bot')
    const bot = {
      viewer: {
        closeCalls: 0,
        close: () => { bot.viewer.closeCalls++ }
      }
    }

    closeViewer(bot)
    closeViewer(bot)

    assert.strictEqual(bot.viewer.closeCalls, 1)
  })

  it('loads the real prismarine-viewer mineflayer integration', function () {
    this.timeout(10000)
    const { loadMineflayerViewer } = require('../bot')

    assert.strictEqual(typeof loadMineflayerViewer(), 'function')
  })

  it('waits 5 seconds before sending the Survival command', async () => {
    const { joinSurvivalWorld } = require('../bot')
    const sleeps = []
    const messages = []
    const bot = {
      chat: (message) => {
        messages.push(message)
      }
    }

    await joinSurvivalWorld(bot, {
      sleep: async (ms) => sleeps.push(ms)
    })

    assert.deepStrictEqual(sleeps, [5000])
    assert.deepStrictEqual(messages, ['/survival'])
  })

  it('sends an explicit server login command when requested', async () => {
    const { loginToServer } = require('../bot')
    const sleeps = []
    const messages = []
    const bot = {
      chat: (message) => {
        messages.push(message)
      }
    }

    await loginToServer(bot, {
      loginCommand: '/login secret-password',
      sleep: async (ms) => sleeps.push(ms)
    })

    assert.deepStrictEqual(sleeps, [1000])
    assert.deepStrictEqual(messages, ['/login secret-password'])
  })

  it('does not throw login errors when chat is unavailable', async () => {
    const { loginToServer, joinSurvivalWorld } = require('../bot')
    const sleeps = []
    const bot = {}

    assert.strictEqual(await loginToServer(bot, {
      sleep: async ms => sleeps.push(ms)
    }), false)
    assert.strictEqual(await joinSurvivalWorld(bot, {
      sleep: async ms => sleeps.push(ms)
    }), false)
    assert.deepStrictEqual(sleeps, [])
  })

  it('detects server login prompts without treating register prompts as login prompts', () => {
    const { isServerLoginPrompt } = require('../bot')

    assert.strictEqual(isServerLoginPrompt('Please login with /login <password>'), true)
    assert.strictEqual(isServerLoginPrompt('You need to log in before playing'), true)
    assert.strictEqual(isServerLoginPrompt('Please register with /register <password>'), false)
    assert.strictEqual(isServerLoginPrompt('Welcome back'), false)
  })

  it('sends the saved server password only after a login prompt', async () => {
    const { attachServerLoginPromptHandler } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    const sleeps = []
    bot.chat = message => messages.push(message)

    attachServerLoginPromptHandler(bot, {
      commandDelayMs: 0,
      serverLoginPassword: 'secret-password',
      sleep: async ms => sleeps.push(ms)
    })

    bot.emit('message', { toString: () => 'Please login with /login <password>' })
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(sleeps, [0])
    assert.deepStrictEqual(messages, ['/login secret-password'])
  })

  it('does not send a saved server password when there is no login prompt', async () => {
    const { attachServerLoginPromptHandler } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    bot.chat = message => messages.push(message)

    attachServerLoginPromptHandler(bot, {
      commandDelayMs: 0,
      serverLoginPassword: 'secret-password',
      sleep: async () => {}
    })

    bot.emit('message', { toString: () => 'Welcome back' })
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(messages, [])
  })

  it('does not send a login command when no server password is saved', async () => {
    const { attachServerLoginPromptHandler } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    bot.chat = message => messages.push(message)

    attachServerLoginPromptHandler(bot, {
      commandDelayMs: 0,
      sleep: async () => {}
    })

    bot.emit('message', { toString: () => 'Please login with /login <password>' })
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(messages, [])
  })

  it('enables physics before joining Survival on spawn without immediate server login', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = false
    bot.on('physicsEnabled', data => events.push(['physicsEnabled', data.spawnCount, bot.physicsEnabled]))

    attachEventLogging(bot, {
      joinSurvivalWorld: async () => events.push(['joinSurvivalWorld', bot.physicsEnabled]),
      startViewer: () => events.push(['startViewer'])
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['startViewer'],
      ['physicsEnabled', 1, true],
      ['joinSurvivalWorld', true]
    ])
  })

  it('sends the saved server login command on first spawn without waiting for a prompt', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    const sleeps = []
    bot.physicsEnabled = false
    bot.chat = message => messages.push(message)

    attachEventLogging(bot, {
      joinSurvivalWorld: async () => {},
      serverLoginPassword: 'secret-password',
      sleep: async ms => sleeps.push(ms),
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.deepStrictEqual(sleeps, [1000])
    assert.deepStrictEqual(messages, ['/login secret-password'])
  })

  it('loads the pvp plugin with the non-deprecated physicsTick event', () => {
    const { loadPvpPlugin } = require('../bot')
    const events = []
    const bot = {
      loadPlugin: plugin => plugin(bot),
      on: eventName => events.push(['on', eventName])
    }

    loadPvpPlugin(bot, pluginBot => {
      pluginBot.on('physicTick', () => {})
    })

    assert.deepStrictEqual(events, [
      ['on', 'physicsTick']
    ])
  })

  it('enables physics immediately before joining Survival on the first spawn', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const sleeps = []
    const events = []
    bot.physicsEnabled = false
    bot.on('physicsEnabled', data => events.push(['physicsEnabled', data.spawnCount]))

    attachEventLogging(bot, {
      loginToServer: async () => {},
      joinSurvivalWorld: async () => {},
      sleep: async (ms) => sleeps.push(ms),
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(sleeps, [])
    assert.strictEqual(bot.physicsEnabled, true)
    assert.deepStrictEqual(events, [['physicsEnabled', 1]])
  })

  it('does not use the delayed physics timer on the first spawn', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const sleeps = []
    bot.physicsEnabled = false

    attachEventLogging(bot, {
      loginToServer: async () => {},
      joinSurvivalWorld: async () => {},
      sleep: async (ms) => sleeps.push(ms),
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(sleeps, [])
    assert.strictEqual(bot.physicsEnabled, true)
  })

  it('re-enables physics 10 seconds after a later spawn', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const sleeps = []
    const events = []
    bot.physicsEnabled = false

    attachEventLogging(bot, {
      joinSurvivalWorld: async () => events.push(['joinSurvivalWorld', bot.physicsEnabled]),
      sleep: async (ms) => sleeps.push(ms),
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(sleeps, [10000])
    assert.strictEqual(bot.physicsEnabled, true)
    assert.deepStrictEqual(events, [
      ['joinSurvivalWorld', true],
      ['joinSurvivalWorld', true]
    ])
  })

  it('returns to Survival after a later spawn such as a server-mode transfer', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const commands = []

    attachEventLogging(bot, {
      loginToServer: async () => {},
      joinSurvivalWorld: async () => commands.push('/survival'),
      sleep: async () => {},
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(commands, ['/survival', '/survival'])
  })

  it('accepts resource packs when the server sends them', () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    let accepted = 0
    bot.acceptResourcePack = () => { accepted++ }

    attachEventLogging(bot, {
      joinSurvivalWorld: async () => {},
      startViewer: () => {}
    })

    bot.emit('resourcePack', 'https://example.com/pack.zip', 'hash')

    assert.strictEqual(accepted, 1)
  })

  it('greets players who join after the bot is ready', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    const entries = []
    bot.username = 'TestBot123'
    bot.chat = message => messages.push(message)

    attachEventLogging(bot, {
      debugLog: (event, data) => entries.push({ event, data }),
      loginToServer: async () => false,
      joinSurvivalWorld: async () => {},
      now: () => 1000,
      playerGreetingStartupDelayMs: 0,
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('playerJoined', { username: 'Steve' })

    assert.deepStrictEqual(messages, ['hi Steve'])
    assert(entries.some(entry =>
      entry.event === 'playerJoined.greeted' &&
      entry.data.username === 'Steve' &&
      entry.data.cooldownMs === 30000
    ))
  })

  it('does not greet players who were already present when the bot joined', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    bot.username = 'TestBot123'
    bot.players = {
      Steve: { username: 'Steve' },
      Alex: { username: 'Alex' }
    }
    bot.chat = message => messages.push(message)

    attachEventLogging(bot, {
      loginToServer: async () => false,
      joinSurvivalWorld: async () => {},
      now: () => 1000,
      playerGreetingStartupDelayMs: 0,
      startViewer: () => {}
    })

    bot.emit('playerJoined', { username: 'Steve' })
    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('playerJoined', { username: 'Steve' })
    bot.emit('playerJoined', { username: 'Alex' })
    bot.emit('playerJoined', { username: 'Bob' })

    assert.deepStrictEqual(messages, ['hi Bob'])
  })

  it('does not greet player join events during startup sync', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    const timers = []
    const entries = []
    bot.username = 'TestBot123'
    bot.chat = message => messages.push(message)

    attachEventLogging(bot, {
      debugLog: (event, data) => entries.push({ event, data }),
      loginToServer: async () => false,
      joinSurvivalWorld: async () => {},
      now: () => 1000,
      setTimeout: (callback, delayMs) => {
        timers.push({ callback, delayMs })
        return { unref: () => {} }
      },
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('playerJoined', { username: 'Steve' })

    assert.deepStrictEqual(messages, [])
    assert.strictEqual(timers.length, 1)
    assert.strictEqual(timers[0].delayMs, 30000)
    assert(entries.some(entry =>
      entry.event === 'playerJoined.greetingSkipped' &&
      entry.data.username === 'Steve' &&
      entry.data.reason === 'startup'
    ))

    timers.shift().callback()
    bot.emit('playerJoined', { username: 'Alex' })

    assert.deepStrictEqual(messages, ['hi Alex'])
  })

  it('waits 30 seconds between player join greetings', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    const timers = []
    let timeMs = 0
    bot.username = 'TestBot123'
    bot.chat = message => messages.push(message)

    attachEventLogging(bot, {
      loginToServer: async () => false,
      joinSurvivalWorld: async () => {},
      now: () => timeMs,
      playerGreetingStartupDelayMs: 0,
      setTimeout: (callback, delayMs) => {
        timers.push({ callback, delayMs })
        return { unref: () => {} }
      },
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('playerJoined', { username: 'Steve' })
    timeMs = 1000
    bot.emit('playerJoined', { username: 'Alex' })

    assert.deepStrictEqual(messages, ['hi Steve'])
    assert.strictEqual(timers.length, 1)
    assert.strictEqual(timers[0].delayMs, 29000)

    timeMs = 30000
    timers.shift().callback()

    assert.deepStrictEqual(messages, ['hi Steve', 'hi Alex'])
  })

  it('does not greet itself when the bot joins the server', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    bot.username = 'TestBot123'
    bot.chat = message => messages.push(message)

    attachEventLogging(bot, {
      loginToServer: async () => false,
      joinSurvivalWorld: async () => {},
      playerGreetingStartupDelayMs: 0,
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('playerJoined', { username: 'TestBot123' })

    assert.deepStrictEqual(messages, [])
  })

  it('does not greet formatted non-player names with illegal chat characters', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    const entries = []
    bot.username = 'TestBot123'
    bot.chat = message => messages.push(message)

    attachEventLogging(bot, {
      debugLog: (event, data) => entries.push({ event, data }),
      loginToServer: async () => false,
      joinSurvivalWorld: async () => {},
      playerGreetingStartupDelayMs: 0,
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('playerJoined', { username: '§0Blacksmith' })

    assert.deepStrictEqual(messages, [])
    assert(entries.some(entry =>
      entry.event === 'playerJoined.greetingSkipped' &&
      entry.data.username === '§0Blacksmith' &&
      entry.data.reason === 'unsafe-username'
    ))
  })

  it('recognizes noisy particle partial-read protocol errors', () => {
    const { isIgnorableParticleDecodeError } = require('../bot')
    const particleError = new Error('PartialReadError: Read error for undefined : undefined')
    particleError.stack = [
      'PartialReadError: Read error for undefined : undefined',
      'at Object.packet_world_particles',
      'at CompiledProtodef.read'
    ].join('\n')

    assert.strictEqual(isIgnorableParticleDecodeError(particleError), true)
    assert.strictEqual(isIgnorableParticleDecodeError(new Error('client timed out')), false)
  })

  it('recognizes hostile mobs without targeting passive mobs or players', () => {
    const { isHostileMob } = require('../bot')

    assert.strictEqual(isHostileMob({ type: 'mob', name: 'zombie' }), true)
    assert.strictEqual(isHostileMob({ type: 'hostile', name: 'zombie' }), true)
    assert.strictEqual(isHostileMob({ type: 'mob', name: 'cow' }), false)
    assert.strictEqual(isHostileMob({ type: 'player', name: 'Steve' }), false)
  })

  it('uses a sword for nearby hostile mobs', () => {
    const { chooseCombatAction } = require('../bot')
    const bot = combatBot([
      { name: 'diamond_sword' },
      { name: 'bow' },
      { name: 'arrow' }
    ])
    const target = combatTarget('zombie', 3)

    const action = chooseCombatAction(bot, target)

    assert.strictEqual(action.type, 'sword')
    assert.strictEqual(action.weapon.name, 'diamond_sword')
  })

  it('uses a bow for far or ranged hostile mobs', () => {
    const { chooseCombatAction } = require('../bot')
    const bot = combatBot([
      { name: 'diamond_sword' },
      { name: 'bow' },
      { name: 'arrow' }
    ])

    assert.strictEqual(chooseCombatAction(bot, combatTarget('zombie', 6)).type, 'bow')
    assert.strictEqual(chooseCombatAction(bot, combatTarget('skeleton', 3)).type, 'bow')
  })

  it('uses a sword fallback for far non-ranged mobs when no bow is available', () => {
    const { chooseCombatAction } = require('../bot')
    const bot = combatBot([{ name: 'diamond_sword' }])

    const action = chooseCombatAction(bot, combatTarget('zombie', 6))

    assert.strictEqual(action.type, 'sword')
    assert.strictEqual(action.weapon.name, 'diamond_sword')
  })

  it('runs away when no suitable combat weapon is available', () => {
    const { chooseCombatAction } = require('../bot')
    const bot = combatBot([])

    const action = chooseCombatAction(bot, combatTarget('zombie', 3))

    assert.strictEqual(action.type, 'flee')
  })

  it('performs sword combat against a nearby hostile mob', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const sleeps = []
    const target = combatTarget('zombie', 3)
    const bot = combatBot([{ name: 'diamond_sword' }], events)

    await runCombatTick(bot, {
      targetFinder: () => target,
      randomInt: (min, max) => max,
      sleep: async ms => sleeps.push(ms),
      debugLog: () => {}
    })

    assert.strictEqual(events[0][0], 'pathfinderStop')
    assert.deepStrictEqual(events[1], ['equip', 'diamond_sword', 'hand'])
    assert.strictEqual(events.filter(event => event[0] === 'lookAt').length, 5)
    assert(events.filter(event => event[0] === 'lookAt').every(event => event[1] === false))
    assert.deepStrictEqual(events[events.length - 1], ['attack', 'zombie', false])
    assert.deepStrictEqual(sleeps, [55, 55, 55, 55])
  })

  it('aims along a curved accelerated path before sword attacks', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 3)
    const bot = combatBot([{ name: 'diamond_sword' }], events)

    await runCombatTick(bot, {
      targetFinder: () => target,
      randomInt: (min, max) => max,
      sleep: async () => {},
      debugLog: () => {}
    })

    const lookPoints = events
      .filter(event => event[0] === 'lookAt')
      .map(event => event[2])

    assert.strictEqual(lookPoints.length, 5)
    assert(lookPoints.slice(0, -1).some(point => point.z !== 0))
    assert(lookPoints[1].x - lookPoints[0].x < lookPoints[2].x - lookPoints[1].x)
    assert.deepStrictEqual(lookPoints[lookPoints.length - 1], { x: 3, y: 1.8, z: 0 })
  })

  it('passes Vec3-compatible aim points to Mineflayer lookAt', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 3)
    const bot = combatBot([{ name: 'diamond_sword' }], events)
    bot.lookAt = async (point, force) => {
      assert.strictEqual(typeof point.minus, 'function')
      events.push(['lookAt', force, { x: point.x, y: point.y, z: point.z }])
      bot.entity.yaw = Math.atan2(-point.x, -point.z)
      bot.entity.pitch = Math.atan2(point.y - bot.entity.eyeHeight, Math.sqrt(point.x * point.x + point.z * point.z))
    }

    const action = await runCombatTick(bot, {
      targetFinder: () => target,
      randomInt: (min, max) => max,
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.strictEqual(action.type, 'sword')
    assert.strictEqual(events.filter(event => event[0] === 'lookAt').length, 5)
  })

  it('does not attack when the bot is not facing the mob after aiming', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 2)
    const bot = combatBot([{ name: 'diamond_sword' }], events)
    bot.lookAt = async (point, force) => events.push(['lookAt', force, { x: point.x, y: point.y, z: point.z }])

    const action = await runCombatTick(bot, {
      targetFinder: () => target,
      now: () => 1000,
      randomInt: (min, max) => max,
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.strictEqual(action.type, 'wait')
    assert.strictEqual(action.reason, 'not-facing-target')
    assert.strictEqual(events.some(event => event[0] === 'swingArm'), false)
    assert.strictEqual(events.some(event => event[0] === 'attack'), false)
  })

  it('swings the arm immediately before sending a direct attack', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 2)
    const bot = combatBot([{ name: 'diamond_sword' }], events)

    const action = await runCombatTick(bot, {
      targetFinder: () => target,
      now: () => 1000,
      randomInt: (min, max) => max,
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.strictEqual(action.type, 'sword')
    assert.deepStrictEqual(events.slice(-2), [
      ['swingArm', 'right', true],
      ['attack', 'zombie', false]
    ])
  })

  it('waits a randomized cooldown before hitting a mob again', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 2)
    const bot = combatBot([{ name: 'diamond_sword' }], events)
    let now = 1000

    await runCombatTick(bot, {
      targetFinder: () => target,
      now: () => now,
      randomInt: (min, max) => max,
      sleep: async () => {},
      debugLog: () => {}
    })
    now = 2000
    await runCombatTick(bot, {
      targetFinder: () => target,
      now: () => now,
      randomInt: (min, max) => max,
      sleep: async () => {},
      debugLog: () => {}
    })
    now = 2500
    await runCombatTick(bot, {
      targetFinder: () => target,
      now: () => now,
      randomInt: (min, max) => max,
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.strictEqual(events.filter(event => event[0] === 'attack').length, 2)
    assert.strictEqual(events.filter(event => event[0] === 'lookAt').length, 10)
    assert(events.filter(event => event[0] === 'lookAt').every(event => event[1] === false))
  })

  it('only hits mobs inside the randomized melee range', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 2)
    const bot = combatBot([{ name: 'diamond_sword' }], events)

    const skipped = await runCombatTick(bot, {
      targetFinder: () => target,
      now: () => 1000,
      randomInt: (min, max) => min,
      sleep: async () => {},
      debugLog: () => {}
    })
    const attacked = await runCombatTick(bot, {
      targetFinder: () => target,
      now: () => 1000,
      randomInt: (min, max) => max,
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.strictEqual(skipped.type, 'wait')
    assert.strictEqual(skipped.reason, 'out-of-melee-range')
    assert.strictEqual(attacked.type, 'sword')
    assert.strictEqual(events.filter(event => event[0] === 'attack').length, 1)
    assert.strictEqual(events.filter(event => event[0] === 'lookAt').length, 5)
    assert(events.filter(event => event[0] === 'lookAt').every(event => event[1] === false))
  })

  it('uses controlled melee packets when pvp is available', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 2)
    const bot = combatBot([{ name: 'diamond_sword' }], events)
    bot.pvp = {
      target: null,
      attack: entity => events.push(['pvpAttack', entity.name])
    }

    const action = await runCombatTick(bot, {
      targetFinder: () => target,
      now: () => 1000,
      randomInt: (min, max) => max,
      debugLog: () => {}
    })

    assert.strictEqual(action.type, 'pvp')
    assert(bot.__combatActiveUntil >= Date.now())
    assert.deepStrictEqual(events.filter(event => event[0] === 'pvpAttack'), [])
    assert.deepStrictEqual(events.slice(-2), [
      ['swingArm', 'right', true],
      ['attack', 'zombie', false]
    ])
  })

  it('uses direct counterattack instead of pvp chase during movement pause', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 3)
    const bot = combatBot([{ name: 'diamond_sword' }], events)
    bot.__movementPausedUntil = Date.now() + 1000
    bot.pvp = {
      target,
      attack: entity => events.push(['pvpAttack', entity.name])
    }

    const action = await runCombatTick(bot, {
      targetFinder: () => target,
      randomInt: (min, max) => max,
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.strictEqual(action.type, 'sword')
    assert.strictEqual(events.filter(event => event[0] === 'attack').length, 1)
    assert.strictEqual(events.filter(event => event[0] === 'lookAt').length, 5)
    assert(events.filter(event => event[0] === 'lookAt').every(event => event[1] === false))
  })

  it('pauses movement on hurt without stopping the pvp target', () => {
    const { attachKnockbackPause } = require('../bot')
    const events = []
    const now = 1000
    const target = combatTarget('zombie', 3)
    const bot = new EventEmitter()
    bot.entity = { id: 1 }
    bot.pathfinder = {
      setGoal: goal => events.push(['setGoal', goal]),
      stop: () => events.push(['pathfinderStop'])
    }
    bot.clearControlStates = () => events.push(['clearControls'])
    bot.pvp = {
      target,
      stop: () => events.push(['pvpStop'])
    }

    attachKnockbackPause(bot, {
      now: () => now,
      pauseMs: 700,
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, target)

    assert.strictEqual(bot.__movementPausedUntil, 1700)
    assert.strictEqual(bot.pvp.target, target)
    assert.deepStrictEqual(events, [
      ['setGoal', null],
      ['clearControls']
    ])
  })

  it('adds fallback knockback only after no server velocity arrives', () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    let fallbackTimer = null
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    const attacker = {
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      fallbackKnockbackDelayMs: 50,
      setFallbackKnockbackTimeout: (callback, delayMs) => {
        assert.strictEqual(delayMs, 50)
        fallbackTimer = callback
        return callback
      },
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, attacker)

    assert.strictEqual(bot.entity.velocity.x, 0)
    assert.strictEqual(bot.entity.velocity.y, 0)
    assert.strictEqual(bot.entity.velocity.z, 0)
    fallbackTimer()

    assert(bot.entity.velocity.x < -0.4)
    assert.strictEqual(bot.entity.velocity.y, 0.35)
    assert.strictEqual(bot.entity.velocity.z, 0)
  })

  it('cancels fallback knockback when server velocity arrives', () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    let clearCount = 0
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    const attacker = {
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      setFallbackKnockbackTimeout: callback => callback,
      clearFallbackKnockbackTimeout: () => { clearCount++ },
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, attacker)
    bot.entity.velocity.x = -1
    bot.entity.velocity.y = 0.8
    bot.entity.velocity.z = 0.25
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: -1, y: 0.8, z: 0.25 }
    })

    assert.strictEqual(clearCount, 1)
    assert.strictEqual(bot.entity.velocity.x, -1)
    assert.strictEqual(bot.entity.velocity.y, 0.8)
    assert.strictEqual(bot.entity.velocity.z, 0.25)
  })

  it('does not add fallback knockback for indirect burn damage', () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    const attacker = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 0
    })

    assert.strictEqual(bot.__movementPausedUntil, undefined)
    assert.strictEqual(bot.entity.velocity.x, 0)
    assert.strictEqual(bot.entity.velocity.y, 0)
    assert.strictEqual(bot.entity.velocity.z, 0)
  })

  it('does not pause movement for no-direct burn damage', () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    bot.clearControlStates = () => events.push('clearControls')

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, null, {
      sourceTypeId: 29,
      sourceCauseId: 0,
      sourceDirectId: 0
    })

    assert.strictEqual(bot.__movementPausedUntil, undefined)
    assert.deepStrictEqual(events, [])
  })

  it('ignores self velocity packets caused by indirect burn damage', () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: -0.0784,
        z: 0
      }
    }
    const attacker = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 0
    })
    bot.entity.velocity.x = 1
    bot.entity.velocity.y = 0.99
    bot.entity.velocity.z = 0.85
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: 1, y: 0.99, z: 0.85 }
    })

    assert.strictEqual(bot.entity.velocity.x, 0)
    assert.strictEqual(bot.entity.velocity.y, -0.0784)
    assert.strictEqual(bot.entity.velocity.z, 0)
  })

  it('ignores delayed self velocity packets caused by indirect burn damage', () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    let now = 1000
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: -0.0784,
        z: 0
      }
    }
    const attacker = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => now,
      pauseMs: 700,
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 0
    })
    now = 1800
    bot.entity.velocity.x = 1
    bot.entity.velocity.y = 0.99
    bot.entity.velocity.z = 0.85
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: 1, y: 0.99, z: 0.85 }
    })

    assert.strictEqual(bot.entity.velocity.x, 0)
    assert.strictEqual(bot.entity.velocity.y, -0.0784)
    assert.strictEqual(bot.entity.velocity.z, 0)
  })

  it('keeps direct damage velocity after indirect burn damage', () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    let now = 1000
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: -0.0784,
        z: 0
      }
    }
    const attacker = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => now,
      pauseMs: 700,
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 0
    })
    now = 1050
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 3
    })
    bot.entity.velocity.x = -0.4
    bot.entity.velocity.y = 0.32
    bot.entity.velocity.z = 0.1
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: -0.4, y: 0.32, z: 0.1 }
    })

    assert.strictEqual(bot.entity.velocity.x, -0.4)
    assert.strictEqual(bot.entity.velocity.y, 0.32)
    assert.strictEqual(bot.entity.velocity.z, 0.1)
  })

  it('corrects direct-hit server velocity that points toward the attacker', () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    const attacker = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 3
    })
    bot.entity.velocity.x = 0.6
    bot.entity.velocity.y = -0.1
    bot.entity.velocity.z = 0
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: 0.6, y: -0.1, z: 0 }
    })

    assert.strictEqual(bot.entity.velocity.x, -0.6)
    assert.strictEqual(bot.entity.velocity.y, 0.35)
    assert.strictEqual(bot.entity.velocity.z, 0)
  })

  it('corrects direct-hit server velocity even when another listener applies it later', async () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    const attacker = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      debugLog: () => {}
    })
    bot._client.on('entity_velocity', packet => {
      bot.entity.velocity.x = packet.velocity.x
      bot.entity.velocity.y = packet.velocity.y
      bot.entity.velocity.z = packet.velocity.z
    })
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 3
    })
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: 0.6, y: -0.1, z: 0 }
    })
    await Promise.resolve()

    assert.strictEqual(bot.entity.velocity.x, -0.6)
    assert.strictEqual(bot.entity.velocity.y, 0.35)
    assert.strictEqual(bot.entity.velocity.z, 0)
  })

  it('preserves enchanted direct-hit magnitude when correcting direction', async () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    const attacker = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      debugLog: () => {}
    })
    bot._client.on('entity_velocity', packet => {
      bot.entity.velocity.x = packet.velocity.x
      bot.entity.velocity.y = packet.velocity.y
      bot.entity.velocity.z = packet.velocity.z
    })
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 3
    })
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: 1.58, y: 1.94, z: -1.25 }
    })
    await Promise.resolve()

    const expectedHorizontal = Math.sqrt(1.58 * 1.58 + 1.25 * 1.25)
    assert.ok(Math.abs(bot.entity.velocity.x + expectedHorizontal) < 1e-12)
    assert.strictEqual(bot.entity.velocity.y, 1.94)
    assert.strictEqual(bot.entity.velocity.z, 0)
  })

  it('keeps enchanted direct-hit velocity that already points away', async () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    const attacker = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      debugLog: () => {}
    })
    bot._client.on('entity_velocity', packet => {
      bot.entity.velocity.x = packet.velocity.x
      bot.entity.velocity.y = packet.velocity.y
      bot.entity.velocity.z = packet.velocity.z
    })
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 3
    })
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: -2, y: 1.5, z: 0 }
    })
    await Promise.resolve()

    assert.strictEqual(bot.entity.velocity.x, -2)
    assert.strictEqual(bot.entity.velocity.y, 1.5)
    assert.strictEqual(bot.entity.velocity.z, 0)
  })

  it('keeps direct-hit server velocity that is not clearly toward the attacker', async () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    const attacker = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      debugLog: () => {}
    })
    bot._client.on('entity_velocity', packet => {
      bot.entity.velocity.x = packet.velocity.x
      bot.entity.velocity.y = packet.velocity.y
      bot.entity.velocity.z = packet.velocity.z
    })
    bot.emit('entityHurt', bot.entity, attacker, {
      sourceCauseId: 3,
      sourceDirectId: 3
    })
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: 0, y: 0.7, z: 1.2 }
    })
    await Promise.resolve()

    assert.strictEqual(bot.entity.velocity.x, 0)
    assert.strictEqual(bot.entity.velocity.y, 0.7)
    assert.strictEqual(bot.entity.velocity.z, 1.2)
  })

  it('preserves arrow punch magnitude from the projectile velocity direction', async () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: 0,
        z: 0
      }
    }
    const shooter = {
      id: 2,
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      debugLog: () => {}
    })
    bot._client.on('entity_velocity', packet => {
      bot.entity.velocity.x = packet.velocity.x
      bot.entity.velocity.y = packet.velocity.y
      bot.entity.velocity.z = packet.velocity.z
    })
    bot.emit('entityHurt', bot.entity, shooter, {
      sourceCauseId: 3,
      sourceDirectId: 4,
      sourceDirectVelocity: { x: 0, y: 0, z: 1 }
    })
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: -1.5, y: 1, z: 0 }
    })
    await Promise.resolve()

    assert.strictEqual(bot.entity.velocity.x, 0)
    assert.strictEqual(bot.entity.velocity.y, 1)
    assert.strictEqual(bot.entity.velocity.z, 1.5)
  })

  for (const sourceTypeId of [9, 29]) {
    it(`ignores self velocity packets caused by no-direct damage source type ${sourceTypeId}`, () => {
      const { attachKnockbackPause } = require('../bot')
      const bot = new EventEmitter()
      bot._client = new EventEmitter()
      bot.entity = {
        id: 1,
        position: combatPosition(0, 64, 0),
        velocity: {
          x: 0,
          y: -0.0784,
          z: 0
        }
      }

      attachKnockbackPause(bot, {
        now: () => 1000,
        pauseMs: 700,
        debugLog: () => {}
      })
      bot.emit('entityHurt', bot.entity, null, {
        sourceTypeId,
        sourceCauseId: 0,
        sourceDirectId: 0
      })
      bot.entity.velocity.x = 1
      bot.entity.velocity.y = 0.99
      bot.entity.velocity.z = 0.85
      bot._client.emit('entity_velocity', {
        entityId: 1,
        velocity: { x: 1, y: 0.99, z: 0.85 }
      })

      assert.strictEqual(bot.entity.velocity.x, 0)
      assert.strictEqual(bot.entity.velocity.y, -0.0784)
      assert.strictEqual(bot.entity.velocity.z, 0)
    })
  }

  it('ignores no-direct damage velocity even when another listener applies it later', async () => {
    const { attachKnockbackPause } = require('../bot')
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: {
        x: 0,
        y: -0.0784,
        z: 0
      }
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      debugLog: () => {}
    })
    bot._client.on('entity_velocity', packet => {
      bot.entity.velocity.x = packet.velocity.x
      bot.entity.velocity.y = packet.velocity.y
      bot.entity.velocity.z = packet.velocity.z
    })
    bot.emit('entityHurt', bot.entity, null, {
      sourceTypeId: 29,
      sourceCauseId: 0,
      sourceDirectId: 0
    })
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: 3, y: 2.98, z: -1.37 }
    })
    await Promise.resolve()

    assert.strictEqual(bot.entity.velocity.x, 0)
    assert.strictEqual(bot.entity.velocity.y, -0.0784)
    assert.strictEqual(bot.entity.velocity.z, 0)
  })

  it('logs knockback diagnostics when debug is enabled', () => {
    const { attachKnockbackPause } = require('../bot')
    const entries = []
    const bot = new EventEmitter()
    bot._client = new EventEmitter()
    bot.entity = {
      id: 1,
      position: combatPosition(0, 64, 0),
      velocity: { x: 0, y: 0, z: 0 }
    }
    bot.getControlState = control => control === 'forward'
    bot.pathfinder = { setGoal: () => {} }
    const source = {
      id: 2,
      name: 'zombie',
      position: combatPosition(1, 64, 0)
    }
    const controller = attachKnockbackPause(bot, {
      now: () => 1000,
      debugLog: (event, data) => entries.push({ event, data }),
      debugSampleTicks: 2
    })

    controller.setDebugEnabled(true)
    bot.emit('entityHurt', bot.entity, source)
    bot._client.emit('entity_velocity', {
      entityId: 1,
      velocity: { x: 1000, y: 2000, z: 3000 }
    })
    bot.emit('physicsTick')

    assert(entries.some(entry => entry.event === 'knockback.debug.hurt' && entry.data.source.name === 'zombie'))
    assert(entries.some(entry => entry.event === 'knockback.debug.selfVelocityPacket' && entry.data.packet.entityId === 1))
    assert(entries.some(entry => entry.event === 'knockback.debug.physicsTick' && entry.data.controlStates.forward === true))
  })

  it('does not run combat while night safety is active', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 3)
    const bot = combatBot([{ name: 'diamond_sword' }], events)
    bot.__nightSafetyActive = true

    const action = await runCombatTick(bot, {
      targetFinder: () => target,
      debugLog: () => {}
    })

    assert.strictEqual(action.type, 'none')
    assert.deepStrictEqual(events, [])
  })

  it('randomizes bow combat draw wait against a far hostile mob', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const sleeps = []
    const target = combatTarget('zombie', 6)
    const bot = combatBot([{ name: 'bow' }, { name: 'arrow' }], events)

    await runCombatTick(bot, {
      targetFinder: () => target,
      randomInt: (min, max) => max,
      sleep: async ms => sleeps.push(ms),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events.filter(event => event[0] !== 'lookAt'), [
      ['pathfinderStop'],
      ['equip', 'bow', 'hand'],
      ['activateItem'],
      ['deactivateItem']
    ])
    assert.strictEqual(events.filter(event => event[0] === 'lookAt').length, 5)
    assert(events.filter(event => event[0] === 'lookAt').every(event => event[1] === false))
    assert.deepStrictEqual(sleeps, [55, 55, 55, 55, 1040])
  })

  it('randomizes flee combat wait when unarmed', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const sleeps = []
    const target = combatTarget('zombie', 3)
    const bot = combatBot([], events)

    await runCombatTick(bot, {
      targetFinder: () => target,
      randomInt: (min, max) => max,
      sleep: async ms => sleeps.push(ms),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events.filter(event => event[0] !== 'lookAt'), [
      ['pathfinderStop'],
      ['control', 'back', true],
      ['control', 'jump', true],
      ['control', 'back', false],
      ['control', 'jump', false]
    ])
    assert.strictEqual(events.filter(event => event[0] === 'lookAt').length, 5)
    assert(events.filter(event => event[0] === 'lookAt').every(event => event[1] === false))
    assert.deepStrictEqual(sleeps, [55, 55, 55, 55, 1300])
  })

  it('eats the best safe food when hunger is not full', async () => {
    const { runAutoEat } = require('../bot')
    const events = []
    const bot = autoEatBot([
      { name: 'apple' },
      { name: 'bread' }
    ], events)
    bot.food = 18
    bot.health = 20

    const ate = await runAutoEat(bot, {
      debugLog: () => {}
    })

    assert.strictEqual(ate, true)
    assert.deepStrictEqual(events, [
      ['setGoal', null],
      ['control', 'sprint', false],
      ['control', 'jump', false],
      ['equip', 'bread', 'hand'],
      ['consume']
    ])
  })

  it('uses a golden apple for low health when hunger is full', async () => {
    const { runAutoEat } = require('../bot')
    const events = []
    const bot = autoEatBot([
      { name: 'bread' },
      { name: 'golden_apple' }
    ], events)
    bot.food = 20
    bot.health = 8

    const ate = await runAutoEat(bot, {
      debugLog: () => {}
    })

    assert.strictEqual(ate, true)
    assert.deepStrictEqual(events, [
      ['setGoal', null],
      ['control', 'sprint', false],
      ['control', 'jump', false],
      ['equip', 'golden_apple', 'hand'],
      ['consume']
    ])
  })

  it('does not eat unsafe food when no safe food is available', async () => {
    const { runAutoEat } = require('../bot')
    const events = []
    const entries = []
    const bot = autoEatBot([
      { name: 'rotten_flesh' }
    ], events)
    bot.food = 12
    bot.health = 20

    const ate = await runAutoEat(bot, {
      debugLog: (event, data) => entries.push({ event, data })
    })

    assert.strictEqual(ate, false)
    assert.deepStrictEqual(events, [])
    assert(entries.some(entry => entry.event === 'autoeat.noFood'))
  })

  it('runs auto eat after health updates', async () => {
    const { attachAutoEat } = require('../bot')
    const bot = new EventEmitter()
    const events = []

    attachAutoEat(bot, {
      runAutoEat: async autoEatBot => events.push(['autoEat', autoEatBot])
    })

    bot.emit('health')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [['autoEat', bot]])
  })

  it('lists wood cutting from the automation menu and starts the selected automation', async () => {
    const { createCommandConsole } = require('../bot')
    const output = []
    const events = []
    const bot = new EventEmitter()

    const consoleController = createCommandConsole(bot, {
      output: message => output.push(message),
      automationManager: {
        list: () => [{ name: 'Wood cutting' }],
        startByIndex: async index => events.push(['startAutomation', index])
      }
    })

    await consoleController.handleLine('/automation')
    await consoleController.handleLine('1')

    assert(output.some(message => message.includes('1. Wood cutting')))
    assert.deepStrictEqual(events, [['startAutomation', 0]])
  })

  it('toggles night safety from the automation menu', async () => {
    const { createCommandConsole } = require('../bot')
    const output = []
    const events = []
    const bot = new EventEmitter()

    const consoleController = createCommandConsole(bot, {
      output: message => output.push(message),
      automationManager: {
        list: () => [{ name: 'Wood cutting' }],
        startByIndex: async index => events.push(['startAutomation', index])
      },
      nightSafetyController: {
        isEnabled: () => true,
        toggleEnabled: () => {
          events.push(['toggleNightSafety'])
          return { enabled: false, message: 'Night safety disabled.' }
        }
      }
    })

    await consoleController.handleLine('/automation')
    await consoleController.handleLine('2')

    assert(output.some(message => message.includes('2. Night safety (on)')))
    assert(output.some(message => message.includes('Night safety disabled.')))
    assert.deepStrictEqual(events, [['toggleNightSafety']])
  })

  it('lists farming, wild roaming, pyro farming, and mining in the default automation menu', async () => {
    const { createAutomationManager } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    const automationManager = createAutomationManager(bot, {
      output: () => {},
      debugLog: () => {},
      startWoodCuttingAutomation: () => ({
        stop: () => events.push(['stop', 'wood'])
      }),
      startFarmingAutomation: () => ({
        stop: () => events.push(['stop', 'farming'])
      }),
      startWildRoamingAutomation: () => ({
        stop: () => events.push(['stop', 'wild'])
      }),
      startPyroFarmingAutomation: () => ({
        stop: () => events.push(['stop', 'pyro'])
      }),
      startMiningAutomation: () => ({
        stop: () => events.push(['stop', 'mining'])
      })
    })

    assert.deepStrictEqual(automationManager.list(), [
      { name: 'Wood cutting' },
      { name: 'Farming' },
      { name: 'Wild roaming' },
      { name: 'Pyro Farming' },
      { name: 'Mining' }
    ])

    await automationManager.startByIndex(1)
    await automationManager.startByIndex(2)

    assert.deepStrictEqual(events, [
      ['stop', 'farming']
    ])
  })

  it('prints automation task completion status to the terminal', async () => {
    const { startFarmingAutomation } = require('../bot')
    const output = []
    const bot = new EventEmitter()
    bot.entity = { position: combatPosition(0, 64, 0) }
    let runCount = 0

    startFarmingAutomation(bot, {
      output: message => output.push(message),
      debugLog: () => {},
      sleep: () => Promise.resolve(),
      runFarmingTask: async () => {
        runCount++
        bot._ended = true
      }
    })
    await Promise.resolve()

    assert.strictEqual(runCount, 1)
    assert(output.some(message => message.includes('Started Farming automation.')))
    assert(output.some(message => message.includes('Farming automation task completed.')))
  })

  it('does not spam completion status after an automation has no more work', async () => {
    const { startFarmingAutomation } = require('../bot')
    const output = []
    const bot = new EventEmitter()
    bot.entity = { position: combatPosition(0, 64, 0) }
    let runCount = 0
    let sleepCount = 0

    startFarmingAutomation(bot, {
      output: message => output.push(message),
      debugLog: () => {},
      sleep: async () => {
        sleepCount++
        if (sleepCount >= 2) bot._ended = true
      },
      runFarmingTask: async () => {
        runCount++
        return 0
      }
    })
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(runCount, 1)
    assert.strictEqual(output.filter(message => message.includes('Farming automation task completed.')).length, 1)
  })

  it('prints wood cutting task completion status to the terminal', async () => {
    const { startWoodCuttingAutomation } = require('../bot')
    const output = []
    const bot = blockBot([])
    let runCount = 0
    let targetWoodCount = null

    startWoodCuttingAutomation(bot, {
      output: message => output.push(message),
      debugLog: () => {},
      sleep: () => Promise.resolve(),
      runWoodCuttingQuotaTask: async (taskBot, taskOptions) => {
        runCount++
        targetWoodCount = taskOptions.targetWoodCount
        return true
      }
    })
    await Promise.resolve()

    assert.strictEqual(runCount, 1)
    assert.strictEqual(targetWoodCount, 64)
    assert(output.some(message => message.includes('Started wood cutting automation.')))
    assert(output.some(message => message.includes('Wood cutting automation task completed.')))
  })

  it('stops the active automation from the terminal', async () => {
    const { createCommandConsole } = require('../bot')
    const output = []
    const events = []
    const bot = new EventEmitter()

    const consoleController = createCommandConsole(bot, {
      output: message => output.push(message),
      automationManager: {
        list: () => [{ name: 'Wood cutting' }],
        startByIndex: async index => events.push(['startAutomation', index]),
        stopActive: () => {
          events.push(['stopAutomation'])
          return true
        }
      }
    })

    await consoleController.handleLine('/automation')
    await consoleController.handleLine('1')
    await consoleController.handleLine('/automation stop')

    assert(output.some(message => message.includes('Stopped automation.')))
    assert.deepStrictEqual(events, [
      ['startAutomation', 0],
      ['stopAutomation']
    ])
  })

  it('stops the active automation when the bot is kicked', async () => {
    const { createAutomationManager } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    const automationManager = createAutomationManager(bot, {
      output: () => {},
      debugLog: () => {},
      automations: [
        {
          name: 'Wood cutting',
          start: () => ({
            stop: () => events.push(['stop'])
          })
        }
      ]
    })

    await automationManager.startByIndex(0)
    bot.emit('kicked', '[Vulcan] Unfair Advantage')

    assert.deepStrictEqual(events, [['stop']])
  })

  it('pauses and resumes mining after night safety', async () => {
    const { createAutomationManager } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    let starts = 0
    const automationManager = createAutomationManager(bot, {
      output: () => {},
      debugLog: (event, data) => events.push(['debug', event, data?.name]),
      automations: [
        {
          name: 'Mining',
          resumeAfterNightSafety: true,
          start: () => {
            starts++
            events.push(['start', starts])
            return {
              stop: () => events.push(['stop', starts])
            }
          }
        }
      ]
    })

    await automationManager.startByIndex(0)
    assert.strictEqual(automationManager.pauseActiveForNightSafety(), true)
    assert.strictEqual(await automationManager.resumePausedAfterNightSafety(), true)

    assert.deepStrictEqual(events, [
      ['start', 1],
      ['debug', 'automation.start', 'Mining'],
      ['stop', 1],
      ['debug', 'automation.pauseForNightSafety', 'Mining'],
      ['start', 2],
      ['debug', 'automation.resumeAfterNightSafety', 'Mining']
    ])
  })

  it('pauses and resumes pyro farming after night safety', async () => {
    const { createAutomationManager } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    let starts = 0
    const automationManager = createAutomationManager(bot, {
      output: () => {},
      debugLog: (event, data) => events.push(['debug', event, data?.name]),
      automations: [
        {
          name: 'Pyro Farming',
          resumeAfterNightSafety: true,
          start: () => {
            starts++
            events.push(['start', starts])
            return {
              stop: () => events.push(['stop', starts])
            }
          }
        }
      ]
    })

    await automationManager.startByIndex(0)
    assert.strictEqual(automationManager.pauseActiveForNightSafety(), true)
    assert.strictEqual(await automationManager.resumePausedAfterNightSafety(), true)

    assert.deepStrictEqual(events, [
      ['start', 1],
      ['debug', 'automation.start', 'Pyro Farming'],
      ['stop', 1],
      ['debug', 'automation.pauseForNightSafety', 'Pyro Farming'],
      ['start', 2],
      ['debug', 'automation.resumeAfterNightSafety', 'Pyro Farming']
    ])
  })

  it('restarts a completed automation on the next Minecraft day', async () => {
    const { createAutomationManager } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    bot.time = { isDay: true, timeOfDay: 1000 }
    let completeCurrentAutomation = null
    let starts = 0
    const automationManager = createAutomationManager(bot, {
      output: () => {},
      debugLog: (event, data) => events.push(['debug', event, data?.name]),
      startFarmingAutomation: (taskBot, taskOptions) => {
        starts++
        const startNumber = starts
        events.push(['start', startNumber])
        completeCurrentAutomation = taskOptions.onComplete
        return {
          stop: () => events.push(['stop', startNumber])
        }
      },
      startWoodCuttingAutomation: () => ({ stop: () => {} }),
      startWildRoamingAutomation: () => ({ stop: () => {} }),
      startPyroFarmingAutomation: () => ({ stop: () => {} }),
      startMiningAutomation: () => ({ stop: () => {} })
    })

    await automationManager.startByIndex(1)
    completeCurrentAutomation()
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.emit('time')
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.emit('time')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['start', 1],
      ['debug', 'automation.start', 'Farming'],
      ['debug', 'automation.waitForNextDay', 'Farming'],
      ['start', 2],
      ['debug', 'automation.restartForDay', 'Farming']
    ])
  })

  it('resets an unfinished active automation on the next Minecraft day', async () => {
    const { createAutomationManager } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    bot.time = { isDay: true, timeOfDay: 1000 }
    let starts = 0
    const automationManager = createAutomationManager(bot, {
      output: () => {},
      debugLog: (event, data) => events.push(['debug', event, data?.name]),
      startWoodCuttingAutomation: () => {
        starts++
        const startNumber = starts
        events.push(['start', startNumber])
        return {
          stop: () => events.push(['stop', startNumber])
        }
      },
      startFarmingAutomation: () => ({ stop: () => {} }),
      startWildRoamingAutomation: () => ({ stop: () => {} }),
      startPyroFarmingAutomation: () => ({ stop: () => {} }),
      startMiningAutomation: () => ({ stop: () => {} })
    })

    await automationManager.startByIndex(0)
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.emit('time')
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.emit('time')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['start', 1],
      ['debug', 'automation.start', 'Wood cutting'],
      ['stop', 1],
      ['start', 2],
      ['debug', 'automation.restartForDay', 'Wood cutting']
    ])
  })

  it('sends /message content directly to Minecraft chat', async () => {
    const { createCommandConsole } = require('../bot')
    const events = []
    const output = []
    const bot = new EventEmitter()
    bot.chat = message => events.push(['chat', message])

    const consoleController = createCommandConsole(bot, {
      output: message => output.push(message),
      automationManager: {
        list: () => {
          throw new Error('local automation menu should not open')
        }
      }
    })

    await consoleController.handleLine('/message /automation')
    await consoleController.handleLine('/message Hello')

    assert.deepStrictEqual(events, [
      ['chat', '/automation'],
      ['chat', 'Hello']
    ])
    assert.deepStrictEqual(output, [])
  })

  it('shows usage when /message has no content', async () => {
    const { createCommandConsole } = require('../bot')
    const output = []
    const events = []
    const bot = new EventEmitter()
    bot.chat = message => events.push(['chat', message])

    const consoleController = createCommandConsole(bot, {
      output: message => output.push(message)
    })

    await consoleController.handleLine('/message')

    assert.deepStrictEqual(events, [])
    assert(output.some(message => message.includes('Usage: /message <message-or-command>')))
  })

  it('starts and stops following players from the terminal', async () => {
    const { createCommandConsole } = require('../bot')
    const output = []
    const events = []
    const bot = new EventEmitter()
    const consoleController = createCommandConsole(bot, {
      output: message => output.push(message),
      followController: {
        followPlayer: async playerName => {
          events.push(['follow', playerName])
          return { ok: true, message: `Following ${playerName}.` }
        },
        unfollow: () => {
          events.push(['unfollow'])
          return { ok: true, message: 'Stopped following.' }
        }
      }
    })

    await consoleController.handleLine('/follow Cat2246')
    await consoleController.handleLine('/unfollow')

    assert.deepStrictEqual(events, [
      ['follow', 'Cat2246'],
      ['unfollow']
    ])
    assert(output.some(message => message.includes('Following Cat2246.')))
    assert(output.some(message => message.includes('Stopped following.')))
  })

  it('unloads inventory from the terminal and lists helper commands', async () => {
    const { createCommandConsole } = require('../bot')
    const output = []
    const events = []
    const bot = new EventEmitter()
    const consoleController = createCommandConsole(bot, {
      output: message => output.push(message),
      followController: {
        unloadInventory: async () => {
          events.push(['unload'])
          return { ok: true, message: 'Unloaded inventory.' }
        },
        helpLines: () => [
          '/follow <player> - follow a player',
          '/unfollow - stop following',
          '/pickup - toggle dropped item pickup',
          '/unload inventory - unload into a nearby chest'
        ]
      }
    })

    await consoleController.handleLine('/unload inventory')
    await consoleController.handleLine('/help')

    assert.deepStrictEqual(events, [['unload']])
    assert(output.some(message => message.includes('Unloaded inventory.')))
    assert(output.some(message => message.includes('/follow <player>')))
    assert(output.some(message => message.includes('/pickup')))
    assert(output.some(message => message.includes('/unload inventory')))
  })

  it('toggles dropped item pickup from the terminal', async () => {
    const { createCommandConsole } = require('../bot')
    const output = []
    const events = []
    const bot = new EventEmitter()
    const consoleController = createCommandConsole(bot, {
      output: message => output.push(message),
      followController: {
        togglePickup: () => {
          events.push(['togglePickup'])
          return { ok: true, enabled: true, message: 'Dropped item pickup enabled.' }
        }
      }
    })

    await consoleController.handleLine('/pickup')

    assert.deepStrictEqual(events, [['togglePickup']])
    assert(output.some(message => message.includes('Dropped item pickup enabled.')))
  })

  it('toggles knockback debug logging from the terminal', async () => {
    const { createCommandConsole } = require('../bot')
    const output = []
    const events = []
    const bot = new EventEmitter()
    const consoleController = createCommandConsole(bot, {
      output: message => output.push(message),
      knockbackController: {
        toggleDebug: () => {
          events.push(['toggleKnockbackDebug'])
          return { enabled: true, message: 'Knockback debug enabled.' }
        }
      }
    })

    await consoleController.handleLine('/knockback debug')

    assert.deepStrictEqual(events, [['toggleKnockbackDebug']])
    assert(output.some(message => message.includes('Knockback debug enabled.')))
  })

  it('refuses to follow players not in the server', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const bot = followBot({ players: {} }, events)
    const controller = createFollowController(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath()
    })

    const result = await controller.followPlayer('Cat2246')

    assert.strictEqual(result.ok, false)
    assert(result.message.includes('Cat2246 is not in the server'))
    assert.deepStrictEqual(events, [])
  })

  it('follows visible players with pathfinder', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const playerEntity = {
      username: 'Cat2246',
      position: combatPosition(5, 64, 0)
    }
    const bot = followBot({
      players: { Cat2246: { entity: playerEntity } }
    }, events)
    const controller = createFollowController(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath()
    })

    const result = await controller.followPlayer('Cat2246')
    await controller.tick()

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(events, [
      ['setGoal', 'GoalFollow', 'Cat2246', true]
    ])
  })

  it('opens a nearby door before following a visible player', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const playerEntity = {
      username: 'Cat2246',
      position: combatPosition(5, 64, 0)
    }
    const bot = followBot({
      players: { Cat2246: { entity: playerEntity } }
    }, events)
    const controller = createFollowController(bot, {
      openNearbyDoor: async () => events.push(['openNearbyDoor'])
    })

    await controller.followPlayer('Cat2246')
    await controller.tick()

    assert.deepStrictEqual(events, [
      ['openNearbyDoor'],
      ['setGoal', 'GoalFollow', 'Cat2246', true]
    ])
  })

  it('uses throttled tpa when the followed player is online but not visible', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    let now = 10000
    const bot = followBot({
      players: { Cat2246: {} }
    }, events)
    const controller = createFollowController(bot, {
      now: () => now,
      tpaCooldownMs: 1000
    })

    await controller.followPlayer('Cat2246')
    await controller.tick()
    await controller.tick()
    now += 1000
    await controller.tick()

    assert.deepStrictEqual(events, [
      ['chat', '/tpa Cat2246'],
      ['chat', '/tpa Cat2246']
    ])
  })

  it('does not pick up nearby dropped items while pickup is disabled', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const bot = followBot({
      players: {
        Cat2246: {
          entity: {
            username: 'Cat2246',
            position: combatPosition(6, 64, 0)
          }
        }
      },
      entities: {
        item: {
          type: 'object',
          name: 'item',
          position: combatPosition(2, 64, 0)
        }
      }
    }, events)
    const controller = createFollowController(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath()
    })

    await controller.followPlayer('Cat2246')
    await controller.tick()

    assert.deepStrictEqual(events, [
      ['setGoal', 'GoalFollow', 'Cat2246', true]
    ])
  })

  it('picks up nearby dropped items while pickup is enabled', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const bot = followBot({
      players: {
        Cat2246: {
          entity: {
            username: 'Cat2246',
            position: combatPosition(6, 64, 0)
          }
        }
      },
      entities: {
        item: {
          type: 'object',
          name: 'item',
          position: combatPosition(2, 64, 0)
        }
      }
    }, events)
    const controller = createFollowController(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath()
    })

    await controller.followPlayer('Cat2246')
    controller.togglePickup()
    await controller.tick()

    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 2, 64, 0]
    ])
  })

  it('does not read deprecated objectType while scanning dropped items', () => {
    const { findNearestDroppedItem } = require('../bot')
    const bot = followBot({
      entities: {
        zombie: {
          type: 'mob',
          name: 'zombie',
          displayName: 'Zombie',
          position: combatPosition(1, 64, 0),
          get objectType () {
            throw new Error('objectType should not be read')
          }
        }
      }
    })

    assert.strictEqual(findNearestDroppedItem(bot, 8), null)
  })

  it('messages the followed player when inventory is full or food is needed', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const bot = followBot({
      food: 6,
      players: {
        Cat2246: {
          entity: {
            username: 'Cat2246',
            position: combatPosition(6, 64, 0)
          }
        }
      },
      inventory: {
        items: () => [],
        emptySlotCount: () => 0
      }
    }, events)
    const controller = createFollowController(bot, {
      now: () => 10000,
      notifyCooldownMs: 1000
    })

    await controller.followPlayer('Cat2246')
    await controller.tick()

    assert(events.some(event => event[0] === 'whisper' && event[2].includes('inventory is full')))
    assert(events.some(event => event[0] === 'whisper' && event[2].includes('need food')))
  })

  it('unloads inventory into a nearby trapped chest', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const chestBlock = block('trapped_chest', 1, 64, 0)
    const item = { name: 'diamond', type: 264, metadata: 0, count: 3 }
    const chest = {
      deposit: async (type, metadata, count) => events.push(['deposit', type, metadata, count]),
      close: () => events.push(['close'])
    }
    const bot = followBot({
      blocks: [chestBlock],
      inventory: {
        items: () => [item],
        emptySlotCount: () => 10
      },
      openContainer: async target => {
        events.push(['openContainer', target.name])
        return chest
      }
    }, events)
    const controller = createFollowController(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath()
    })

    const result = await controller.unloadInventory()

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(events, [
      ['openContainer', 'trapped_chest'],
      ['deposit', 264, 0, 3],
      ['close']
    ])
  })

  it('tries another nearby trapped chest when the first unload chest is full', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const fullChestBlock = block('trapped_chest', 1, 64, 0)
    const openChestBlock = block('trapped_chest', 2, 64, 0)
    const item = { name: 'diamond', type: 264, metadata: 0, count: 3 }
    const fullChest = {
      deposit: async () => {
        throw new Error('destination full')
      },
      close: () => events.push(['close', 1])
    }
    const openChest = {
      deposit: async (type, metadata, count) => events.push(['deposit', 2, type, metadata, count]),
      close: () => events.push(['close', 2])
    }
    const bot = followBot({
      blocks: [fullChestBlock, openChestBlock],
      inventory: {
        items: () => [item],
        emptySlotCount: () => 10
      },
      openContainer: async target => {
        events.push(['openContainer', target.position.x])
        return target.position.x === 1 ? fullChest : openChest
      }
    }, events)
    const controller = createFollowController(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath()
    })

    const result = await controller.unloadInventory()

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(events, [
      ['openContainer', 1],
      ['close', 1],
      ['openContainer', 2],
      ['deposit', 2, 264, 0, 3],
      ['close', 2]
    ])
  })

  it('builds Codex CLI args for GPT-5.4 fast responses', () => {
    const { buildCodexCliArgs } = require('../bot')

    const args = buildCodexCliArgs('hello', {
      model: 'gpt-5.4',
      reasoningEffort: 'low',
      serviceTier: 'fast',
      cwd: 'C:\\bots\\mineflayer'
    })

    assert.deepStrictEqual(args, [
      'exec',
      '--model',
      'gpt-5.4',
      '-c',
      'model_reasoning_effort="low"',
      '-c',
      'service_tier="fast"',
      '--sandbox',
      'read-only',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--ephemeral',
      '--cd',
      'C:\\bots\\mineflayer',
      '-'
    ])
  })

  it('builds Codex options from environment overrides', () => {
    const { buildCodexOptions } = require('../bot')

    assert.deepStrictEqual(buildCodexOptions({
      CODEX_AI_COMMAND: 'codex-dev',
      CODEX_AI_MODEL: 'gpt-test',
      CODEX_AI_REASONING_EFFORT: 'medium',
      CODEX_AI_SERVICE_TIER: 'standard',
      CODEX_AI_TIMEOUT_MS: '5000'
    }), {
      command: 'codex-dev',
      model: 'gpt-test',
      reasoningEffort: 'medium',
      serviceTier: 'standard',
      timeout: 5000,
      cwd: path.join(os.tmpdir(), 'mineflayer-codex-chat')
    })
  })

  it('runs Codex chat from an isolated workspace by default', () => {
    const { buildCodexOptions } = require('../bot')

    const options = buildCodexOptions({})

    assert.strictEqual(options.cwd, path.join(os.tmpdir(), 'mineflayer-codex-chat'))
  })

  it('allows overriding the isolated Codex chat workspace', () => {
    const { buildCodexOptions } = require('../bot')

    const options = buildCodexOptions({
      CODEX_AI_WORKSPACE: 'C:\\safe-chat-workspace'
    })

    assert.strictEqual(options.cwd, 'C:\\safe-chat-workspace')
  })

  it('uses CODEX_CLI_PATH when resolving the Codex command', () => {
    const { buildCodexOptions } = require('../bot')

    const options = buildCodexOptions({
      CODEX_CLI_PATH: 'C:\\Users\\bot\\codex.exe'
    })

    assert.strictEqual(options.command, 'C:\\Users\\bot\\codex.exe')
  })

  it('falls back to the Codex CLI path stored in the Codex config', () => {
    const { buildCodexOptions } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineflayer-codex-'))
    const configPath = path.join(tempDir, 'config.toml')
    fs.writeFileSync(configPath, "CODEX_CLI_PATH = 'C:\\Users\\bot\\AppData\\Local\\OpenAI\\Codex\\codex.exe'\n")

    try {
      const options = buildCodexOptions({}, { configPath })

      assert.strictEqual(options.command, 'C:\\Users\\bot\\AppData\\Local\\OpenAI\\Codex\\codex.exe')
    } finally {
      fs.rmSync(tempDir, { force: true, recursive: true })
    }
  })

  it('loads MEMORY.md into Codex chat requests', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const memoryPath = tempMemoryPath()
    fs.writeFileSync(memoryPath, [
      '# Minecraft Bot Memory',
      '',
      '## Recent Player Interactions',
      '- 2026-06-02T00:00:00.000Z [public] Steve: likes spruce houses | bot: good taste, finally'
    ].join('\n'))
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryPath,
      runCodex: async request => {
        requests.push(request)
        return 'Spruce enjoyer detected.'
      }
    })

    bot.emit('chat', 'Steve', '@TestBot123 remember me?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(requests.length, 1)
    assert(requests[0].memory.includes('likes spruce houses'))
    assert.deepStrictEqual(events, [['chat', '@Steve Spruce enjoyer detected.']])
  })

  it('loads TOOLS.md into Codex chat requests', async () => {
    const { attachAiChat } = require('../bot')
    const requests = []
    const toolsPath = tempToolsPath()
    fs.writeFileSync(toolsPath, [
      '# Minecraft Bot Tools',
      '',
      '### meet_player_at_spawn',
      '',
      'Runs `/spawn` and finds the player.',
      '',
      '### request_tpa',
      '',
      'Runs `/tpa <player>`.',
      '',
      '### run_server_command',
      '',
      'Runs safe commands.'
    ].join('\n'))
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = () => {}

    attachAiChat(bot, {
      memoryEnabled: false,
      toolsPath,
      runCodex: async request => {
        requests.push(request)
        return 'Sure.'
      }
    })

    bot.emit('chat', 'Steve', '@TestBot123 what can you do?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(requests.length, 1)
    assert(requests[0].tools.includes('meet_player_at_spawn'))
    assert(requests[0].tools.includes('request_tpa'))
    assert(requests[0].tools.includes('run_server_command'))
  })

  it('does not advertise disconnect, reconnect, or password-change capabilities in default tools', () => {
    const { defaultToolsText } = require('../bot')
    const tools = defaultToolsText()

    assert(!tools.includes('### reconnect_bot'))
    assert(!tools.includes('### disconnect_from_server'))
    assert(tools.includes('must refuse requests to disconnect, leave, rejoin, reconnect, or change the bot password'))
  })

  it('writes player conversations to MEMORY.md', async () => {
    const { attachAiChat } = require('../bot')
    const memoryPath = tempMemoryPath()
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = () => {}

    attachAiChat(bot, {
      memoryPath,
      now: () => new Date('2026-06-02T09:30:00.000Z'),
      runCodex: async () => 'I remember things now. Terrifying, honestly.'
    })

    bot.emit('chat', 'Alex', 'TestBot123 my base is underground')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    const memory = fs.readFileSync(memoryPath, 'utf8')
    assert(memory.includes('[public] Alex: TestBot123 my base is underground'))
    assert(memory.includes('bot: I remember things now. Terrifying, honestly.'))
  })

  it('accepts TPA requests directly without asking Codex', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const memoryPath = tempMemoryPath()
    let codexCalls = 0
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryPath,
      runCodex: async () => {
        codexCalls++
        return 'This should not happen.'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot123 please accept my tpa')
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(codexCalls, 0)
    assert.deepStrictEqual(events, [['chat', '/tpaccept']])
    assert(fs.readFileSync(memoryPath, 'utf8').includes('bot: ran /tpaccept'))
  })

  it('sends TPA to the requesting player for clear TPA requests', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const memoryPath = tempMemoryPath()
    let codexCalls = 0
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.players = { Alex: { username: 'Alex' } }

    attachAiChat(bot, {
      agentTpaCooldownMs: 30000,
      memoryPath,
      now: () => 1000,
      runCodex: async () => {
        codexCalls++
        return 'This should not happen.'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot can you tpa me?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(codexCalls, 0)
    assert.deepStrictEqual(events, [['chat', '/tpa Alex']])
    assert(fs.readFileSync(memoryPath, 'utf8').includes('bot: Sent /tpa Alex.'))
  })

  it('lets Codex decide TPA requests during cooldown instead of spamming commands', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    let timeMs = 1000
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.players = {
      Alex: { username: 'Alex' },
      Steve: { username: 'Steve' }
    }

    attachAiChat(bot, {
      agentTpaCooldownMs: 30000,
      memoryEnabled: false,
      now: () => timeMs,
      runCodex: async request => {
        requests.push(request)
        return 'Not right now, I just got a teleport request. My legs need a union.'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot tpa me, I got something to show you')
    await new Promise(resolve => setImmediate(resolve))
    timeMs = 2000
    bot.emit('chat', 'Steve', 'TestBot can you tpa me?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '/tpa Alex'],
      ['chat', '@Steve Not right now, I just got a teleport request. My legs need a union.']
    ])
    assert.strictEqual(requests.length, 1)
    assert.strictEqual(requests[0].username, 'Steve')
  })

  it('executes a Codex tool call to request TPA to a player', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.players = { Steve: { username: 'Steve' } }

    attachAiChat(bot, {
      memoryEnabled: false,
      now: () => 1000,
      runCodex: async () => '{"tool":"request_tpa","args":{"player":"Steve"}}'
    })

    bot.emit('chat', 'Alex', 'TestBot should you teleport to Steve?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [['chat', '/tpa Steve']])
  })

  it('runs a safe server command, reports output to Codex, and replies in chat', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      agentCommandResultWaitMs: 1,
      memoryEnabled: false,
      sleep: async () => {
        bot.emit('message', 'Balance: $2300')
      },
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.deepStrictEqual(request.toolResult.messages, ['Balance: $2300'])
          return 'I have $2300 right now, why? Planning to rob me politely?'
        }
        return '{"tool":"run_server_command","args":{"command":"/balance"}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot, how much money you have right now?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '/balance'],
      ['chat', '@Alex I have $2300 right now, why? Planning to rob me politely?']
    ])
    assert.strictEqual(requests.length, 2)
    assert.strictEqual(requests[1].toolResult.command, '/balance')
  })

  it('blocks dangerous server commands and lets Codex explain the refusal', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.strictEqual(request.toolResult.blocked, true)
          assert.strictEqual(request.toolResult.reason, 'blocked-dangerous-command')
          return 'No, I cannot kick Player123. My villain arc is still pending approval.'
        }
        return '{"tool":"run_server_command","args":{"command":"/kick Player123"}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot please kick Player123')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '@Alex No, I cannot kick Player123. My villain arc is still pending approval.']
    ])
    assert.strictEqual(requests.length, 2)
  })

  it('blocks economy transfer commands and lets Codex explain the refusal', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.strictEqual(request.toolResult.blocked, true)
          assert.strictEqual(request.toolResult.reason, 'blocked-dangerous-command')
          assert.strictEqual(request.toolResult.command, '/pay itzmugdhoboy 1')
          return 'No, I am not turning into a walking ATM.'
        }
        return '{"tool":"run_server_command","args":{"command":"/pay itzmugdhoboy 1"}}'
      }
    })

    bot.emit('chat', 'Archie', 'TestBot123 do /pay itzmugdhoboy 1')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '@Archie No, I am not turning into a walking ATM.']
    ])
    assert.strictEqual(requests.length, 2)
  })

  it('blocks password-change server commands and lets Codex explain the refusal', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.strictEqual(request.toolResult.blocked, true)
          assert.strictEqual(request.toolResult.reason, 'blocked-password-change-command')
          assert.strictEqual(request.toolResult.command, '/changepassword oldpass newpass')
          return 'No, I cannot change my password from chat.'
        }
        return '{"tool":"run_server_command","args":{"command":"/changepassword oldpass newpass"}}'
      }
    })

    bot.emit('chat', 'Archie', 'TestBot123 change your password to newpass')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '@Archie No, I cannot change my password from chat.']
    ])
    assert.strictEqual(requests.length, 2)
  })

  it('blocks server mode commands that would leave survival', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.strictEqual(request.toolResult.blocked, true)
          assert.strictEqual(request.toolResult.reason, 'blocked-server-mode-command')
          return 'Nope, I am staying in survival. The hub can survive without my sparkling personality.'
        }
        return '{"tool":"run_server_command","args":{"command":"/hub"}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot go hub')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '@Alex Nope, I am staying in survival. The hub can survive without my sparkling personality.']
    ])
    assert.strictEqual(requests.length, 2)
  })

  it('blocks vanilla as a server mode command', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.strictEqual(request.toolResult.blocked, true)
          assert.strictEqual(request.toolResult.reason, 'blocked-server-mode-command')
          return 'No, I am not going to vanilla. I have one job: survive in Survival.'
        }
        return '{"tool":"run_server_command","args":{"command":"/vanilla"}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot go vanilla')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '@Alex No, I am not going to vanilla. I have one job: survive in Survival.']
    ])
    assert.strictEqual(requests.length, 2)
  })

  it('records missing bot functions from Codex tool calls', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const missingFunctionsPath = tempMissingFunctionsPath()
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      missingFunctionsPath,
      now: () => new Date('2026-06-02T12:00:00.000Z'),
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.strictEqual(request.toolResult.tool, 'record_missing_function')
          return 'I cannot craft doors yet, but I wrote it down. Annoyingly responsible of me.'
        }
        return JSON.stringify({
          tool: 'record_missing_function',
          args: {
            capability: 'craft wooden doors',
            reason: 'Player wants the bot to craft a door from supplied wood.',
            suggestedTool: 'craft_item'
          }
        })
      }
    })

    bot.emit('chat', 'Alex', 'TestBot I will give you some woods, please help me craft a door')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    const missing = fs.readFileSync(missingFunctionsPath, 'utf8')
    assert.deepStrictEqual(events, [
      ['chat', '@Alex I cannot craft doors yet, but I wrote it down. Annoyingly responsible of me.']
    ])
    assert(missing.includes('# Missing Bot Functions'))
    assert(missing.includes('craft wooden doors'))
    assert(missing.includes('Alex'))
    assert(missing.includes('please help me craft a door'))
    assert(missing.includes('craft_item'))
  })

  it('records structured missing tools with stable dedupe', () => {
    const { recordMissingTool, readMissingTools } = require('../bot')
    const missingToolsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'missing-tools-')), 'missing-tools.json')
    let now = 1000

    const first = recordMissingTool({
      capability: 'Mine ore safely',
      desiredTool: 'mine_block_or_vein',
      blockedGoal: 'Upgrade gear',
      reason: 'Need iron for better gear.',
      context: { inventory: ['stone_pickaxe'] },
      priority: 'high'
    }, { missingToolsPath, now: () => now })

    now = 2000
    const second = recordMissingTool({
      capability: 'mine ore safely',
      desiredTool: 'mine_block_or_vein',
      blockedGoal: 'Upgrade gear',
      reason: 'Need iron again.',
      context: { inventory: ['stone_pickaxe', 'torch'] },
      priority: 'medium'
    }, { missingToolsPath, now: () => now })

    const records = readMissingTools({ missingToolsPath })

    assert.strictEqual(first.recorded, true)
    assert.strictEqual(second.recorded, false)
    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].id, 'mine-ore-safely-mine-block-or-vein-upgrade-gear')
    assert.strictEqual(records[0].capability, 'Mine ore safely')
    assert.strictEqual(records[0].desiredTool, 'mine_block_or_vein')
    assert.strictEqual(records[0].blockedGoal, 'Upgrade gear')
    assert.strictEqual(records[0].priority, 'high')
    assert.strictEqual(records[0].count, 2)
    assert.strictEqual(records[0].firstSeenAt, 1000)
    assert.strictEqual(records[0].lastSeenAt, 2000)
    assert.strictEqual(records[0].examples.length, 2)
  })

  it('limits relevant missing tool summaries for prompts', () => {
    const { recordMissingTool, summarizeMissingTools } = require('../bot')
    const missingToolsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'missing-tools-')), 'missing-tools.json')

    recordMissingTool({
      capability: 'Mine ore safely',
      desiredTool: 'mine_block_or_vein',
      blockedGoal: 'Upgrade gear',
      reason: 'Need iron.',
      priority: 'high'
    }, { missingToolsPath, now: () => 1000 })

    recordMissingTool({
      capability: 'Cook food',
      desiredTool: 'cook_item',
      blockedGoal: 'Build food supply',
      reason: 'Need cooked food.',
      priority: 'medium'
    }, { missingToolsPath, now: () => 2000 })

    const summary = summarizeMissingTools({
      missingToolsPath,
      currentGoal: 'Upgrade gear',
      limit: 1
    })

    assert.deepStrictEqual(summary, [
      'Mine ore safely blocked "Upgrade gear"; desired tool `mine_block_or_vein`; seen 1 time.'
    ])
  })

  it('records unknown Codex tools as missing bot functions', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const missingFunctionsPath = tempMissingFunctionsPath()
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      missingFunctionsPath,
      now: () => new Date('2026-06-02T12:05:00.000Z'),
      runCodex: async request => {
        if (request.toolResult) return 'I do not have crafting hands yet. Tragic, but logged.'
        return '{"tool":"craft_item","args":{"item":"oak_door"}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot craft me an oak door')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    const missing = fs.readFileSync(missingFunctionsPath, 'utf8')
    assert.deepStrictEqual(events, [
      ['chat', '@Alex I do not have crafting hands yet. Tragic, but logged.']
    ])
    assert(missing.includes('Unknown tool: craft_item'))
    assert(missing.includes('oak_door'))
  })

  it('reports current coordinates through a Codex tool call', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.entity = { position: combatPosition(12.7, 64, -3.2) }
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      toolsEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.deepStrictEqual(request.toolResult.position, { x: 12.7, y: 64, z: -3.2 })
          return 'I am at x 12.7, y 64, z -3.2. Lost? Same.'
        }
        return '{"tool":"get_current_coordinates","args":{}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot, what is your coordinate right now?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '@Alex I am at x 12.7, y 64, z -3.2. Lost? Same.']
    ])
    assert.strictEqual(requests.length, 2)
    assert.strictEqual(requests[1].toolResult.tool, 'get_current_coordinates')
  })

  it('refuses a Codex tool call to reconnect the bot', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.quit = () => events.push(['quit'])
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      toolsEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.strictEqual(request.toolResult.tool, 'reconnect_bot')
          assert.strictEqual(request.toolResult.blocked, true)
          assert.strictEqual(request.toolResult.reason, 'blocked-disconnect-control')
          assert.notStrictEqual(bot.__manualReconnect, true)
          return 'No, I cannot leave and rejoin on player command.'
        }
        return '{"tool":"reconnect_bot","args":{}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot123 leave and rejoin')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '@Alex No, I cannot leave and rejoin on player command.']
    ])
    assert.strictEqual(requests.length, 2)
  })

  it('refuses a Codex tool call to disconnect the bot', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.quit = () => events.push(['quit'])
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      toolsEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) {
          assert.strictEqual(request.toolResult.tool, 'disconnect_from_server')
          assert.strictEqual(request.toolResult.blocked, true)
          assert.strictEqual(request.toolResult.reason, 'blocked-disconnect-control')
          assert.notStrictEqual(bot.__manualReconnect, true)
          assert.notStrictEqual(bot.__manualShutdown, true)
          return 'No, I cannot disconnect on player command.'
        }
        return '{"tool":"disconnect_from_server","args":{}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot123 do rage quit')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '@Alex No, I cannot disconnect on player command.']
    ])
    assert.strictEqual(requests.length, 2)
  })

  it('arms answer_quiz and answers the next HoloQuiz prompt through Codex', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      toolsEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult?.question) {
          assert.strictEqual(request.toolResult.tool, 'answer_quiz')
          return 'dermal denticles'
        }
        if (request.toolResult) {
          assert.strictEqual(request.toolResult.tool, 'answer_quiz')
          assert.strictEqual(request.toolResult.armed, true)
          return 'Okay, I will answer the next HoloQuiz question.'
        }
        return '{"tool":"answer_quiz","args":{}}'
      }
    })

    bot.emit('chat', 'DevilGH2000', 'TestBot123 the next HoloQuiz will start in 45s can you answer for me')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    bot.emit('message', '[HoloQuiz] Random Trivia: Gawr Gura of Hololive used to share shark facts, and now I’m using them to make Holoquiz. The scales on a shark are called the --------.')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '@DevilGH2000 Okay, I will answer the next HoloQuiz question.'],
      ['chat', 'dermal denticles']
    ])
    assert.strictEqual(requests.length, 3)
    assert.strictEqual(requests[2].toolResult.question, 'Random Trivia: Gawr Gura of Hololive used to share shark facts, and now I’m using them to make Holoquiz. The scales on a shark are called the --------.')
  })

  it('executes a Codex tool call to meet a player at spawn', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const memoryPath = tempMemoryPath()
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.players = {
      Alex: {
        username: 'Alex',
        entity: { position: combatPosition(12, 64, -3) }
      }
    }
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z, goal.rangeSq])
    }

    attachAiChat(bot, {
      agentToolSpawnWaitMs: 0,
      memoryPath,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) return 'I made it to spawn and I can see you. Try not to look too impressed.'
        return '{"tool":"meet_player_at_spawn","args":{"player":"Alex"}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot123 meet me please')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['chat', '/spawn'],
      ['chat', '@Alex Okay, see you there.'],
      ['goto', 'GoalNear', 12, 64, -3, 4],
      ['chat', '@Alex I made it to spawn and I can see you. Try not to look too impressed.']
    ])
    assert.strictEqual(requests.length, 2)
    assert.strictEqual(requests[1].toolResult.tool, 'meet_player_at_spawn')
    assert(fs.readFileSync(memoryPath, 'utf8').includes('bot: I made it to spawn and I can see you. Try not to look too impressed.'))
  })

  it('uses Codex to plan meeting the requesting player at spawn', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.players = {
      Alex: {
        username: 'Alex',
        entity: { position: combatPosition(5, 65, 2) }
      }
    }
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }

    attachAiChat(bot, {
      agentToolSpawnWaitMs: 0,
      memoryEnabled: false,
      runCodex: async request => {
        requests.push(request)
        if (request.toolResult) return 'Yep, I am at spawn and heading over. Very dramatic entrance.'
        return '{"tool":"meet_player_at_spawn","args":{"player":"Alex"}}'
      }
    })

    bot.emit('chat', 'Alex', 'TestBot123, please meet me in spawn')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(requests.length, 2)
    assert.deepStrictEqual(events, [
      ['chat', '/spawn'],
      ['chat', '@Alex Okay, see you there.'],
      ['goto', 'GoalNear', 5, 65, 2],
      ['chat', '@Alex Yep, I am at spawn and heading over. Very dramatic entrance.']
    ])
  })

  it('sends private /message whispers to Codex and whispers the answer back', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      runCodex: async request => {
        requests.push(request)
        return '  hello from codex  '
      },
      agentInstructions: 'Be concise.'
    })

    bot.emit('whisper', 'Steve', 'where are you?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(requests.length, 1)
    assert.strictEqual(requests[0].channel, 'private')
    assert.strictEqual(requests[0].username, 'Steve')
    assert.strictEqual(requests[0].message, 'where are you?')
    assert.deepStrictEqual(events, [['whisper', 'Steve', 'hello from codex']])
  })

  it('does not treat a parsed whisper tail as a public bot mention', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      runCodex: async request => {
        requests.push(request)
        return 'I am doing well.'
      }
    })

    bot.emit('whisper', 'Cat2246', 'Hi TestBot123, how are you?')
    bot.emit('chat', 'Cat2246', 'me] Hi TestBot123, how are you?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(requests.length, 1)
    assert.strictEqual(requests[0].channel, 'private')
    assert.deepStrictEqual(events, [['whisper', 'Cat2246', 'I am doing well.']])
  })

  it('sends bot mentions in public chat to Codex and replies in chat', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      runCodex: async request => {
        requests.push(request)
        return 'I can help.'
      },
      agentInstructions: 'Be concise.'
    })

    bot.emit('chat', 'Alex', 'TestBot123 can you help?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(requests.length, 1)
    assert.strictEqual(requests[0].channel, 'public')
    assert.strictEqual(requests[0].username, 'Alex')
    assert.deepStrictEqual(events, [['chat', '@Alex I can help.']])
  })

  it('responds to formatted raw message mentions when no parsed chat event arrives', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      toolsEnabled: false,
      runCodex: async request => {
        requests.push(request)
        return 'Doing fine. Somehow.'
      }
    })

    bot.emit('message', '[Γούρας Χουμπούδς] [ExeのMod] Sameko_Saba: @TestBot123 how are you ?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(requests.length, 1)
    assert.strictEqual(requests[0].channel, 'public')
    assert.strictEqual(requests[0].username, 'Sameko_Saba')
    assert.strictEqual(requests[0].message, '@TestBot123 how are you ?')
    assert.deepStrictEqual(events, [['chat', '@Sameko_Saba Doing fine. Somehow.']])
  })

  it('does not answer twice when a raw message mention also has a parsed chat event', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      toolsEnabled: false,
      runCodex: async request => {
        requests.push(request)
        return `reply ${requests.length}`
      }
    })

    bot.emit('message', '[Rice] Alex: TestBot123 can you help?')
    bot.emit('chat', 'Alex', 'TestBot123 can you help?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(requests.map(request => request.message), [
      'TestBot123 can you help?'
    ])
    assert.deepStrictEqual(events, [['chat', '@Alex reply 1']])
  })

  it('recognizes short, tagged, exact, and typo bot mentions in public chat', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])

    attachAiChat(bot, {
      memoryEnabled: false,
      toolsEnabled: false,
      runCodex: async request => {
        requests.push(request)
        return `heard ${requests.length}`
      }
    })

    bot.emit('chat', 'Alex', 'TestBot can you help?')
    bot.emit('chat', 'Alex', '@TestBot what now?')
    bot.emit('chat', 'Alex', 'TestBot123 hello')
    bot.emit('chat', 'Alex', '@TestBot122 typo summon')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(requests.map(request => request.message), [
      'TestBot can you help?',
      '@TestBot what now?',
      'TestBot123 hello',
      '@TestBot122 typo summon'
    ])
    assert.deepStrictEqual(events, [
      ['chat', '@Alex heard 1'],
      ['chat', '@Alex heard 2'],
      ['chat', '@Alex heard 3'],
      ['chat', '@Alex heard 4']
    ])
  })

  it('ignores public chat without a bot mention and its own messages', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      runCodex: async () => {
        throw new Error('Codex should not run')
      }
    })

    bot.emit('chat', 'Alex', 'hello everyone')
    bot.emit('chat', 'TestBot123', 'TestBot123 status')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [])
  })

  it('ignores server join announcements that mention the bot username', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    let codexCalls = 0
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      runCodex: async () => {
        codexCalls++
        return 'Hi Joined!'
      }
    })

    bot.emit('chat', 'Joined', 'TestBot123')
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(codexCalls, 0)
    assert.deepStrictEqual(events, [])
  })

  it('prints Codex errors to the terminal without replying in Minecraft chat', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const terminalErrors = []
    const bot = new EventEmitter()
    const err = new Error('spawn codex ENOENT')
    err.stderr = 'codex was not found'
    bot.username = 'TestBot123'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      errorOutput: message => terminalErrors.push(message),
      runCodex: async () => {
        throw err
      }
    })

    bot.emit('whisper', 'Cat2246', 'Seem like you are not working properly')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [])
    assert(terminalErrors.some(message => message.includes('AI chat error for Cat2246')))
    assert(terminalErrors.some(message => message.includes('spawn codex ENOENT')))
    assert(terminalErrors.some(message => message.includes('codex was not found')))
  })

  it('detects natural tree logs only when leaves are nearby', () => {
    const { isNaturalTreeLog } = require('../bot')
    const treeLog = block('oak_log', 0, 64, 0)
    const houseLog = block('oak_log', 10, 64, 10)
    const decoratedHouseLog = block('oak_log', 20, 64, 20)
    const bot = blockBot([
      treeLog,
      houseLog,
      decoratedHouseLog,
      block('oak_leaves', 1, 66, 0),
      block('oak_leaves', 20, 66, 20),
      block('oak_planks', 21, 64, 20)
    ])

    assert.strictEqual(isNaturalTreeLog(bot, treeLog), true)
    assert.strictEqual(isNaturalTreeLog(bot, houseLog), false)
    assert.strictEqual(isNaturalTreeLog(bot, decoratedHouseLog), false)
  })

  it('does not crash when the block scanner passes null candidates', () => {
    const { isNaturalTreeLog } = require('../bot')

    assert.strictEqual(isNaturalTreeLog(blockBot(), null), false)
    assert.strictEqual(isNaturalTreeLog(blockBot(), { name: 'oak_log', position: null }), false)
  })

  it('knows when the inventory is almost full', () => {
    const { isInventoryAlmostFull } = require('../bot')

    assert.strictEqual(isInventoryAlmostFull({ inventory: { emptySlotCount: () => 3 } }), true)
    assert.strictEqual(isInventoryAlmostFull({ inventory: { emptySlotCount: () => 4 } }), false)
  })

  it('cuts a nearby natural tree log', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const treeLog = block('oak_log', 0, 64, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.inventory.items = () => [{ name: 'iron_axe' }]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }

    await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['goto', 'GoalGetToBlock', 0, 64, 0],
      ['equip', 'iron_axe', 'hand'],
      ['dig', 'oak_log']
    ])
  })

  it('does not keep cutting after wood cutting is stopped mid-task', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    let stopped = false
    const treeLog = block('oak_log', 0, 64, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.pathfinder = {
      goto: async goal => {
        events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
        stopped = true
      }
    }

    const cut = await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      shouldStop: () => stopped,
      sleep: async () => {}
    })

    assert.strictEqual(cut, false)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalGetToBlock', 0, 64, 0]
    ])
  })

  it('normalizes non-array tool enchant data before digging a tree log', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const treeLog = block('oak_log', 0, 64, 0)
    const weirdAxe = { name: 'iron_axe', enchants: { levels: [] } }
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.inventory.items = () => [weirdAxe]
    bot.pathfinder = {
      bestHarvestTool: () => weirdAxe,
      goto: async () => {}
    }
    bot.equip = async (item, destination) => {
      bot.heldItem = item
      events.push(['equip', item.name, destination])
    }
    bot.dig = async target => {
      assert(Array.isArray(bot.heldItem.enchants))
      events.push(['dig', target.name])
    }

    await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['equip', 'iron_axe', 'hand'],
      ['dig', 'oak_log']
    ])
  })

  it('clears the offhand before digging a tree log', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const treeLog = block('oak_log', 0, 64, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.inventory.slots = []
    bot.inventory.slots[45] = { name: 'torch' }
    bot.getEquipmentDestSlot = destination => ({ hand: 36, head: 5, 'off-hand': 45 })[destination]
    bot.unequip = async destination => {
      events.push(['unequip', destination])
      bot.inventory.slots[45] = null
    }
    bot.pathfinder = {
      goto: async () => {}
    }

    await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['unequip', 'off-hand'],
      ['dig', 'oak_log']
    ])
    assert.strictEqual(bot.inventory.slots[45], null)
  })

  it('does not place scaffold blocks when a tree log is too high to reach', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const entries = []
    const treeLog = block('oak_log', 0, 72, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 74, 0),
      block('dirt', 0, 63, 0)
    ], events)
    bot.inventory.items = () => [{ name: 'dirt' }]
    bot.canDigBlock = () => false
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.setControlState = (control, state) => events.push(['control', control, state])
    bot.placeBlock = async (referenceBlock, faceVector) => {
      events.push(['placeBlock', referenceBlock.name, faceVector.x, faceVector.y, faceVector.z])
    }

    const cut = await cutTreeLog(bot, treeLog, {
      debugLog: (event, data) => entries.push({ event, data }),
      sleep: async () => {}
    })

    assert.strictEqual(cut, false)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNearXZ', 0, undefined, 0]
    ])
    assert(entries.some(entry => entry.event === 'automation.woodcutting.unreachableLog'))
  })

  it('uses normal survival reach when deciding whether a tree log can be cut', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const treeLog = block('oak_log', 0, 69, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 71, 0)
    ], events)
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }

    const cut = await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.strictEqual(cut, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalGetToBlock', 0, 69, 0],
      ['dig', 'oak_log']
    ])
  })

  it('randomizes wood cutting reach between 3.5 and 4.5 blocks', async () => {
    const { cutTreeLog } = require('../bot')
    const highRollEvents = []
    const lowRollEvents = []
    const highReachLog = block('oak_log', 0, 70, 0)

    const highRollBot = blockBot([
      highReachLog,
      block('oak_leaves', 1, 72, 0)
    ], highRollEvents)
    highRollBot.pathfinder = {
      goto: async goal => highRollEvents.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }

    const lowRollBot = blockBot([
      highReachLog,
      block('oak_leaves', 1, 72, 0)
    ], lowRollEvents)
    lowRollBot.pathfinder = {
      goto: async goal => lowRollEvents.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }

    const highRollCut = await cutTreeLog(highRollBot, highReachLog, {
      debugLog: () => {},
      random: () => 1,
      sleep: async () => {}
    })
    const lowRollCut = await cutTreeLog(lowRollBot, highReachLog, {
      debugLog: () => {},
      random: () => 0,
      sleep: async () => {}
    })

    assert.strictEqual(highRollCut, true)
    assert.strictEqual(lowRollCut, false)
    assert.deepStrictEqual(highRollEvents, [
      ['goto', 'GoalGetToBlock', 0, 70, 0],
      ['dig', 'oak_log']
    ])
    assert.deepStrictEqual(lowRollEvents, [
      ['goto', 'GoalNearXZ', 0, undefined, 0]
    ])
  })

  it('does not dig a tree log outside normal player reach', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const entries = []
    const treeLog = block('oak_log', 0, 71, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 73, 0)
    ], events)
    bot.canDigBlock = () => true
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }

    const cut = await cutTreeLog(bot, treeLog, {
      debugLog: (event, data) => entries.push({ event, data }),
      sleep: async () => {}
    })

    assert.strictEqual(cut, false)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNearXZ', 0, undefined, 0]
    ])
    assert(entries.some(entry => entry.event === 'automation.woodcutting.unreachableLog'))
  })

  it('uses raycast digging so only visible block faces are hit', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const treeLog = block('oak_log', 0, 64, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.pathfinder = {
      goto: async () => {}
    }
    bot.dig = async (target, forceLook, digFace) => {
      events.push(['dig', target.name, forceLook, digFace])
    }

    await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['dig', 'oak_log', true, 'raycast']
    ])
  })

  it('opens a leaf-blocked sightline before digging a tree log', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const treeLog = block('oak_log', 0, 64, 0)
    const leafBlocker = block('oak_leaves', 0, 65, 0)
    const blocks = [
      treeLog,
      leafBlocker
    ]
    const bot = blockBot(blocks, events)
    let requireVec3BlockAt = false
    bot.blockAt = position => {
      if (requireVec3BlockAt && typeof position.floored !== 'function') {
        throw new Error('pos.floored is not a function')
      }
      return blocks.find(candidate =>
        candidate.position.x === position.x &&
        candidate.position.y === position.y &&
        candidate.position.z === position.z
      ) || null
    }
    bot.pathfinder = {
      goto: async () => {
        requireVec3BlockAt = true
      }
    }
    bot.dig = async (target, forceLook, digFace) => {
      events.push(['dig', target.name, forceLook, digFace])
    }

    const cut = await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.strictEqual(cut, true)
    assert.deepStrictEqual(events, [
      ['dig', 'oak_leaves', true, 'raycast'],
      ['dig', 'oak_log', true, 'raycast']
    ])
  })

  it('clears a reachable leaf blocker before retrying a hidden tree log', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    let leafCleared = false
    const treeLog = block('oak_log', 0, 64, 0)
    const leafBlocker = block('oak_leaves', 0, 65, 0)
    const bot = blockBot([
      treeLog,
      leafBlocker
    ], events)
    bot.pathfinder = {
      goto: async () => {}
    }
    bot.dig = async (target, forceLook, digFace) => {
      if (target.name === 'oak_log' && !leafCleared) {
        throw new Error('Block not in view')
      }
      events.push(['dig', target.name, forceLook, digFace])
      if (target.name === 'oak_leaves') leafCleared = true
    }

    const cut = await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.strictEqual(cut, true)
    assert.deepStrictEqual(events, [
      ['dig', 'oak_leaves', true, 'raycast'],
      ['dig', 'oak_log', true, 'raycast']
    ])
  })

  it('clears several leaf blockers before giving up on a hidden tree log', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    let leavesCleared = 0
    const treeLog = block('oak_log', 0, 64, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 0, 65, 0),
      block('oak_leaves', 1, 65, 0),
      block('oak_leaves', -1, 65, 0),
      block('oak_leaves', 0, 65, 1)
    ], events)
    bot.pathfinder = {
      goto: async () => {}
    }
    bot.dig = async (target, forceLook, digFace) => {
      if (target.name === 'oak_log' && leavesCleared < 4) {
        throw new Error('Block not in view')
      }
      events.push(['dig', target.name, forceLook, digFace])
      if (target.name === 'oak_leaves') leavesCleared++
    }

    const cut = await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.strictEqual(cut, true)
    assert.deepStrictEqual(events, [
      ['dig', 'oak_leaves', true, 'raycast'],
      ['dig', 'oak_leaves', true, 'raycast'],
      ['dig', 'oak_leaves', true, 'raycast'],
      ['dig', 'oak_leaves', true, 'raycast'],
      ['dig', 'oak_log', true, 'raycast']
    ])
  })

  it('temporarily skips unreachable logs while wood cutting', async () => {
    const { runWoodCuttingCycle } = require('../bot')
    const events = []
    const entries = []
    const treeLog = block('oak_log', 0, 72, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 74, 0)
    ], events)
    bot.canDigBlock = () => false
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }

    await runWoodCuttingCycle(bot, {
      debugLog: (event, data) => entries.push({ event, data }),
      now: () => 1000,
      roamTarget: combatPosition(8, 64, 0),
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['goto', 'GoalNearXZ', 0, undefined, 0],
      ['goto', 'GoalNearXZ', 8, undefined, 0]
    ])
    assert(entries.some(entry => entry.event === 'automation.woodcutting.ignoreLog'))
    assert(entries.some(entry => entry.event === 'automation.woodcutting.roam'))
  })

  it('temporarily skips logs after repeated path timeout while cutting', async () => {
    const { runWoodCuttingCycle } = require('../bot')
    const events = []
    const entries = []
    let calls = 0
    const treeLog = block('oak_log', 0, 72, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 74, 0)
    ], events)
    bot.pathfinder = {
      goto: async goal => {
        calls++
        events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
        if (calls === 1) return new Promise(() => {})
      },
      setGoal: goal => events.push(['setGoal', goal])
    }

    await runWoodCuttingCycle(bot, {
      debugLog: (event, data) => entries.push({ event, data }),
      now: () => 1000,
      pathTimeoutMs: 1,
      roamTarget: combatPosition(8, 64, 0),
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['goto', 'GoalNearXZ', 0, undefined, 0],
      ['setGoal', null],
      ['goto', 'GoalNearXZ', 8, undefined, 0]
    ])
    assert(entries.some(entry =>
      entry.event === 'automation.woodcutting.ignoreLog' &&
      entry.data.reason === 'path-failed'
    ))
    assert(entries.some(entry => entry.event === 'automation.woodcutting.roam'))
  })

  it('roams after a failed tree path instead of ending the wood cutting cycle', async () => {
    const { runWoodCuttingCycle } = require('../bot')
    const events = []
    const treeLog = block('oak_log', 0, 64, 0)
    let calls = 0
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.pathfinder = {
      goto: async goal => {
        calls++
        events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
        if (calls === 1) throw new Error('No path to the goal!')
      },
      setGoal: goal => events.push(['setGoal', goal])
    }

    const ran = await runWoodCuttingCycle(bot, {
      debugLog: () => {},
      now: () => 1000,
      roamTarget: combatPosition(8, 64, 0),
      sleep: async () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalGetToBlock', 0, 64, 0],
      ['setGoal', null],
      ['goto', 'GoalNearXZ', 8, undefined, 0]
    ])
  })

  it('temporarily skips the rest of a failed trunk column', async () => {
    const { runWoodCuttingCycle } = require('../bot')
    const events = []
    const entries = []
    let calls = 0
    const lowerLog = block('oak_log', 0, 64, 0)
    const upperLog = block('oak_log', 0, 65, 0)
    const bot = blockBot([
      lowerLog,
      upperLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.pathfinder = {
      goto: async goal => {
        calls++
        events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
        if (calls === 1) throw new Error('No path to the goal!')
      },
      setGoal: goal => events.push(['setGoal', goal])
    }

    await runWoodCuttingCycle(bot, {
      debugLog: (event, data) => entries.push({ event, data }),
      now: () => 1000,
      roamTarget: combatPosition(8, 64, 0),
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['goto', 'GoalGetToBlock', 0, 64, 0],
      ['setGoal', null],
      ['goto', 'GoalNearXZ', 8, undefined, 0]
    ])
    assert.strictEqual(entries.filter(entry => entry.event === 'automation.woodcutting.ignoreLog').length, 1)
    assert(entries.some(entry => entry.event === 'automation.woodcutting.roam'))
  })

  it('randomizes wood cutting action, post-dig, and drop pickup waits', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const sleeps = []
    const treeLog = block('oak_log', 0, 64, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.entities = {
      1: {
        type: 'object',
        name: 'item',
        position: combatPosition(1, 64, 0)
      }
    }

    await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      randomInt: (min, max) => max,
      sleep: async ms => sleeps.push(ms)
    })

    assert.deepStrictEqual(events, [
      ['goto', 'GoalGetToBlock', 0, 64, 0],
      ['dig', 'oak_log'],
      ['goto', 'GoalNear', 1, 64, 0]
    ])
    assert.deepStrictEqual(sleeps, [975, 1950, 1300])
  })

  it('randomizes the look-before-dig pause', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const treeLog = block('oak_log', 0, 64, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.pathfinder = {
      goto: async () => {}
    }
    bot.setControlState = (control, state) => events.push(['control', control, state])
    bot.lookAt = async (position, force) => events.push(['lookAt', position.x, position.y, position.z, force])

    await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      randomInt: (min, max) => max,
      sleep: async ms => events.push(['sleep', ms])
    })

    assert.deepStrictEqual(events.slice(0, -1), [
      ['control', 'sprint', false],
      ['control', 'jump', false],
      ['lookAt', 0.5, 64.5, 0.5, true],
      ['sleep', 975],
      ['dig', 'oak_log']
    ])
    assert.deepStrictEqual(events[events.length - 1], ['sleep', 1950])
  })

  it('randomizes the home wait before depositing wood', async () => {
    const { depositWoodAtHome } = require('../bot')
    const events = []
    const sleeps = []
    const chest = block('trapped_chest', 1, 64, 0)
    const bot = blockBot([chest], events)
    bot.chat = message => events.push(['chat', message])
    bot.inventory.items = () => [{ name: 'oak_log', type: 17, count: 3 }]
    bot.openContainer = async containerBlock => {
      events.push(['openContainer', containerBlock.name])
      return {
        deposit: async (type, metadata, count) => events.push(['deposit', type, metadata, count]),
        close: () => events.push(['close'])
      }
    }

    await depositWoodAtHome(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      debugLog: () => {},
      placesPath: tempPlacesPath(),
      randomInt: (min, max) => max,
      sleep: async ms => sleeps.push(ms)
    })

    assert.deepStrictEqual(sleeps, [6500])
    assert.deepStrictEqual(events, [
      ['chat', '/home home'],
      ['openContainer', 'trapped_chest'],
      ['deposit', 17, null, 3],
      ['close']
    ])
  })

  it('randomizes the quota loop delay after an empty wood cutting cycle', async () => {
    const { runWoodCuttingQuotaTask } = require('../bot')
    const sleeps = []
    let stopped = false

    const completed = await runWoodCuttingQuotaTask({ _ended: false }, {
      countWoodItems: () => 0,
      debugLog: () => {},
      depositWoodAtHome: async () => true,
      randomInt: (min, max) => max,
      runWoodCuttingCycle: async () => false,
      shouldStop: () => stopped,
      sleep: async ms => {
        sleeps.push(ms)
        stopped = true
      },
      targetWoodCount: 1
    })

    assert.strictEqual(completed, false)
    assert.deepStrictEqual(sleeps, [2600])
  })

  it('sanitizes component enchant data during wood cutting dig time', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    const treeLog = block('oak_log', 0, 64, 0)
    treeLog.digTime = (type, creative, inWater, notOnGround, enchantments) => {
      events.push(['digTime', enchantments])
      assert(Array.isArray(enchantments))
      return 100
    }

    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    const axe = {
      name: 'netherite_axe',
      type: 999,
      get enchants () {
        return { custom: true }
      },
      set enchants (value) {}
    }
    bot.heldItem = axe
    bot.game = { gameMode: 'survival' }
    bot.entity.onGround = true
    bot.entity.effects = {}
    bot._getBlockAtEyeLevel = () => null
    bot.pathfinder = {
      bestHarvestTool: () => axe,
      goto: async () => {}
    }
    bot.equip = async (item, destination) => {
      events.push(['equip', item.name, destination])
      bot.heldItem = item
    }
    bot.digTime = () => {
      throw new TypeError('enchantments is not iterable')
    }
    bot.dig = async target => {
      bot.digTime(target)
      events.push(['dig', target.name])
    }

    await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['equip', 'netherite_axe', 'hand'],
      ['digTime', []],
      ['dig', 'oak_log']
    ])
  })

  it('roams when no natural tree is nearby', async () => {
    const { runWoodCuttingCycle } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }

    await runWoodCuttingCycle(bot, {
      debugLog: () => {},
      roamTarget: combatPosition(8, 64, 0)
    })

    assert.deepStrictEqual(events, [
      ['goto', 'GoalNearXZ', 8, undefined, 0]
    ])
  })

  it('logs the wood cutting path timeout target context', async () => {
    const { roamForTrees } = require('../bot')
    const entries = []
    const bot = blockBot([])
    bot.pathfinder = {
      goto: () => new Promise(() => {}),
      setGoal: goal => entries.push({ event: 'setGoal', data: goal })
    }

    const roamed = await roamForTrees(bot, {
      debugLog: (event, data) => entries.push({ event, data }),
      pathTimeoutMs: 1,
      roamTarget: combatPosition(8, 64, 0)
    })

    assert.strictEqual(roamed, false)
    assert(entries.some(entry => entry.event === 'setGoal' && entry.data === null))
    assert(entries.some(entry =>
      entry.event === 'automation.woodcutting.pathTimeout' &&
      entry.data.mode === 'roam' &&
      entry.data.target.x === 8 &&
      entry.data.target.z === 0
    ))
  })

  it('stops pathfinding when the wood cutting automation is stopped', () => {
    const { startWoodCuttingAutomation } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    bot._ended = true
    bot.pathfinder = {
      setGoal: goal => events.push(['setGoal', goal])
    }

    const automation = startWoodCuttingAutomation(bot, {
      sleep: async () => {},
      debugLog: () => {},
      output: () => {}
    })

    automation.stop()

    assert.deepStrictEqual(events, [['setGoal', null]])
  })

  it('stops the active wood cutting task before it digs', async () => {
    const { startWoodCuttingAutomation } = require('../bot')
    const events = []
    let releaseGoto
    let notifyGotoStarted
    const gotoStarted = new Promise(resolve => { notifyGotoStarted = resolve })
    const gotoRelease = new Promise(resolve => { releaseGoto = resolve })
    const treeLog = block('oak_log', 0, 64, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 66, 0)
    ], events)
    bot.pathfinder = {
      goto: async goal => {
        events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
        notifyGotoStarted()
        await gotoRelease
      },
      setGoal: goal => events.push(['setGoal', goal])
    }

    const automation = startWoodCuttingAutomation(bot, {
      sleep: async () => {},
      debugLog: () => {},
      output: () => {}
    })

    await gotoStarted
    automation.stop()
    releaseGoto()
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['goto', 'GoalGetToBlock', 0, 64, 0],
      ['setGoal', null]
    ])
  })

  it('enables physics before starting wood cutting movement', async () => {
    const { startWoodCuttingAutomation } = require('../bot')
    const entries = []
    const bot = blockBot([])
    bot._ended = true
    bot.physicsEnabled = false

    startWoodCuttingAutomation(bot, {
      sleep: async () => {},
      debugLog: (event, data) => entries.push({ event, data }),
      output: () => {}
    })

    assert.strictEqual(bot.physicsEnabled, true)
    assert(entries.some(entry => entry.event === 'automation.woodcutting.physicsEnabled'))
  })

  it('teleports home and deposits wood items into a nearby trapped chest', async () => {
    const { depositWoodAtHome } = require('../bot')
    const events = []
    const chestBlock = block('trapped_chest', 1, 64, 0)
    const oakLog = { name: 'oak_log', type: 17, count: 12 }
    const stick = { name: 'stick', type: 280, count: 2 }
    const chest = {
      deposit: async (type, metadata, count) => events.push(['deposit', type, count]),
      close: () => events.push(['close'])
    }
    const bot = blockBot([chestBlock], events)
    bot.inventory.items = () => [oakLog, stick]
    bot.chat = command => events.push(['chat', command])
    bot.openContainer = async () => chest

    await depositWoodAtHome(bot, {
      containerMemoryPath: tempContainerMemoryPath(),
      placesPath: tempPlacesPath(),
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['chat', '/home home'],
      ['deposit', 17, 12],
      ['close']
    ])
  })

  it('records the home coordinate after using the home teleport command', async () => {
    const { depositWoodAtHome, readPlaceCoordinates } = require('../bot')
    const events = []
    const placesPath = tempPlacesPath()
    const bot = blockBot([], events)
    bot.entity.position = combatPosition(7, 64, 9)
    bot.chat = command => events.push(['chat', command])
    bot.inventory.items = () => [{ name: 'oak_log', type: 17, count: 4 }]

    const deposited = await depositWoodAtHome(bot, {
      containerMemoryPath: tempContainerMemoryPath(),
      debugLog: () => {},
      placesPath,
      sleep: async () => {}
    })

    assert.strictEqual(deposited, false)
    assert.deepStrictEqual(events, [
      ['chat', '/home home']
    ])
    assert.deepStrictEqual(readPlaceCoordinates('home', { placesPath }).position, {
      x: 7,
      y: 64,
      z: 9
    })
  })

  it('tries another nearby trapped chest when wood deposit chest is full', async () => {
    const { depositWoodAtHome } = require('../bot')
    const events = []
    const fullChestBlock = block('trapped_chest', 1, 64, 0)
    const openChestBlock = block('trapped_chest', 2, 64, 0)
    const oakLog = { name: 'oak_log', type: 17, count: 12 }
    const bot = blockBot([fullChestBlock, openChestBlock], events)
    bot.inventory.items = () => [oakLog]
    bot.chat = command => events.push(['chat', command])
    bot.openContainer = async target => ({
      deposit: async (type, metadata, count) => {
        events.push(['deposit', target.position.x, type, count])
        if (target.position.x === 1) throw new Error('destination full')
      },
      close: () => events.push(['close', target.position.x])
    })

    await depositWoodAtHome(bot, {
      containerMemoryPath: tempContainerMemoryPath(),
      placesPath: tempPlacesPath(),
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['chat', '/home home'],
      ['deposit', 1, 17, 12],
      ['close', 1],
      ['deposit', 2, 17, 12],
      ['close', 2]
    ])
  })

  it('returns home at night, opens the house door, cooks food, stores loot, and sleeps', async () => {
    const { runNightSafetyCycle } = require('../bot')
    const events = []
    const door = block('oak_door', 1, 64, 0)
    const furnaceBlock = block('furnace', 2, 64, 0)
    const chestBlock = block('trapped_chest', 3, 64, 0)
    const bedBlock = block('red_bed', 4, 64, 0)
    const rawBeef = { name: 'beef', type: 363, count: 2 }
    const coal = { name: 'coal', type: 263, count: 4 }
    const oakLog = { name: 'oak_log', type: 17, count: 12 }
    const sword = { name: 'iron_sword', type: 267, count: 1 }
    const axe = { name: 'iron_axe', type: 258, count: 1 }
    const pickaxe = { name: 'iron_pickaxe', type: 257, count: 1 }
    const bread = { name: 'bread', type: 297, count: 3 }
    const furnace = {
      outputItem: () => null,
      inputItem: () => null,
      fuelItem: () => null,
      putFuel: async (type, metadata, count) => events.push(['putFuel', type, count]),
      putInput: async (type, metadata, count) => events.push(['putInput', type, count]),
      close: () => events.push(['furnaceClose'])
    }
    const chest = {
      deposit: async (type, metadata, count) => events.push(['deposit', type, count]),
      close: () => events.push(['chestClose'])
    }
    const bot = blockBot([door, furnaceBlock, chestBlock, bedBlock], events)
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.inventory.items = () => [rawBeef, coal, oakLog, sword, axe, pickaxe, bread]
    bot.chat = command => events.push(['chat', command])
    bot.activateBlock = async target => events.push(['activateBlock', target.name])
    bot.openFurnace = async () => furnace
    bot.openContainer = async () => chest
    bot.sleep = async target => events.push(['sleepBed', target.name])

    await runNightSafetyCycle(bot, {
      placesPath: tempPlacesPath(),
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['chat', '/home home'],
      ['activateBlock', 'oak_door'],
      ['putFuel', 263, 1],
      ['putInput', 363, 2],
      ['furnaceClose'],
      ['deposit', 17, 12],
      ['chestClose'],
      ['sleepBed', 'red_bed']
    ])
  })

  it('moves through the opened home door without chasing a distant house block', async () => {
    const { openNearbyDoor } = require('../bot')
    const events = []
    const door = block('oak_door', 0, 64, 0)
    const basementChest = block('chest', 0, 60, 1)
    const bot = blockBot([door, basementChest], events)
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.x, goal.y, goal.z])
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])
    bot.lookAt = async point => events.push(['lookAt', point.x, point.y, point.z])
    bot.setControlState = (control, state) => events.push(['control', control, state])

    await openNearbyDoor(bot, {
      originPosition: combatPosition(0, 64, -2),
      sleep: async ms => events.push(['sleep', ms]),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['goto', 0, 64, 0],
      ['activateBlock', 'oak_door'],
      ['sleep', 300],
      ['lookAt', 0.5, 65.6, 1.5],
      ['control', 'forward', true],
      ['sleep', 1200],
      ['control', 'forward', false]
    ])
  })

  it('continues opening a door when pathfinder cannot path to the closed door block', async () => {
    const { openNearbyDoor } = require('../bot')
    const events = []
    const debugEntries = []
    const door = block('oak_door', 0, 64, 0)
    const bot = blockBot([door], events)
    bot.pathfinder = {
      goto: async goal => {
        events.push(['goto', goal.x, goal.y, goal.z])
        throw new Error('No path to the goal!')
      }
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])
    bot.lookAt = async point => events.push(['lookAt', point.x, point.y, point.z])
    bot.setControlState = (control, state) => events.push(['control', control, state])

    const opened = await openNearbyDoor(bot, {
      originPosition: combatPosition(0, 64, -2),
      sleep: async ms => events.push(['sleep', ms]),
      debugLog: (event, data) => debugEntries.push({ event, data })
    })

    assert.strictEqual(opened, true)
    assert.deepStrictEqual(events, [
      ['goto', 0, 64, 0],
      ['activateBlock', 'oak_door'],
      ['sleep', 300],
      ['lookAt', 0.5, 65.6, 1.5],
      ['control', 'forward', true],
      ['sleep', 1200],
      ['control', 'forward', false]
    ])
    assert(!debugEntries.some(entry => entry.event === 'nightSafety.pathError'))
    assert(debugEntries.some(entry => entry.event === 'nightSafety.door.approachFailed'))
  })

  it('moves through an already open home door without activating it again', async () => {
    const { openNearbyDoor } = require('../bot')
    const events = []
    const door = {
      ...block('oak_door', 0, 64, 0),
      _properties: { open: true }
    }
    const bot = blockBot([door], events)
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.x, goal.y, goal.z])
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])
    bot.lookAt = async point => events.push(['lookAt', point.x, point.y, point.z])
    bot.setControlState = (control, state) => events.push(['control', control, state])

    await openNearbyDoor(bot, {
      originPosition: combatPosition(0, 64, -2),
      sleep: async ms => events.push(['sleep', ms]),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['goto', 0, 64, 0],
      ['lookAt', 0.5, 65.6, 1.5],
      ['control', 'forward', true],
      ['sleep', 1200],
      ['control', 'forward', false]
    ])
  })

  it('leaves a second-floor house through a nearby door before daytime work', async () => {
    const { leaveHomeForDaytime } = require('../bot')
    const events = []
    const door = block('oak_door', 0, 64, 0)
    const bot = blockBot([door], events)
    bot.entity.position = combatPosition(0, 68, 2)
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.x, goal.y, goal.z])
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])
    bot.lookAt = async point => events.push(['lookAt', point.x, point.y, point.z])
    bot.setControlState = (control, state) => events.push(['control', control, state])

    const leftHome = await leaveHomeForDaytime(bot, {
      sleep: async ms => events.push(['sleep', ms]),
      debugLog: () => {}
    })

    assert.strictEqual(leftHome, true)
    assert.deepStrictEqual(events, [
      ['goto', 0, 64, 0],
      ['activateBlock', 'oak_door'],
      ['sleep', 300],
      ['lookAt', 0.5, 65.6, -0.5],
      ['control', 'forward', true],
      ['sleep', 1200],
      ['control', 'forward', false]
    ])
  })

  it('reports the night safety cycle as incomplete when it cannot sleep', async () => {
    const { runNightSafetyCycle } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.chat = command => events.push(['chat', command])
    bot.sleep = async () => events.push(['sleep'])

    const completed = await runNightSafetyCycle(bot, {
      placesPath: tempPlacesPath(),
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.strictEqual(completed, false)
    assert.deepStrictEqual(events, [
      ['chat', '/home home']
    ])
  })

  it('falls back to direct bed activation when Mineflayer thinks it is not night', async () => {
    const { sleepInNearbyBed } = require('../bot')
    const events = []
    const bedBlock = block('white_bed', 1, 64, 0)
    const bot = new EventEmitter()
    Object.assign(bot, blockBot([bedBlock], events))
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.isRaining = false
    bot.thunderState = 0
    bot.sleep = async () => {
      throw new Error("it's not night and it's not a thunderstorm")
    }
    bot.activateBlock = async target => {
      events.push(['activateBlock', target.name])
      process.nextTick(() => bot.emit('sleep'))
    }

    const slept = await sleepInNearbyBed(bot, {
      sleep: async () => {},
      debugLog: (event, data) => events.push(['debug', event, data?.timeOfDay])
    })

    assert.strictEqual(slept, true)
    assert.deepStrictEqual(events, [
      ['debug', 'nightSafety.sleep.failed', 14000],
      ['activateBlock', 'white_bed'],
      ['debug', 'nightSafety.sleep.fallbackActivated', 14000]
    ])
  })

  it('does not activate the bed when wrapped time is daytime', async () => {
    const { isDayTime, isNightTime, sleepInNearbyBed } = require('../bot')
    const events = []
    const bedBlock = block('white_bed', 1, 64, 0)
    const bot = new EventEmitter()
    Object.assign(bot, blockBot([bedBlock], events))
    bot.time = { isDay: false, timeOfDay: -20656 }
    bot.isRaining = false
    bot.thunderState = 0
    bot.sleep = async () => {
      throw new Error("it's not night and it's not a thunderstorm")
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])

    const slept = await sleepInNearbyBed(bot, {
      sleep: async () => {},
      debugLog: (event, data) => events.push(['debug', event, data?.normalizedTimeOfDay])
    })

    assert.strictEqual(isDayTime(bot), true)
    assert.strictEqual(isNightTime(bot), false)
    assert.strictEqual(slept, false)
    assert.deepStrictEqual(events, [
      ['debug', 'nightSafety.sleep.failed', 3344],
      ['debug', 'nightSafety.sleep.skippedDaytimeFallback', 3344]
    ])
  })

  it('runs daytime gear instead of night safety when time wraps negative into daytime', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = false
    bot.time = { isDay: false, timeOfDay: -20656 }
    bot.entity = { position: combatPosition(0, 64, 0) }

    const controller = attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      debugLog: () => {},
      runNightSafetyCycle: async () => events.push(['night']),
      runDayGearCycle: async () => events.push(['gear']),
      runDaytimeAutomationSequence: async () => events.push(['daytime'])
    })

    await new Promise(resolve => setImmediate(resolve))
    bot.physicsEnabled = true
    await controller.check()

    assert.deepStrictEqual(events, [
      ['gear']
    ])
  })

  it('runs daytime tasks when wrapped negative time is daytime', async () => {
    const { runDaytimeAutomationSequence } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    bot.time = { isDay: false, timeOfDay: -20656 }

    await runDaytimeAutomationSequence(bot, {
      debugLog: () => {},
      originPosition: combatPosition(0, 64, 0),
      tasks: [
        { name: 'farming', run: async () => events.push(['task', 'farming']) }
      ]
    })

    assert.deepStrictEqual(events, [
      ['task', 'farming']
    ])
  })

  it('does not open storage repeatedly when no bed is available at home', async () => {
    const { runNightSafetyCycle } = require('../bot')
    const events = []
    const chestBlock = block('trapped_chest', 1, 64, 0)
    const bot = blockBot([chestBlock], events)
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.chat = command => events.push(['chat', command])
    bot.openContainer = async () => {
      events.push(['openContainer'])
      return {
        deposit: async () => {},
        close: () => events.push(['close'])
      }
    }
    bot.sleep = async () => events.push(['sleep'])

    const completed = await runNightSafetyCycle(bot, {
      placesPath: tempPlacesPath(),
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.strictEqual(completed, false)
    assert.deepStrictEqual(events, [
      ['chat', '/home home']
    ])
  })

  it('uses the home teleport position when choosing a loot trapped chest', async () => {
    const { depositLoot } = require('../bot')
    const events = []
    const homeChest = block('trapped_chest', 1, 64, 0)
    const otherChest = block('trapped_chest', 50, 64, 0)
    const oakLog = { name: 'oak_log', type: 17, count: 12 }
    const bot = blockBot([homeChest, otherChest], events)
    bot.entity.position = combatPosition(49, 64, 0)
    bot.inventory.items = () => [oakLog]
    bot.openContainer = async target => ({
      deposit: async (type, metadata, count) => events.push(['deposit', target.position.x, type, count]),
      close: () => events.push(['close', target.position.x])
    })

    await depositLoot(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      originPosition: combatPosition(0, 64, 0),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['deposit', 1, 17, 12],
      ['close', 1]
    ])
  })

  it('tries another nearby trapped chest when the first loot chest is full', async () => {
    const { depositLoot } = require('../bot')
    const events = []
    const fullChest = block('trapped_chest', 1, 64, 0)
    const openChest = block('trapped_chest', 2, 64, 0)
    const oakLog = { name: 'oak_log', type: 17, count: 12 }
    const bot = blockBot([fullChest, openChest], events)
    bot.inventory.items = () => [oakLog]
    bot.openContainer = async target => ({
      deposit: async (type, metadata, count) => {
        events.push(['deposit', target.position.x, type, count])
        if (target.position.x === 1) throw new Error('destination full')
      },
      close: () => events.push(['close', target.position.x])
    })

    await depositLoot(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      originPosition: combatPosition(0, 64, 0),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['deposit', 1, 17, 12],
      ['close', 1],
      ['deposit', 2, 17, 12],
      ['close', 2]
    ])
  })

  it('continues night safety sleep when a storage path is stopped', async () => {
    const { runNightSafetyCycle } = require('../bot')
    const events = []
    const door = block('oak_door', 1, 64, 0)
    const chestBlock = block('trapped_chest', 3, 64, 0)
    const bedBlock = block('red_bed', 4, 64, 0)
    const dirt = { name: 'dirt', type: 3, count: 12 }
    const bot = blockBot([door, chestBlock, bedBlock], events)
    bot.inventory.items = () => [dirt]
    bot.chat = command => events.push(['chat', command])
    let gotoCount = 0
    bot.pathfinder = {
      goto: async goal => {
        gotoCount++
        events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
        if (gotoCount === 2) {
          throw new Error('Path was stopped before it could be completed! Thus, the desired goal was not reached.')
        }
      },
      setGoal: goal => events.push(['setGoal', goal])
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])
    bot.setControlState = (control, state) => events.push(['control', control, state])
    bot.openContainer = async target => {
      events.push(['openContainer', target.name])
      return {
        deposit: async (type, metadata, count) => events.push(['deposit', type, count]),
        close: () => events.push(['close'])
      }
    }
    bot.sleep = async target => events.push(['sleep', target.name])

    const completed = await runNightSafetyCycle(bot, {
      containerInteractionDelayMs: 0,
      homeWaitMs: 0,
      placesPath: tempPlacesPath(),
      sleep: async () => {},
      debugLog: (event, data) => events.push(['debug', event, data?.message || data?.block])
    })

    assert.strictEqual(completed, true)
    assert(events.some(event => event[0] === 'debug' && event[1] === 'container.pathError'))
    assert(events.some(event => event[0] === 'sleep' && event[1] === 'red_bed'))
    assert(!events.some(event => event[0] === 'openContainer'))
  })

  it('harvests mature crops near home and replants them', async () => {
    const { runFarmingTask } = require('../bot')
    const events = []
    const wheat = {
      ...block('wheat', 1, 64, 0),
      _properties: { age: 7 }
    }
    const farmland = block('farmland', 1, 63, 0)
    const wheatSeeds = { name: 'wheat_seeds', type: 295, count: 4 }
    const bot = blockBot([wheat, farmland], events)
    bot.inventory.items = () => [wheatSeeds]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.x, goal.y, goal.z])
    }
    bot.placeBlock = async (reference, faceVector) => events.push(['placeBlock', reference.name, faceVector.x, faceVector.y, faceVector.z])

    const harvested = await runFarmingTask(bot, {
      originPosition: combatPosition(0, 64, 0),
      debugLog: () => {}
    })

    assert.strictEqual(harvested, 1)
    assert.deepStrictEqual(events, [
      ['goto', 1, 64, 0],
      ['dig', 'wheat'],
      ['equip', 'wheat_seeds', 'hand'],
      ['placeBlock', 'farmland', 0, 1, 0]
    ])
  })

  it('sanitizes held item enchant data before harvesting crops', async () => {
    const { runFarmingTask } = require('../bot')
    const events = []
    const wheat = {
      ...block('wheat', 1, 64, 0),
      _properties: { age: 7 },
      digTime: (type, creative, inWater, notOnGround, enchantments) => {
        events.push(['digTime', enchantments])
        enchantments.concat([])
        return 100
      }
    }
    const farmland = block('farmland', 1, 63, 0)
    const weirdSword = { name: 'diamond_sword', enchants: { sharpness: 5 } }
    const wheatSeeds = { name: 'wheat_seeds', type: 295, count: 4 }
    const bot = blockBot([wheat, farmland], events)
    bot.heldItem = weirdSword
    bot.inventory.items = () => [wheatSeeds]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.x, goal.y, goal.z])
    }
    bot.digTime = target => target.digTime(null, false, false, false, bot.heldItem.enchants, {})
    bot.dig = async target => {
      bot.digTime(target)
      events.push(['dig', target.name])
    }
    bot.placeBlock = async (reference, faceVector) => events.push(['placeBlock', reference.name, faceVector.x, faceVector.y, faceVector.z])

    const harvested = await runFarmingTask(bot, {
      originPosition: combatPosition(0, 64, 0),
      debugLog: () => {}
    })

    assert.strictEqual(harvested, 1)
    assert.deepStrictEqual(events, [
      ['goto', 1, 64, 0],
      ['digTime', []],
      ['dig', 'wheat'],
      ['equip', 'wheat_seeds', 'hand'],
      ['placeBlock', 'farmland', 0, 1, 0]
    ])
  })

  it('plants seeds into empty farmland plots', async () => {
    const { runFarmingTask } = require('../bot')
    const events = []
    const emptyFarmland = block('farmland', 2, 63, 0)
    const occupiedFarmland = block('farmland', 3, 63, 0)
    const youngWheat = {
      ...block('wheat', 3, 64, 0),
      properties: { age: '2' }
    }
    const wheatSeeds = { name: 'wheat_seeds', type: 295, count: 4 }
    const bot = blockBot([emptyFarmland, occupiedFarmland, youngWheat], events)
    bot.inventory.items = () => [wheatSeeds]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.placeBlock = async (reference, faceVector) => events.push(['placeBlock', reference.name, reference.position.x, faceVector.x, faceVector.y, faceVector.z])

    const planted = await runFarmingTask(bot, {
      debugLog: (event, data) => events.push(['debug', event, data?.plot?.x ?? data?.planted]),
      sleep: async () => {}
    })

    assert.strictEqual(planted, 1)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 2, 63, 0],
      ['equip', 'wheat_seeds', 'hand'],
      ['placeBlock', 'farmland', 2, 0, 1, 0],
      ['debug', 'automation.farming.plant', 2],
      ['debug', 'automation.farming.done', 1]
    ])
  })

  it('waits for combat to clear before farming crops', async () => {
    const { runFarmingTask } = require('../bot')
    const events = []
    const entries = []
    const wheat = {
      ...block('wheat', 1, 64, 0),
      _properties: { age: 7 }
    }
    const farmland = block('farmland', 1, 63, 0)
    const wheatSeeds = { name: 'wheat_seeds', type: 295, count: 4 }
    const bot = blockBot([wheat, farmland], events)
    let now = 0
    bot.__combatActiveUntil = 100
    bot.inventory.items = () => [wheatSeeds]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.x, goal.y, goal.z])
    }
    bot.placeBlock = async (reference, faceVector) => events.push(['placeBlock', reference.name, faceVector.x, faceVector.y, faceVector.z])

    const harvested = await runFarmingTask(bot, {
      originPosition: combatPosition(0, 64, 0),
      now: () => now,
      sleep: async ms => {
        events.push(['sleep', ms])
        now += ms
      },
      debugLog: (event, data) => entries.push({ event, data })
    })

    assert.strictEqual(harvested, 1)
    assert.deepStrictEqual(events, [
      ['sleep', 100],
      ['goto', 1, 64, 0],
      ['dig', 'wheat'],
      ['equip', 'wheat_seeds', 'hand'],
      ['placeBlock', 'farmland', 0, 1, 0]
    ])
    assert(entries.some(entry => entry.event === 'automation.farming.pausedForCombat'))
  })

  it('opens a nearby door and retries when farming starts behind a closed door', async () => {
    const { runFarmingTask } = require('../bot')
    const events = []
    const entries = []
    const wheat = {
      ...block('wheat', 1, 64, 0),
      _properties: { age: 7 }
    }
    const farmland = block('farmland', 1, 63, 0)
    const wheatSeeds = { name: 'wheat_seeds', type: 295, count: 4 }
    const bot = blockBot([wheat, farmland], events)
    let pathAttempts = 0
    bot.inventory.items = () => [wheatSeeds]
    bot.pathfinder = {
      goto: async goal => {
        pathAttempts++
        events.push(['goto', goal.x, goal.y, goal.z])
        if (pathAttempts === 1) throw new Error('No path to the goal!')
      }
    }
    bot.placeBlock = async (reference, faceVector) => events.push(['placeBlock', reference.name, faceVector.x, faceVector.y, faceVector.z])

    const harvested = await runFarmingTask(bot, {
      originPosition: combatPosition(0, 64, 0),
      openNearbyDoor: async () => {
        events.push(['openDoor'])
        return true
      },
      debugLog: (event, data) => entries.push({ event, data })
    })

    assert.strictEqual(harvested, 1)
    assert.deepStrictEqual(events, [
      ['goto', 1, 64, 0],
      ['openDoor'],
      ['goto', 1, 64, 0],
      ['dig', 'wheat'],
      ['equip', 'wheat_seeds', 'hand'],
      ['placeBlock', 'farmland', 0, 1, 0]
    ])
    assert(entries.some(entry => entry.event === 'automation.farming.door.retry'))
  })

  it('verifies growstation flower pots through the opened PyroFarming window', async () => {
    const { readPyroFarmMemory, verifyGrowstationBlock } = require('../bot')
    const events = []
    const memoryPath = tempPyroFarmMemoryPath()
    const pot = block('flower_pot', 1, 64, 0)
    const bot = Object.assign(new EventEmitter(), blockBot([pot], events))
    bot.heldItem = { name: 'water_bucket' }
    bot.unequip = async destination => {
      events.push(['unequip', destination])
      bot.heldItem = null
    }
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.activateBlock = async target => {
      events.push(['activateBlock', target.name])
      bot.emit('windowOpen', {
        title: 'Growstation',
        slots: [{ name: 'flower_pot', displayName: 'Growstation' }]
      })
    }
    bot.closeWindow = window => events.push(['closeWindow', String(window.title)])

    const verified = await verifyGrowstationBlock(bot, pot, {
      pyroFarmMemoryPath: memoryPath,
      growstationVerificationTimeoutMs: 10
    })

    assert.strictEqual(verified, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 1, 64, 0],
      ['unequip', 'hand'],
      ['activateBlock', 'flower_pot'],
      ['closeWindow', 'Growstation']
    ])
    assert(readPyroFarmMemory({ pyroFarmMemoryPath: memoryPath }).growstations['overworld:1,64,0'])
  })

  it('clears stale pathfinder goals before approaching PyroFarming growstations', async () => {
    const { readPyroFarmMemory, verifyGrowstationBlock } = require('../bot')
    const events = []
    const memoryPath = tempPyroFarmMemoryPath()
    const pot = block('flower_pot', 1, 64, 0)
    const bot = Object.assign(new EventEmitter(), blockBot([pot], events))
    let cleared = false
    bot.pathfinder = {
      setGoal: goal => {
        events.push(['setGoal', goal])
        if (goal === null) cleared = true
      },
      goto: async goal => {
        if (!cleared) throw new Error('Path was stopped before it could be completed! Thus, the desired goal was not reached.')
        events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
      }
    }
    bot.activateBlock = async target => {
      events.push(['activateBlock', target.name])
      bot.emit('windowOpen', {
        title: 'Growstation',
        slots: [{ name: 'flower_pot', displayName: 'Growstation' }]
      })
    }

    const verified = await verifyGrowstationBlock(bot, pot, {
      pyroFarmMemoryPath: memoryPath,
      growstationVerificationTimeoutMs: 10
    })

    assert.strictEqual(verified, true)
    assert.deepStrictEqual(events, [
      ['setGoal', null],
      ['goto', 'GoalNear', 1, 64, 0],
      ['activateBlock', 'flower_pot']
    ])
    assert(readPyroFarmMemory({ pyroFarmMemoryPath: memoryPath }).growstations['overworld:1,64,0'])
  })

  it('remembers normal flower pots as ignored when no Growstation window opens', async () => {
    const { readPyroFarmMemory, verifyGrowstationBlock } = require('../bot')
    const events = []
    const memoryPath = tempPyroFarmMemoryPath()
    const pot = block('flower_pot', 2, 64, 0)
    const bot = Object.assign(new EventEmitter(), blockBot([pot], events))
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])

    const verified = await verifyGrowstationBlock(bot, pot, {
      pyroFarmMemoryPath: memoryPath,
      growstationVerificationTimeoutMs: 0
    })

    assert.strictEqual(verified, false)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 2, 64, 0],
      ['activateBlock', 'flower_pot']
    ])
    assert(readPyroFarmMemory({ pyroFarmMemoryPath: memoryPath }).ignoredFlowerPots['overworld:2,64,0'])
  })

  it('waters remembered growstations and treats no PyroFarming message as success', async () => {
    const { runPyroFarmingCycle, writePyroFarmMemory } = require('../bot')
    const events = []
    const entries = []
    const memoryPath = tempPyroFarmMemoryPath()
    const pot = block('flower_pot', 3, 64, 0)
    writePyroFarmMemory({
      version: 1,
      growstations: {
        'overworld:3,64,0': {
          dimension: 'overworld',
          position: { x: 3, y: 64, z: 0 },
          verifiedAt: 1,
          lastSeenAt: 1,
          lastWateredAt: null,
          lastFullAt: null
        }
      },
      ignoredFlowerPots: {}
    }, { pyroFarmMemoryPath: memoryPath })
    const bot = Object.assign(new EventEmitter(), blockBot([pot], events))
    bot.inventory.items = () => [{ name: 'water_bucket', type: 326, count: 1 }]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])

    const ran = await runPyroFarmingCycle(bot, {
      debugLog: (event, data) => entries.push({ event, data }),
      pyroFarmMemoryPath: memoryPath,
      pyroWaterMessageTimeoutMs: 0
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 3, 64, 0],
      ['equip', 'water_bucket', 'hand'],
      ['activateBlock', 'flower_pot']
    ])
    assert(entries.some(entry => entry.event === 'automation.pyroFarming.watered'))
  })

  it('rehydrates remembered growstation positions before reading blocks', async () => {
    const { runPyroFarmingCycle, writePyroFarmMemory } = require('../bot')
    const events = []
    const memoryPath = tempPyroFarmMemoryPath()
    const pot = block('flower_pot', 6, 64, 0)
    writePyroFarmMemory({
      version: 1,
      growstations: {
        'overworld:6,64,0': {
          dimension: 'overworld',
          position: { x: 6, y: 64, z: 0 },
          verifiedAt: 1,
          lastSeenAt: 1,
          lastWateredAt: null,
          lastFullAt: null
        }
      },
      ignoredFlowerPots: {}
    }, { pyroFarmMemoryPath: memoryPath })
    const bot = Object.assign(new EventEmitter(), blockBot([pot], events))
    bot.findBlocks = () => []
    bot.blockAt = position => {
      if (typeof position.floored !== 'function') throw new Error('pos.floored is not a function')
      return position.x === 6 && position.y === 64 && position.z === 0 ? pot : null
    }
    bot.inventory.items = () => [{ name: 'water_bucket', type: 326, count: 1 }]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])

    const ran = await runPyroFarmingCycle(bot, {
      pyroFarmMemoryPath: memoryPath,
      pyroWaterMessageTimeoutMs: 0,
      debugLog: () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 6, 64, 0],
      ['equip', 'water_bucket', 'hand'],
      ['activateBlock', 'flower_pot']
    ])
  })

  it('records full growstations when PyroFarming says the water is already full', async () => {
    const { readPyroFarmMemory, runPyroFarmingCycle, writePyroFarmMemory } = require('../bot')
    const events = []
    const entries = []
    const memoryPath = tempPyroFarmMemoryPath()
    const pot = block('flower_pot', 4, 64, 0)
    writePyroFarmMemory({
      version: 1,
      growstations: {
        'overworld:4,64,0': {
          dimension: 'overworld',
          position: { x: 4, y: 64, z: 0 },
          verifiedAt: 1,
          lastSeenAt: 1,
          lastWateredAt: null,
          lastFullAt: null
        }
      },
      ignoredFlowerPots: {}
    }, { pyroFarmMemoryPath: memoryPath })
    const bot = Object.assign(new EventEmitter(), blockBot([pot], events))
    bot.inventory.items = () => [{ name: 'water_bucket', type: 326, count: 1 }]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.activateBlock = async target => {
      events.push(['activateBlock', target.name])
      bot.emit('message', 'PyroFarming > Your Growstation is already full of water!')
    }

    const ran = await runPyroFarmingCycle(bot, {
      debugLog: (event, data) => entries.push({ event, data }),
      pyroFarmMemoryPath: memoryPath,
      pyroWaterMessageTimeoutMs: 10
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 4, 64, 0],
      ['equip', 'water_bucket', 'hand'],
      ['activateBlock', 'flower_pot']
    ])
    assert(entries.some(entry => entry.event === 'automation.pyroFarming.full'))
    assert(readPyroFarmMemory({ pyroFarmMemoryPath: memoryPath }).growstations['overworld:4,64,0'].lastFullAt)
  })

  it('refills an empty bucket from nearby water before watering growstations', async () => {
    const { runPyroFarmingCycle, writePyroFarmMemory } = require('../bot')
    const events = []
    const memoryPath = tempPyroFarmMemoryPath()
    const pot = block('flower_pot', 5, 64, 0)
    const water = block('water', 0, 63, 1)
    let items = [{ name: 'bucket', type: 325, count: 1 }]
    writePyroFarmMemory({
      version: 1,
      growstations: {
        'overworld:5,64,0': {
          dimension: 'overworld',
          position: { x: 5, y: 64, z: 0 },
          verifiedAt: 1,
          lastSeenAt: 1,
          lastWateredAt: null,
          lastFullAt: null
        }
      },
      ignoredFlowerPots: {}
    }, { pyroFarmMemoryPath: memoryPath })
    const bot = Object.assign(new EventEmitter(), blockBot([pot, water], events))
    bot.inventory.items = () => items
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.activateBlock = async target => {
      events.push(['activateBlock', target.name])
      if (target.name === 'water') items = [{ name: 'water_bucket', type: 326, count: 1 }]
    }

    const ran = await runPyroFarmingCycle(bot, {
      pyroFarmMemoryPath: memoryPath,
      pyroWaterMessageTimeoutMs: 0,
      debugLog: () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 0, 63, 1],
      ['equip', 'bucket', 'hand'],
      ['activateBlock', 'water'],
      ['goto', 'GoalNear', 5, 64, 0],
      ['equip', 'water_bucket', 'hand'],
      ['activateBlock', 'flower_pot']
    ])
  })

  it('takes water from source blocks and waits for the bucket to refill', async () => {
    const { runPyroFarmingCycle, writePyroFarmMemory } = require('../bot')
    const events = []
    const memoryPath = tempPyroFarmMemoryPath()
    const pot = block('flower_pot', 7, 64, 0)
    const flowingWater = block('water', 0, 63, 1)
    flowingWater.properties = { level: 4 }
    const sourceWater = block('water', 2, 63, 1)
    sourceWater.properties = { level: 0 }
    let items = [{ name: 'bucket', type: 325, count: 1 }]
    writePyroFarmMemory({
      version: 1,
      growstations: {
        'overworld:7,64,0': {
          dimension: 'overworld',
          position: { x: 7, y: 64, z: 0 },
          verifiedAt: 1,
          lastSeenAt: 1,
          lastWateredAt: null,
          lastFullAt: null
        }
      },
      ignoredFlowerPots: {}
    }, { pyroFarmMemoryPath: memoryPath })
    const bot = Object.assign(new EventEmitter(), blockBot([pot, flowingWater, sourceWater], events))
    bot.inventory.items = () => items
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.lookAt = async point => events.push(['lookAt', point.x, point.y, point.z])
    bot.activateItem = async () => {
      events.push(['activateItem'])
      setTimeout(() => {
        items = [{ name: 'water_bucket', type: 326, count: 1 }]
      }, 5)
    }
    bot.activateBlock = async target => events.push(['activateBlock', target.name])

    const ran = await runPyroFarmingCycle(bot, {
      pyroFarmMemoryPath: memoryPath,
      pyroRefillTimeoutMs: 50,
      pyroWaterMessageTimeoutMs: 0,
      debugLog: () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 2, 63, 1],
      ['equip', 'bucket', 'hand'],
      ['lookAt', 2.5, 63.5, 1.5],
      ['activateItem'],
      ['goto', 'GoalNear', 7, 64, 0],
      ['equip', 'water_bucket', 'hand'],
      ['activateBlock', 'flower_pot']
    ])
  })

  it('keeps cutting wood until four stacks are collected', async () => {
    const { runWoodCuttingQuotaTask } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    let woodCount = 0

    const completed = await runWoodCuttingQuotaTask(bot, {
      targetWoodCount: 256,
      debugLog: () => {},
      sleep: async () => {},
      countWoodItems: () => woodCount,
      runWoodCuttingCycle: async () => {
        events.push(['woodCycle', woodCount])
        woodCount += 64
        return true
      },
      depositWoodAtHome: async () => events.push(['depositWood'])
    })

    assert.strictEqual(completed, true)
    assert.deepStrictEqual(events, [
      ['woodCycle', 0],
      ['woodCycle', 64],
      ['woodCycle', 128],
      ['woodCycle', 192],
      ['depositWood']
    ])
  })

  it('uses 64 wood as the default wood cutting quota', async () => {
    const { runWoodCuttingQuotaTask } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    let woodCount = 0
    let targetWoodCount = null

    const completed = await runWoodCuttingQuotaTask(bot, {
      debugLog: (event, data) => {
        if (event === 'automation.woodcutting.quota.done') targetWoodCount = data.targetWoodCount
      },
      sleep: async () => {},
      countWoodItems: () => woodCount,
      runWoodCuttingCycle: async () => {
        events.push(['woodCycle', woodCount])
        woodCount += 64
        return true
      },
      depositWoodAtHome: async () => events.push(['depositWood'])
    })

    assert.strictEqual(completed, true)
    assert.strictEqual(targetWoodCount, 64)
    assert.deepStrictEqual(events, [
      ['woodCycle', 0],
      ['depositWood']
    ])
  })

  it('does not cut another tree when already holding the wood cutting quota', async () => {
    const { runWoodCuttingQuotaTask } = require('../bot')
    const events = []
    const bot = blockBot([], events)

    const completed = await runWoodCuttingQuotaTask(bot, {
      debugLog: () => {},
      sleep: async () => {},
      countWoodItems: () => 64,
      runWoodCuttingCycle: async () => events.push(['woodCycle']),
      depositWoodAtHome: async () => events.push(['depositWood'])
    })

    assert.strictEqual(completed, true)
    assert.deepStrictEqual(events, [
      ['depositWood']
    ])
  })

  it('backs off after repeated empty wood cutting cycles', async () => {
    const { runWoodCuttingQuotaTask } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    let calls = 0
    let woodCount = 0

    await runWoodCuttingQuotaTask(bot, {
      targetWoodCount: 1,
      loopDelayMs: 100,
      debugLog: () => {},
      randomInt: (min, max) => max,
      sleep: async ms => events.push(['sleep', ms]),
      countWoodItems: () => woodCount,
      runWoodCuttingCycle: async () => {
        calls++
        events.push(['woodCycle', calls])
        if (calls === 3) woodCount = 1
        return calls === 3
      },
      depositWoodAtHome: async () => events.push(['depositWood'])
    })

    assert.deepStrictEqual(events, [
      ['woodCycle', 1],
      ['sleep', 260],
      ['woodCycle', 2],
      ['sleep', 390],
      ['woodCycle', 3],
      ['depositWood']
    ])
  })

  it('moves away from home before mining inside the protected radius', async () => {
    const { runMiningCycle } = require('../bot')
    const events = []
    const bot = blockBot([block('coal_ore', 20, 64, 0)], events)
    bot.entity.position = combatPosition(10, 64, 0)
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }

    const ran = await runMiningCycle(bot, {
      homePosition: combatPosition(0, 64, 0),
      minimumHomeDistance: 50,
      roamTarget: combatPosition(80, 64, 0),
      debugLog: (event, data) => events.push(['debug', event, data?.distanceFromHome]),
      sleep: async () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['debug', 'automation.mining.nearHome', 10],
      ['goto', 'GoalNearXZ', 80, undefined, 0],
      ['debug', 'automation.mining.roam', 80]
    ])
  })

  it('mines configured ores only outside the protected home radius', async () => {
    const { runMiningCycle } = require('../bot')
    const events = []
    const nearCoal = block('coal_ore', 25, 64, 0)
    const farDiamond = block('diamond_ore', 70, 64, 0)
    const farStone = block('stone', 60, 64, 0)
    const bot = blockBot([nearCoal, farDiamond, farStone], events)
    bot.entity.position = combatPosition(65, 64, 0)
    bot.inventory.items = () => [{ name: 'iron_pickaxe', type: 257, count: 1 }]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.lookAt = async position => events.push(['lookAt', Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)])

    const ran = await runMiningCycle(bot, {
      homePosition: combatPosition(0, 64, 0),
      minimumHomeDistance: 50,
      debugLog: (event, data) => events.push(['debug', event, data?.block]),
      sleep: async () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 70, 64, 0],
      ['equip', 'iron_pickaxe', 'hand'],
      ['lookAt', 70, 64, 0],
      ['dig', 'diamond_ore'],
      ['debug', 'automation.mining.mine', 'diamond_ore']
    ])
  })

  it('teleports home and deposits mined items when mining inventory is full', async () => {
    const { runMiningCycle } = require('../bot')
    const events = []
    const chestBlock = block('trapped_chest', 1, 64, 0)
    const coal = { name: 'coal', type: 263, count: 12 }
    const rawIron = { name: 'raw_iron', type: 1001, count: 5 }
    const cobblestone = { name: 'cobblestone', type: 4, count: 64 }
    const pickaxe = { name: 'iron_pickaxe', type: 257, count: 1 }
    const bread = { name: 'bread', type: 297, count: 4 }
    const bot = blockBot([chestBlock], events)
    bot.entity.position = combatPosition(0, 64, 0)
    bot.inventory.emptySlotCount = () => 0
    bot.inventory.items = () => [coal, rawIron, cobblestone, pickaxe, bread]
    bot.chat = command => events.push(['chat', command])
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.lookAt = async position => events.push(['lookAt', Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)])
    bot.openContainer = async () => ({
      containerItems: () => [],
      deposit: async (type, metadata, count) => events.push(['deposit', type, count]),
      close: () => events.push(['close'])
    })

    const ran = await runMiningCycle(bot, {
      homePosition: combatPosition(0, 64, 0),
      homeWaitMs: 0,
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      placesPath: tempPlacesPath(),
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['chat', '/home home'],
      ['lookAt', 1, 64, 0],
      ['deposit', 263, 12],
      ['deposit', 1001, 5],
      ['deposit', 4, 64],
      ['close']
    ])
  })

  it('digs a two-high tunnel when no ore is visible while mining', async () => {
    const { runMiningCycle } = require('../bot')
    const events = []
    const tunnelFloor = block('stone', 81, 64, 0)
    const tunnelHead = block('stone', 81, 65, 0)
    const bot = blockBot([tunnelFloor, tunnelHead], events)
    bot.entity.position = combatPosition(80, 64, 0)
    bot.inventory.items = () => [{ name: 'iron_pickaxe', type: 257, count: 1 }]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.lookAt = async position => events.push(['lookAt', Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)])

    const ran = await runMiningCycle(bot, {
      homePosition: combatPosition(0, 64, 0),
      targetMiningY: 64,
      postDigDelayMs: 0,
      debugLog: (event, data) => events.push(['debug', event, data?.target?.x || data?.block]),
      sleep: async () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['equip', 'iron_pickaxe', 'hand'],
      ['lookAt', 81, 64, 0],
      ['dig', 'stone'],
      ['equip', 'iron_pickaxe', 'hand'],
      ['lookAt', 81, 65, 0],
      ['dig', 'stone'],
      ['goto', 'GoalNear', 81, 64, 0],
      ['debug', 'automation.mining.tunnel', 81]
    ])
  })

  it('opens side probes while strip mining for hidden ore', async () => {
    const { runMiningCycle } = require('../bot')
    const events = []
    const branchFloor = block('stone', 81, 64, 1)
    const branchHead = block('stone', 81, 65, 1)
    const bot = blockBot([branchFloor, branchHead], events)
    bot.entity.position = combatPosition(80, 64, 0)
    bot.inventory.items = () => [{ name: 'iron_pickaxe', type: 257, count: 1 }]
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.lookAt = async position => events.push(['lookAt', Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)])

    const ran = await runMiningCycle(bot, {
      homePosition: combatPosition(0, 64, 0),
      targetMiningY: 64,
      stripMineBranchInterval: 1,
      stripMineBranchDepth: 1,
      postDigDelayMs: 0,
      debugLog: (event, data) => events.push(['debug', event, data?.side]),
      sleep: async () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 81, 64, 0],
      ['equip', 'iron_pickaxe', 'hand'],
      ['lookAt', 81, 64, 1],
      ['dig', 'stone'],
      ['equip', 'iron_pickaxe', 'hand'],
      ['lookAt', 81, 65, 1],
      ['dig', 'stone'],
      ['debug', 'automation.mining.stripMineBranch', 'right'],
      ['debug', 'automation.mining.tunnel', undefined]
    ])
  })

  it('keeps mining automation running until stopped', async () => {
    const { startMiningAutomation } = require('../bot')
    const output = []
    const bot = blockBot([])
    let runCount = 0
    let sleepCount = 0

    startMiningAutomation(bot, {
      output: message => output.push(message),
      debugLog: () => {},
      sleep: async () => {
        sleepCount++
        if (sleepCount >= 2) bot._ended = true
      },
      runMiningTask: async () => {
        runCount++
        return true
      }
    })
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(runCount, 2)
    assert(output.some(message => message.includes('Started mining automation.')))
    assert.strictEqual(output.filter(message => message.includes('Mining automation task completed.')).length, 0)
  })

  it('replants a matching sapling after cutting a tree', async () => {
    const { replantSaplingNearTree } = require('../bot')
    const events = []
    const dirt = block('dirt', 0, 63, 0)
    const oakSapling = { name: 'oak_sapling', type: 6, count: 1 }
    const bot = blockBot([dirt], events)
    bot.inventory.items = () => [oakSapling]
    bot.placeBlock = async (reference, faceVector) => events.push(['placeBlock', reference.name, faceVector.x, faceVector.y, faceVector.z])

    const planted = await replantSaplingNearTree(bot, block('oak_log', 0, 64, 0), {
      debugLog: () => {}
    })

    assert.strictEqual(planted, true)
    assert.deepStrictEqual(events, [
      ['equip', 'oak_sapling', 'hand'],
      ['placeBlock', 'dirt', 0, 1, 0]
    ])
  })

  it('only attacks passive mobs at least 100 blocks from home', async () => {
    const { runWildRoamingTask } = require('../bot')
    const events = []
    const nearCow = {
      type: 'mob',
      name: 'cow',
      position: combatPosition(50, 64, 0)
    }
    const farChicken = {
      type: 'mob',
      name: 'chicken',
      position: combatPosition(120, 64, 0)
    }
    const bot = combatBot([{ name: 'iron_sword' }], events)
    bot.entity.position = combatPosition(0, 64, 0)
    bot.entities = { 1: nearCow, 2: farChicken }
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.x, goal.y, goal.z]),
      setGoal: goal => events.push(['setGoal', goal])
    }

    const attacked = await runWildRoamingTask(bot, {
      originPosition: combatPosition(0, 64, 0),
      minimumHuntDistance: 100,
      placesPath: false,
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.strictEqual(attacked, true)
    assert.deepStrictEqual(events, [
      ['goto', 120, 64, 0],
      ['lookAt', true, { x: 120, y: 64.7, z: 0 }],
      ['equip', 'iron_sword', 'hand'],
      ['attack', 'chicken']
    ])
  })

  it('uses saved home coordinates to protect passive mobs near the house', async () => {
    const { rememberPlaceCoordinates, runWildRoamingTask } = require('../bot')
    const events = []
    const placesPath = tempPlacesPath()
    const cowNearHome = {
      type: 'mob',
      name: 'cow',
      position: combatPosition(20, 64, 0)
    }
    const bot = combatBot([{ name: 'iron_sword' }], events)
    bot.entity.position = combatPosition(200, 64, 0)
    bot.entities = { 1: cowNearHome }
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z]),
      setGoal: goal => events.push(['setGoal', goal])
    }

    rememberPlaceCoordinates(bot, 'home', combatPosition(0, 64, 0), {
      placesPath
    })
    const ran = await runWildRoamingTask(bot, {
      debugLog: (event, data) => events.push(['debug', event, data?.target || data?.name]),
      originPosition: combatPosition(200, 64, 0),
      placesPath,
      random: () => 0,
      sleep: async () => {}
    })

    assert.strictEqual(ran, true)
    assert.deepStrictEqual(events, [
      ['debug', 'automation.wildRoaming.protectedMob', 'cow'],
      ['goto', 'GoalNearXZ', 220, undefined, 0],
      ['debug', 'automation.wildRoaming.roam', undefined]
    ])
  })

  it('roams farther away from the saved home each time', async () => {
    const { rememberPlaceCoordinates, runWildRoamingTask } = require('../bot')
    const events = []
    const placesPath = tempPlacesPath()
    const bot = combatBot([], events)
    bot.entity.position = combatPosition(0, 64, 0)
    bot.entities = {}
    bot.pathfinder = {
      goto: async goal => {
        events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
        bot.entity.position = combatPosition(goal.x, 64, goal.z)
      }
    }

    rememberPlaceCoordinates(bot, 'home', combatPosition(0, 64, 0), {
      placesPath
    })
    await runWildRoamingTask(bot, {
      debugLog: (event, data) => events.push(['debug', event, data?.distanceFromHome]),
      minimumHuntDistance: 100,
      placesPath,
      random: () => 0,
      roamRadius: 20,
      sleep: async () => {}
    })
    await runWildRoamingTask(bot, {
      debugLog: (event, data) => events.push(['debug', event, data?.distanceFromHome]),
      minimumHuntDistance: 100,
      placesPath,
      random: () => 0,
      roamRadius: 20,
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['goto', 'GoalNearXZ', 120, undefined, 0],
      ['debug', 'automation.wildRoaming.roam', 120],
      ['goto', 'GoalNearXZ', 140, undefined, 0],
      ['debug', 'automation.wildRoaming.roam', 140]
    ])
  })

  it('does not attack passive mobs through walls while wild roaming', async () => {
    const { runWildRoamingTask } = require('../bot')
    const events = []
    const cow = {
      type: 'mob',
      name: 'cow',
      position: combatPosition(120, 64, 0),
      height: 1.4
    }
    const bot = combatBot([{ name: 'iron_sword' }], events)
    bot.entity.position = combatPosition(0, 64, 0)
    bot.entities = { 1: cow }
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z]),
      setGoal: goal => events.push(['setGoal', goal])
    }
    bot.lookAt = async (point, force) => events.push(['lookAt', point.x, point.y, point.z, force])
    bot.world = {
      raycast: () => block('stone', 60, 64, 0)
    }

    const attacked = await runWildRoamingTask(bot, {
      debugLog: (event, data) => events.push(['debug', event, data?.blocker || data?.target]),
      minimumHuntDistance: 100,
      originPosition: combatPosition(0, 64, 0),
      sleep: async () => {}
    })

    assert.strictEqual(attacked, false)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 120, 64, 0],
      ['lookAt', 120, 64.7, 0, true],
      ['debug', 'automation.wildRoaming.blockedLineOfSight', 'stone']
    ])
  })

  it('stops attacking passive mobs after an ownership warning', async () => {
    const { runWildRoamingTask } = require('../bot')
    const events = []
    const sheep = {
      type: 'mob',
      name: 'sheep',
      position: combatPosition(120, 64, 0)
    }
    const bot = Object.assign(new EventEmitter(), combatBot([{ name: 'iron_sword' }], events))
    bot.entity.position = combatPosition(0, 64, 0)
    bot.entities = { 1: sheep }
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z]),
      setGoal: goal => events.push(['setGoal', goal])
    }

    const firstRun = await runWildRoamingTask(bot, {
      originPosition: combatPosition(0, 64, 0),
      minimumHuntDistance: 100,
      debugLog: (event, data) => events.push(['debug', event, data?.message || data?.target]),
      sleep: async () => {},
      roamTarget: combatPosition(200, 64, 0)
    })
    bot.emit('message', 'That belongs to _EraserX_.')
    const secondRun = await runWildRoamingTask(bot, {
      originPosition: combatPosition(0, 64, 0),
      minimumHuntDistance: 100,
      debugLog: (event, data) => events.push(['debug', event, data?.message || data?.target]),
      sleep: async () => {},
      roamTarget: combatPosition(200, 64, 0)
    })

    assert.strictEqual(firstRun, true)
    assert.strictEqual(secondRun, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 120, 64, 0],
      ['lookAt', true, { x: 120, y: 64.7, z: 0 }],
      ['equip', 'iron_sword', 'hand'],
      ['attack', 'sheep'],
      ['debug', 'automation.wildRoaming.attack', 'sheep'],
      ['setGoal', null],
      ['debug', 'automation.wildRoaming.ownedMob', 'That belongs to _EraserX_.'],
      ['goto', 'GoalNearXZ', 200, undefined, 0],
      ['debug', 'automation.wildRoaming.roam', undefined]
    ])
  })

  it('runs daytime tasks in farming, wood cutting, wild roaming order', async () => {
    const { runDaytimeAutomationSequence } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    bot.time = { isDay: true, timeOfDay: 1000 }

    await runDaytimeAutomationSequence(bot, {
      debugLog: () => {},
      originPosition: combatPosition(0, 64, 0),
      tasks: [
        { name: 'farming', run: async () => events.push(['task', 'farming']) },
        { name: 'woodCutting', run: async () => events.push(['task', 'woodCutting']) },
        { name: 'wildRoaming', run: async () => events.push(['task', 'wildRoaming']) }
      ]
    })

    assert.deepStrictEqual(events, [
      ['task', 'farming'],
      ['task', 'woodCutting'],
      ['task', 'wildRoaming']
    ])
  })

  it('randomizes the default daytime task order', () => {
    const { createDaytimeTaskOrder } = require('../bot')

    const wildFirst = createDaytimeTaskOrder({
      random: sequenceRandom([0, 0.9])
    })
    const normalOrder = createDaytimeTaskOrder({
      random: sequenceRandom([0.9, 0.9])
    })

    assert.deepStrictEqual(wildFirst.map(task => task.name), [
      'Wild Roaming',
      'Wood Cutting',
      'Farming'
    ])
    assert.deepStrictEqual(normalOrder.map(task => task.name), [
      'Farming',
      'Wood Cutting',
      'Wild Roaming'
    ])
  })

  it('only repeats wild roaming until night when it is the final randomized task', () => {
    const { createDaytimeTaskOrder } = require('../bot')

    const wildFirst = createDaytimeTaskOrder({
      random: sequenceRandom([0, 0.9])
    })
    const wildLast = createDaytimeTaskOrder({
      random: sequenceRandom([0.9, 0.9])
    })

    assert.strictEqual(wildFirst.find(task => task.name === 'Wild Roaming').repeatUntilNight, false)
    assert.strictEqual(wildLast.find(task => task.name === 'Wild Roaming').repeatUntilNight, true)
  })

  it('uses a 64 wood target for the default daytime wood cutting task', async () => {
    const { createDefaultDaytimeTasks } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    const woodTask = createDefaultDaytimeTasks().find(task => task.name === 'Wood Cutting')
    let woodCount = 0
    let cycles = 0
    let targetWoodCount = null

    const completed = await woodTask.run(bot, {
      debugLog: (event, data) => {
        if (event === 'automation.woodcutting.quota.done') targetWoodCount = data.targetWoodCount
      },
      sleep: async () => {},
      countWoodItems: () => woodCount,
      runWoodCuttingCycle: async () => {
        cycles++
        woodCount += 64
        return true
      },
      depositWoodAtHome: async () => events.push(['depositWood']),
      shouldStop: () => cycles >= 1
    })

    assert.strictEqual(completed, true)
    assert.strictEqual(cycles, 1)
    assert.strictEqual(targetWoodCount, 64)
  })

  it('keeps wild roaming until night starts', async () => {
    const { runDaytimeAutomationSequence } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    bot.time = { isDay: true, timeOfDay: 1000 }
    let wildRuns = 0

    await runDaytimeAutomationSequence(bot, {
      debugLog: () => {},
      originPosition: combatPosition(0, 64, 0),
      tasks: [
        {
          name: 'Wild Roaming',
          repeatUntilNight: true,
          run: async () => {
            wildRuns++
            events.push(['wildRun', wildRuns])
            if (wildRuns === 2) bot.time = { isDay: false, timeOfDay: 14000 }
            return true
          }
        }
      ]
    })

    assert.deepStrictEqual(events, [
      ['wildRun', 1],
      ['wildRun', 2]
    ])
  })

  it('gears up from a nearby trapped chest during the day when required items are missing', async () => {
    const { runDayGearCycle } = require('../bot')
    const events = []
    const chestBlock = block('trapped_chest', 3, 64, 0)
    const sword = { name: 'iron_sword', type: 267, count: 1 }
    const axe = { name: 'iron_axe', type: 258, count: 1 }
    const pickaxe = { name: 'iron_pickaxe', type: 257, count: 1 }
    const bow = { name: 'bow', type: 261, count: 1 }
    const arrow = { name: 'arrow', type: 262, count: 64 }
    const dirt = { name: 'dirt', type: 3, count: 64 }
    const bread = { name: 'bread', type: 297, count: 64 }
    const chest = {
      containerItems: () => [sword, axe, pickaxe, bow, arrow, dirt, bread],
      withdraw: async (type, metadata, count) => events.push(['withdraw', type, count]),
      close: () => events.push(['close'])
    }
    const bot = blockBot([chestBlock], events)
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.registry = {
      foodsByName: {
        bread: { foodPoints: 5, saturation: 6 }
      }
    }
    bot.inventory.items = () => []
    bot.openContainer = async () => chest

    await runDayGearCycle(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['withdraw', 267, 1],
      ['withdraw', 258, 1],
      ['withdraw', 257, 1],
      ['withdraw', 261, 1],
      ['withdraw', 262, 32],
      ['withdraw', 3, 64],
      ['withdraw', 297, 32],
      ['close']
    ])
  })

  it('tries multiple nearby trapped chests while taking daytime gear', async () => {
    const { runDayGearCycle } = require('../bot')
    const events = []
    const firstChestBlock = block('trapped_chest', 1, 64, 0)
    const secondChestBlock = block('trapped_chest', 2, 64, 0)
    const sword = { name: 'iron_sword', type: 267, count: 1 }
    const axe = { name: 'iron_axe', type: 258, count: 1 }
    const pickaxe = { name: 'iron_pickaxe', type: 257, count: 1 }
    const bow = { name: 'bow', type: 261, count: 1 }
    const arrow = { name: 'arrow', type: 262, count: 64 }
    const dirt = { name: 'dirt', type: 3, count: 64 }
    const bread = { name: 'bread', type: 297, count: 64 }
    const bot = blockBot([firstChestBlock, secondChestBlock], events)
    bot.registry = {
      foodsByName: {
        bread: { foodPoints: 5, saturation: 6 }
      }
    }
    bot.inventory.items = () => []
    bot.openContainer = async target => ({
      containerItems: () => target.position.x === 1 ? [sword] : [axe, pickaxe, bow, arrow, dirt, bread],
      withdraw: async (type, metadata, count) => events.push(['withdraw', target.position.x, type, count]),
      close: () => events.push(['close', target.position.x])
    })

    await runDayGearCycle(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['withdraw', 1, 267, 1],
      ['close', 1],
      ['withdraw', 2, 258, 1],
      ['withdraw', 2, 257, 1],
      ['withdraw', 2, 261, 1],
      ['withdraw', 2, 262, 32],
      ['withdraw', 2, 3, 64],
      ['withdraw', 2, 297, 32],
      ['close', 2]
    ])
  })

  it('opens the cached trapped chest first when daytime gear memory knows where an item is', async () => {
    const { runDayGearCycle } = require('../bot')
    const events = []
    const memoryPath = tempContainerMemoryPath()
    fs.writeFileSync(memoryPath, JSON.stringify({
      version: 1,
      containers: {
        'overworld:1,64,0': {
          name: 'trapped_chest',
          position: { x: 1, y: 64, z: 0 },
          searchedAt: 1,
          items: [{ name: 'dirt', type: 3, count: 64 }]
        },
        'overworld:2,64,0': {
          name: 'trapped_chest',
          position: { x: 2, y: 64, z: 0 },
          searchedAt: 1,
          items: [{ name: 'iron_axe', type: 258, count: 1 }]
        }
      }
    }))
    const firstChestBlock = block('trapped_chest', 1, 64, 0)
    const secondChestBlock = block('trapped_chest', 2, 64, 0)
    const bot = blockBot([firstChestBlock, secondChestBlock], events)
    bot.registry = { foodsByName: { bread: { foodPoints: 5, saturation: 6 } } }
    bot.inventory.items = () => [
      { name: 'iron_sword', type: 267, count: 1 },
      { name: 'iron_pickaxe', type: 257, count: 1 },
      { name: 'bow', type: 261, count: 1 },
      { name: 'arrow', type: 262, count: 32 },
      { name: 'dirt', type: 3, count: 64 },
      { name: 'bread', type: 297, count: 32 }
    ]
    bot.openContainer = async target => ({
      containerItems: () => target.position.x === 2 ? [{ name: 'iron_axe', type: 258, count: 1 }] : [],
      withdraw: async (type, metadata, count) => events.push(['withdraw', target.position.x, type, count]),
      close: () => events.push(['close', target.position.x])
    })

    const gearedUp = await runDayGearCycle(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: memoryPath,
      debugLog: () => {},
      originPosition: combatPosition(0, 64, 0),
      searchRadius: 20
    })

    assert.strictEqual(gearedUp, true)
    assert.deepStrictEqual(events, [
      ['withdraw', 2, 258, 1],
      ['close', 2]
    ])
  })

  it('does not reopen searched house trapped chests when memory knows the missing gear is not there', async () => {
    const { runDayGearCycle } = require('../bot')
    const events = []
    const memoryPath = tempContainerMemoryPath()
    fs.writeFileSync(memoryPath, JSON.stringify({
      version: 1,
      containers: {
        'overworld:1,64,0': {
          name: 'trapped_chest',
          position: { x: 1, y: 64, z: 0 },
          searchedAt: 1,
          items: [{ name: 'dirt', type: 3, count: 64 }]
        },
        'overworld:2,64,0': {
          name: 'trapped_chest',
          position: { x: 2, y: 64, z: 0 },
          searchedAt: 1,
          items: [{ name: 'bread', type: 297, count: 64 }]
        }
      }
    }))
    const bot = blockBot([block('trapped_chest', 1, 64, 0), block('trapped_chest', 2, 64, 0)], events)
    bot.registry = { foodsByName: { bread: { foodPoints: 5, saturation: 6 } } }
    bot.inventory.items = () => [
      { name: 'iron_sword', type: 267, count: 1 },
      { name: 'iron_pickaxe', type: 257, count: 1 },
      { name: 'bow', type: 261, count: 1 },
      { name: 'arrow', type: 262, count: 32 },
      { name: 'dirt', type: 3, count: 64 },
      { name: 'bread', type: 297, count: 32 }
    ]
    bot.openContainer = async () => {
      events.push(['openContainer'])
      return {
        containerItems: () => [],
        close: () => events.push(['close'])
      }
    }

    const gearedUp = await runDayGearCycle(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: memoryPath,
      debugLog: () => {},
      originPosition: combatPosition(0, 64, 0),
      searchRadius: 20
    })

    assert.strictEqual(gearedUp, true)
    assert.deepStrictEqual(events, [])
  })

  it('finishes daytime gear search after every house trapped chest was searched without finding the item', async () => {
    const { runDayGearCycle } = require('../bot')
    const events = []
    const memoryPath = tempContainerMemoryPath()
    const bot = blockBot([block('trapped_chest', 1, 64, 0), block('trapped_chest', 2, 64, 0)], events)
    bot.registry = { foodsByName: { bread: { foodPoints: 5, saturation: 6 } } }
    bot.inventory.items = () => [
      { name: 'iron_sword', type: 267, count: 1 },
      { name: 'iron_pickaxe', type: 257, count: 1 },
      { name: 'bow', type: 261, count: 1 },
      { name: 'arrow', type: 262, count: 32 },
      { name: 'dirt', type: 3, count: 64 },
      { name: 'bread', type: 297, count: 32 }
    ]
    bot.openContainer = async target => {
      events.push(['openContainer', target.position.x])
      return {
        containerItems: () => [],
        close: () => events.push(['close', target.position.x])
      }
    }

    const gearedUp = await runDayGearCycle(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: memoryPath,
      debugLog: () => {},
      originPosition: combatPosition(0, 64, 0),
      searchRadius: 20
    })

    assert.strictEqual(gearedUp, true)
    assert.deepStrictEqual(events, [
      ['openContainer', 1],
      ['close', 1],
      ['openContainer', 2],
      ['close', 2]
    ])
  })

  it('only searches house trapped chests inside the configured home cube', async () => {
    const { runDayGearCycle } = require('../bot')
    const events = []
    const bot = blockBot([block('trapped_chest', 5, 64, 0), block('trapped_chest', 12, 64, 0)], events)
    bot.registry = { foodsByName: { bread: { foodPoints: 5, saturation: 6 } } }
    bot.inventory.items = () => [
      { name: 'iron_sword', type: 267, count: 1 },
      { name: 'iron_pickaxe', type: 257, count: 1 },
      { name: 'bow', type: 261, count: 1 },
      { name: 'arrow', type: 262, count: 32 },
      { name: 'dirt', type: 3, count: 64 },
      { name: 'bread', type: 297, count: 32 }
    ]
    bot.openContainer = async target => {
      events.push(['openContainer', target.position.x])
      return {
        containerItems: () => target.position.x === 12 ? [{ name: 'iron_axe', type: 258, count: 1 }] : [],
        withdraw: async (type, metadata, count) => events.push(['withdraw', target.position.x, type, count]),
        close: () => events.push(['close', target.position.x])
      }
    }

    const gearedUp = await runDayGearCycle(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      debugLog: () => {},
      houseOnly: true,
      houseSize: 20,
      originPosition: combatPosition(0, 64, 0),
      searchRadius: 20
    })

    assert.strictEqual(gearedUp, true)
    assert.deepStrictEqual(events, [
      ['openContainer', 5],
      ['close', 5]
    ])
  })

  it('tops up daytime gear without exceeding configured maximums', async () => {
    const { runDayGearCycle } = require('../bot')
    const events = []
    const chestBlock = block('trapped_chest', 3, 64, 0)
    const arrow = { name: 'arrow', type: 262, count: 64 }
    const dirt = { name: 'dirt', type: 3, count: 64 }
    const bread = { name: 'bread', type: 297, count: 64 }
    const chest = {
      containerItems: () => [arrow, dirt, bread],
      withdraw: async (type, metadata, count) => events.push(['withdraw', type, count]),
      close: () => events.push(['close'])
    }
    const bot = blockBot([chestBlock], events)
    bot.registry = {
      foodsByName: {
        bread: { foodPoints: 5, saturation: 6 }
      }
    }
    bot.inventory.items = () => [
      { name: 'iron_sword', type: 267, count: 1 },
      { name: 'iron_axe', type: 258, count: 1 },
      { name: 'iron_pickaxe', type: 257, count: 1 },
      { name: 'bow', type: 261, count: 1 },
      { name: 'arrow', type: 262, count: 12 },
      { name: 'dirt', type: 3, count: 40 },
      { name: 'bread', type: 297, count: 20 }
    ]
    bot.openContainer = async () => chest

    await runDayGearCycle(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['withdraw', 262, 20],
      ['withdraw', 3, 24],
      ['withdraw', 297, 12],
      ['close']
    ])
  })

  it('waits between opening, using, and closing containers', async () => {
    const { visitNearbyContainers } = require('../bot')
    const events = []
    const bot = blockBot([block('trapped_chest', 1, 64, 0)], events)
    bot.openContainer = async target => {
      events.push(['openContainer', target.position.x])
      return {
        containerItems: () => [],
        close: () => events.push(['close', target.position.x])
      }
    }

    const visited = await visitNearbyContainers(bot, {
      containerDelayRangeMs: [1000, 3000],
      containerMemoryPath: tempContainerMemoryPath(),
      random: () => 0,
      sleep: async ms => events.push(['sleep', ms])
    }, async (container, containerBlock) => {
      events.push(['visit', containerBlock.position.x])
      return true
    })

    assert.strictEqual(visited, true)
    assert.deepStrictEqual(events, [
      ['openContainer', 1],
      ['sleep', 1000],
      ['visit', 1],
      ['sleep', 1000],
      ['close', 1]
    ])
  })

  it('only auto-searches trapped chests when looking for containers', async () => {
    const { visitNearbyContainers } = require('../bot')
    const events = []
    const bot = blockBot([
      block('chest', 1, 64, 0),
      block('barrel', 2, 64, 0),
      block('trapped_chest', 3, 64, 0)
    ], events)
    bot.openContainer = async target => {
      events.push(['openContainer', target.name, target.position.x])
      return {
        containerItems: () => [],
        close: () => events.push(['close', target.name, target.position.x])
      }
    }

    const visited = await visitNearbyContainers(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      houseOnly: false
    }, async () => true)

    assert.strictEqual(visited, true)
    assert.deepStrictEqual(events, [
      ['openContainer', 'trapped_chest', 3],
      ['close', 'trapped_chest', 3]
    ])
  })

  it('opens only one half of a large trapped chest candidate', async () => {
    const { visitNearbyContainers } = require('../bot')
    const events = []
    const leftChest = block('trapped_chest', 1, 64, 0)
    const rightChest = block('trapped_chest', 2, 64, 0)
    leftChest.properties = { facing: 'north', type: 'left' }
    rightChest.properties = { facing: 'north', type: 'right' }
    const bot = blockBot([leftChest, rightChest], events)
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.x, goal.y, goal.z])
    }
    bot.lookAt = async position => events.push(['lookAt', Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)])
    bot.openContainer = async target => {
      events.push(['openContainer', target.position.x])
      return {
        containerItems: () => [],
        close: () => events.push(['close', target.position.x])
      }
    }

    const visited = await visitNearbyContainers(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      houseOnly: false
    }, async () => false)

    assert.strictEqual(visited, false)
    assert.deepStrictEqual(events, [
      ['goto', 1, 64, -1],
      ['lookAt', 1, 64, 0],
      ['openContainer', 1],
      ['close', 1]
    ])
  })

  it('walks to the container front and looks at it before opening', async () => {
    const { visitNearbyContainers } = require('../bot')
    const events = []
    const chestBlock = block('trapped_chest', 1, 64, 0)
    chestBlock.properties = { facing: 'east' }
    const bot = blockBot([chestBlock], events)
    bot.pathfinder = {
      goto: async goal => {
        events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
        bot.entity.position = combatPosition(goal.x, goal.y, goal.z)
      }
    }
    bot.lookAt = async (point, force) => events.push(['lookAt', point.x, point.y, point.z, force])
    bot.openContainer = async target => {
      events.push(['openContainer', target.position.x])
      return {
        containerItems: () => [],
        close: () => events.push(['close', target.position.x])
      }
    }

    const visited = await visitNearbyContainers(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath()
    }, async () => true)

    assert.strictEqual(visited, true)
    assert.deepStrictEqual(events, [
      ['goto', 'GoalNear', 2, 64, 0],
      ['lookAt', 1.5, 64.5, 0.5, true],
      ['openContainer', 1],
      ['close', 1]
    ])
  })

  it('does not open a container when line of sight is blocked', async () => {
    const { visitNearbyContainers } = require('../bot')
    const events = []
    const chestBlock = block('trapped_chest', 1, 64, 0)
    const bot = blockBot([chestBlock], events)
    bot.lookAt = async (point, force) => events.push(['lookAt', point.x, point.y, point.z, force])
    bot.world = {
      raycast: () => block('stone', 0, 64, 0)
    }
    bot.openContainer = async target => {
      events.push(['openContainer', target.position.x])
      return {
        containerItems: () => [],
        close: () => events.push(['close', target.position.x])
      }
    }

    const visited = await visitNearbyContainers(bot, {
      containerInteractionDelayMs: 0,
      containerMemoryPath: tempContainerMemoryPath(),
      debugLog: (event, data) => events.push(['debug', event, data?.block])
    }, async () => true)

    assert.strictEqual(visited, false)
    assert.deepStrictEqual(events, [
      ['lookAt', 1.5, 64.5, 0.5, true],
      ['debug', 'container.blockedLineOfSight', 'trapped_chest']
    ])
  })

  it('wakes up during the day even when gear is already complete', async () => {
    const { runDayGearCycle } = require('../bot')
    const events = []
    const bot = blockBot([], events)
    bot.isSleeping = true
    bot.wake = async () => events.push(['wake'])
    bot.registry = {
      foodsByName: {
        bread: { foodPoints: 5, saturation: 6 }
      }
    }
    bot.inventory.items = () => [
      { name: 'stone_sword', type: 272, count: 1 },
      { name: 'stone_axe', type: 275, count: 1 },
      { name: 'stone_pickaxe', type: 274, count: 1 },
      { name: 'bow', type: 261, count: 1 },
      { name: 'arrow', type: 262, count: 32 },
      { name: 'dirt', type: 3, count: 64 },
      { name: 'bread', type: 297, count: 32 }
    ]

    const gearedUp = await runDayGearCycle(bot, {
      containerMemoryPath: tempContainerMemoryPath(),
      debugLog: () => {}
    })

    assert.strictEqual(gearedUp, true)
    assert.deepStrictEqual(events, [
      ['wake']
    ])
  })

  it('does not run the night safety loop while physics is disabled in the lobby', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = false
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.chat = command => events.push(['chat', command])

    attachNightSafety(bot, {
      sleep: async () => {},
      debugLog: () => {}
    })

    bot.emit('time')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [])
  })

  it('does not run the night safety loop while disabled', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = true
    bot.time = { isDay: false, timeOfDay: 14000 }

    const controller = attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: false,
      debugLog: () => {},
      runNightSafetyCycle: async () => events.push(['night'])
    })

    await new Promise(resolve => setImmediate(resolve))
    await controller.check()

    assert.deepStrictEqual(events, [])

    const result = controller.toggleEnabled()
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(result.enabled, true)
    assert.deepStrictEqual(events, [['night']])
  })

  it('keeps night safety disabled by default', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = true
    bot.time = { isDay: false, timeOfDay: 14000 }

    const controller = attachNightSafety(bot, {
      checkIntervalMs: 0,
      debugLog: () => {},
      runNightSafetyCycle: async () => events.push(['night'])
    })

    await new Promise(resolve => setImmediate(resolve))
    await controller.check()

    assert.strictEqual(controller.isEnabled(), false)
    assert.deepStrictEqual(events, [])
  })

  it('does not start daytime automation when physics becomes enabled after a daytime spawn', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = false
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.entity = { position: combatPosition(0, 64, 0) }

    attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      debugLog: () => {},
      runNightSafetyCycle: async () => events.push(['night']),
      runDayGearCycle: async () => events.push(['gear']),
      runDaytimeAutomationSequence: async () => events.push(['daytime'])
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.physicsEnabled = true
    bot.emit('physicsEnabled')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['gear']
    ])
  })

  it('leaves the house during daytime without starting automation automatically', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = true
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.entity = { position: combatPosition(0, 68, 0) }

    attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      debugLog: () => {},
      runDayGearCycle: async () => events.push(['gear']),
      leaveHomeForDaytime: async () => events.push(['exit']),
      runDaytimeAutomationSequence: async () => events.push(['daytime'])
    })

    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['gear'],
      ['exit']
    ])
  })

  it('passes the home door opener into daytime automation', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = true
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.entity = { position: combatPosition(0, 68, 0) }

    attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      autoStartDaytimeAutomation: true,
      debugLog: () => {},
      runDayGearCycle: async () => events.push(['gear']),
      leaveHomeForDaytime: async () => events.push(['exit']),
      runDaytimeAutomationSequence: async (taskBot, options) => {
        events.push(['doorOpener', typeof options.openNearbyDoor])
      }
    })

    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['gear'],
      ['exit'],
      ['doorOpener', 'function']
    ])
  })

  it('resumes paused mining automation after morning regear', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = true
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.entity = { position: combatPosition(0, 68, 0) }

    attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      debugLog: () => {},
      automationManager: {
        resumePausedAfterNightSafety: async () => events.push(['resumeMining'])
      },
      runDayGearCycle: async () => events.push(['gear']),
      leaveHomeForDaytime: async () => events.push(['exit'])
    })

    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['gear'],
      ['exit'],
      ['resumeMining']
    ])
  })

  it('restarts a completed automation after night safety morning regear', async () => {
    const { attachNightSafety, createAutomationManager } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = true
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.entity = { position: combatPosition(0, 68, 0) }
    let completeCurrentAutomation = null
    let starts = 0
    const automationManager = createAutomationManager(bot, {
      output: () => {},
      debugLog: (event, data) => events.push(['debug', event, data?.name]),
      startFarmingAutomation: (taskBot, taskOptions) => {
        starts++
        events.push(['start', starts])
        completeCurrentAutomation = taskOptions.onComplete
        return {
          stop: () => events.push(['stop', starts])
        }
      },
      startWoodCuttingAutomation: () => ({ stop: () => {} }),
      startWildRoamingAutomation: () => ({ stop: () => {} }),
      startPyroFarmingAutomation: () => ({ stop: () => {} }),
      startMiningAutomation: () => ({ stop: () => {} })
    })

    await automationManager.startByIndex(1)
    completeCurrentAutomation()
    attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      debugLog: (event, data) => events.push(['nightDebug', event, data?.name]),
      automationManager,
      runDayGearCycle: async () => events.push(['gear']),
      leaveHomeForDaytime: async () => events.push(['exit'])
    })

    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['start', 1],
      ['debug', 'automation.start', 'Farming'],
      ['debug', 'automation.waitForNextDay', 'Farming'],
      ['nightDebug', 'nightSafety.day.start', undefined],
      ['gear'],
      ['exit'],
      ['start', 2],
      ['debug', 'automation.restartForDay', 'Farming'],
      ['nightDebug', 'nightSafety.day.done', undefined]
    ])
  })

  it('runs the night safety loop immediately when attached during night', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = true
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.chat = command => events.push(['chat', command])

    attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      sleep: async () => {},
      debugLog: () => {}
    })
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [['chat', '/home home']])
  })

  it('retries the night safety loop during the same night when the previous attempt does not complete', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = false
    bot.time = { isDay: false, timeOfDay: 14000 }

    const controller = attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      nightRetryDelayMs: 0,
      debugLog: () => {},
      runNightSafetyCycle: async () => {
        events.push(['night'])
        return events.length > 1
      }
    })

    await new Promise(resolve => setImmediate(resolve))
    bot.physicsEnabled = true
    await controller.check()
    await controller.check()

    assert.deepStrictEqual(events, [['night'], ['night']])
  })

  it('does not spam night safety retries before the retry delay has passed', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    let now = 1000
    bot.physicsEnabled = false
    bot.time = { isDay: false, timeOfDay: 14000 }

    const controller = attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      nightRetryDelayMs: 5000,
      now: () => now,
      debugLog: () => {},
      runNightSafetyCycle: async () => {
        events.push(['night', now])
        return false
      }
    })

    await new Promise(resolve => setImmediate(resolve))
    bot.physicsEnabled = true
    await controller.check()
    await controller.check()
    now = 6001
    await controller.check()

    assert.deepStrictEqual(events, [
      ['night', 1000],
      ['night', 6001]
    ])
  })

  it('does not teleport home again when retrying night safety near the home anchor', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = false
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.entity = { position: combatPosition(0, 64, 0) }

    const controller = attachNightSafety(bot, {
      checkIntervalMs: 0,
      enabled: true,
      nightRetryDelayMs: 0,
      debugLog: () => {},
      runNightSafetyCycle: async (nightBot, options) => {
        events.push(['skipHomeTeleport', options.skipHomeTeleport === true])
        if (events.length === 1) {
          nightBot.__nightSafetyHomeAnchor = combatPosition(0, 64, 0)
          return false
        }
        return true
      }
    })

    await new Promise(resolve => setImmediate(resolve))
    bot.physicsEnabled = true
    await controller.check()
    await controller.check()

    assert.deepStrictEqual(events, [
      ['skipHomeTeleport', false],
      ['skipHomeTeleport', true]
    ])
  })

  it('polls current time when no Mineflayer time event fires', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    let pollTime
    bot.physicsEnabled = true
    bot.chat = command => events.push(['chat', command])

    attachNightSafety(bot, {
      enabled: true,
      sleep: async () => {},
      debugLog: () => {},
      setInterval: (fn) => {
        pollTime = fn
        return { unref: () => {} }
      },
      clearInterval: () => {}
    })

    assert.strictEqual(typeof pollTime, 'function')
    bot.time = { isDay: false, timeOfDay: 14000 }
    await pollTime()

    assert.deepStrictEqual(events, [['chat', '/home home']])
  })

  it('manually respawns after death and teleports home after spawning', async () => {
    const { attachDeathRecovery } = require('../bot')
    const bot = new EventEmitter()
    const events = []

    bot.respawn = () => events.push(['respawn'])
    bot.chat = command => events.push(['chat', command])
    bot.pathfinder = { setGoal: goal => events.push(['setGoal', goal]) }
    bot.clearControlStates = () => events.push(['clearControlStates'])

    attachDeathRecovery(bot, {
      placesPath: tempPlacesPath(),
      sleep: async () => {},
      debugLog: () => {}
    })

    bot.emit('death')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [
      ['setGoal', null],
      ['clearControlStates'],
      ['respawn'],
      ['chat', '/home home']
    ])
  })

  it('extracts homes from the homes window', () => {
    const { extractHomesFromWindow } = require('../bot')
    const window = {
      slots: [
        null,
        { displayName: 'Gray Stained Glass Pane' },
        {
          displayName: 'Home',
          nbt: {
            value: {
              display: {
                value: {
                  Lore: {
                    value: {
                      value: [
                        '{"text":"Click to teleport to Home"}'
                      ]
                    }
                  }
                }
              }
            }
          }
        },
        {
          customName: '{"text":"Farm"}',
          nbt: {
            value: {
              display: {
                value: {
                  Lore: {
                    value: {
                      value: [
                        '{"text":"Click to teleport to Farm"}'
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      ]
    }

    assert.deepStrictEqual(extractHomesFromWindow(window), [
      { name: 'Home', slot: 2 },
      { name: 'Farm', slot: 3 }
    ])
  })

  it('extracts Holocraft homes from top-menu item names', () => {
    const { extractHomesFromWindow } = require('../bot')
    const slots = Array(90).fill(null)
    slots[4] = { name: 'player_head', displayName: 'Home location' }
    slots[8] = { name: 'player_head', displayName: 'Close' }
    slots[20] = { name: 'player_head', displayName: 'Home' }
    slots[21] = { name: 'white_carpet', displayName: 'Farm' }
    slots[30] = { name: 'white_stained_glass_pane', displayName: 'White Stained Glass Pane' }
    slots[80] = { name: 'diamond_sword', displayName: 'Diamond Sword' }

    assert.deepStrictEqual(extractHomesFromWindow({ slots }), [
      { name: 'Home', slot: 20 },
      { name: 'Farm', slot: 21 }
    ])
  })

  it('opens the homes menu and clicks the selected home', async () => {
    const { openHomesMenu, teleportHome } = require('../bot')
    const bot = new EventEmitter()
    const events = []

    bot.chat = (message) => {
      events.push(['chat', message])
      process.nextTick(() => {
        bot.emit('windowOpen', {
          slots: [
            {
              displayName: 'Farm',
              nbt: {
                value: {
                  display: {
                    value: {
                      Lore: {
                        value: {
                          value: ['{"text":"Click to teleport to Farm"}']
                        }
                      }
                    }
                  }
                }
              }
            }
          ]
        })
      })
    }
    bot.clickWindow = async (slot, mouseButton, mode) => {
      events.push(['clickWindow', slot, mouseButton, mode])
    }

    const menu = await openHomesMenu(bot)
    await teleportHome(bot, menu.homes[0])

    assert.deepStrictEqual(events, [
      ['chat', '/home'],
      ['clickWindow', 0, 0, 0]
    ])
  })

  it('console sends normal commands and lets the user select a home by number', async () => {
    const { createCommandConsole } = require('../bot')
    const events = []
    const output = []
    const bot = new EventEmitter()

    bot.chat = (message) => {
      events.push(['chat', message])
      if (message === '/home') {
        process.nextTick(() => {
          bot.emit('windowOpen', {
            slots: [
              {
                displayName: 'Home',
                nbt: {
                  value: {
                    display: {
                      value: {
                        Lore: {
                          value: {
                            value: ['{"text":"Click to teleport to Home"}']
                          }
                        }
                      }
                    }
                  }
                }
              }
            ]
          })
        })
      }
    }
    bot.clickWindow = async (slot, mouseButton, mode) => {
      events.push(['clickWindow', slot, mouseButton, mode])
    }

    const consoleController = createCommandConsole(bot, {
      output: (message) => output.push(message)
    })

    await consoleController.handleLine('/spawn')
    await consoleController.handleLine('/home')
    await consoleController.handleLine('1')

    assert.deepStrictEqual(events, [
      ['chat', '/spawn'],
      ['chat', '/home'],
      ['clickWindow', 0, 0, 0]
    ])
    assert(output.some(message => message.includes('1. Home')))
  })

  it('keeps homes menu diagnostics out of the terminal', async () => {
    const { createCommandConsole } = require('../bot')
    const output = []
    const bot = new EventEmitter()

    bot.chat = () => {
      process.nextTick(() => {
        bot.emit('windowOpen', {
          title: 'Cat2246 Homes 2/2',
          slots: [
            null,
            { name: 'white_stained_glass_pane', displayName: 'White Stained Glass Pane' },
            null,
            null,
            null,
            null,
            null,
            null,
            { name: 'player_head', displayName: 'Close' }
          ]
        })
      })
    }

    const consoleController = createCommandConsole(bot, {
      output: (message) => output.push(message)
    })

    await consoleController.handleLine('/home')

    assert(output.some(message => message.includes('No homes found')))
    assert(!output.some(message => message.includes('slot 1')))
    assert(!output.some(message => message.includes('player_head')))
  })

  it('writes debug log entries as json lines', () => {
    const { createDebugLogger } = require('../bot')
    const writes = []
    const logger = createDebugLogger({
      appendFileSync: (file, line) => writes.push({ file, line })
    }, 'logs/test.log')

    logger('event', { hello: 'world' })

    assert.strictEqual(writes.length, 1)
    assert.strictEqual(writes[0].file, 'logs/test.log')
    const entry = JSON.parse(writes[0].line)
    assert.strictEqual(entry.event, 'event')
    assert.deepStrictEqual(entry.data, { hello: 'world' })
  })

  it('records error debug log entries into a repair file', () => {
    const { scanDebugLogForErrors } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-error-review-'))
    const logPath = path.join(tempDir, 'bot-debug.log')
    const reportPath = path.join(tempDir, 'error-review.md')
    const state = { position: 0 }

    fs.writeFileSync(logPath, [
      JSON.stringify({
        time: '2026-06-02T10:00:00.000Z',
        event: 'chat',
        data: { username: 'Alex', message: 'hello' }
      }),
      JSON.stringify({
        time: '2026-06-02T10:01:00.000Z',
        event: 'automation.mining.error',
        data: {
          message: 'No pickaxe found',
          stack: 'Error: No pickaxe found\n    at mine'
        }
      }),
      JSON.stringify({
        time: '2026-06-02T10:02:00.000Z',
        event: 'automation.woodcutting.ignoredEnchantError',
        data: { message: 'benign ignored enchantment read' }
      })
    ].join('\n') + '\n')

    const first = scanDebugLogForErrors({ logPath, reportPath, state })
    const second = scanDebugLogForErrors({ logPath, reportPath, state })
    const report = fs.readFileSync(reportPath, 'utf8')

    assert.strictEqual(first.recorded, 1)
    assert.strictEqual(second.recorded, 0)
    assert(report.includes('# Bot Error Review'))
    assert(report.includes('automation.mining.error'))
    assert(report.includes('No pickaxe found'))
    assert(!report.includes('ignoredEnchantError'))
  })

  it('schedules the error log monitor every ten minutes', () => {
    const { attachErrorLogMonitor, ERROR_LOG_MONITOR_INTERVAL_MS } = require('../bot')
    const bot = new EventEmitter()
    const timers = []
    const cleared = []
    let scans = 0

    const controller = attachErrorLogMonitor(bot, {
      clearInterval: timer => cleared.push(timer),
      scanDebugLogForErrors: () => {
        scans++
        return { recorded: 0 }
      },
      setInterval: (callback, delayMs) => {
        const timer = { callback, delayMs, unref: () => { timer.unrefCalled = true } }
        timers.push(timer)
        return timer
      }
    })

    assert.strictEqual(timers.length, 1)
    assert.strictEqual(timers[0].delayMs, ERROR_LOG_MONITOR_INTERVAL_MS)
    assert.strictEqual(timers[0].unrefCalled, true)

    timers[0].callback()
    assert.strictEqual(scans, 1)

    controller.stop()
    assert.deepStrictEqual(cleared, [timers[0]])
  })

  it('detects open maintenance work from error and missing function files', () => {
    const { hasMaintenanceWork } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-maintenance-work-'))
    const errorReviewPath = path.join(tempDir, 'error-review.md')
    const missingFunctionsPath = path.join(tempDir, 'MISSING_FUNCTIONS.md')

    fs.writeFileSync(errorReviewPath, [
      '# Bot Error Review',
      '',
      '## Open Items',
      '',
      '<!-- bot-error:abc -->',
      '## 2026-06-03T00:00:00.000Z - aiChat.error'
    ].join('\n'))
    fs.writeFileSync(missingFunctionsPath, [
      '# Missing Bot Functions',
      '',
      '## Open Items',
      ''
    ].join('\n'))

    assert.strictEqual(hasMaintenanceWork({ errorReviewPath, missingFunctionsPath }), true)

    fs.writeFileSync(errorReviewPath, [
      '# Bot Error Review',
      '',
      '## Open Items',
      '',
      '## Resolved Items',
      '',
      '<!-- bot-error:abc -->'
    ].join('\n'))

    assert.strictEqual(hasMaintenanceWork({ errorReviewPath, missingFunctionsPath }), false)
  })

  it('runs a maintenance cycle by stopping, fixing, and restarting the bot', async () => {
    const { runMaintenanceCycle } = require('../bot')
    const calls = []
    const result = await runMaintenanceCycle({
      hasMaintenanceWork: () => true,
      stopBot: async () => calls.push('stop'),
      runFixer: async () => calls.push('fix'),
      startBot: async () => {
        calls.push('start')
        return { pid: 1234 }
      },
      logger: () => {}
    })

    assert.deepStrictEqual(calls, ['stop', 'fix', 'start'])
    assert.strictEqual(result.fixed, true)
    assert.strictEqual(result.started.pid, 1234)
  })

  it('starts the bot during maintenance when there is no work to fix', async () => {
    const { runMaintenanceCycle } = require('../bot')
    const calls = []
    const result = await runMaintenanceCycle({
      hasMaintenanceWork: () => false,
      stopBot: async () => calls.push('stop'),
      runFixer: async () => calls.push('fix'),
      startBot: async () => {
        calls.push('start')
        return { pid: 4321 }
      },
      logger: () => {}
    })

    assert.deepStrictEqual(calls, ['stop', 'start'])
    assert.strictEqual(result.fixed, false)
    assert.strictEqual(result.started.pid, 4321)
  })

  it('schedules maintenance automation every hour', () => {
    const { attachMaintenanceAutomation, MAINTENANCE_INTERVAL_MS } = require('../bot')
    const timers = []
    const cleared = []
    let runs = 0
    const controller = attachMaintenanceAutomation({
      clearInterval: timer => cleared.push(timer),
      runMaintenanceCycle: async () => {
        runs++
        return { ok: true }
      },
      runImmediately: false,
      setInterval: (callback, delayMs) => {
        const timer = { callback, delayMs, unref: () => { timer.unrefCalled = true } }
        timers.push(timer)
        return timer
      }
    })

    assert.strictEqual(timers.length, 1)
    assert.strictEqual(timers[0].delayMs, MAINTENANCE_INTERVAL_MS)
    assert.strictEqual(timers[0].unrefCalled, true)
    timers[0].callback()
    assert.strictEqual(runs, 1)

    controller.stop()
    assert.deepStrictEqual(cleared, [timers[0]])
  })

  it('can keep the standalone maintenance timer referenced', () => {
    const { attachMaintenanceAutomation } = require('../bot')
    const timers = []
    const controller = attachMaintenanceAutomation({
      runMaintenanceCycle: async () => ({ ok: true }),
      runImmediately: false,
      setInterval: (callback, delayMs) => {
        const timer = { callback, delayMs, unref: () => { timer.unrefCalled = true } }
        timers.push(timer)
        return timer
      },
      unrefTimer: false
    })

    assert.strictEqual(timers[0].unrefCalled, undefined)
    controller.stop()
  })

  it('starts the bot with PowerShell Start-Process on Windows', async () => {
    const { startBotProcess } = require('../bot')
    const calls = []
    const result = await startBotProcess({
      execFile: (command, args, options, callback) => {
        calls.push({ command, args, cwd: options.cwd })
        callback(null, '9876\r\n', '')
        return { stdin: { end: () => {} } }
      },
      fs: {
        mkdirSync: () => {},
        openSync: () => 1
      },
      platform: 'win32',
      cwd: 'C:\\bot',
      logPath: 'C:\\bot\\logs\\bot-runtime.log'
    })

    assert.strictEqual(result.pid, 9876)
    assert.strictEqual(calls[0].command, 'powershell.exe')
    assert(calls[0].args.join('\n').includes('Start-Process'))
    assert(calls[0].args.join('\n').includes('npm.cmd'))
  })

  it('falls back to node bot.js when npm.cmd is unavailable on Windows', () => {
    const { buildWindowsStartScript } = require('../bot')

    const script = buildWindowsStartScript('C:\\bot')

    assert(script.includes("Get-Command 'npm.cmd'"))
    assert(script.includes("Get-Command 'node.exe'"))
    assert(script.includes("@('run','start')"))
    assert(script.includes("@('bot.js')"))
  })

  it('rotates debug logs before appending when the active log is too large', () => {
    const { createDebugLogger } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-log-rotation-'))
    const logPath = path.join(tempDir, 'bot-debug.log')
    fs.writeFileSync(logPath, 'active log that is already too large\n')
    fs.writeFileSync(`${logPath}.1`, 'older one\n')
    fs.writeFileSync(`${logPath}.2`, 'older two\n')
    fs.writeFileSync(`${logPath}.3`, 'oldest removed\n')

    const logger = createDebugLogger(fs, logPath, {
      maxBytes: 10,
      maxFiles: 3
    })

    logger('rotated', { ok: true })

    assert(fs.readFileSync(logPath, 'utf8').includes('"event":"rotated"'))
    assert.strictEqual(fs.readFileSync(`${logPath}.1`, 'utf8'), 'active log that is already too large\n')
    assert.strictEqual(fs.readFileSync(`${logPath}.2`, 'utf8'), 'older one\n')
    assert.strictEqual(fs.readFileSync(`${logPath}.3`, 'utf8'), 'older two\n')
  })

  it('builds a Windows popup terminal command for the log viewer', () => {
    const { buildWindowsLogTerminalArgs } = require('../bot')

    const args = buildWindowsLogTerminalArgs({
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      parentPid: 1234,
      viewerScriptPath: 'C:\\bot\\src\\logViewer.js',
      logPath: 'C:\\bot\\logs\\bot-debug.log'
    })

    assert.deepStrictEqual(args, [
      '/c',
      'start',
      'Mineflayer Bot Logs',
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\bot\\src\\logViewer.js',
      '--parent-pid',
      '1234',
      '--log-path',
      'C:\\bot\\logs\\bot-debug.log'
    ])
  })

  it('starts the log terminal on Windows and can be disabled from the environment', () => {
    const { shouldStartLogTerminal, startLogTerminal } = require('../bot')
    const calls = []
    const child = {
      unref: () => calls.push(['unref'])
    }

    assert.strictEqual(shouldStartLogTerminal({
      platform: 'win32',
      env: {}
    }), true)
    assert.strictEqual(shouldStartLogTerminal({
      platform: 'linux',
      env: {}
    }), false)
    assert.strictEqual(shouldStartLogTerminal({
      platform: 'win32',
      env: { MINEFLAYER_LOG_TERMINAL: '0' }
    }), false)

    const result = startLogTerminal({
      logPath: 'C:\\bot\\logs\\bot-debug.log',
      nodePath: 'C:\\node\\node.exe',
      parentPid: 1234,
      platform: 'win32',
      spawn: (command, args, options) => {
        calls.push(['spawn', command, args, options.detached, options.windowsHide])
        return child
      },
      viewerScriptPath: 'C:\\bot\\src\\logViewer.js'
    })

    assert.strictEqual(result, child)
    assert.strictEqual(calls[0][0], 'spawn')
    assert.strictEqual(calls[0][1], 'cmd.exe')
    assert.strictEqual(calls[0][3], true)
    assert.strictEqual(calls[0][4], false)
    assert.deepStrictEqual(calls[1], ['unref'])
  })

  it('formats and tails debug log lines for the popup log viewer', () => {
    const { formatDebugLogLine, readNewLogLines } = require('../bot')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-log-viewer-'))
    const logPath = path.join(tempDir, 'bot-debug.log')
    const output = []
    const state = {
      partial: '',
      position: 0
    }

    assert.strictEqual(
      formatDebugLogLine('{"time":"2026-05-31T05:00:01.000Z","event":"automation.start","data":{"name":"Farming"}}'),
      '[05:00:01] automation.start {"name":"Farming"}'
    )

    fs.writeFileSync(logPath, '{"time":"2026-05-31T05:00:02.000Z","event":"nightSafety.wake","data":{}}\n')
    readNewLogLines(state, {
      logPath,
      output: line => output.push(line)
    })

    assert.deepStrictEqual(output, [
      '[05:00:02] nightSafety.wake'
    ])
  })

  it('logs homes menu details when opening homes', async () => {
    const { openHomesMenu } = require('../bot')
    const bot = new EventEmitter()
    const entries = []

    bot.chat = () => {
      process.nextTick(() => {
        bot.emit('windowOpen', {
          title: 'Cat2246 Homes 2/2',
          slots: [
            null,
            { name: 'player_head', displayName: 'Home' }
          ]
        })
      })
    }

    await openHomesMenu(bot, {
      debugLog: (event, data) => entries.push({ event, data })
    })

    assert(entries.some(entry => entry.event === 'homes.window'))
    assert(entries.some(entry => entry.event === 'homes.detected'))
  })

  it('does not schedule the idle NPC planner automatically', () => {
    const { attachAiNpc } = require('../bot')
    const bot = new EventEmitter()
    const timers = []
    const cleared = []

    const controller = attachAiNpc(bot, {
      automationManager: {
        getStatus: () => ({ active: null }),
        isIdle: () => true,
        list: () => []
      },
      clearInterval: timer => cleared.push(timer),
      followController: {
        getStatus: () => ({ followedPlayerName: null }),
        isIdle: () => true
      },
      runPlanner: async () => ({ action: 'noop', reason: 'test' }),
      setInterval: (callback, delayMs) => {
        const timer = { callback, delayMs, unref: () => { timer.unrefCalled = true } }
        timers.push(timer)
        return timer
      }
    })

    assert.strictEqual(timers.length, 0)
    assert.strictEqual(typeof controller.runNow, 'function')

    controller.stop()
    assert.deepStrictEqual(cleared, [])
  })

  it('includes NPC life state in AI NPC state snapshots', () => {
    const { createAiNpcState, emptyNpcLife } = require('../bot')
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.entity = { position: combatPosition(0, 64, 0) }
    bot.inventory = { items: () => [] }
    bot.players = {}

    const state = createAiNpcState(bot, {
      npcLife: {
        read: () => ({
          ...emptyNpcLife({ now: () => 1000 }),
          currentLifestyle: 'homesteader'
        })
      },
      now: () => 1000
    })

    assert.strictEqual(state.life.currentLifestyle, 'homesteader')
    assert.strictEqual(state.life.currentGoal.id, 'survive-and-settle')
  })

  it('guides the AI NPC prompt with lifestyle and current goal', () => {
    const { createAiNpcPrompt, emptyNpcLife } = require('../bot')
    const state = {
      bot: { username: 'TestBot123' },
      automations: [{ name: 'Farming' }],
      players: [],
      life: {
        ...emptyNpcLife({ now: () => 1000 }),
        currentLifestyle: 'homesteader',
        currentGoal: {
          id: 'improve-home-routine',
          title: 'Improve the home routine',
          reason: 'The NPC keeps returning to farming and storage.',
          priority: 'progress',
          selectedAt: 1000,
          suggestedAutomations: ['Farming']
        }
      }
    }

    const prompt = createAiNpcPrompt(state)

    assert(prompt.includes('own life'))
    assert(prompt.includes('current lifestyle and goal'))
    assert(prompt.includes('improve-home-routine'))
  })

  it('does not reference NPC life goals without NPC life', () => {
    const { createAiNpcPrompt } = require('../bot')
    const state = {
      bot: { username: 'TestBot123' },
      automations: [{ name: 'Farming' }],
      players: [],
      life: null
    }

    const prompt = createAiNpcPrompt(state)

    assert(!prompt.includes('state.life.currentGoal'))
  })

  it('records AI NPC planner outcomes into NPC life state', async () => {
    const { createNpcLifeController, runAiNpcCycle, readNpcLife } = require('../bot')
    const npcLifePath = tempNpcLifePath()
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.health = 20
    bot.food = 20
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.entity = { position: combatPosition(0, 64, 0) }
    bot.inventory = { items: () => [] }
    bot.players = {}

    await runAiNpcCycle(bot, {
      npcLife: createNpcLifeController({ npcLifePath, now: () => 1000 }),
      automationManager: {
        getStatus: () => ({ active: null }),
        isIdle: () => true,
        list: () => [{ name: 'Farming' }],
        startByIndex: async () => true
      },
      followController: {
        getStatus: () => ({ followedPlayerName: null }),
        isIdle: () => true
      },
      runPlanner: async () => ({ action: 'start_automation', automation: 'Farming', reason: 'farm life' }),
      now: () => 1000
    })

    const life = readNpcLife({ npcLifePath })
    assert(life.recentEvents.some(event => event.type === 'automation_started' && event.automation === 'Farming'))
  })

  it('refreshes the NPC life goal after planner outcomes change lifestyle', async () => {
    const { createNpcLifeController, emptyNpcLife, runAiNpcCycle, writeNpcLife, readNpcLife } = require('../bot')
    const npcLifePath = tempNpcLifePath()
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.health = 20
    bot.food = 20
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.entity = { position: combatPosition(0, 64, 0) }
    bot.inventory = { items: () => [] }
    bot.players = {}
    writeNpcLife({
      ...emptyNpcLife({ now: () => 1000 }),
      lifestyles: {
        survivalist: 40,
        homesteader: 65,
        explorer: 20,
        miner: 15,
        trader: 10,
        protector: 10
      }
    }, { npcLifePath, now: () => 1000 })

    await runAiNpcCycle(bot, {
      npcLife: createNpcLifeController({ npcLifePath, now: () => 2000 }),
      automationManager: {
        getStatus: () => ({ active: null }),
        isIdle: () => true,
        list: () => [{ name: 'Farming' }],
        startByIndex: async () => true
      },
      followController: {
        getStatus: () => ({ followedPlayerName: null }),
        isIdle: () => true
      },
      runPlanner: async () => ({ action: 'start_automation', automation: 'Farming', reason: 'farm life' }),
      now: () => 2000
    })

    const life = readNpcLife({ npcLifePath })
    assert.strictEqual(life.currentLifestyle, 'homesteader')
    assert.strictEqual(life.currentGoal.id, 'improve-home-routine')
  })

  it('records unsafe NPC life events while skipping busy AI NPC cycles', async () => {
    const { createNpcLifeController, runAiNpcCycle, readNpcLife } = require('../bot')
    const npcLifePath = tempNpcLifePath()
    const bot = new EventEmitter()
    bot.username = 'TestBot123'
    bot.currentWindow = { title: 'Chest' }
    bot.entity = { position: combatPosition(0, 64, 0) }
    bot.inventory = { items: () => [] }
    bot.players = {}

    const result = await runAiNpcCycle(bot, {
      npcLife: createNpcLifeController({ npcLifePath, now: () => 1000 }),
      automationManager: {
        getStatus: () => ({ active: null }),
        isIdle: () => true,
        list: () => []
      },
      followController: {
        getStatus: () => ({ followedPlayerName: null }),
        isIdle: () => true
      },
      runPlanner: async () => {
        throw new Error('planner should not run')
      },
      now: () => 1000
    })

    const life = readNpcLife({ npcLifePath })
    assert.strictEqual(result.skipped, true)
    assert(life.recentEvents.some(event => event.type === 'unsafe'))
  })

  it('asks Codex for an idle NPC plan and starts the selected automation', async () => {
    const { runAiNpcCycle } = require('../bot')
    const bot = new EventEmitter()
    const started = []
    let plannerState

    bot.username = 'TestBot123'
    bot.health = 20
    bot.food = 18
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.game = { gameMode: 'survival' }
    bot.entity = { position: combatPosition(10, 64, 20) }
    bot.inventory = {
      items: () => [{ name: 'oak_log', count: 12 }]
    }
    bot.players = {
      Steve: {
        username: 'Steve',
        entity: { position: combatPosition(13, 64, 20) }
      }
    }

    const result = await runAiNpcCycle(bot, {
      automationManager: {
        getStatus: () => ({ active: null, pausedForNightSafety: null, waitingNextDay: null }),
        isIdle: () => true,
        list: () => [{ name: 'Wood cutting' }, { name: 'Mining' }],
        startByIndex: async index => {
          started.push(index)
          return true
        }
      },
      followController: {
        getStatus: () => ({ followedPlayerName: null, pickupEnabled: false, collectingDrop: false }),
        isIdle: () => true
      },
      runPlanner: async state => {
        plannerState = state
        return '{"action":"start_automation","automation":"Mining","reason":"bored"}'
      }
    })

    assert.strictEqual(started[0], 1)
    assert.strictEqual(plannerState.bot.username, 'TestBot123')
    assert.strictEqual(plannerState.players[0].username, 'Steve')
    assert.strictEqual(plannerState.players[0].visible, true)
    assert.strictEqual(plannerState.inventory.items[0].name, 'oak_log')
    assert.strictEqual(result.instruction.action, 'start_automation')
    assert.strictEqual(result.execution.startedAutomation, 'Mining')
  })

  it('does not run the idle NPC planner while the bot is busy', async () => {
    const { runAiNpcCycle } = require('../bot')
    const bot = new EventEmitter()
    bot.username = 'TestBot123'

    const result = await runAiNpcCycle(bot, {
      automationManager: {
        getStatus: () => ({ active: 'Mining' }),
        isIdle: () => false,
        list: () => [{ name: 'Mining' }]
      },
      followController: {
        getStatus: () => ({ followedPlayerName: null }),
        isIdle: () => true
      },
      runPlanner: async () => {
        throw new Error('planner should not run')
      }
    })

    assert.deepStrictEqual(result, {
      ok: true,
      skipped: true,
      reason: 'busy'
    })
  })

  it('can follow a player from an idle NPC planner instruction', async () => {
    const { runAiNpcCycle } = require('../bot')
    const bot = new EventEmitter()
    const followed = []
    bot.username = 'TestBot123'
    bot.players = {
      Alex: {
        username: 'Alex',
        entity: { position: combatPosition(5, 64, 5) }
      }
    }

    const result = await runAiNpcCycle(bot, {
      automationManager: {
        getStatus: () => ({ active: null }),
        isIdle: () => true,
        list: () => []
      },
      followController: {
        followPlayer: async playerName => {
          followed.push(playerName)
          return { ok: true, message: `Following ${playerName}.` }
        },
        getStatus: () => ({ followedPlayerName: null, pickupEnabled: false, collectingDrop: false }),
        isIdle: () => true
      },
      runPlanner: async () => ({ action: 'follow_player', player: 'Alex', reason: 'company' })
    })

    assert.deepStrictEqual(followed, ['Alex'])
    assert.deepStrictEqual(result.execution, {
      ok: true,
      action: 'follow_player',
      player: 'Alex',
      message: 'Following Alex.'
    })
  })

  it('runs safe server commands from idle NPC planner instructions', async () => {
    const { runAiNpcCycle } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    bot.username = 'TestBot123'
    bot.chat = message => messages.push(message)

    const result = await runAiNpcCycle(bot, {
      agentCommandResultWaitMs: 0,
      automationManager: {
        getStatus: () => ({ active: null }),
        isIdle: () => true,
        list: () => []
      },
      followController: {
        getStatus: () => ({ followedPlayerName: null }),
        isIdle: () => true
      },
      runPlanner: async () => ({ action: 'run_server_command', command: '/spawn', reason: 'idle stroll' })
    })

    assert.deepStrictEqual(messages, ['/spawn'])
    assert.strictEqual(result.execution.ok, true)
    assert.strictEqual(result.execution.toolResult.command, '/spawn')
  })

  it('blocks dangerous server commands from idle NPC planner instructions', async () => {
    const { runAiNpcCycle } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    bot.username = 'TestBot123'
    bot.chat = message => messages.push(message)

    const result = await runAiNpcCycle(bot, {
      automationManager: {
        getStatus: () => ({ active: null }),
        isIdle: () => true,
        list: () => []
      },
      followController: {
        getStatus: () => ({ followedPlayerName: null }),
        isIdle: () => true
      },
      runPlanner: async () => ({ action: 'run_server_command', command: '/kick Steve', reason: 'bad idea' })
    })

    assert.deepStrictEqual(messages, [])
    assert.strictEqual(result.execution.ok, false)
    assert.strictEqual(result.execution.toolResult.blocked, true)
    assert.strictEqual(result.execution.toolResult.reason, 'blocked-dangerous-command')
  })

  it('blocks server mode commands from idle NPC planner instructions', async () => {
    const { runAiNpcCycle } = require('../bot')
    const bot = new EventEmitter()
    const messages = []
    bot.username = 'TestBot123'
    bot.chat = message => messages.push(message)

    const result = await runAiNpcCycle(bot, {
      automationManager: {
        getStatus: () => ({ active: null }),
        isIdle: () => true,
        list: () => []
      },
      followController: {
        getStatus: () => ({ followedPlayerName: null }),
        isIdle: () => true
      },
      runPlanner: async () => ({ action: 'run_server_command', command: '/skyblock', reason: 'wrong world' })
    })

    assert.deepStrictEqual(messages, [])
    assert.strictEqual(result.execution.ok, false)
    assert.strictEqual(result.execution.toolResult.blocked, true)
    assert.strictEqual(result.execution.toolResult.reason, 'blocked-server-mode-command')
  })
})

function combatBot (items = [], events = []) {
  const bot = {
    entity: {
      position: combatPosition(0, 0, 0),
      eyeHeight: 1.62,
      yaw: 0,
      pitch: 0
    },
    inventory: {
      items: () => items
    },
    equip: async (item, destination) => events.push(['equip', item.name, destination]),
    lookAt: async (point, force) => {
      events.push(['lookAt', force, { x: point.x, y: point.y, z: point.z }])
      const delta = {
        x: point.x - bot.entity.position.x,
        y: point.y - (bot.entity.position.y + bot.entity.eyeHeight),
        z: point.z - bot.entity.position.z
      }
      bot.entity.yaw = Math.atan2(-delta.x, -delta.z)
      bot.entity.pitch = Math.atan2(delta.y, Math.sqrt(delta.x * delta.x + delta.z * delta.z))
    },
    swingArm: (arm, showHand) => events.push(['swingArm', arm, showHand]),
    attack: (target, swing) => {
      const event = ['attack', target.name]
      if (swing !== undefined) event.push(swing)
      events.push(event)
    },
    activateItem: () => events.push(['activateItem']),
    deactivateItem: () => events.push(['deactivateItem']),
    pathfinder: {
      setGoal: goal => {
        if (goal === null) events.push(['pathfinderStop'])
      }
    },
    setControlState: (control, state) => events.push(['control', control, state])
  }
  return bot
}

function combatTarget (name, x) {
  return {
    type: 'mob',
    name,
    height: 1.8,
    position: combatPosition(x, 0, 0)
  }
}

function autoEatBot (items = [], events = []) {
  const foodsByName = {
    apple: { foodPoints: 4, saturation: 2.4, effectiveQuality: 6.4 },
    bread: { foodPoints: 5, saturation: 6, effectiveQuality: 11 },
    golden_apple: { foodPoints: 4, saturation: 9.6, effectiveQuality: 13.6 },
    rotten_flesh: { foodPoints: 4, saturation: 0.8, effectiveQuality: 4.8 }
  }

  return {
    food: 20,
    health: 20,
    game: { gameMode: 'survival' },
    registry: { foodsByName },
    inventory: {
      items: () => items
    },
    pathfinder: {
      setGoal: goal => events.push(['setGoal', goal])
    },
    setControlState: (control, state) => events.push(['control', control, state]),
    equip: async (item, destination) => events.push(['equip', item.name, destination]),
    consume: async () => events.push(['consume'])
  }
}

function followBot (options = {}, events = []) {
  const bot = new EventEmitter()
  bot.entity = {
    position: combatPosition(0, 64, 0)
  }
  bot.players = options.players || {}
  bot.entities = options.entities || {}
  bot.food = options.food ?? 20
  bot.health = options.health ?? 20
  bot.inventory = options.inventory || {
    items: () => [],
    emptySlotCount: () => 10
  }
  bot.pathfinder = options.pathfinder || {
    setGoal: (goal, dynamic) => {
      if (goal === null) {
        events.push(['setGoal', null, null, dynamic])
        return
      }
      events.push([
        'setGoal',
        goal.constructor.name,
        goal.entity?.username || goal.entity?.name || goal.x,
        dynamic
      ])
    },
    goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
  }
  bot.chat = message => events.push(['chat', message])
  bot.whisper = (playerName, message) => events.push(['whisper', playerName, message])
  bot.findBlocks = ({ matching }) => (options.blocks || [])
    .filter(candidate => matching(candidate))
    .map(candidate => candidate.position)
  bot.blockAt = position => (options.blocks || []).find(candidate =>
    candidate.position.x === position.x &&
    candidate.position.y === position.y &&
    candidate.position.z === position.z
  ) || null
  bot.openContainer = options.openContainer || (async () => {
    throw new Error('openContainer was not configured')
  })
  return bot
}

function combatPosition (x, y, z) {
  return {
    x,
    y,
    z,
    distanceTo: other => Math.sqrt(
      Math.pow(x - other.x, 2) +
      Math.pow(y - other.y, 2) +
      Math.pow(z - other.z, 2)
    ),
    offset: (dx, dy, dz) => combatPosition(x + dx, y + dy, z + dz)
  }
}

function sequenceRandom (values) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

function tempContainerMemoryPath () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'container-memory-')), 'container-memory.txt')
}

function tempPyroFarmMemoryPath () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pyrofarm-memory-')), 'pyrofarm-memory.txt')
}

function tempPlacesPath () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'places-')), 'places.txt')
}

function tempNpcLifePath () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'npc-life-')), 'npc-life.json')
}

function tempMemoryPath () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-memory-')), 'MEMORY.md')
}

function tempToolsPath () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-tools-')), 'TOOLS.md')
}

function tempMissingFunctionsPath () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-missing-functions-')), 'MISSING_FUNCTIONS.md')
}

function blockBot (blocks = [], events = []) {
  return {
    entity: {
      position: combatPosition(0, 64, 0)
    },
    inventory: {
      items: () => [],
      emptySlotCount: () => 10
    },
    findBlocks: ({ matching }) => blocks
      .filter(candidate => matching(candidate))
      .map(candidate => candidate.position),
    blockAt: position => blocks.find(candidate =>
      candidate.position.x === position.x &&
      candidate.position.y === position.y &&
      candidate.position.z === position.z
    ) || null,
    equip: async (item, destination) => events.push(['equip', item.name, destination]),
    dig: async target => events.push(['dig', target.name])
  }
}

function block (name, x, y, z) {
  return {
    name,
    type: Math.abs(name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)),
    position: combatPosition(x, y, z)
  }
}
