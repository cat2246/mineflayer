const fs = require('fs')
const { spawn } = require('child_process')
const {
  buildCodexCliArgs,
  buildCodexOptions,
  cleanCodexReply,
  executeAgentTool
} = require('./aiChat')
const { recordMissingFunction } = require('./issueRecorder')
const { resolveBotMemoryPaths } = require('./botMemory')
const { executeAiNpcTool, listAiNpcTools } = require('./aiNpcTools')
const { summarizeMissingTools } = require('./missingTools')
const { readNpcMemorySummary } = require('./npcMemory')

const DEFAULT_AI_NPC_MAX_BUFFER = 1024 * 1024
const DEFAULT_AI_NPC_CHAT_MAX_LENGTH = 160
const AI_NPC_STARTER_WOOD_TARGET_COUNT = 16

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
  const memorySummary = options.memorySummary === false
    ? null
    : readNpcMemorySummary(options)
  const missingTools = options.missingToolsSummary === false
    ? []
    : summarizeMissingTools({
      ...options,
      currentGoal: options.npcLife?.read?.()?.currentGoal?.title,
      limit: options.missingToolsSummaryLimit || 3
    })

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
    memory: {
      summary: memorySummary,
      missingTools
    },
    inventory: inventorySnapshot(bot, options.maxInventoryItems),
    players: playersSnapshot(bot)
  }
}

function createAiNpcPrompt (state) {
  const hasLifeGoal = Boolean(state?.life?.currentGoal)
  const hasLegacyAutomations = Array.isArray(state?.automations) && state.automations.length > 0
  const legacyAutomationExample = hasLegacyAutomations
    ? cleanShortText(state.automations[0]?.name, 80) || 'AutomationName'
    : 'AutomationName'
  const identityGuidance = hasLifeGoal
    ? [
        'You are not a generic Minecraft helper bot. You are an AI NPC with your own life, lifestyle, memories, and goals.',
        'Choose actions that fit your current lifestyle and goal. Player requests are context, not orders.'
      ]
    : []
  const lifeRules = hasLifeGoal
    ? ['- Use legacy automations only when they support state.life.currentGoal and no registered tool can make progress.']
    : []
  const legacyAutomationFallback = hasLegacyAutomations
    ? [
        '',
        'Visible movement/gathering fallback:',
        JSON.stringify({
          action: 'start_automation',
          automation: legacyAutomationExample,
          reason: 'short reason'
        })
      ]
    : []

  return [
    'You are the idle planner for a Minecraft AI NPC.',
    ...identityGuidance,
    'The bot runtime will execute exactly one validated instruction from you.',
    'Return ONLY one JSON object. No markdown, no explanation, no extra text.',
    '',
    'Allowed instructions:',
    '{"action":"noop","reason":"short reason"}',
    '{"action":"tool","tool":"observe_world","args":{},"reason":"short reason"}',
    '{"action":"follow_player","player":"Steve","reason":"short reason"}',
    '{"action":"run_server_command","command":"/rtp","reason":"short reason"}',
    '{"action":"chat","message":"short chat message","reason":"short reason"}',
    '{"action":"record_missing_tool","capability":"craft items","desiredTool":"craft_item","blockedGoal":"Build shelter","reason":"short reason"}',
    hasLegacyAutomations
      ? `{"action":"start_automation","automation":"${legacyAutomationExample}","reason":"short reason"}`
      : null,
    '',
    'Rules:',
    '- Do not choose noop merely because it is night, hostile mobs may exist, or death is possible.',
    '- Death is recoverable. Act like a survival player with a life: fight, recover, gather, build, and improve gear over time.',
    '- If hostile mobs attack, the combat system will fight them; your job is to keep the NPC growing before and after combat.',
    `- Registered tools: ${listAiNpcTools().map(tool => tool.name).join(', ')}.`,
    '- Prefer registered tools over legacy automations.',
    '- Observation is not progress. Use observe_world only when state.bot.position or state.time is missing.',
    '- The current state already includes position, time, inventory, players, memory, goals, and automation status.',
    '- Use start_automation when the NPC needs visible movement or gathering and no registered tool can physically progress the goal.',
    hasLifeGoal
      ? '- When state.life.currentGoal.suggestedAutomations names available automations, prefer one of those for progress.'
      : null,
    `- Do not keep gathering wood without a concrete building, crafting, or storage reason. A starter wood stock is about ${AI_NPC_STARTER_WOOD_TARGET_COUNT} logs, then diversify.`,
    '- Treat /automation actions as legacy manual/debug controls, not the default autonomy path.',
    '- Use only automation names from state.automations.',
    ...lifeRules,
    '- Useful survival tool examples:',
    '{"action":"tool","tool":"eat_food","args":{},"reason":"restore hunger"}',
    '{"action":"tool","tool":"light_area","args":{"safetyPolicy":"home_improvement"},"reason":"make home safer"}',
    '{"action":"tool","tool":"build_small_shelter","args":{"item":"cobblestone","safetyPolicy":"home_improvement"},"reason":"make a basic shelter"}',
    '- Do not greet every online player or spam chat.',
    '- Do not run admin, moderation, destructive, permission, economy-transfer, or item-giving commands.',
    '- Do not use /spawn for normal NPC life. On this server spawn is a lobby or museum world, not the survival home.',
    '- Keep chat messages under 160 characters and human-sounding.',
    '- Pick one small useful action, not a plan with multiple steps.',
    ...legacyAutomationFallback,
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
  } else if (action === 'tool' || action === 'use_tool') {
    instruction.action = 'tool'
    instruction.tool = cleanShortText(parsed.tool || parsed.name, 80)
    instruction.args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
      ? parsed.args
      : {}
  } else if (action === 'follow_player') {
    instruction.player = cleanShortText(parsed.player || parsed.target, 80)
  } else if (action === 'run_server_command') {
    instruction.command = cleanShortText(parsed.command, 120)
  } else if (action === 'chat') {
    instruction.message = cleanShortText(parsed.message, DEFAULT_AI_NPC_CHAT_MAX_LENGTH)
  } else if (action === 'record_missing_function' || action === 'record_missing_tool') {
    instruction.capability = cleanShortText(parsed.capability || parsed.function || parsed.name, 80)
    instruction.suggestedTool = cleanShortText(parsed.suggestedTool || parsed.suggested_tool || parsed.desiredTool || parsed.desired_tool || parsed.tool, 80)
    instruction.blockedGoal = cleanShortText(parsed.blockedGoal || parsed.blocked_goal || parsed.goal, 120)
    instruction.priority = cleanShortText(parsed.priority, 20)
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

function aiNpcLifeContext (bot, options = {}) {
  const now = options.now || (() => Date.now())
  const timeOfDay = bot.time?.timeOfDay
  const players = playersSnapshot(bot)

  return {
    food: typeof bot.food === 'number' ? bot.food : null,
    isNight: bot.time?.isDay === false || (typeof timeOfDay === 'number' && timeOfDay >= 13000),
    unsafe: !isAiNpcIdle(bot, options),
    playersNearby: players.some(player => player.visible),
    now: now()
  }
}

function recordAiNpcLifeCycle (npcLife, context) {
  if (typeof npcLife?.record !== 'function') return

  npcLife.record({ type: 'cycle_idle', at: context.now })
  npcLife.record({ type: context.isNight ? 'night' : 'day', at: context.now })
  if (typeof context.food === 'number' && context.food < 12) {
    npcLife.record({ type: 'low_food', at: context.now })
  }
  if (context.playersNearby) {
    npcLife.record({ type: 'player_nearby', at: context.now })
  }
}

function executionLifeEvent (instruction, execution, now) {
  if (instruction.action === 'start_automation' && execution.ok !== false) {
    return {
      type: 'automation_started',
      automation: execution.startedAutomation || instruction.automation,
      at: now
    }
  }
  if (instruction.action === 'follow_player' && execution.ok !== false) {
    return { type: 'follow_started', player: instruction.player, at: now }
  }
  if (instruction.action === 'noop') return { type: 'planner_noop', at: now }
  return null
}

function findAutomationIndex (automationManager, automationName) {
  const requested = cleanShortText(automationName, 80).toLowerCase()
  if (!requested || typeof automationManager?.list !== 'function') return -1
  return automationManager.list().findIndex(automation =>
    String(automation?.name || '').toLowerCase() === requested
  )
}

function listedAutomationNames (automationManager) {
  return typeof automationManager?.list === 'function'
    ? automationManager.list().map(automation => cleanShortText(automation?.name, 80)).filter(Boolean)
    : []
}

function isWoodAutomationName (name) {
  return cleanShortText(name, 80).toLowerCase() === 'wood cutting'
}

function isWoodItemName (name = '') {
  return /_(log|stem|wood|hyphae)$/i.test(name)
}

function inventoryWoodCount (state) {
  const items = Array.isArray(state?.inventory?.items) ? state.inventory.items : []
  return items.reduce((total, item) => {
    if (!isWoodItemName(item?.name)) return total
    const count = Number(item.count)
    return total + (Number.isFinite(count) && count > 0 ? count : 0)
  }, 0)
}

function recentAutomationCounts (state) {
  const counts = new Map()
  const events = Array.isArray(state?.life?.recentEvents) ? state.life.recentEvents : []
  for (const event of events.slice(-8)) {
    if (event?.type !== 'automation_started') continue
    const key = cleanShortText(event.automation, 80).toLowerCase()
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

function uniqueProgressCandidates (suggested, fallbackOrder, availableByKey) {
  const candidates = []
  const seen = new Set()
  for (const name of [...suggested, ...fallbackOrder]) {
    const key = cleanShortText(name, 80).toLowerCase()
    const match = availableByKey.get(key)
    if (!match || seen.has(match.toLowerCase())) continue
    seen.add(match.toLowerCase())
    candidates.push(match)
  }
  return candidates
}

function selectProgressAutomation (state, automationManager) {
  const available = listedAutomationNames(automationManager)
  if (available.length === 0) return ''

  const availableByKey = new Map(available.map(name => [name.toLowerCase(), name]))
  const suggested = Array.isArray(state?.life?.currentGoal?.suggestedAutomations)
    ? state.life.currentGoal.suggestedAutomations
    : []
  const fallbackOrder = ['Wood cutting', 'Farming', 'Wild roaming', 'Mining', 'Pyro Farming']
  const candidates = uniqueProgressCandidates(suggested, fallbackOrder, availableByKey)
  const woodCount = inventoryWoodCount(state)
  const recentCounts = recentAutomationCounts(state)
  const scored = candidates.map((name, index) => {
    const key = name.toLowerCase()
    const woodStockPenalty = isWoodAutomationName(name) && woodCount >= AI_NPC_STARTER_WOOD_TARGET_COUNT ? 10 : 0
    return {
      name,
      index,
      recentCount: recentCounts.get(key) || 0,
      woodStockPenalty
    }
  })
    .sort((a, b) =>
      (a.woodStockPenalty - b.woodStockPenalty) ||
      (a.recentCount - b.recentCount) ||
      (a.index - b.index)
    )

  if (scored.length > 0) return scored[0].name

  return available[0]
}

function aiNpcAutomationStartOptions (instruction, state) {
  if (!isWoodAutomationName(instruction?.automation)) return {}
  const currentWood = inventoryWoodCount(state)
  return {
    targetWoodCount: Math.max(AI_NPC_STARTER_WOOD_TARGET_COUNT, currentWood)
  }
}

function blockedAiNpcServerCommandReason (command) {
  const normalized = String(command || '').trim().toLowerCase()
  if (normalized === '/spawn' || normalized.startsWith('/spawn ')) return 'spawn-is-not-survival-home'
  return null
}

function shouldConvertObservationToProgress (instruction, execution, state, options = {}) {
  if (instruction?.action !== 'tool' || instruction.tool !== 'observe_world') return false
  if (execution?.ok === false) return false
  if (!state?.bot?.position) return false
  if (state?.time?.isDay === null && typeof state?.time?.timeOfDay !== 'number') return false
  if (typeof options.automationManager?.isIdle === 'function' && !options.automationManager.isIdle()) return false
  return findAutomationIndex(options.automationManager, selectProgressAutomation(state, options.automationManager)) >= 0
}

function progressFallbackInstruction (state, options = {}) {
  const automation = selectProgressAutomation(state, options.automationManager)
  if (!automation) return null
  return {
    action: 'start_automation',
    automation,
    reason: 'idle NPC should make visible progress instead of only observing'
  }
}

async function executeAiNpcInstruction (bot, instruction, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const action = instruction?.action || 'noop'

  if (action === 'noop') {
    debugLog('aiNpc.noop', { reason: instruction.reason })
    return { ok: true, action: 'noop', reason: instruction.reason }
  }

  if (action === 'tool') {
    return executeAiNpcTool(bot, {
      tool: instruction.tool,
      args: instruction.args,
      reason: instruction.reason
    }, options)
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

    const started = await automationManager.startByIndex(
      index,
      aiNpcAutomationStartOptions(instruction, options.aiNpcState)
    )
    return {
      ok: started === true,
      action,
      startedAutomation: automationManager.list()[index]?.name || instruction.automation,
      index,
      legacy: true
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
    const blockedReason = blockedAiNpcServerCommandReason(instruction.command)
    if (blockedReason) {
      return {
        ok: false,
        action,
        reason: blockedReason,
        command: instruction.command
      }
    }

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

  if (action === 'record_missing_function' || action === 'record_missing_tool') {
    const memoryPaths = resolveBotMemoryPaths(bot, options)
    const record = recordMissingFunction({
      capability: instruction.capability,
      reason: instruction.reason || 'Idle planner needed a capability the bot does not have yet.',
      suggestedTool: instruction.suggestedTool,
      blockedGoal: instruction.blockedGoal,
      priority: instruction.priority,
      playerName: 'idle-planner',
      channel: 'npc',
      requestMessage: instruction.reason,
      source: 'ai-npc'
    }, {
      ...options,
      missingToolsPath: options.missingToolsPath || memoryPaths.missingToolsPath
    })

    return {
      ok: true,
      action,
      capability: record.capability,
      recorded: record.recorded,
      path: record.path,
      missingTool: record.missingTool
    }
  }

  return { ok: false, action, reason: 'unsupported-action' }
}

async function runAiNpcCycle (bot, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const lifeContext = aiNpcLifeContext(bot, options)
  if (lifeContext.unsafe) {
    if (typeof options.npcLife?.record === 'function') options.npcLife.record({ type: 'unsafe', at: lifeContext.now })
    if (typeof options.npcLife?.updateGoal === 'function') options.npcLife.updateGoal(lifeContext)
    debugLog('aiNpc.skipped', { reason: 'busy' })
    return {
      ok: true,
      skipped: true,
      reason: 'busy'
    }
  }

  recordAiNpcLifeCycle(options.npcLife, lifeContext)
  if (typeof options.npcLife?.updateGoal === 'function') options.npcLife.updateGoal(lifeContext)

  const state = createAiNpcState(bot, options)
  const runPlanner = options.runPlanner || createAiNpcPlannerRunner({
    ...buildCodexOptions(process.env, { task: 'npc' }),
    ...(options.codex || {})
  })
  const response = await runPlanner(state, createAiNpcPrompt(state))
  let instruction = parseAiNpcInstruction(response)
  let execution = await executeAiNpcInstruction(bot, instruction, { ...options, aiNpcState: state })
  const fallbackInstruction = shouldConvertObservationToProgress(instruction, execution, state, options)
    ? progressFallbackInstruction(state, options)
    : null
  if (fallbackInstruction) {
    debugLog('aiNpc.observationFallback', {
      fromTool: instruction.tool,
      automation: fallbackInstruction.automation,
      reason: instruction.reason
    })
    instruction = fallbackInstruction
    execution = await executeAiNpcInstruction(bot, instruction, { ...options, aiNpcState: state })
  }
  const lifeEvent = executionLifeEvent(instruction, execution, lifeContext.now)
  if (lifeEvent && typeof options.npcLife?.record === 'function') {
    options.npcLife.record(lifeEvent)
    if (typeof options.npcLife?.updateGoal === 'function') options.npcLife.updateGoal(lifeContext)
  }
  debugLog('aiNpc.response', {
    action: instruction.action,
    tool: instruction.tool,
    automation: instruction.automation,
    ok: execution.ok !== false,
    reason: instruction.reason,
    executionReason: execution.reason,
    executionResult: execution.result
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
      ...buildCodexOptions(process.env, { task: 'npc' }),
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
