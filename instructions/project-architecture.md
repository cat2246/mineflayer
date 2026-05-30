# Project Architecture

This workspace contains two layers:

- Mineflayer library code in `index.js`, `index.d.ts`, `lib/`, `docs/`,
  `examples/`, `test/`, and `versions/`.
- A local Minecraft bot app in `bot.js` and `src/`.

The official upstream is `https://github.com/PrismarineJS/mineflayer`. This
checkout is 4.37.1, supports tested versions through 1.21.11, and the package
metadata requires Node >= 22. If an external example or older link disagrees
with this checkout, follow the local code and current `docs/` files.

## Runtime Entry Points

- `bot.js` loads `./src` and calls `start()` when executed directly.
- `src/index.js` re-exports all local bot modules.
- `src/createBot.js` is the composition root:
  - builds options from `src/config.js`;
  - creates the Mineflayer bot;
  - loads `mineflayer-pathfinder`;
  - loads `mineflayer-pvp` through a compatibility wrapper that rewrites the
    deprecated `physicTick` event to `physicsTick`;
  - configures conservative pathfinder movement after `spawn`;
  - attaches logging, death recovery, auto eating, automation manager, follow,
    knockback pause, night safety, combat, AI chat, console commands, and
    shutdown handlers.

Keep new app behavior in a focused `src/<feature>.js` module and attach it from
`src/createBot.js` only when it should run for every bot.

## Local Bot Conventions

- Use CommonJS and StandardJS formatting: no semicolons, 2-space indentation,
  single quotes unless a string needs interpolation.
- Export pure helpers for testability. The existing modules expose functions
  such as `attachAutoEat`, `attachCombat`, `createAutomationManager`, and
  `startWoodCuttingAutomation`.
- Accept injectable options for timers, loggers, output functions, and helper
  implementations. This keeps tests fast and avoids real server work.
- Prefer `debugLog(eventName, data)` for internal trace details and concise
  `console.log` or chat output for user-visible events.
- Do not add secrets to source. `src/config.js` currently has defaults for the
  local server, but new credentials or passwords should come from environment
  variables.

## Movement And Automation Ownership

Movement is shared by pathfinder, PVP, knockback recovery, auto eating, night
safety, woodcutting, farming, wild roaming, and follow mode. Before a module
takes control:

- stop pathfinder with `bot.pathfinder.setGoal(null)` when available;
- call `bot.pathfinder.stop()` when a graceful stop is enough;
- clear or restore control states using `bot.clearControlStates()` or
  `bot.setControlState(control, false)`;
- respect flags already used by the app, including `bot._ended`,
  `bot.__autoEating`, `bot.__combatActiveUntil`, `bot.__nightSafetyActive`,
  `bot.__movementPausedUntil`, `bot.isSleeping`, `bot.currentWindow`, and
  `bot.pvp?.target`;
- use `shouldStop` callbacks in long loops and check them between every awaited
  action.

Pathfinder is configured conservatively in `configureConservativeMovements`:
`canDig`, sprinting, parkour, 1x1 towers, and door opening are disabled, and
drop-down distance is limited. Keep this default unless the feature explicitly
needs a more permissive movement profile.

## Mineflayer Library Shape

The library entry point is `index.js`, which delegates to `lib/loader.js`.
`createBot(options)` creates an EventEmitter bot, installs the plugin loader,
loads internal plugins, creates or accepts a `minecraft-protocol` client, then
initializes `bot.registry`, `bot.version`, `bot.majorVersion`,
`bot.protocolVersion`, and `bot.supportFeature`.

Internal plugins live in `lib/plugins/`. Each plugin exports a function
`inject(bot, options)` and adds methods, properties, events, or packet handlers
to the bot. The plugin loader guarantees plugins are injected after
`inject_allowed`; `bot.loadPlugin`, `bot.loadPlugins`, and `bot.hasPlugin` are
available for external plugins too.

When changing library-level behavior:

- update or add the matching internal plugin under `lib/plugins/`;
- keep `index.d.ts` synchronized with public JS behavior;
- update `docs/api.md` and run DocToc if the table of contents is affected;
- add an external test for vanilla-server behavior or an internal test for
  protocol-level behavior.
