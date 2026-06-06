const { AI_NPC_IDLE_INTERVAL_MS } = require('./config')

const DEFAULT_AI_NPC_EVENT_COOLDOWN_MS = 60000
const DEFAULT_AI_NPC_SPAWN_THINK_DELAY_MS = 15000
const LOW_HEALTH_THINK_THRESHOLD = 10
const LOW_FOOD_THINK_THRESHOLD = 10

function isObviouslyBusyForAiNpc (bot, options = {}) {
  const now = options.now || (() => Date.now())
  const currentTime = now()

  return Boolean(
    !bot ||
    bot._ended ||
    bot.currentWindow ||
    bot.isSleeping ||
    bot.__autoEating ||
    bot.__nightSafetyActive ||
    bot.pvp?.target ||
    (bot.__combatActiveUntil && bot.__combatActiveUntil > currentTime)
  )
}

function shouldTriggerForHealth (bot) {
  return (
    (typeof bot?.health === 'number' && bot.health <= LOW_HEALTH_THINK_THRESHOLD) ||
    (typeof bot?.food === 'number' && bot.food <= LOW_FOOD_THINK_THRESHOLD)
  )
}

function callUnref (timer) {
  if (typeof timer?.unref === 'function') timer.unref()
}

function attachAiNpcScheduler (bot, controller, options = {}) {
  const debugLog = options.debugLog || (() => {})
  const errorOutput = options.errorOutput || console.error
  const now = options.now || (() => Date.now())
  const eventCooldownMs = options.eventCooldownMs ?? DEFAULT_AI_NPC_EVENT_COOLDOWN_MS
  const idleIntervalMs = options.idleIntervalMs ?? AI_NPC_IDLE_INTERVAL_MS
  const spawnDelayMs = options.spawnDelayMs ?? DEFAULT_AI_NPC_SPAWN_THINK_DELAY_MS
  const setSchedulerInterval = options.setInterval || setInterval
  const clearSchedulerInterval = options.clearInterval || clearInterval
  const setSchedulerTimeout = options.setTimeout || setTimeout
  const clearSchedulerTimeout = options.clearTimeout || clearTimeout
  const shouldThink = options.shouldThink || (() => !isObviouslyBusyForAiNpc(bot, { now }))
  const runNow = controller?.runNow
  const lastTriggeredAt = new Map()
  const pendingTimeouts = new Set()
  let stopped = false
  let running = false
  let idleTimer = null

  async function trigger (reason = 'manual') {
    const triggerReason = String(reason || 'manual')
    if (stopped) return { ok: true, skipped: true, reason: 'stopped', trigger: triggerReason }
    if (typeof runNow !== 'function') return { ok: false, skipped: true, reason: 'unavailable', trigger: triggerReason }
    if (!shouldThink(triggerReason)) return { ok: true, skipped: true, reason: 'busy', trigger: triggerReason }
    if (running) return { ok: true, skipped: true, reason: 'running', trigger: triggerReason }

    const currentTime = now()
    const previousTime = lastTriggeredAt.get(triggerReason)
    if (
      eventCooldownMs > 0 &&
      typeof previousTime === 'number' &&
      currentTime - previousTime < eventCooldownMs
    ) {
      return { ok: true, skipped: true, reason: 'cooldown', trigger: triggerReason }
    }

    lastTriggeredAt.set(triggerReason, currentTime)
    running = true
    debugLog('aiNpcScheduler.trigger', { reason: triggerReason })

    try {
      const result = await runNow({ reason: triggerReason })
      return {
        ok: result?.ok !== false,
        skipped: false,
        reason: triggerReason,
        result
      }
    } catch (err) {
      errorOutput(`AI NPC scheduler error (${triggerReason}): ${err.message}`)
      debugLog('aiNpcScheduler.error', {
        reason: triggerReason,
        message: err.message,
        stack: err.stack
      })
      return {
        ok: false,
        skipped: false,
        reason: triggerReason,
        error: err.message
      }
    } finally {
      running = false
    }
  }

  function scheduleDelayedTrigger (reason, delayMs) {
    if (stopped) return null

    const timer = setSchedulerTimeout(async () => {
      pendingTimeouts.delete(timer)
      await trigger(reason)
    }, Math.max(0, delayMs))

    pendingTimeouts.add(timer)
    callUnref(timer)
    return timer
  }

  function onSpawn () {
    scheduleDelayedTrigger('spawn', spawnDelayMs)
  }

  function onDeath () {
    trigger('death')
  }

  function onHealth () {
    if (shouldTriggerForHealth(bot)) trigger('low-survival')
  }

  function stop () {
    if (stopped) return
    stopped = true

    if (idleTimer) {
      clearSchedulerInterval(idleTimer)
      idleTimer = null
    }

    for (const timer of pendingTimeouts) {
      clearSchedulerTimeout(timer)
    }
    pendingTimeouts.clear()

    bot?.removeListener?.('spawn', onSpawn)
    bot?.removeListener?.('death', onDeath)
    bot?.removeListener?.('health', onHealth)
  }

  if (idleIntervalMs > 0 && typeof setSchedulerInterval === 'function') {
    idleTimer = setSchedulerInterval(() => trigger('idle'), idleIntervalMs)
    callUnref(idleTimer)
  }

  bot?.on?.('spawn', onSpawn)
  bot?.on?.('death', onDeath)
  bot?.on?.('health', onHealth)
  bot?.once?.('end', stop)
  bot?.once?.('kicked', stop)

  return {
    stop,
    trigger
  }
}

module.exports = {
  DEFAULT_AI_NPC_EVENT_COOLDOWN_MS,
  DEFAULT_AI_NPC_SPAWN_THINK_DELAY_MS,
  LOW_FOOD_THINK_THRESHOLD,
  LOW_HEALTH_THINK_THRESHOLD,
  attachAiNpcScheduler,
  isObviouslyBusyForAiNpc
}
