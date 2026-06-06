# AI NPC Master SRS

## 1. Purpose

This Software Requirements Specification defines the roadmap for turning the current Mineflayer bot into an AI NPC: a self-directed Minecraft character with memory, goals, safe tools, personality continuity, and gradual capability growth.

The AI NPC should not behave only like a chat bot or a menu-driven automation runner. It should observe the world, decide what matters, choose one safe action, remember the result, and continue its life over time.

## 2. Current System State

The project already includes several useful foundations:

- AI chat responses through Codex.
- Safe chat tool-call handling.
- Per-bot memory path resolution.
- NPC life state with lifestyle and goal tracking.
- Structured missing-tool backlog.
- Manual and planner-accessible automations for farming, mining, wood cutting, roaming, and pyro farming.
- Follow, combat, auto-eat, night safety, death recovery, and debug logging.

The main gap is that the AI NPC brain is not yet an active life loop. `attachAiNpc()` exposes a `runNow()` controller, but the normal bot startup path does not store, schedule, or trigger that controller.

## 3. Product Goal

Create a safe, incremental AI NPC system where:

- The bot can start a persistent life.
- The bot remembers its home, places, supplies, projects, players, and missing capabilities.
- The bot thinks through Codex only when useful.
- Codex chooses one validated action at a time.
- The runtime executes only allowlisted, bounded tools.
- Failures and missing capabilities become structured backlog items.
- The system grows through small milestones rather than a large rewrite.

## 4. High-Level Flow

```text
Bot starts
-> Login and enter survival
-> Load per-bot memory
-> Check known home state
-> If home exists: verify or return home
-> If no home exists: use /rtp, find safe area, set home
-> Observe compact world state
-> Scheduler decides whether AI should think
-> Codex returns one validated tool call
-> Runtime validates and executes the tool
-> Tool result is recorded
-> NPC life and memory are updated
-> Scheduler decides the next step
```

## 5. System Principles

- Safety gates run before AI decisions.
- Local reflexes handle obvious survival needs without spending model calls.
- Codex never directly manipulates Mineflayer objects.
- Codex returns one JSON tool call or one no-op decision.
- Tool validation happens before execution.
- Missing or unknown capabilities are recorded rather than silently ignored.
- Normal prompts use compact summaries, not full raw memory.
- Existing manual commands remain available while the AI NPC system matures.

## 6. Milestone Roadmap

### Milestone 1: AI NPC Scheduler

Purpose: make the NPC brain actually run.

Requirements:

- Store the controller returned by `attachAiNpc()`.
- Add an AI NPC scheduler module.
- Trigger thinking on spawn, important events, tool completion, and slow idle.
- Rate-limit repeated thoughts for the same reason.
- Skip thinking when the bot is unsafe, busy, in combat, sleeping, using a window, or running another action.
- Preserve the rule that random five-minute automation behavior must not return.
- Add tests for scheduler trigger, cooldown, busy skip, and shutdown cleanup.

Acceptance criteria:

- The bot can run an AI NPC thinking cycle without manual console intervention.
- The scheduler does not spam Codex calls.
- The scheduler stops cleanly when the bot ends or is kicked.

### Milestone 2: Startup Home Flow

Purpose: give the NPC a persistent life anchor.

Requirements:

- Load known home data from per-bot place memory.
- On first spawn, enter survival.
- If home exists, verify it or return with `/home home`.
- If no home exists, use `/rtp`.
- After a safe wilderness landing, run `/sethome home`.
- Remember home position, dimension, timestamp, and basic safety notes.
- Do not repeatedly run `/rtp` after home is known.
- Record startup flow results in memory.

Acceptance criteria:

- Fresh NPCs start a new journey only once.
- Existing NPCs return to or verify home instead of restarting their life.
- Home state survives process restart.

### Milestone 3: Tool Registry And Validator

Purpose: replace broad command execution and big automation choices with small, explicit tools.

Initial tools:

- `observe_world`
- `inspect_inventory`
- `run_safe_command`
- `rtp`
- `set_home`
- `go_home`
- `remember_place`
- `write_memory_event`
- `record_missing_tool`
- `read_missing_tools`

Requirements:

- Create a central tool registry.
- Each tool has a name, description, argument schema, validator, and executor.
- Tool names are allowlisted.
- Tool arguments are bounded and sanitized.
- NPC command tools use an allowlist, not only a blacklist.
- Unknown tools are recorded in the structured missing-tool backlog.
- Tool results are normalized before being sent back to Codex.

Acceptance criteria:

- Codex can only call registered tools.
- Unsafe commands are blocked before execution.
- Missing tools are deduped and recorded.

### Milestone 4: Memory Summary And Journal

Purpose: prevent prompts from growing forever while preserving continuity.

Requirements:

- Add or formalize `event-log.jsonl`.
- Add `memory-summary.json`.
- Add `daily-journal.md`.
- Store recent tool calls, failures, discoveries, dangers, and player interactions.
- Run deep reflection every 30 real minutes.
- Reflection updates summary memory and appends a short journal entry.
- Normal prompts include only compact state, relevant records, and top missing tools.
- Raw logs are not sent wholesale to Codex.

Acceptance criteria:

- Long sessions do not cause unbounded prompt growth.
- The NPC can retain identity, home state, current projects, and recent important events.
- Memory write failures are logged but do not crash gameplay.

### Milestone 5: Movement And Observation Tools

Purpose: let the NPC move and explore intentionally.

Tools:

- `scan_blocks`
- `scan_entities`
- `go_to_position`
- `go_to_block`
- `return_home`
- `stop_movement`

Requirements:

- Respect pathfinder busy state.
- Stop movement on danger or manual interruption.
- Record failed pathing attempts.
- Record useful discovered places.
- Keep movement bounded by distance, timeout, and safety policy.

Acceptance criteria:

- The NPC can move for a reason chosen by the planner.
- Movement failures produce useful tool results.
- The NPC can return home from nearby locations.

### Milestone 6: Inventory And Storage Tools

Purpose: let the NPC manage supplies.

Tools:

- `deposit_items`
- `withdraw_items`
- `equip_item`
- `find_container`
- `remember_container`

Requirements:

- Remember known home containers.
- Deposit low-priority gathered resources.
- Withdraw only requested or required items.
- Avoid dropping valuable items unless a later explicit policy allows it.
- Fail safely if no container exists.

Acceptance criteria:

- The NPC can store and retrieve supplies around home.
- Storage actions are recorded in structured memory.
- Inventory failures do not leave the bot stuck in a window.

### Milestone 7: Crafting And Survival Tools

Purpose: give the NPC basic survival independence.

Tools:

- `list_craftable_items`
- `craft_item`
- `eat_food`
- `sleep_if_possible`
- `cook_food`
- `smelt_item`

Requirements:

- Craft only known safe recipes.
- Prefer survival needs before long-term projects.
- Record missing ingredients.
- Record missing tools if desired crafting, cooking, or smelting support is unavailable.
- Avoid high-risk crafting loops.

Acceptance criteria:

- The NPC can satisfy simple food, crafting, and survival needs.
- Failed crafting attempts explain what is missing.

### Milestone 8: Simple Building Tools

Purpose: allow conservative home improvement.

Tools:

- `place_block`
- `dig_block`
- `build_small_shelter`
- `light_area`
- `repair_shelter`

Requirements:

- Start with small, bounded structures.
- Avoid destructive edits around player builds.
- Restrict building and digging around known home unless a later policy allows wider work.
- Require explicit safety policy for digging and placement.
- Record building projects and unfinished work.

Acceptance criteria:

- The NPC can improve a starter home.
- Building tools are bounded, testable, and reversible where practical.
- The NPC does not freely destroy the environment.

### Milestone 9: Reduce Legacy Automation Dependency

Purpose: make AI tools the primary behavior path.

Requirements:

- Keep existing automations as manual or debug features.
- Wrap useful automation primitives as smaller tools where appropriate.
- Planner prompts should prefer grounded tools over `start_automation`.
- `/automation` can remain for human control while the NPC tool system matures.

Acceptance criteria:

- The NPC no longer requires `/automation` to behave autonomously.
- Existing automations do not conflict with the AI scheduler.

## 7. Functional Requirements

### 7.1 Scheduler

- The system shall trigger AI thinking on meaningful events.
- The system shall rate-limit repeated thinking.
- The system shall skip thinking while unsafe or busy.
- The system shall stop scheduled work on bot end or kick.

### 7.2 Startup And Home

- The system shall load per-bot home memory on startup.
- The system shall use `/rtp` only when no known home exists.
- The system shall set and remember `home` after a safe fresh start.
- The system shall verify or return to known home on later starts.

### 7.3 Tool Calls

- The model shall return one JSON tool call or no-op decision.
- The runtime shall validate every tool call.
- The runtime shall execute only registered tools.
- The runtime shall record unknown tools as missing capabilities.

### 7.4 Memory

- The system shall store per-bot memory under `data/bots/<bot-id>/`.
- The system shall keep structured memory separate from human-readable journal text.
- The system shall summarize memory before adding it to prompts.
- The system shall dedupe missing-tool records.

### 7.5 Safety

- The system shall block unsafe commands.
- The system shall prefer command allowlists for autonomous NPC actions.
- The system shall avoid destructive building or digging unless explicitly allowed by a safe tool.
- The system shall keep local reflexes for food, danger, and interruption.

## 8. Non-Functional Requirements

- The system should keep Codex calls low and purposeful.
- The system should degrade gracefully if memory files cannot be read or written.
- The system should be testable without connecting to a real server.
- The system should preserve existing manual commands.
- The system should avoid unbounded prompt growth.
- The system should keep each new module focused and small.

## 9. Initial Implementation Priority

The next work should happen in this order:

1. AI NPC scheduler.
2. Startup home flow.
3. Tool registry and validator.
4. Memory summary and journal.
5. Movement and observation tools.
6. Inventory and storage tools.
7. Crafting and survival tools.
8. Simple building tools.
9. Reduce legacy automation dependency.

## 10. First Phase Definition Of Done

The first phase is complete when:

- The bot starts and enters survival.
- The bot loads per-bot memory.
- The bot decides whether home exists.
- The bot uses `/rtp` only when no home is known.
- The bot can set and remember home.
- AI NPC thinking runs through a scheduler.
- The scheduler is event-aware and rate-limited.
- Codex returns one validated tool call.
- Tool results are recorded.
- Missing tools are deduped in structured backlog.
- Tests cover scheduler, startup flow, safe command validation, and memory writes.

## 11. Open Decisions

- Whether the scheduler should be enabled by default or guarded by an environment variable for the first rollout.
- Whether `/sethome home` should be exposed only through a dedicated `set_home` tool or allowed through a restricted command tool.
- How strict the first home safety check should be before setting home.
- Whether existing automations should remain planner-callable during the first scheduler milestone.

## 12. Recommended Next Step

Create an implementation plan for Milestone 1: AI NPC Scheduler.

The scheduler should be built first because every later milestone depends on having a reliable, rate-limited way to decide when the NPC brain should think.
