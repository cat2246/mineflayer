const fs = require('fs')
const path = require('path')
const { resolveBotMemoryPaths } = require('./botMemory')
const { readMissingTools, recordMissingTool, recordSharedMissingTool } = require('./missingTools')
const { readPlaceCoordinates, rememberPlaceCoordinates } = require('./places')

const MAX_TOOL_TEXT_LENGTH = 160
const SAFE_PLACE_NAME = /^[A-Za-z0-9_-]{1,32}$/

function compactText (value, fallback = '', maxLength = MAX_TOOL_TEXT_LENGTH) {
  const text = String(value || fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, maxLength)
}

function objectArgs (args) {
  return args && typeof args === 'object' && !Array.isArray(args) ? args : {}
}

function roundedNumber (value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null
}

function positionSnapshot (position) {
  if (!position) return null
  return {
    x: roundedNumber(position.x),
    y: roundedNumber(position.y),
    z: roundedNumber(position.z)
  }
}

function inventorySnapshot (bot) {
  const items = typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
  return {
    emptySlots: typeof bot.inventory?.emptySlotCount === 'function'
      ? bot.inventory.emptySlotCount()
      : null,
    items: items
      .filter(item => item && item.count > 0)
      .slice(0, 24)
      .map(item => ({
        name: item.name,
        count: item.count
      }))
  }
}

function normalizeCommand (command) {
  const text = compactText(command, '', 120)
  if (!text || /[\r\n]/.test(text)) return ''
  return text.startsWith('/') ? text : `/${text}`
}

function isSafePlaceName (name) {
  return SAFE_PLACE_NAME.test(String(name || ''))
}

function isAllowedSafeCommand (command) {
  const normalized = normalizeCommand(command)
  if (!normalized) return false
  if (/^\/(spawn|survival|rtp|warps)$/i.test(normalized)) return true
  if (/^\/home\s+home$/i.test(normalized)) return true
  if (/^\/sethome\s+home$/i.test(normalized)) return true
  if (/^\/warp\s+[A-Za-z0-9_-]{1,32}$/i.test(normalized)) return true
  return false
}

function validateSafeCommandArgs (args) {
  const command = normalizeCommand(args.command)
  if (!isAllowedSafeCommand(command)) {
    return { ok: false, reason: 'command-not-allowed' }
  }
  return { ok: true, args: { command } }
}

function validateHomeNameArgs (args) {
  const name = compactText(args.name, 'home', 32)
  if (name !== 'home' || !isSafePlaceName(name)) return { ok: false, reason: 'invalid-home-name' }
  return { ok: true, args: { name } }
}

function validatePlaceArgs (args) {
  const name = compactText(args.name, '', 32)
  if (!isSafePlaceName(name)) return { ok: false, reason: 'invalid-place-name' }
  return { ok: true, args: { name } }
}

function validateMemoryEventArgs (args) {
  const type = compactText(args.type, '', 80)
  const message = compactText(args.message || args.reason, '', 300)
  if (!type) return { ok: false, reason: 'missing-event-type' }
  return { ok: true, args: { type, message } }
}

function validateMissingToolArgs (args) {
  const capability = compactText(args.capability, '', 120)
  if (!capability) return { ok: false, reason: 'missing-capability' }
  return {
    ok: true,
    args: {
      capability,
      desiredTool: compactText(args.desiredTool || args.suggestedTool || args.tool, '', 120),
      blockedGoal: compactText(args.blockedGoal || args.goal, 'Unspecified goal', 160),
      reason: compactText(args.reason, 'No reason captured', 300),
      priority: compactText(args.priority, 'medium', 20)
    }
  }
}

function passArgs (args) {
  return { ok: true, args: objectArgs(args) }
}

function toolDefinitions () {
  return [
    {
      name: 'observe_world',
      description: 'Read compact bot/world state.',
      validate: passArgs,
      execute: async (bot) => ({
        bot: {
          username: bot.username || null,
          position: positionSnapshot(bot.entity?.position),
          health: typeof bot.health === 'number' ? bot.health : null,
          food: typeof bot.food === 'number' ? bot.food : null,
          dimension: bot.game?.dimension || bot.game?.dimensionType || null
        },
        time: {
          isDay: bot.time?.isDay ?? null,
          timeOfDay: typeof bot.time?.timeOfDay === 'number' ? bot.time.timeOfDay : null
        },
        players: Object.keys(bot.players || {}).filter(username => username && username !== bot.username)
      })
    },
    {
      name: 'inspect_inventory',
      description: 'Read compact inventory state.',
      validate: passArgs,
      execute: async bot => inventorySnapshot(bot)
    },
    {
      name: 'run_safe_command',
      description: 'Run an allowlisted survival command.',
      validate: validateSafeCommandArgs,
      execute: async (bot, args) => {
        if (typeof bot.chat !== 'function') return { ok: false, reason: 'chat-unavailable' }
        bot.chat(args.command)
        return { command: args.command }
      }
    },
    {
      name: 'rtp',
      description: 'Run /rtp for a fresh wilderness start.',
      validate: passArgs,
      execute: async bot => {
        if (typeof bot.chat !== 'function') return { ok: false, reason: 'chat-unavailable' }
        bot.chat('/rtp')
        return { command: '/rtp' }
      }
    },
    {
      name: 'set_home',
      description: 'Set and remember /sethome home.',
      validate: validateHomeNameArgs,
      execute: async (bot, args, options) => {
        if (typeof bot.chat !== 'function') return { ok: false, reason: 'chat-unavailable' }
        if (!bot.entity?.position) return { ok: false, reason: 'position-unavailable' }
        bot.chat(`/sethome ${args.name}`)
        const place = rememberPlaceCoordinates(bot, args.name, bot.entity.position, options)
        return { command: `/sethome ${args.name}`, place }
      }
    },
    {
      name: 'go_home',
      description: 'Run /home home.',
      validate: validateHomeNameArgs,
      execute: async (bot, args) => {
        if (typeof bot.chat !== 'function') return { ok: false, reason: 'chat-unavailable' }
        bot.chat(`/home ${args.name}`)
        return { command: `/home ${args.name}` }
      }
    },
    {
      name: 'remember_place',
      description: 'Remember current position as a named place.',
      validate: validatePlaceArgs,
      execute: async (bot, args, options) => {
        if (!bot.entity?.position) return { ok: false, reason: 'position-unavailable' }
        return readPlaceCoordinates(args.name, options) ||
          rememberPlaceCoordinates(bot, args.name, bot.entity.position, options)
      }
    },
    {
      name: 'write_memory_event',
      description: 'Append a compact event to event-log.jsonl.',
      validate: validateMemoryEventArgs,
      execute: async (bot, args, options) => {
        const memoryPaths = resolveBotMemoryPaths(bot, options)
        const eventLogPath = options.eventLogPath || memoryPaths.eventLogPath
        const event = {
          at: options.now?.() || Date.now(),
          source: 'ai-npc-tool',
          type: args.type,
          message: args.message
        }
        fs.mkdirSync(path.dirname(eventLogPath), { recursive: true })
        fs.appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`)
        return { path: eventLogPath, event }
      }
    },
    {
      name: 'record_missing_tool',
      description: 'Record a missing capability in structured memory.',
      validate: validateMissingToolArgs,
      execute: async (bot, args, options) => {
        const memoryPaths = resolveBotMemoryPaths(bot, options)
        const record = recordMissingTool(args, {
          ...options,
          missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
        })
        const shared = options.sharedMissingToolsPath
          ? recordSharedMissingTool(args, options)
          : null
        return { record, shared }
      }
    },
    {
      name: 'read_missing_tools',
      description: 'Read top structured missing capabilities.',
      validate: passArgs,
      execute: async (bot, args, options) => {
        const memoryPaths = resolveBotMemoryPaths(bot, options)
        const limit = Math.max(1, Math.min(Number.parseInt(args.limit || 5, 10), 20))
        return readMissingTools({
          ...options,
          missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
        }).slice(0, limit)
      }
    }
  ]
}

function createAiNpcToolRegistry () {
  return new Map(toolDefinitions().map(tool => [tool.name, tool]))
}

function listAiNpcTools (registry = createAiNpcToolRegistry()) {
  return [...registry.values()].map(tool => ({
    name: tool.name,
    description: tool.description
  }))
}

function validateAiNpcToolCall (toolCall, registry = createAiNpcToolRegistry()) {
  const tool = compactText(toolCall?.tool || toolCall?.name, '', 80)
  if (!registry.has(tool)) return { ok: false, tool, reason: 'unknown-tool' }
  const validation = registry.get(tool).validate(objectArgs(toolCall?.args))
  if (!validation.ok) return { ok: false, tool, reason: validation.reason }
  return { ok: true, tool, args: validation.args }
}

async function recordUnknownAiNpcTool (bot, toolCall, options = {}) {
  const memoryPaths = resolveBotMemoryPaths(bot, options)
  const tool = compactText(toolCall?.tool || toolCall?.name || 'unknown_tool', 'unknown_tool', 80)
  const blockedGoal = compactText(toolCall?.reason, 'Unknown NPC goal', 160)
  const record = recordMissingTool({
    capability: `Unknown tool: ${tool}`,
    desiredTool: tool,
    blockedGoal,
    reason: blockedGoal,
    priority: 'medium',
    context: {
      args: objectArgs(toolCall?.args)
    }
  }, {
    ...options,
    missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
  })
  return {
    ok: false,
    tool,
    reason: 'unknown-tool',
    missingTool: record
  }
}

async function executeAiNpcTool (bot, toolCall, options = {}) {
  const registry = options.toolRegistry || createAiNpcToolRegistry()
  const validation = validateAiNpcToolCall(toolCall, registry)
  if (!validation.ok) {
    if (validation.reason === 'unknown-tool') return recordUnknownAiNpcTool(bot, toolCall, options)
    return {
      ok: false,
      tool: validation.tool,
      reason: validation.reason
    }
  }

  const definition = registry.get(validation.tool)
  const result = await definition.execute(bot, validation.args, options)
  if (result?.ok === false) {
    return {
      ok: false,
      tool: validation.tool,
      reason: result.reason,
      result
    }
  }

  return {
    ok: true,
    tool: validation.tool,
    result
  }
}

module.exports = {
  createAiNpcToolRegistry,
  executeAiNpcTool,
  isAllowedSafeCommand,
  listAiNpcTools,
  normalizeCommand,
  validateAiNpcToolCall
}
