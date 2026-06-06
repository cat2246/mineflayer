# Nearby AI Chat Design

## Goal

Let visible players within 15 blocks talk to the bot in public chat without mentioning the bot name, while keeping existing mention-based chat behavior for everyone else.

## Behavior

- A public chat message is handled when it either mentions the bot or comes from a visible player within 15 blocks of the bot.
- The nearby check uses the sender's visible player entity position and the bot entity position.
- Mentioned public messages keep working regardless of distance.
- Server announcements, parsed whisper tails, the bot's own chat, and duplicate public events remain ignored.
- For nearby handled messages, the bot tries to look at the sender's head.
- The look-at action is skipped when the bot is busy: active automation, combat, night safety, auto eating, sleeping, current window, movement pause, PVP target, or active pathfinder movement/goal.
- Looking uses non-forced `bot.lookAt(point, false)` so Mineflayer automation actions can retain priority.

## Test Coverage

- Nearby unmentioned chat produces an AI request and public reply.
- Far unmentioned chat remains ignored.
- Nearby chat can be processed while an automation is active.
- Nearby look-at is skipped while an automation is active.
