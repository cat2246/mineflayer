# Nearby AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let visible nearby players chat with the bot without mentioning its name, with opportunistic idle-only look-at behavior.

**Architecture:** Keep the change inside `src/aiChat.js`, where public chat filtering already lives. Add small pure helpers for nearby-player detection and busy-state checks, pass `automationManager` from `src/createBot.js`, and cover behavior in `test/botConfigTest.js`.

**Tech Stack:** Node.js CommonJS, Mineflayer bot entities, Mocha, `assert`, StandardJS.

---

### Task 1: Nearby Chat Tests

**Files:**
- Modify: `test/botConfigTest.js`

- [ ] **Step 1: Write failing tests**

Add tests under the existing `attachAiChat` cases:

```js
it('lets visible nearby players talk without mentioning the bot', async () => {
  const { attachAiChat } = require('../bot')
  const events = []
  const requests = []
  const bot = new EventEmitter()
  bot.username = 'TestBot123'
  bot.entity = { position: combatPosition(0, 64, 0) }
  bot.players = {
    Alex: {
      entity: {
        position: combatPosition(10, 64, 0)
      }
    }
  }
  bot.chat = message => events.push(['chat', message])
  bot.lookAt = async point => events.push(['lookAt', point.x, point.y, point.z])

  attachAiChat(bot, {
    memoryEnabled: false,
    runCodex: async request => {
      requests.push(request)
      return 'I can hear you from here.'
    }
  })

  bot.emit('chat', 'Alex', 'can you hear me?')
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))

  assert.strictEqual(requests.length, 1)
  assert.strictEqual(requests[0].username, 'Alex')
  assert.deepStrictEqual(events[0], ['lookAt', 10, 65.6, 0])
  assert.deepStrictEqual(events[1], ['chat', '@Alex I can hear you from here.'])
})
```

- [ ] **Step 2: Verify red**

Run: `npm run mocha_test -- --grep "visible nearby players talk without mentioning"`

Expected: FAIL because `requests.length` is `0`.

### Task 2: Nearby Chat Implementation

**Files:**
- Modify: `src/aiChat.js`
- Modify: `src/createBot.js`

- [ ] **Step 1: Add helpers and wire public filtering**

Add helper functions for finding a visible player entity, checking distance, checking busy look-at states, and attempting a non-forced look. Change `handlePublicMessage` so a message is processable when it mentions the bot or the sender is within `nearbyPlayerChatRange`.

- [ ] **Step 2: Pass automation manager**

Change `attachAiChat(bot, { debugLog })` in `src/createBot.js` to `attachAiChat(bot, { debugLog, automationManager })`.

- [ ] **Step 3: Verify green**

Run: `npm run mocha_test -- --grep "visible nearby players talk without mentioning"`

Expected: PASS.

### Task 3: Busy State Regression Tests

**Files:**
- Modify: `test/botConfigTest.js`

- [ ] **Step 1: Write failing tests**

Add tests for far players being ignored and active automation skipping look-at while still processing nearby chat.

- [ ] **Step 2: Verify red/green**

Run the targeted AI chat grep and confirm all nearby chat tests pass after implementation.

### Task 4: Final Verification

**Files:**
- Read: `src/aiChat.js`
- Read: `test/botConfigTest.js`

- [ ] **Step 1: Run focused tests**

Run: `npm run mocha_test -- --grep "nearby|visible nearby|automation is active"`

Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: PASS.
