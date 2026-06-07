# Minecraft Bot Tools

The bot runtime can execute only the allowlisted tools below.
Tool calls must be a single JSON object with this shape:

```json
{"tool":"tool_name","args":{"key":"value"}}
```

Do not invent tool names, commands, or arguments.
The bot must refuse requests to disconnect, leave, rejoin, reconnect, or change the bot password.
Do not record those requests as missing functions; answer with a short refusal instead.

## Tools

### meet_player_at_spawn

Use when a player asks the bot to meet them at spawn.

Arguments:

- `player`: Minecraft username to find after going to spawn. Use the player who asked if unspecified.

Behavior:

- Runs `/spawn` in chat.
- Waits for teleport/server movement.
- If the player is visible, pathfinds near that player.

Example:

```json
{"tool":"meet_player_at_spawn","args":{"player":"Alex"}}
```

### accept_tpa

Use when a player asks the bot to accept a teleport request.

Behavior:

- Runs `/tpaccept` in chat.

Example:

```json
{"tool":"accept_tpa","args":{}}
```

### request_tpa

Use when a player asks the bot to teleport to them.

Arguments:

- `player`: Minecraft username to send the TPA request to. Use the player who asked if unspecified.

Behavior:

- Runs `/tpa <player>` in chat.

Example:

```json
{"tool":"request_tpa","args":{"player":"Alex"}}
```

### run_server_command

Use for safe informational or movement server commands when the player asks about server state or asks the bot to go somewhere.

Arguments:

- `command`: The server command to run, including `/` if known.

Safety:

- The runtime blocks destructive, moderation, admin, economy-transfer, and permission-changing commands.
- The bot must stay in survival. Do not run server-mode switching commands such as `/hub`, `/lobby`, `/skyblock`, `/sb`, `/oneblock`, `/creative`, `/prison`, `/factions`, `/minigames`, `/bedwars`, `/skywars`, `/duels`, `/vanilla`, or `/server`.
- Survival-local informational commands such as `/rules`, `/help`, `/balance`, `/money`, `/spawn`, `/warps`, and `/warp <name>` are allowed when otherwise safe.
- Do not use this for kicking, banning, muting, paying, giving items, deleting homes, or changing server/player permissions.

Behavior:

- Runs the validated command in chat.
- Captures nearby server messages.
- Sends the command result back to the model so it can answer the player.

Example:

```json
{"tool":"run_server_command","args":{"command":"/rules"}}
```

### record_missing_function

Use when a player asks the bot to do something useful but no available tool/function can do it yet.

Arguments:

- `capability`: Short name for the missing function, such as `craft wooden doors`.
- `reason`: Why the function is needed.
- `suggestedTool`: Optional future tool name, such as `craft_item`.

Behavior:

- Records the missing function in MISSING_FUNCTIONS.md so it can be implemented later.
- Does not attempt the unsupported action.

Example:

```json
{"tool":"record_missing_function","args":{"capability":"craft wooden doors","reason":"Player asked the bot to craft a door from wood.","suggestedTool":"craft_item"}}
```

### get_current_coordinates

Use when a player asks where the bot is, what its current coordinates are, or asks for its position.

Behavior:

- Reads the bot current in-game position.
- Sends the position back to the model so it can answer the player.

Example:

```json
{"tool":"get_current_coordinates","args":{}}
```

### answer_quiz

Use when a player asks the bot to answer the next HoloQuiz question automatically.

Behavior:

- Arms the runtime to watch for the next HoloQuiz prompt.
- When the prompt arrives, sends only the quiz answer back into Minecraft chat.

Example:

```json
{"tool":"answer_quiz","args":{}}
```
