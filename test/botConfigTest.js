/* eslint-env mocha */

const assert = require('assert')
const EventEmitter = require('events')

describe('holocraft bot config', function () {
  this.timeout(10000)

  it('uses the Holocraft server with Microsoft auth', () => {
    const { buildBotOptions } = require('../bot')

    const options = buildBotOptions(['node', 'bot.js', 'PlayerEmail@example.com'], {})

    assert.deepStrictEqual(options, {
      host: 'play.holocraft.xyz',
      port: 25565,
      username: 'PlayerEmail@example.com',
      auth: 'microsoft',
      version: '1.21.10',
      physicsEnabled: false,
      hideErrors: false,
      checkTimeoutInterval: 30000,
      closeTimeout: 120000
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

  it('uses the configured default account when no override is provided', () => {
    const { buildBotOptions } = require('../bot')
    const options = buildBotOptions(['node', 'bot.js'], {})

    assert.strictEqual(typeof options.username, 'string')
    assert.ok(options.username.length > 0)
  })

  it('uses first-person viewer defaults on port 3007', () => {
    const { buildViewerOptions } = require('../bot')

    assert.deepStrictEqual(buildViewerOptions(), {
      port: 3007,
      firstPerson: true
    })
  })

  it('starts prismarine-viewer with the bot and viewer options', () => {
    const { startViewer } = require('../bot')
    const calls = []
    const bot = {}

    startViewer(bot, (viewerBot, options) => {
      calls.push({ viewerBot, options })
      return 'viewer'
    })

    assert.deepStrictEqual(calls, [{
      viewerBot: bot,
      options: {
        port: 3007,
        firstPerson: true
      }
    }])
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

  it('joins Survival on spawn after starting the viewer', async () => {
    const { attachEventLogging } = require('../bot')
    const bot = new EventEmitter()
    const events = []

    attachEventLogging(bot, {
      joinSurvivalWorld: async () => events.push('joinSurvivalWorld'),
      startViewer: () => events.push('startViewer')
    })

    bot.emit('spawn')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepStrictEqual(events, ['startViewer', 'joinSurvivalWorld'])
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
