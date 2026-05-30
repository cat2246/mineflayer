# Reference Map

This map condenses the official PrismarineJS/Mineflayer documentation and
ecosystem links into useful coding references. Use it when you need source
context before making a change.

## Primary Sources Read

- Official repo: `https://github.com/PrismarineJS/mineflayer`
- Workspace docs: `docs/README.md`, `docs/tutorial.md`, `docs/FAQ.md`,
  `docs/api.md`, `docs/unstable_api.md`, `docs/CONTRIBUTING.md`,
  `docs/history.md`, `docs/demos.md`
- Workspace code: `index.js`, `lib/loader.js`, `lib/plugin_loader.js`,
  `lib/version.js`, `lib/plugins/*`, `src/*`, `test/internalTest.js`,
  `test/externalTest.js`, `test/externalTests/*`

## Core Prismarine Ecosystem

- `minecraft-protocol`:
  `https://github.com/PrismarineJS/node-minecraft-protocol`
  Lower-level packet client/server. Mineflayer uses it for connection,
  authentication, encryption, compression, keepalive, auto version detection,
  and raw packet events. Only use `bot._client` after checking stable
  Mineflayer APIs.
- `minecraft-data`:
  `https://github.com/PrismarineJS/minecraft-data`
  Versioned protocol, block, item, entity, biome, recipe, and feature data.
- `prismarine-registry`:
  `https://github.com/PrismarineJS/prismarine-registry`
  Dynamic wrapper around `minecraft-data`; Mineflayer exposes it as
  `bot.registry`.
- `prismarine-physics`:
  `https://github.com/PrismarineJS/prismarine-physics`
  Physics engine used by `lib/plugins/physics.js`.
- `prismarine-world`:
  `https://github.com/PrismarineJS/prismarine-world`
  Synchronous world abstraction used by Mineflayer world/block APIs.
- `prismarine-viewer`:
  `https://github.com/PrismarineJS/prismarine-viewer`
  Browser viewer used by `src/viewer.js` and examples.
- `vec3` / `node-vec3`:
  `https://github.com/PrismarineJS/node-vec3`
  Position and vector math. Use `vec3(x, y, z)` or `new Vec3(...)` where the
  surrounding code does.
- `prismarine-block`, `prismarine-item`, `prismarine-entity`,
  `prismarine-chat`, `prismarine-windows`, `prismarine-nbt`,
  `prismarine-recipe`, `prismarine-biome`, `prismarine-chunk`
  provide the version-aware classes behind Mineflayer objects.

## Important Mineflayer Docs

- `docs/api.md`: public API reference. This is the first stop for bot methods,
  events, properties, classes, and public behavior.
- `docs/unstable_api.md`: explains that `bot._client` is unstable because it is
  the raw `minecraft-protocol` client.
- `docs/FAQ.md`: practical answers for Microsoft auth, custom chat parsing,
  commands, multi-account bots, inventory dropping, protocol debugging, laggy
  keepalive, item NBT/lore, console input, plugin dependencies, SOCKS proxies,
  common connection errors, and spawn protection.
- `docs/CONTRIBUTING.md`: tests are split into internal protocol/server tests
  and external vanilla-server tests; public docs should be updated with API
  changes.
- `docs/history.md`: changelog. Relevant current-era changes include 1.21.x
  support, Node 22/24 CI, chat/event/type updates, physics fixes, manual
  respawn, elytra, particles, direction/cursor support for interactions, and
  replacing callback APIs with promises.

## Examples Worth Consulting

- `examples/chat_parsing.js`: current `addChatPattern` and
  `addChatPatternSet` usage.
- `examples/digger.js`: `waitForChunksToLoad`, `canDigBlock`, `dig`,
  `placeBlock`, `supportFeature`, and inventory selection.
- `examples/pathfinder/gps.js`: minimal pathfinder setup with `Movements` and
  `GoalNear`.
- `examples/reconnector.js`: simple reconnect pattern after `end`.
- `examples/chest.js`, `examples/inventory.js`, `examples/trader.js`,
  `examples/fisherman.js`, `examples/auto-eat.js`, `examples/attack.js`,
  `examples/guard.js`: practical reference for windows, inventory, villagers,
  fishing, food, combat, and guarding behavior.
- `examples/viewer/` and `examples/screenshot-with-node-canvas-webgl/`: viewer
  integration and rendering examples.
- `examples/python/`: Python/JSPyBridge usage; useful only when asked for
  Python interoperability.

## Third-Party Plugins From The README

Implementation-relevant:

- `mineflayer-pathfinder`:
  `https://github.com/Karang/mineflayer-pathfinder`
  A* pathfinding, movement costs, block breaking/placing, entity avoidance,
  `Movements`, and goals.
- `mineflayer-pvp`:
  `https://github.com/TheDudeFromCI/mineflayer-pvp`
  PVP/PVE helper that depends on pathfinder.
- `mineflayer-auto-eat`:
  `https://github.com/link-discord/mineflayer-auto-eat`
  Reference for food thresholds and physics-tick eating, though this workspace
  has its own `src/autoEat.js`.
- `mineflayer-collectblock`:
  `https://github.com/TheDudeFromCI/mineflayer-collectblock`
  High-level block collection pattern.
- `mineflayer-tool`:
  `https://github.com/TheDudeFromCI/mineflayer-tool`
  Automatic tool/weapon selection pattern.
- `mineflayer-statemachine`:
  `https://github.com/TheDudeFromCI/mineflayer-statemachine`
  State-machine approach for complex bot behaviors.
- `prismarine-viewer`, `mineflayer-web-inventory`, `mineflayer-dashboard`,
  and `mineflayer-GUI` are UI/inspection references.
- `minecraftHawkEye`, `mineflayer-projectile`, and `mineflayer-autocrystal`
  are combat/projectile references.
- `MineflayerArmorManager`, `MineflayerAutoAuth`, `mineflayer-bloodhound`,
  `mineflayer-tps`, `mineflayer-panorama`, and `mineflayer-death-event` are
  narrow behavior references.

Historical or less relevant for new code:

- `mineflayer-navigate`, `mineflayer-radar`, old `andrewrk/mineflayer` links,
  and some demo projects are useful as history but may use deprecated APIs.
- YouTube links and old demo pages are not authoritative for current API shape.

## Contribution And Version Update References

- `https://github.com/PrismarineJS/prismarine-contribute`
  explains the PrismarineJS split: protocol in `minecraft-protocol`, data in
  `minecraft-data`, high-level bots in Mineflayer, and update work flowing
  through data/protocol packages first.
- `https://github.com/PrismarineJS/mineflayer/wiki/Big-Prismarine-projects`
  lists larger project ideas.
- `https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/docs/API.md#mccreateclientoptions`
  is the lower-level source for connection options such as auth, keepalive,
  custom `connect`, proxy streams, `fakeHost`, `profilesFolder`, and realms.

## Links To Treat Carefully

- Badges, sponsors, Discord, Gitpod, Colab, npm badges, and image links are not
  coding guidance.
- Old `wiki.vg` and `minecraftwiki.net` links may be stale. Prefer current
  `minecraft-data`, `bot.registry`, or Minecraft Wiki links used in current
  docs.
- Old examples that use callbacks, `chatAddPattern`, `openChest`, or
  `physicTick` should be modernized to promises, `addChatPattern`,
  `openContainer`, and `physicsTick`.
