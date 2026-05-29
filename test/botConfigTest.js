/* eslint-env mocha */

const assert = require('assert')
const EventEmitter = require('events')

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

  it('configures conservative pathfinder movements', () => {
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

    assert.deepStrictEqual(events, [
      ['control', 'sprint', false],
      ['control', 'jump', false],
      ['lookAt', 0.5, 64.5, 0.5, true],
      ['sleep', 750],
      ['dig', 'oak_log'],
      ['sleep', 1500]
    ])
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
