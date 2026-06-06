# AI NPC Lifestyle Goals Design

## Purpose

The bot should feel like an AI NPC with its own life, not a generic Minecraft helper or a random automation runner. It needs continuity: a persistent identity, evolving lifestyle, current goals, memories that explain why those goals exist, and planner prompts that choose coherent next steps.

The first version should make the bot behave like a self-directed survival NPC. It should still use the existing safe automation modules, but only when those actions serve the NPC's current lifestyle and goal.

## Goals

- Add persistent NPC life state stored locally under `data/`.
- Track personality traits, lifestyle scores, current lifestyle, current goal, event history, and short life-story summaries.
- Update lifestyle scores from repeated world and runtime events.
- Choose a current goal from needs, lifestyle scores, time of day, inventory, known automations, and nearby players.
- Include NPC life state in idle planner prompts so planner output is grounded in identity and current goal.
- Keep existing chat tools and manual automation behavior intact.
- Avoid restoring the previous behavior where the bot automatically runs random actions every five minutes.

## Non-Goals

- Do not add unrestricted building, block placing, or destructive world changes.
- Do not create a fully autonomous high-frequency bot loop in this first milestone.
- Do not let the AI planner invent new runtime tools or bypass existing command safety.
- Do not remove manual commands such as `/automation`, `/follow`, or chat-request tools.
- Do not make the NPC obey every player request. The NPC may decline if the request conflicts with its current life goal.

## Approach

Use a small deterministic life model around the existing AI NPC planner:

1. `npcLife` stores persistent life state and provides pure functions for scoring, goal selection, and event recording.
2. `aiNpc` reads life state when building planner state and updates it after planner cycles.
3. The planner prompt changes from "pick any small useful action" to "choose one next step that fits the NPC's current lifestyle and goal."
4. The planner remains explicit/manual unless a later feature deliberately schedules it. This keeps autonomy coherent instead of random.

## Life State

The local JSON file should live at `data/npc-life.json`. The `data` directory is already ignored by git.

Initial state:

```json
{
  "version": 1,
  "identity": {
    "name": null,
    "origin": "new survival NPC",
    "selfImage": "I am learning what kind of life I want in this world."
  },
  "traits": {
    "curious": 25,
    "cautious": 25,
    "social": 20,
    "independent": 30,
    "ambitious": 20
  },
  "lifestyles": {
    "survivalist": 40,
    "homesteader": 25,
    "explorer": 20,
    "miner": 15,
    "trader": 10,
    "protector": 10
  },
  "currentLifestyle": "survivalist",
  "previousLifestyle": null,
  "currentGoal": {
    "id": "survive-and-settle",
    "title": "Survive and find a stable routine",
    "reason": "The NPC is new and needs food, safety, and a sense of home.",
    "priority": "safety",
    "selectedAt": 0
  },
  "recentEvents": [],
  "lifeStory": [
    "I arrived with no settled purpose yet."
  ],
  "updatedAt": 0
}
```

Scores are clamped from 0 to 100. Lifestyle transitions should require repeated evidence, not one event. A lifestyle should change only when another lifestyle leads the current one by at least 10 points. The life story should record that transition in one short sentence.

## Event Model

The life module should accept compact events. The first milestone only needs events available from existing state and planner execution:

- `cycle_idle`: planner cycle ran while idle.
- `automation_started`: an automation started through the NPC planner.
- `automation_completed`: an automation reports waiting for next day or no active work.
- `follow_started`: NPC started following a player.
- `player_nearby`: visible non-bot player exists nearby.
- `night`: world is night.
- `day`: world is day.
- `low_food`: food is below a safe threshold.
- `unsafe`: combat, night safety, death, sleep, window, or active combat blocks autonomous work.
- `planner_noop`: planner chose to do nothing.

Example scoring:

- Farming or wood cutting nudges `homesteader`.
- Mining nudges `miner`.
- Wild roaming nudges `explorer`.
- Pyro Farming nudges `homesteader` and `ambitious`.
- Following or nearby players nudges `social`.
- Night, low food, combat, and unsafe state nudge `cautious` and `survivalist`.

## Goal Selection

Goal selection should be deterministic and testable. It should not ask the AI model to invent the long-term goal from scratch.

Recommended first goal mapping:

- If unsafe or night: `stay-safe-until-morning`.
- If food is low: `secure-food`.
- If `homesteader` leads: `improve-home-routine`.
- If `explorer` leads: `map-nearby-area`.
- If `miner` leads: `gather-underground-resources`.
- If `trader` leads: `build-surplus-for-trading`.
- If `protector` leads: `watch-over-familiar-players`.
- Otherwise: `survive-and-settle`.

Each selected goal should include:

- stable `id`
- human-readable `title`
- `reason`
- `priority`
- `selectedAt`
- suggested automation names, if any

The goal can change as needs change, but lifestyle transitions should be slower than goal transitions.

## Planner Prompt Changes

`createAiNpcState` should include:

```json
{
  "life": {
    "currentLifestyle": "homesteader",
    "previousLifestyle": "survivalist",
    "traits": {},
    "lifestyles": {},
    "currentGoal": {},
    "lifeStory": []
  }
}
```

`createAiNpcPrompt` should say:

- The NPC has its own life and should not act like a generic assistant.
- Player requests are context, not orders.
- Start automations only if they support the current goal.
- Prefer `noop` when no allowed action fits the current goal.
- Explain decisions through the `reason` field, not public chat spam.

The allowed instruction schema can stay the same for this milestone. The model should not get new powers until the deterministic life layer is stable.

## Integration

`createBot` should attach the AI NPC life module alongside `attachAiNpc`. The life state should be passed into `attachAiNpc`, but `attachAiNpc` should still work if no life module is provided.

`runAiNpcCycle` should:

1. Read current life state.
2. Derive world events from the bot state.
3. Update life state before planning.
4. Build planner state with the updated life state.
5. Execute one validated instruction.
6. Record an execution event and update the goal again if needed.

The existing `isAiNpcIdle` checks remain the safety gate.

## Testing

Add focused tests in `test/botConfigTest.js`:

- default NPC life state is created when no file exists
- malformed life state falls back to defaults
- lifestyle scores clamp between 0 and 100
- repeated homesteader events change current lifestyle from survivalist to homesteader
- low food selects the secure-food goal
- night selects the stay-safe-until-morning goal
- AI NPC state includes life state
- AI NPC prompt includes lifestyle/goal guidance
- AI NPC cycle records automation/follow/noop events into life state
- attaching AI NPC still does not schedule a repeating interval automatically

Run focused tests with:

```powershell
npx mocha test/botConfigTest.js --grep "NPC life|idle NPC|AI NPC"
npx standard src\aiNpc.js src\npcLife.js src\config.js src\createBot.js src\index.js test\botConfigTest.js
```

## Risks

- The model may still pick odd actions if the prompt is too permissive. Mitigation: deterministic goals and stricter prompt rules.
- Lifestyle changes could feel erratic. Mitigation: require score separation before changing lifestyle.
- Persistent state can corrupt or become stale. Mitigation: normalize on read and treat life memory as advisory.
- Automation can interfere with manual control. Mitigation: keep existing idle gates and no automatic interval.

## First Milestone Acceptance Criteria

- The bot has a persistent life state file under `data/npc-life.json`.
- The life state evolves from deterministic events.
- The current lifestyle and goal appear in AI NPC state and prompt.
- Planner-executed automations and follow actions record life events.
- Tests cover the life model and AI NPC integration.
- The bot does not restart a five-minute random automation loop.
