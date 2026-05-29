# Follow Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local commands that let the bot follow a player, collect nearby dropped items, notify the followed player when inventory or food is low, and unload inventory into a nearby chest.

**Architecture:** Add a focused `src/follow.js` controller with follow state, throttled teleport fallback, dropped-item pickup, and chest unloading helpers. Wire it into `src/createBot.js` and `src/commandConsole.js`, reusing the existing combat module for hostile mobs.

**Tech Stack:** Node.js CommonJS, Mineflayer, mineflayer-pathfinder goals, Mocha/assert tests.

---

### Task 1: Follow Controller Tests

**Files:**
- Modify: `test/botConfigTest.js`

- [ ] Write failing tests for `/follow`, `/unfollow`, throttled `/tpa`, pickup pathing, unload-to-chest, notifications, and `/help`.
- [ ] Run `npx mocha test/botConfigTest.js --grep "follow|unload|help"` and confirm the new tests fail because exports/commands do not exist yet.

### Task 2: Follow Controller Implementation

**Files:**
- Create: `src/follow.js`
- Modify: `src/index.js`
- Modify: `src/config.js`

- [ ] Implement `createFollowController(bot, options)` with `followPlayer`, `unfollow`, `tick`, `unloadInventory`, and `helpLines`.
- [ ] Use `bot.players[name]` to validate online players.
- [ ] Use `GoalFollow` when the player entity is visible.
- [ ] Use `/tpa <player>` only when the followed player is not visible and the cooldown has elapsed.
- [ ] Pickup nearest dropped item with `GoalNear` when not busy, inventory has room, and no current combat/eating/window task is active.
- [ ] Notify followed player when inventory is full or bot needs food, with a cooldown.
- [ ] Unload non-empty inventory slots into the nearest chest-like block using `bot.openContainer` and `container.deposit`.

### Task 3: Command and Startup Wiring

**Files:**
- Modify: `src/commandConsole.js`
- Modify: `src/createBot.js`

- [ ] Inject or create the follow controller in `createCommandConsole`.
- [ ] Handle `/follow <player>`, `/unfollow`, `/unload inventory`, and `/help` locally.
- [ ] Attach the follow controller during bot startup so it runs continuously while connected.

### Task 4: Verification

**Files:**
- Modify as needed from Tasks 1-3 only.

- [ ] Run `npx mocha test/botConfigTest.js --grep "follow|unload|help"` and confirm it passes.
- [ ] Run `npm test` if the focused tests pass.
- [ ] Run `git diff --check`.
