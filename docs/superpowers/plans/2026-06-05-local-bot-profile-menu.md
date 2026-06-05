# Local Bot Profile Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded bot/server credentials with an ignored local profile store and an interactive startup menu.

**Architecture:** Add a focused profile store for local JSON data, a focused start-menu module for CLI flow, and keep Mineflayer runtime creation inside `src/createBot.js`. Move server login from hardcoded global credentials to per-session saved passwords that are sent on spawn and deduplicated against later prompts.

**Tech Stack:** Node.js CommonJS, built-in `fs`, `path`, `crypto`, `readline`, existing Mocha/assert tests, existing Mineflayer runtime.

---

## File Structure

- Create `src/profileStore.js`: local `data/bot-profiles.json` load/save, bot/server creation, per-bot/server password storage, and selected option building.
- Create `src/startMenu.js`: interactive CLI menus plus small pure option helpers for tests.
- Modify `src/config.js`: remove real default host, username, and server login password; keep safe runtime defaults.
- Modify `src/createBot.js`: make `start()` open the menu and pass runtime login metadata to event logging.
- Modify `src/eventLogging.js`: remove default-host spawn log and attach login-prompt handling.
- Modify `src/survival.js`: remove global default login command behavior.
- Modify `test/botConfigTest.js`: add red tests first, then update old credential-default tests.
- Keep `.gitignore`: verify `data` remains ignored.

## Task 1: Profile Store

**Files:**
- Create: `src/profileStore.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing tests**

Add tests for empty local stores, offline/online bot creation, server creation, password save/read, and selected Mineflayer options. Run `npx mocha test/botConfigTest.js --grep "profile store|selected profile"` and expect module-not-found failures before implementation.

- [ ] **Step 2: Implement minimal store**

Create `createProfileStore`, `buildBotOptionsFromProfileSelection`, `getLoginKey`, and constants for `data/bot-profiles.json` and `data/auth`.

- [ ] **Step 3: Verify**

Run `npx mocha test/botConfigTest.js --grep "profile store|selected profile"` and expect all profile tests to pass.

## Task 2: Interactive Menu

**Files:**
- Create: `src/startMenu.js`
- Modify: `src/createBot.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing tests**

Add tests for main menu options with and without bots, server menu options with and without servers, and a scripted menu flow that starts a selected bot/server with a saved password.

- [ ] **Step 2: Implement menu**

Use built-in `readline` to show numbered options, loop back after create actions, and call a supplied `createBot` only after bot and server selection.

- [ ] **Step 3: Wire startup**

Change `start()` to start the log terminal, then call `startInteractiveMenu` instead of creating a bot immediately.

- [ ] **Step 4: Verify**

Run `npx mocha test/botConfigTest.js --grep "start menu"` and expect all menu tests to pass.

## Task 3: Saved Server Login

**Files:**
- Modify: `src/eventLogging.js`
- Modify: `src/survival.js`
- Modify: `src/createBot.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing tests**

Add tests proving `/login <password>` is sent on spawn when a saved password exists, prompt-only handling can still send after a login prompt, and no login is sent when no saved password exists.

- [ ] **Step 2: Implement prompt handler**

Add `isServerLoginPrompt` and `attachServerLoginPromptHandler`, call `loginToServer` on spawn when configured, and pass `serverLoginPassword` through `createBot` runtime options without sending it to Mineflayer.

- [ ] **Step 3: Remove old immediate login**

Delete hardcoded first-spawn auto-login from `attachEventLogging`; keep saved-password spawn login, viewer, physics, and `/survival` behavior.

- [ ] **Step 4: Verify**

Run `npx mocha test/botConfigTest.js --grep "server login prompt|logs into the server"` and update obsolete tests to match prompt-based behavior.

## Task 4: Remove Tracked Credentials

**Files:**
- Modify: `src/config.js`
- Modify: `src/eventLogging.js`
- Test: `test/botConfigTest.js`

- [ ] **Step 1: Write failing tests**

Update config tests to assert `buildBotOptions` throws without explicit credentials and accepts explicit env host/username/auth/version.

- [ ] **Step 2: Remove real defaults**

Remove hardcoded server host, username, and login command constants. Keep `DEFAULT_PORT`, `DEFAULT_AUTH`, and `DEFAULT_BOT_VERSION`.

- [ ] **Step 3: Verify no credential strings remain**

Run a repository search for the removed real username, server host, and login password fragments and expect no matches.

## Task 5: Full Verification

**Files:**
- All touched files

- [ ] **Step 1: Run focused tests**

Run `npx mocha test/botConfigTest.js`.

- [ ] **Step 2: Run lint if feasible**

Run `npm run lint`. If markdown lint fails due existing docs formatting outside this change, report it with evidence.

- [ ] **Step 3: Inspect git diff**

Run `git diff -- src test docs/superpowers .gitignore` and verify only intended files changed.
