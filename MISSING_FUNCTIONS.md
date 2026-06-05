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
- Player message: TestBot, what is your coordinate right now?
- Resolved: Added the `get_current_coordinates` tool so the bot can report its current position through Codex.

<!-- missing-function:1f6917110bd08e10 -->
## 2026-06-02T16:11:52.440Z - Unknown tool: get_current_coordinates

- Requested by: `Alex` via `public`
- Source: `unknown-tool`
- Reason: Codex requested a tool that the bot runtime does not have.
- Suggested tool/function: `get_current_coordinates`
- Player message: TestBot, what is your coordinate right now?

```json
{
  "tool": "get_current_coordinates",
  "args": {}
}
```

- Resolved: Added `get_current_coordinates` to the checked-in tool list so Codex can call the existing runtime handler consistently.

<!-- missing-function:4f1b707b43302f56 -->
## 2026-06-02T16:16:09.379Z - leave and rejoin server

- Requested by: `JaggedFireFang` via `public`
- Source: `ai-chat`
- Reason: Player asked the bot to disconnect from the server and reconnect.
- Player message: TestBot123 leave and rejoin
- Blocked: Player-commanded disconnect/rejoin requests are not allowed. The bot must refuse instead of treating this as a missing function.

<!-- missing-function:718274c6af5cf0f1 -->
## 2026-06-02T16:16:40.283Z - leave and rejoin server

- Requested by: `JaggedFireFang` via `public`
- Source: `ai-chat`
- Reason: Player asked the bot to disconnect from the server and reconnect.
- Player message: TestBot123 leave and rejoin
- Blocked: Player-commanded disconnect/rejoin requests are not allowed. The bot must refuse instead of treating this as a missing function.

<!-- missing-function:57eb2ac0ff1f6689 -->
## 2026-06-02T16:17:36.371Z - leave and rejoin server

- Requested by: `Archie` via `public`
- Source: `ai-chat`
- Reason: Player asked the bot to rage quit.
- Player message: TestBot123 do rage quit
- Blocked: Player-commanded disconnect requests are not allowed. The bot must refuse instead of treating this as a missing function.

<!-- missing-function:5ad59fbe39cd6055 -->
## 2026-06-02T16:42:59.524Z - answer Holoquiz questions automatically

- Requested by: `DevilGH2000` via `public`
- Source: `ai-chat`
- Reason: Player asked the bot to answer an upcoming Holoquiz for them, but no tool exists to read quiz prompts and respond in chat.
- Suggested tool/function: `answer_quiz`
- Player message: TestBot123 the next Holoquiz will start in 45s can you answer for me
- Resolved: Added the `answer_quiz` runtime tool to arm the next HoloQuiz prompt and submit the answer through Codex.

<!-- missing-function:aaa864deddea8456 -->
## 2026-06-02T16:44:10.312Z - pay another player money

- Requested by: `Archie` via `public`
- Source: `ai-chat`
- Reason: Player asked the bot to send 1 to itzmugdhoboy with /pay, but available tools do not allow economy-transfer commands.
- Suggested tool/function: `pay_player`
- Player message: TestBot123 do /pay itzmugdhoboy 1
- Resolved: Kept economy-transfer commands blocked and added regression coverage so `/pay` requests are refused consistently instead of being treated as a missing capability.

<!-- missing-function:42ba8ab814d167eb -->
## 2026-06-02T17:19:38.709Z - switch to hub server

- Requested by: `Archie` via `public`
- Source: `ai-chat`
- Reason: Player asked the bot to run /hub, but server-mode switching commands are not allowed by the current runtime.
- Suggested tool/function: `switch_server_mode`
- Player message: TestBot123 do /hub
- Resolved: Kept server-mode switching blocked so the bot stays in survival, and added regression coverage for `/hub`-style requests.
