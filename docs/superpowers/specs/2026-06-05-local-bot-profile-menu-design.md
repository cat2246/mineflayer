# Local Bot Profile Menu Design

## Context

`npm run start` currently calls `src.start()`, which creates a Mineflayer bot immediately from constants and environment/CLI values. `src/config.js` includes concrete server and bot credentials, including a default username and server login command. Because this repository is public, bot usernames, server addresses, and login passwords must move out of tracked source.

## Goals

- Do not store server or bot credentials as source constants.
- Keep local bot/server credentials out of git.
- Make `npm run start` open an interactive menu instead of connecting immediately.
- Support creating offline and Microsoft-authenticated bots.
- Support creating and selecting servers.
- Store a login password per bot/server pair after the user enters it once.
- Send `/login <password>` automatically when joining a selected server if a saved password exists.
- Never auto-register accounts.

## Storage

Add a local JSON profile store at `data/bot-profiles.json`. The existing `.gitignore` already ignores `data`, so this file will remain local.

The store will contain:

- bots: local ids, usernames, auth modes, and optional Microsoft auth profile folders
- servers: local ids, host, and port
- server logins: saved password entries keyed by bot id and server id

The store module will create the `data` directory when needed, return empty lists when no profile file exists, write JSON atomically enough for this single-user CLI use case, and validate basic fields before saving.

## Startup Flow

`src.start()` will start the log terminal as it does today, then open an interactive CLI menu:

1. If no bots exist, show only `Create new bot`.
2. If bots exist, show `Create new bot` and `Select a bot`.
3. Creating a bot asks for `Offline bot` or `Online bot`.
4. Offline bots ask only for username.
5. Online bots ask for username and save `auth: "microsoft"`. Mineflayer will run its normal Microsoft auth flow when the bot is later started.
6. After creating a bot, return to the main menu.
7. Selecting a bot opens a server menu.
8. If no servers exist, show only `Create new server`.
9. If servers exist, show `Create new server` and `Select a server`.
10. Creating a server asks for host and optional port, then returns to the server menu.
11. Selecting a server asks for the bot/server password only if no password has been saved for that pair.
12. After a bot and server are selected, build Mineflayer options and start the bot.

## Bot Options

The new builder will combine the selected bot and server into the existing conservative runtime options:

- `host` and `port` from the selected server
- `username` and `auth` from the selected bot
- `version` from `MINECRAFT_VERSION` or the existing default version
- Microsoft bots get a local `profilesFolder` under `data/auth/<bot-id>` so auth tokens do not land in source-controlled files
- existing connection safety options remain unchanged

The existing `buildBotOptions` environment/CLI behavior can be retained for tests or direct API use, but it must no longer fall back to real credentials.

## Login Prompt Handling

The server login command will become per-session data instead of a global default. When a selected bot/server pair has a saved password, the bot will send `/login <password>` once after spawning on the selected server. This covers servers that do not print a login prompt. Event logging will still watch incoming chat/messages for common login prompts, such as text containing `/login <password>` or asking the player to log in, but it will not send a duplicate login command for the same connection.

When login handling runs:

- if a saved password exists, send `/login <password>` on spawn
- if a login prompt appears later in the same connection, do not send a duplicate command
- if no saved password exists, do nothing automatically
- never send `/register` or any registration command

If the server allows relogin without requiring the command, the extra `/login` may be ignored by the server.

## Tests

Add focused tests for:

- empty profile store when no local file exists
- creating offline and online bot profiles
- creating server profiles
- saving and reading per-bot-per-server passwords
- building bot options from selected local profiles
- menu behavior that hides unavailable options when bots or servers do not exist
- saved passwords send `/login <password>` on spawn without waiting for a prompt
- login prompt detection sends `/login <password>` when prompt-only handling is used
- no default real username, server, or login password remains in tracked config

## Non-Goals

- Encrypting local passwords at rest.
- Registering bot accounts.
- Managing multiple bots concurrently from the menu in this change.
- Editing or deleting existing profiles.
