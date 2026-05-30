# Coding Agent Instructions

Use this file as the entry point before changing this Mineflayer workspace. The
source-of-truth project is `PrismarineJS/mineflayer`. This checkout is
`mineflayer` 4.37.1, has local bot automation code under `src/`, and includes
extra runtime dependencies such as `mineflayer-pathfinder`, `mineflayer-pvp`,
`prismarine-viewer`, and `canvas`.

Read these files in order:

1. `instructions/project-architecture.md` for the local bot application shape.
2. `instructions/mineflayer-api-guide.md` for the Mineflayer API and ecosystem
   rules that matter while coding.
3. `instructions/verification.md` for test, lint, and manual verification
   expectations.
4. `instructions/reference-map.md` when you need to chase the original docs or
   linked ecosystem projects.

Default coding posture:

- Prefer the APIs already exposed by Mineflayer and Prismarine modules. Use
  `bot._client` only when no stable Mineflayer API exists.
- Treat all world, entity, inventory, window, chat, and movement operations as
  asynchronous and stateful. Guard against disconnects, unloaded chunks,
  missing entities, open windows, death, and server lag.
- Use `bot.registry`, `bot.supportFeature(...)`, and version-tested code paths
  for cross-version behavior. Do not hard-code protocol packet shapes without a
  feature or version check.
- Keep local automation modules small and attach behavior through explicit
  `attach...` or `start...` functions, following the existing `src/` pattern.
- Stop pathfinder goals and clear movement state before taking over movement,
  fighting, eating, sleeping, dying, or shutting down.
- Update `index.d.ts`, docs, examples, and tests whenever a public Mineflayer
  API changes.
- Run focused verification before claiming work is done. At minimum run lint for
  docs/code changes and targeted mocha tests for changed behavior.
