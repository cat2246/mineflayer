# Mineflayer API Guide

Mineflayer is a high-level bot API built on `minecraft-protocol` and the
Prismarine ecosystem. Favor stable Mineflayer methods over raw packet work.

## Bot Creation And Lifecycle

Create bots with `mineflayer.createBot(options)`. Common options include:

- `host`, `port`, `username`, `password`, `auth`, and `version`;
- `auth: 'offline'` for offline-mode servers, `auth: 'microsoft'` for Microsoft
  account login;
- `version: false` for auto-detection, or an explicit tested version when a
  server/proxy needs it;
- `checkTimeoutInterval`, `closeTimeout`, and `keepAlive` for laggy servers;
- `hideErrors` and `logErrors` to control default error logging;
- `respawn: false` if the app wants manual `bot.respawn()`;
- `physicsEnabled: false` when local code wants to delay physics until server
  login/setup is complete;
- `plugins` and `loadInternalPlugins` for enabling, disabling, or overriding
  plugins.

Important events:

- `login`: connected and logged in;
- `spawn`: bot entity and world state are usable;
- `messagestr`, `message`, `chat`, `whisper`, `actionBar`: chat surfaces;
- `health`, `death`, `respawn`, `kicked`, `end`, `error`: lifecycle and safety;
- `entitySpawn`, `entityMoved`, `entityGone`, `entityHurt`, `playerJoined`,
  `playerLeft`: entity/player tracking;
- `blockUpdate`, `chunkColumnLoad`, `chunkColumnUnload`: world changes;
- `windowOpen`, `windowClose`: inventory windows;
- `physicsTick`: repeated movement/automation tick.

Most bot actions are promise-based in modern Mineflayer. Use `async/await`,
catch errors around server-sensitive actions, and avoid callback-era patterns
from old examples unless editing legacy code.

## Version-Safe Data Access

Use `bot.registry` for Minecraft data. It exposes version-specific blocks,
items, foods, entities, biomes, recipes, packets, language, and feature flags.

Useful patterns:

```js
const block = bot.registry.blocksByName.oak_log
const item = bot.registry.itemsByName.apple
if (bot.supportFeature('signedChat')) {
  // version-specific behavior
}
```

Do not assume names, IDs, packet fields, inventory windows, chat shape, world
height, dimension format, or block/item relationships are stable across
versions. Prefer registry names and feature flags over numeric IDs.

## World And Entity APIs

Use:

- `bot.blockAt(pos, extraInfos = true)` for loaded blocks;
- `bot.findBlocks({ point, matching, maxDistance, count, useExtraInfo })` for
  coordinates, and `bot.findBlock(...)` for one block;
- `bot.blockAtCursor(maxDistance)` and `bot.entityAtCursor(maxDistance)` for
  raycast targeting;
- `bot.canSeeBlock(block)`, `bot.canDigBlock(block)`, and `bot.digTime(block)`;
- `bot.entities`, `bot.players`, and `bot.nearestEntity(match)`.

Guard every access to world state. Blocks can be `null` when chunks are not
loaded, player entities can be absent, and entity positions can become invalid
around death, teleport, or dimension changes.

## Movement And Pathfinder

Core movement uses:

- `bot.setControlState(control, state)`;
- `bot.getControlState(control)`;
- `bot.clearControlStates()`;
- `bot.lookAt(point, force)` and `bot.look(yaw, pitch, force)`.

Use `mineflayer-pathfinder` for navigation. Load the plugin once, create a
`Movements(bot)` instance after `spawn`, tune movement flags, then call:

- `bot.pathfinder.setMovements(movements)`;
- `bot.pathfinder.goto(goal)` for a promise that resolves when reached;
- `bot.pathfinder.setGoal(goal, dynamic)` for ongoing goals such as follow;
- `bot.pathfinder.stop()` or `bot.pathfinder.setGoal(null)` to cancel;
- `bot.pathfinder.bestHarvestTool(block)` for tool selection.

Common goals include `GoalNear`, `GoalBlock`, `GoalGetToBlock`,
`GoalFollow`, `GoalNearXZ`, `GoalLookAtBlock`, and composite goals. For server
safety, set conservative movement options unless a feature explicitly needs
digging, placing, parkour, sprinting, or door opening.

## Inventory, Windows, And Items

High-level inventory methods:

- `bot.inventory.items()`, `bot.inventory.slots`, and
  `bot.inventory.emptySlotCount()`;
- `bot.equip(itemOrType, destination)` and `bot.unequip(destination)`;
- `bot.tossStack(item)` and `bot.toss(itemType, metadata, count)`;
- `bot.consume()`, `bot.activateItem(offHand)`, and `bot.deactivateItem()`;
- `bot.craft(recipe, count, craftingTable)`;
- `bot.openContainer(blockOrEntity)`, `bot.openFurnace(block)`,
  `bot.openEnchantmentTable(block)`, `bot.openAnvil(block)`,
  `bot.openVillager(entity)`;
- lower-level `bot.clickWindow`, `bot.transfer`, `bot.moveSlotItem`, and
  `bot.closeWindow` when high-level helpers are insufficient.

Treat windows as exclusive state. Do not start combat, pathing, digging,
sleeping, or eating while `bot.currentWindow` is active unless the feature owns
that window. Always close windows or let cleanup run on error.

For NBT/lore, use `item.nbt` with `prismarine-nbt.simplify(...)` and
`prismarine-chat` for text conversion.

## Blocks, Digging, Placing, And Interaction

Use `await bot.waitForChunksToLoad()` before relying on nearby terrain after
spawn or teleport.

For digging:

- check `bot.targetDigBlock` to avoid concurrent digs;
- check `bot.canDigBlock(block)`;
- call `await bot.dig(block, forceLook, digFace)`;
- use `bot.stopDigging()` when cancelling;
- prefer `digFace: 'raycast'` on servers with anti-cheat when needed.

For placing/interacting:

- equip the correct item first;
- call `await bot.placeBlock(referenceBlock, faceVector)`;
- call `await bot.activateBlock(block, direction, cursorPos)` for doors,
  buttons, beds, containers, and similar interactions;
- use `bot.openContainer` instead of deprecated `openChest` or
  `openDispenser`.

Spawn protection, permissions, reach distance, unloaded chunks, and anti-cheat
can all make valid API calls fail. Handle errors without leaving movement keys
stuck.

## Chat And Commands

Use `bot.chat(message)` for public messages and commands. Mineflayer splits long
messages, but commands should not be blindly split. Use `bot.whisper(username,
message)` for private replies when available.

For parsing:

- prefer `messagestr` for custom server plugin messages and multiline parsing;
- use `bot.addChatPattern(name, regex, { parse, repeat })`;
- use `bot.addChatPatternSet(name, [regex...], options)` for multi-message
  sequences;
- avoid deprecated `bot.chatAddPattern` in new code;
- use `bot.awaitMessage(...)` for small, bounded waits and pass a timeout when
  a server response may never arrive.

For server commands, make command strings explicit and safe. Never invent
permissions or state that the bot has not observed.

## Combat And PVP

Core Mineflayer combat helpers include `bot.attack(entity)`,
`bot.activateItem`, `bot.deactivateItem`, `bot.useOn(entity)`, `bot.swingArm`,
and `bot.getExplosionDamages`.

The local app also loads `mineflayer-pvp`, which depends on pathfinder. Use
`bot.pvp.attack(entity)` for managed PVP/PVE and `bot.pvp.stop()` to cancel.
Manual combat should stop pathfinder first, choose a weapon from inventory,
look at the target head with `force: true`, and respect cooldown/timing logic.

Combat must yield to death, eating, sleeping, open windows, and current
automation stop signals.

## Lower-Level Protocol

`bot._client` is a `minecraft-protocol` client. It can read/write packets and
listen for low-level events, but it is explicitly unstable. Use it only when:

- Mineflayer lacks a stable API for the packet;
- packet shape is guarded by `bot.supportFeature(...)` or version data;
- listeners are removed on `end` or feature stop;
- tests cover every affected Minecraft version family.

Enable packet debugging with `DEBUG=minecraft-protocol node ...` on Unix-like
shells or `set DEBUG=minecraft-protocol` before `node ...` on Windows.

## Public API Changes

When adding or changing a Mineflayer public method, event, class, option, or
property:

- update JavaScript implementation and plugin exports;
- update `index.d.ts`;
- update `docs/api.md`;
- update examples if the old pattern is now wrong;
- update tests;
- run DocToc for `docs/api.md` if headings changed.
