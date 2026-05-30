# Verification

Use the lightest verification that proves the change. This project can run
expensive vanilla-server tests across many Minecraft versions, so target the
changed behavior first.

## Always Check First

Before editing, inspect the current state:

```bash
git status --short --branch
npm pkg get scripts
```

Do not overwrite unrelated user changes. If a file is already dirty, read it
carefully and work with the existing edits.

## Lint And Formatting

The package uses StandardJS and `standard-markdown`:

```bash
npm run lint
```

For mechanical formatting only:

```bash
npm run fix
```

Run `npm run lint` after editing `.js`, `.md`, package metadata, examples, or
docs.

## Tests

Full suite:

```bash
npm test
```

Target one Minecraft version:

```bash
npm run mocha_test -- -g "mineflayer_external 1.20.4v"
```

Target one external test:

```bash
npm run mocha_test -- -g "mineflayer_external 1.20.4v.*exampleBee"
```

Target one internal area:

```bash
npm run mocha_test -- -g "mineflayer_internal 1.21.11v.*chat"
```

External tests download and run vanilla server jars through `minecraft-wrap`.
They require Java in `PATH` and may use `server_jars/`. Prefer a targeted test
for behavior touching blocks, inventory, pathing, chat, combat, or dimensions.

## Manual Bot Checks

For local app behavior, `npm start` or `npm run dev` starts `bot.js`. The
default config connects to the configured server in `src/config.js`; prefer
environment variables over changing defaults:

```bash
$env:MINECRAFT_USERNAME = "botName"
$env:MINECRAFT_AUTH = "offline"
$env:MINECRAFT_VERSION = "1.21.10"
npm start
```

If viewer is enabled, it uses Prismarine Viewer on port `3007` by default. If
that port is busy, `src/viewer.js` skips the viewer rather than crashing.

For behavior that controls movement, inspect logs under `logs/bot-debug.log`
and verify that pathfinder goals, movement keys, windows, and combat targets are
cleaned up after errors, death, kicks, or shutdown.

## Documentation Checks

When editing `docs/api.md`, update its generated table of contents with DocToc:

```bash
npx doctoc docs/api.md
```

When adding public API, verify all of these:

- implementation in `lib/` or `src/`;
- TypeScript declaration in `index.d.ts`;
- API docs in `docs/api.md`;
- example or migration note where useful;
- test coverage for the behavior.

## Done Criteria

Do not claim completion until:

- the requested files are changed;
- focused verification has run and the result is known;
- any skipped verification is named with the reason;
- no long-running local process was left behind unless the user asked for it.
