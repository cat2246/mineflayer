/* eslint-env mocha */

const assert = require('assert')
const EventEmitter = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')

describe('holocraft bot config', function () {
  this.timeout(10000)

  it('uses the Holocraft server with offline auth', () => {
    const { buildBotOptions } = require('../bot')

    const options = buildBotOptions(['node', 'bot.js'], {})

    assert.deepStrictEqual(options, {
      host: 'play.holocraft.xyz',
      port: 25565,
      username: 'PokiMoki82719',
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
      MINECRAFT_USERNAME: 'env@example.com',
      MINECRAFT_VERSION: '1.21.5'
    })

    assert.strictEqual(options.version, '1.21.5')
  })

  it('reads the Microsoft account identifier from the environment first', () => {
    const { buildBotOptions } = require('../bot')

    const options = buildBotOptions(['node', 'bot.js', 'cli@example.com'], {
      MINECRAFT_USERNAME: 'env@example.com'
    })

    assert.strictEqual(options.username, 'env@example.com')
  })

  it('allows overriding Minecraft auth mode from the environment', () => {
    const { buildBotOptions } = require('../bot')

    const options = buildBotOptions(['node', 'bot.js'], {
      MINECRAFT_USERNAME: 'premium@example.com',
      MINECRAFT_AUTH: 'microsoft'
    })

    assert.strictEqual(options.auth, 'microsoft')
  })

  it('uses the configured default account when no override is provided', () => {
    const { buildBotOptions } = require('../bot')
    const options = buildBotOptions(['node', 'bot.js'], {})

    assert.strictEqual(typeof options.username, 'string')
    assert.ok(options.username.length > 0)
  })

  it('uses third-person viewer defaults on port 3007', () => {
    const { buildViewerOptions } = require('../bot')

    assert.deepStrictEqual(buildViewerOptions(), {
      port: 3007,
      firstPerson: false
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
      firstPerson: false,
      isPortAvailable: async () => true
    })

    assert.deepStrictEqual(calls, [{
      viewerBot: bot,
      options: {
        port: 3007,
        firstPerson: false
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

  it('sends the Holocraft login command after spawn', async () => {
    const { loginToServer } = require('../bot')
    const sleeps = []
    const messages = []
    const bot = {
      chat: (message) => {
        messages.push(message)
      }
    }

    await loginToServer(bot, {
      sleep: async (ms) => sleeps.push(ms)
    })

    assert.deepStrictEqual(sleeps, [1000])
    assert.deepStrictEqual(messages, ['/login PqOwIeUr0192'])
  })

  it('logs into the server and joins Survival on spawn after starting the viewer', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const events = []

    attachEventLogging(bot, {
      loginToServer: async () => events.push('loginToServer'),
      joinSurvivalWorld: async () => events.push('joinSurvivalWorld'),
      startViewer: () => events.push('startViewer')
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, ['startViewer', 'loginToServer', 'joinSurvivalWorld'])
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

  it('re-enables physics after joining Survival on the first spawn', async () => {
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

    assert.deepStrictEqual(sleeps, [10000])
    assert.strictEqual(bot.physicsEnabled, true)
    assert.deepStrictEqual(events, [['physicsEnabled', 1]])
  })

  it('keeps physics disabled on the lobby spawn', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const sleeps = []
    bot.physicsEnabled = false

    attachEventLogging(bot, {
      joinSurvivalWorld: async () => {},
      sleep: async (ms) => sleeps.push(ms),
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(sleeps, [])
    assert.strictEqual(bot.physicsEnabled, false)
  })

  it('re-enables physics 10 seconds after a later spawn', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const sleeps = []
    bot.physicsEnabled = false

    attachEventLogging(bot, {
      joinSurvivalWorld: async () => {},
      sleep: async (ms) => sleeps.push(ms),
      startViewer: () => {}
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))
    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(sleeps, [10000])
    assert.strictEqual(bot.physicsEnabled, true)
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
    const target = combatTarget('zombie', 3)
    const bot = combatBot([{ name: 'diamond_sword' }], events)

    await runCombatTick(bot, {
      targetFinder: () => target,
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['pathfinderStop'],
      ['equip', 'diamond_sword', 'hand'],
      ['lookAt'],
      ['attack', 'zombie']
    ])
  })

  it('delegates hostile targets to mineflayer-pvp when available', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 7)
    const bot = combatBot([{ name: 'diamond_sword' }], events)
    bot.pvp = {
      target: null,
      attack: entity => events.push(['pvpAttack', entity.name])
    }

    const action = await runCombatTick(bot, {
      targetFinder: () => target,
      debugLog: () => {}
    })

    assert.strictEqual(action.type, 'pvp')
    assert(bot.__combatActiveUntil >= Date.now())
    assert.deepStrictEqual(events, [
      ['equip', 'diamond_sword', 'hand'],
      ['pvpAttack', 'zombie']
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
      debugLog: () => {}
    })

    assert.strictEqual(action.type, 'sword')
    assert.deepStrictEqual(events, [
      ['pathfinderStop'],
      ['equip', 'diamond_sword', 'hand'],
      ['lookAt'],
      ['attack', 'zombie']
    ])
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

  it('adds fallback knockback when hurt arrives without server velocity', () => {
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
      position: combatPosition(1, 64, 0)
    }

    attachKnockbackPause(bot, {
      now: () => 1000,
      pauseMs: 700,
      horizontalVelocity: 0.45,
      verticalVelocity: 0.35,
      debugLog: () => {}
    })
    bot.emit('entityHurt', bot.entity, attacker)

    assert(bot.entity.velocity.x < -0.4)
    assert.strictEqual(bot.entity.velocity.y, 0.35)
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

  it('performs bow combat against a far hostile mob', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 6)
    const bot = combatBot([{ name: 'bow' }, { name: 'arrow' }], events)

    await runCombatTick(bot, {
      targetFinder: () => target,
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['pathfinderStop'],
      ['equip', 'bow', 'hand'],
      ['lookAt'],
      ['activateItem'],
      ['deactivateItem']
    ])
  })

  it('tries to flee from a hostile mob when unarmed', async () => {
    const { runCombatTick } = require('../bot')
    const events = []
    const target = combatTarget('zombie', 3)
    const bot = combatBot([], events)

    await runCombatTick(bot, {
      targetFinder: () => target,
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['pathfinderStop'],
      ['lookAt'],
      ['control', 'back', true],
      ['control', 'jump', true],
      ['control', 'back', false],
      ['control', 'jump', false]
    ])
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

  it('lists farming and wild roaming in the default automation menu', async () => {
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
      })
    })

    assert.deepStrictEqual(automationManager.list(), [
      { name: 'Wood cutting' },
      { name: 'Farming' },
      { name: 'Wild roaming' }
    ])

    await automationManager.startByIndex(1)
    await automationManager.startByIndex(2)

    assert.deepStrictEqual(events, [
      ['stop', 'farming']
    ])
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
    const controller = createFollowController(bot)

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
    const controller = createFollowController(bot)

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
    const controller = createFollowController(bot)

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
    const controller = createFollowController(bot)

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

  it('unloads inventory into a nearby chest', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const chestBlock = block('chest', 1, 64, 0)
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
    const controller = createFollowController(bot)

    const result = await controller.unloadInventory()

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(events, [
      ['openContainer', 'chest'],
      ['deposit', 264, 0, 3],
      ['close']
    ])
  })

  it('tries another nearby chest when the first unload chest is full', async () => {
    const { createFollowController } = require('../bot')
    const events = []
    const fullChestBlock = block('chest', 1, 64, 0)
    const openChestBlock = block('chest', 2, 64, 0)
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
    const controller = createFollowController(bot)

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

  it('sends private /message whispers to Codex and whispers the answer back', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const requests = []
    const bot = new EventEmitter()
    bot.username = 'PokiMoki82719'
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
    bot.username = 'PokiMoki82719'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      runCodex: async request => {
        requests.push(request)
        return 'I am doing well.'
      }
    })

    bot.emit('whisper', 'Cat2246', 'Hi PokiMoki82719, how are you?')
    bot.emit('chat', 'Cat2246', 'me] Hi PokiMoki82719, how are you?')
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
    bot.username = 'PokiMoki82719'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      runCodex: async request => {
        requests.push(request)
        return 'I can help.'
      },
      agentInstructions: 'Be concise.'
    })

    bot.emit('chat', 'Alex', 'PokiMoki82719 can you help?')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    assert.strictEqual(requests.length, 1)
    assert.strictEqual(requests[0].channel, 'public')
    assert.strictEqual(requests[0].username, 'Alex')
    assert.deepStrictEqual(events, [['chat', '@Alex I can help.']])
  })

  it('ignores public chat without a bot mention and its own messages', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    const bot = new EventEmitter()
    bot.username = 'PokiMoki82719'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      runCodex: async () => {
        throw new Error('Codex should not run')
      }
    })

    bot.emit('chat', 'Alex', 'hello everyone')
    bot.emit('chat', 'PokiMoki82719', 'PokiMoki82719 status')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, [])
  })

  it('ignores server join announcements that mention the bot username', async () => {
    const { attachAiChat } = require('../bot')
    const events = []
    let codexCalls = 0
    const bot = new EventEmitter()
    bot.username = 'PokiMoki82719'
    bot.chat = message => events.push(['chat', message])
    bot.whisper = (username, message) => events.push(['whisper', username, message])

    attachAiChat(bot, {
      runCodex: async () => {
        codexCalls++
        return 'Hi Joined!'
      }
    })

    bot.emit('chat', 'Joined', 'PokiMoki82719')
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
    bot.username = 'PokiMoki82719'
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

  it('places a scaffold block when a tree log is too high to reach', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
    let canReachLog = false
    const treeLog = block('oak_log', 0, 72, 0)
    const bot = blockBot([
      treeLog,
      block('oak_leaves', 1, 74, 0),
      block('dirt', 0, 63, 0)
    ], events)
    bot.inventory.items = () => [{ name: 'dirt' }]
    bot.canDigBlock = () => canReachLog
    bot.pathfinder = {
      goto: async goal => events.push(['goto', goal.constructor.name, goal.x, goal.y, goal.z])
    }
    bot.setControlState = (control, state) => events.push(['control', control, state])
    bot.placeBlock = async (referenceBlock, faceVector) => {
      events.push(['placeBlock', referenceBlock.name, faceVector.x, faceVector.y, faceVector.z])
      canReachLog = true
      bot.entity.position = combatPosition(0, 68, 0)
    }

    await cutTreeLog(bot, treeLog, {
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['goto', 'GoalNearXZ', 0, undefined, 0],
      ['equip', 'dirt', 'hand'],
      ['control', 'jump', true],
      ['placeBlock', 'dirt', 0, 1, 0],
      ['control', 'jump', false],
      ['control', 'sprint', false],
      ['control', 'jump', false],
      ['dig', 'oak_log']
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
      maxScaffoldBlocks: 0,
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

  it('temporarily skips unreachable logs when no scaffold block is available', async () => {
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
    assert(entries.some(entry => entry.event === 'automation.woodcutting.noTree'))
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
    assert(entries.some(entry => entry.event === 'automation.woodcutting.noTree'))
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
    assert(entries.some(entry => entry.event === 'automation.woodcutting.noTree'))
  })

  it('walks to nearby dropped items after cutting a tree log', async () => {
    const { cutTreeLog } = require('../bot')
    const events = []
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
      sleep: async () => {}
    })

    assert.deepStrictEqual(events, [
      ['goto', 'GoalGetToBlock', 0, 64, 0],
      ['dig', 'oak_log'],
      ['goto', 'GoalNear', 1, 64, 0]
    ])
  })

  it('looks at the log and pauses before digging', async () => {
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
      sleep: async ms => events.push(['sleep', ms])
    })

    assert.deepStrictEqual(events.slice(0, -1), [
      ['control', 'sprint', false],
      ['control', 'jump', false],
      ['lookAt', 0.5, 64.5, 0.5, true],
      ['sleep', 750],
      ['dig', 'oak_log']
    ])
    assert.strictEqual(events[events.length - 1][0], 'sleep')
    assert(events[events.length - 1][1] >= 1000)
    assert(events[events.length - 1][1] <= 1600)
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

  it('teleports home and deposits wood items into a nearby chest', async () => {
    const { depositWoodAtHome } = require('../bot')
    const events = []
    const chestBlock = block('chest', 1, 64, 0)
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
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['chat', '/home home'],
      ['deposit', 17, 12],
      ['close']
    ])
  })

  it('returns home at night, opens the house door, cooks food, stores loot, and sleeps', async () => {
    const { runNightSafetyCycle } = require('../bot')
    const events = []
    const door = block('oak_door', 1, 64, 0)
    const furnaceBlock = block('furnace', 2, 64, 0)
    const chestBlock = block('chest', 3, 64, 0)
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
    const chestBlock = block('chest', 1, 64, 0)
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
      sleep: async () => {},
      debugLog: () => {}
    })

    assert.strictEqual(completed, false)
    assert.deepStrictEqual(events, [
      ['chat', '/home home']
    ])
  })

  it('uses the home teleport position when choosing a loot chest', async () => {
    const { depositLoot } = require('../bot')
    const events = []
    const homeChest = block('chest', 1, 64, 0)
    const otherChest = block('chest', 50, 64, 0)
    const oakLog = { name: 'oak_log', type: 17, count: 12 }
    const bot = blockBot([homeChest, otherChest], events)
    bot.entity.position = combatPosition(49, 64, 0)
    bot.inventory.items = () => [oakLog]
    bot.openContainer = async target => ({
      deposit: async (type, metadata, count) => events.push(['deposit', target.position.x, type, count]),
      close: () => events.push(['close', target.position.x])
    })

    await depositLoot(bot, {
      originPosition: combatPosition(0, 64, 0),
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['deposit', 1, 17, 12],
      ['close', 1]
    ])
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
      ['sleep', 200],
      ['woodCycle', 2],
      ['sleep', 300],
      ['woodCycle', 3],
      ['depositWood']
    ])
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
      debugLog: () => {},
      sleep: async () => {}
    })

    assert.strictEqual(attacked, true)
    assert.deepStrictEqual(events, [
      ['goto', 120, 64, 0],
      ['equip', 'iron_sword', 'hand'],
      ['attack', 'chicken']
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

  it('uses a 32 wood target for the default daytime wood cutting task', async () => {
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
        woodCount += 32
        return true
      },
      depositWoodAtHome: async () => events.push(['depositWood']),
      shouldStop: () => cycles >= 1
    })

    assert.strictEqual(completed, true)
    assert.strictEqual(cycles, 1)
    assert.strictEqual(targetWoodCount, 32)
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

  it('gears up from a nearby chest during the day when required items are missing', async () => {
    const { runDayGearCycle } = require('../bot')
    const events = []
    const chestBlock = block('chest', 3, 64, 0)
    const sword = { name: 'iron_sword', type: 267, count: 1 }
    const axe = { name: 'iron_axe', type: 258, count: 1 }
    const pickaxe = { name: 'iron_pickaxe', type: 257, count: 1 }
    const bread = { name: 'bread', type: 297, count: 8 }
    const chest = {
      containerItems: () => [sword, axe, pickaxe, bread],
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
      debugLog: () => {}
    })

    assert.deepStrictEqual(events, [
      ['withdraw', 267, 1],
      ['withdraw', 258, 1],
      ['withdraw', 257, 1],
      ['withdraw', 297, 8],
      ['close']
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
      { name: 'bread', type: 297, count: 8 }
    ]

    const gearedUp = await runDayGearCycle(bot, {
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

  it('does not start daytime automation when physics becomes enabled after a daytime spawn', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = false
    bot.time = { isDay: true, timeOfDay: 1000 }
    bot.entity = { position: combatPosition(0, 64, 0) }

    attachNightSafety(bot, {
      checkIntervalMs: 0,
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

  it('runs the night safety loop immediately when attached during night', async () => {
    const { attachNightSafety } = require('../bot')
    const bot = new EventEmitter()
    const events = []
    bot.physicsEnabled = true
    bot.time = { isDay: false, timeOfDay: 14000 }
    bot.chat = command => events.push(['chat', command])

    attachNightSafety(bot, {
      checkIntervalMs: 0,
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
})

function combatBot (items = [], events = []) {
  return {
    entity: {
      position: combatPosition(0, 0, 0)
    },
    inventory: {
      items: () => items
    },
    equip: async (item, destination) => events.push(['equip', item.name, destination]),
    lookAt: async () => events.push(['lookAt']),
    attack: target => events.push(['attack', target.name]),
    activateItem: () => events.push(['activateItem']),
    deactivateItem: () => events.push(['deactivateItem']),
    pathfinder: {
      setGoal: goal => {
        if (goal === null) events.push(['pathfinderStop'])
      }
    },
    setControlState: (control, state) => events.push(['control', control, state])
  }
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
