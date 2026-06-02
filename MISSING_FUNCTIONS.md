# Missing Bot Functions

Feature backlog captured by the Minecraft AI NPC when players ask for abilities the runtime does not have yet.

## Open Items

## Resolved Items

<!-- missing-function:c6e36b21ae2ad449 -->
## 2026-06-02T15:45:17.731Z - report current coordinates

- Requested by: `Cat2246` via `public`
- Source: `ai-chat`
- Reason: Player asked for the bot's current coordinates, but no available tool can read or report the bot's position.
- Suggested tool/function: `get_current_coordinates`
- Player message: PokiMoki, what is your coordinate right now?
- Resolved: Added the `get_current_coordinates` tool so the bot can report its current position through Codex.

<!-- missing-function:1f6917110bd08e10 -->
## 2026-06-02T16:11:52.440Z - Unknown tool: get_current_coordinates

- Requested by: `Alex` via `public`
- Source: `unknown-tool`
- Reason: Codex requested a tool that the bot runtime does not have.
- Suggested tool/function: `get_current_coordinates`
- Player message: PokiMoki, what is your coordinate right now?

```json
{
  "tool": "get_current_coordinates",
  "args": {}
}
```

<!-- missing-function:4f1b707b43302f56 -->
## 2026-06-02T16:16:09.379Z - leave and rejoin server

- Requested by: `JaggedFireFang` via `public`
- Source: `ai-chat`
- Reason: Player asked the bot to disconnect from the server and reconnect, but no available runtime tool can do that yet.
- Suggested tool/function: `reconnect_server`
- Player message: PokiMoki82719 leave and rejoin

<!-- missing-function:718274c6af5cf0f1 -->
## 2026-06-02T16:16:40.283Z - leave and rejoin server

- Requested by: `JaggedFireFang` via `public`
- Source: `ai-chat`
- Reason: Player asked the bot to disconnect from the server and reconnect.
- Suggested tool/function: `reconnect_bot`
- Player message: PokiMoki82719 leave and rejoin

<!-- missing-function:57eb2ac0ff1f6689 -->
## 2026-06-02T16:17:36.371Z - leave and rejoin server

- Requested by: `Archie` via `public`
- Source: `ai-chat`
- Reason: Player asked the bot to rage quit, but there is no available tool to disconnect from the server.
- Suggested tool/function: `disconnect_from_server`
- Player message: PokiMoki82719 do rage quit
