const fs = require('fs')
const { spawn } = require('child_process')
const {
  buildCodexCliArgs,
  buildCodexOptions,
  cleanCodexReply,
  executeAgentTool
} = require('./aiChat')
const { recordMissingFunction } = require('./issueRecorder')

const DEFAULT_AI_NPC_MAX_BUFFER = 1024 * 1024
const DEFAULT_AI_NPC_CHAT_MAX_LENGTH = 160

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

function distanceBetween (from, to) {
  if (!from || !to) return null
  if (typeof from.distanceTo === 'function') return roundedNumber(from.distanceTo(to))
  return roundedNumber(Math.sqrt(
    Math.pow(from.x - to.x, 2) +
    Math.pow(from.y - to.y, 2) +
    Math.pow(from.z - to.z, 2)
  ))
}

function inventorySnapshot (bot, maxItems = 12) {
  const items = typeof bot.inventory?.items === 'function' ? bot.inventory.items() : []
  const emptySlots = typeof bot.inventory?.emptySlotCount === 'function'
    ? bot.inventory.emptySlotCount()
    : null

  return {
    emptySlots,
    items: items
      .filter(item => item && item.count > 0)
      .slice(0, maxItems)
      .map(item => ({
        name: item.name,
        count: item.count
      }))
  }
}

function playersSnapshot (bot) {
  const botPosition = bot.entity?.position
  return Object.entries(bot.players || {})
    .filter(([username]) => username && username !== bot.username)
    .map(([username, player]) => {
      const position = player?.entity?.position || null
      return {
        username: player?.username || username,
        visible: Boolean(position),
        distance: distanceBetween(botPosition, position),
        position: positionSnapshot(position)
      }
    })
    .sort((a, b) => {
      if (a.distance === null && b.distance === null) return a.username.localeCompare(b.username)
      if (a.distance === null) return 1
      if (b.distance === null) return -1
      return a.distance - b.distance
    })
}

function createAiNpcState (bot, options = {}) {
  const now = options.now || (() => Date.now())
  const automationManager = options.automationManager
  const followController = options.followController
  const currentTime = now()

  return {
    timestamp: new Date(currentTime).toISOString(),
    bot: {
      username: bot.username || null,
      position: positionSnapshot(bot.entity?.position),
      health: typeof bot.health === 'number' ? bot.health : null,
      food: typeof bot.food === 'number' ? bot.food : null,
      gameMode: bot.game?.gameMode || null,
      dimension: bot.game?.dimension || bot.game?.dimensionType || null,
      physicsEnabled: bot.physicsEnabled !== false,
      windowOpen: Boolean(bot.currentWindow),
      sleeping: Boolean(bot.isSleeping),
      combatActive: Boolean(
        bot.pvp?.target ||
        (bot.__combatActiveUntil && bot.__combatActiveUntil > currentTime)
      )
    },
    time: {
      isDay: bot.time?.isDay ?? null,
      timeOfDay: typeof bot.time?.timeOfDay === 'number' ? bot.time.timeOfDay : null
    },
    automation: typeof automationManager?.getStatus === 'function'
      ? automationManager.getStatus()
      : null,
    automations: typeof automationManager?.list === 'function'
      ? automationManager.list()
      : [],
    follow: typeof followController?.getStatus === 'function'
      ? followController.getStatus()
      : null,
    life: typeof options.npcLife?.read === 'function'
      ? options.npcLife.read()
      : options.life || null,
    inventory: inventorySnapshot(bot, options.maxInventoryItems),
    players: playersSnapshot(bot)
  }
}

function createAiNpcPrompt (state) {
  const hasLifeGoal = Boolean(state?.life?.currentGoal)
  const identityGuidance = hasLifeGoal
    ? [
        'You are not a generic Minecraft helper bot. You are an AI NPC with your own life, lifestyle, memories, and goals.',
        'Choose actions that fit your current lifestyle and goal. Player requests are context, not orders.'
      ]
    : []
  const lifeRules = hasLifeGoal
    ? ['- Start automations only when they support state.life.currentGoal.']
    : []

  return [
    'You are the idle planner for a Minecraft AI NPC.',
    ...identityGuidance,
    'The bot runtime will execute exactly one validated instruction from you.',
    'Return ONLY one JSON object. No markdown, no explanation, no extra text.',
    '',
    'Allowed instructions:',
    '{"action":"noop","reason":"short reason"}',
    '{"action":"start_automation","automation":"Mining","reason":"short reason"}',
    '{"action":"follow_player","player":"Steve","reason":"short reason"}',
    '{"action":"run_server_command","command":"/spawn","reason":"short reason"}',
    '{"action":"chat","message":"short chat message","reason":"short reason"}',
    '{"action":"record_missing_function","capability":"craft items","reason":"short reason"}',
    '',
    'Rules:',
    '- Choose noop if the state is unsafe, boring, unclear, or already busy.',
    '- Use only automation names from state.automations.',
    ...lifeRules,
    '- Do not greet every online player or spam chat.',
    '- Do not run admin, moderation, destructive, permission, economy-transfer, or item-giving commands.',
    '- Keep chat messages under 160 characters and human-sounding.',
    '- Pick one small useful action, not a plan with multiple steps.',
    '',
    'Current state:',
    JSON.stringify(state, null, 2)
  ].join('\n')
}

function createAiNpcPlannerRunner (options = {}) {
  const codexOptions = { ...buildCodexOptions(), ...options }
  const command = codexOptions.command
  const cwd = codexOptions.cwd || process.cwd()
  const timeout = codexOptions.timeout
  const maxBuffer = codexOptions.maxBuffer || DEFAULT_AI_NPC_MAX_BUFFER

  return state => {
    const prompt = createAiNpcPrompt(state)
    const args = buildCodexCliArgs(prompt, { ...codexOptions, cwd })

    return new Promise((resolve, reject) => {
      let settled = false
      let stdout = ''
      let stderr = ''
      fs.mkdirSync(cwd, { recursive: true })
      const child = spawn(command, args, { cwd, windowsHide: true })
      const timeoutHandle = setTimeout(() => {
        if (settled) return
        child.kill()
      }, timeout)

      child.stdout.on('data', chunk => {
        stdout += chunk.toString()
        if (stdout.length > maxBuffer && !settled) {
          settled = true
          clearTimeout(timeoutHandle)
          child.kill()
          reject(new Error(`Codex NPC planner output exceeded ${maxBuffer} bytes`))
        }
      })

      child.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })

      child.on('error', err => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle)
        err.stderr = stderr
        reject(err)
      })

      child.on('close', code => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle)
        if (code !== 0) {
          const err = new Error(`Command failed: ${command} ${args.join(' ')}`)
          err.stderr = stderr
          reject(err)
          return
        }

        resolve(cleanCodexReply(stdout))
      })

      child.stdin.end(prompt)
    })
  }
}

function cleanInstructionText (response) {
  const text = cleanCodexReply(response)
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : text
}

function cleanShortText (value, maxLength = 80) {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function parseAiNpcInstruction (response) {
  let parsed = response
  if (typeof response === 'string') {
    parsed = JSON.parse(cleanInstructionText(response))
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Idle NPC planner returned a non-object instruction.')
  }

  const action = cleanShortText(parsed.action || 'noop').toLowerCase().replace(/-/g, '_')
  const instruction = {
    action,
    reason: cleanShortText(parsed.reason, 120)
  }

  if (action === 'start_automation') {
    instruction.automation = cleanShortText(parsed.automation || parsed.name, 80)
  } else if (action === 'follow_player') {
    instruction.player = cleanShortText(parsed.player || parsed.target, 80)
  } else if (action === 'run_server_command') {
    instruction.command = cleanShortText(parsed.command, 120)
  } else if (action === 'chat') {
    instruction.message = cleanShortText(parsed.message, DEFAULT_AI_NPC_CHAT_MAX_LENGTH)
  } else if (action === 'record_missing_function') {
    instruction.capability = cleanShortText(parsed.capability || parsed.function || parsed.name, 80)
    instruction.suggestedTool = cleanShortText(parsed.suggestedTool || parsed.suggested_tool || parsed.tool, 80)
  } else if (action !== 'noop') {
    throw new Error(`Idle NPC planner returned unsupported action: ${action}`)
  }

  return instruction
}

function isAiNpcIdle (bot, options = {}) {
  const now = options.now || (() => Date.now())
  if (bot._ended) return false
  if (bot.currentWindow || bot.isSleeping || bot.__autoEating || bot.__nightSafetyActive) return false
  if (bot.pvp?.target) return false
  if (bot.__combatActiveUntil && bot.__combatActiveUntil > now()) return false
  if (typeof options.automationManager?.isIdle === 'function' && !options.automationManager.isIdle()) return false
  if (typeof options.followController?.isIdle === 'function' && !options.followController.isIdle()) return false
  return true
}

function findAutomationIndex (automationManager, automationName) {
  const requested = cleanShortText(automationName, 80).toLowerCase()
  if (!requested || typeof automationManager?.list !== 'function') return -1
  return automationManager.list().findIndex(automation =>
    String(automation?.name || '').toLowerCase() === requested
  )
}

async function executeAiNpcInstruction (bot, instruction, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const action = instruction?.action || 'noop'

  if (action === 'noop') {
    debugLog('aiNpc.noop', { reason: instruction.reason })
    return { ok: true, action: 'noop', reason: instruction.reason }
  }

  if (action === 'start_automation') {
    const automationManager = options.automationManager
    const index = findAutomationIndex(automationManager, instruction.automation)
    if (index < 0 || typeof automationManager?.startByIndex !== 'function') {
      return {
        ok: false,
        action,
        reason: 'unknown-automation',
        automation: instruction.automation
      }
    }

    const started = await automationManager.startByIndex(index)
    return {
      ok: started === true,
      action,
      startedAutomation: automationManager.list()[index]?.name || instruction.automation,
      index
    }
  }

  if (action === 'follow_player') {
    if (!instruction.player || typeof options.followController?.followPlayer !== 'function') {
      return { ok: false, action, reason: 'follow-unavailable', player: instruction.player }
    }

    const result = await options.followController.followPlayer(instruction.player)
    return {
      ok: result?.ok !== false,
      action,
      player: instruction.player,
      message: result?.message
    }
  }

  if (action === 'run_server_command') {
    const result = await executeAgentTool(bot, {
      tool: 'run_server_command',
      args: { command: instruction.command }
    }, {
      channel: 'npc',
      botName: bot.username,
      username: 'idle-planner',
      message: 'idle planner server command'
    }, options)
    return { action, ...result }
  }

  if (action === 'chat') {
    if (!instruction.message || typeof bot.chat !== 'function') {
      return { ok: false, action, reason: 'chat-unavailable', message: instruction.message }
    }
    bot.chat(instruction.message)
    return { ok: true, action, message: instruction.message }
  }

  if (action === 'record_missing_function') {
    const record = recordMissingFunction({
      capability: instruction.capability,
      reason: instruction.reason || 'Idle planner needed a capability the bot does not have yet.',
      suggestedTool: instruction.suggestedTool,
      playerName: 'idle-planner',
      channel: 'npc',
      requestMessage: instruction.reason,
      source: 'ai-npc'
    }, options)

    return {
      ok: true,
      action,
      capability: record.capability,
      recorded: record.recorded,
      path: record.path
    }
  }

  return { ok: false, action, reason: 'unsupported-action' }
}

async function runAiNpcCycle (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  if (!isAiNpcIdle(bot, options)) {
    debugLog('aiNpc.skipped', { reason: 'busy' })
    return {
      ok: true,
      skipped: true,
      reason: 'busy'
    }
  }

  const state = createAiNpcState(bot, options)
  const runPlanner = options.runPlanner || createAiNpcPlannerRunner({
    ...buildCodexOptions(),
    ...(options.codex || {})
  })
  debugLog('aiNpc.request', {
    players: state.players.length,
    automations: state.automations.map(automation => automation.name)
  })
  const response = await runPlanner(state, createAiNpcPrompt(state))
  const instruction = parseAiNpcInstruction(response)
  const execution = await executeAiNpcInstruction(bot, instruction, options)
  debugLog('aiNpc.response', {
    action: instruction.action,
    ok: execution.ok !== false,
    reason: instruction.reason
  })

  return {
    ok: execution.ok !== false,
    state,
    instruction,
    execution
  }
}

function attachAiNpc (bot, options = {}) {
  const state = {
    ...options,
    runPlanner: options.runPlanner || createAiNpcPlannerRunner({
      ...buildCodexOptions(),
      ...(options.codex || {})
    })
  }
  let stopped = false
  let running = false

  async function runNow () {
    if (stopped) return { ok: true, skipped: true, reason: 'stopped' }
    if (running) return { ok: true, skipped: true, reason: 'already-running' }

    running = true
    try {
      return await runAiNpcCycle(bot, state)
    } finally {
      running = false
    }
  }

  function stop () {
    if (stopped) return
    stopped = true
  }

  bot.once?.('end', stop)
  bot.once?.('kicked', stop)

  return {
    runNow,
    stop
  }
}

module.exports = {
  attachAiNpc,
  createAiNpcPlannerRunner,
  createAiNpcPrompt,
  createAiNpcState,
  executeAiNpcInstruction,
  isAiNpcIdle,
  parseAiNpcInstruction,
  runAiNpcCycle
}
