# Configuration schema

Create new configs with `schemaVersion: "1.1"`. Version `1.0` is compatibility-only for retained One Night Werewolf Runs.

The config is only the executable portion of the approved test contract. Before initializing a new 1.1 Run, complete [e2e-questionnaire.md](e2e-questionnaire.md), query history under [evidence-reuse-contract.md](evidence-reuse-contract.md), create a CoveragePlan under [coverage-planning.md](coverage-planning.md) for `feature_cp`, and create an approved plan with `scripts/plan-contract.js`. `init-run.js` rejects a new 1.1 Run without a matching approved plan. Existing immutable Runs and direct library fixtures remain readable without retroactive approval files.

## Generic config

```json
{
  "schemaVersion": "1.1",
  "game": "onenightwolf",
  "playerCount": 5,
  "gamesToPlay": 3,
  "gameSettings": {
    "deckPreset": "recommended",
    "discussionSeconds": 300
  },
  "testPurpose": {
    "selectionSource": "ai_recommended",
    "objective": "Verify first-time users can create, join, complete, and understand a game without private-information leakage.",
    "approach": "natural_user",
    "userPerspective": "first_time_player",
    "focusAreas": ["onboarding", "core_gameplay", "information_isolation", "result_consistency"],
    "journeyIds": ["create_join_complete_game"],
    "scenarioIds": [],
    "completionRequirements": [
      { "id": "cross_tab_result", "kind": "cross_tab_final_state" },
      { "id": "visible_terminal", "kind": "terminal_visible" }
    ],
    "scenarioParameters": {},
    "successCriteria": [
      {
        "id": "complete_visible_journey",
        "description": "Every player reaches the same visible terminal result through legal UI actions.",
        "oracle": "cross_tab_consistency",
        "required": true
      },
      {
        "id": "private_views_isolated",
        "description": "No player tab or agent receives another player's private information before the terminal state.",
        "oracle": "visible_ui",
        "required": true
      }
    ],
    "recommendationRationale": "A short natural-user journey validates broad playability before targeted rule scenarios."
  },
  "speed": { "profile": "fast" },
  "players": [],
  "interaction": {
    "maximumDecisionPasses": 3,
    "allowInaction": true,
    "userPacing": "human_like"
  },
  "evidence": { "mode": "logs_only" },
  "reconnect": { "mode": "none" },
  "resourceLifecycle": {
    "policyVersion": "1.0",
    "cleanupAfterRun": true
  },
  "limits": {
    "maxInvalidDecisions": 3,
    "maxDecisionSeconds": 120,
    "maxMinutesPerGame": 30
  },
  "allowExperimental": true,
  "allowDiscovery": false,
  "certificationCandidate": false,
  "artifactRoot": "D:\\Codex\\avalon-online\\tests\\AI_E2E"
}
```

## Purpose fields

- `selectionSource`: `user_questionnaire`, `ai_recommended`, or `provided_config`.
- `objective`: required plain-language product objective. Validation never invents it.
- `approach`: `natural_user`, `targeted_scenario`, `mixed`, or `exploratory`.
- `userPerspective`: `first_time_player`, `regular_player`, `experienced_player`, or `mixed_experience`.
- `focusAreas`: one or more generic user-visible quality areas.
- `journeyIds`: one or more IDs declared by the selected Adapter.
- `scenarioIds`: Adapter-declared IDs. Required for `targeted_scenario`; forbidden for `natural_user`.
- `completionRequirements`: derived from selected Adapter journey/scenario declarations. Resolved configs record it; callers may omit it, but cannot weaken or replace it. Requirement kinds are `terminal_visible`, `cross_tab_final_state`, and `checkpoint`. Requirements default to `scope: "per_execution"`; checkpoint requirements may declare `scope: "across_run"`. Approved CoveragePlan targets are treated as `across_run` for compatibility even when an older Adapter omitted the field.
- `scenarioParameters`: Adapter-owned parameters. The core does not interpret them.
- `successCriteria`: unique IDs with description, observable oracle, and `required` flag. `scope` is optionally `per_execution` or `across_run`; criteria default to per-execution except an approved CoveragePlan defaults its suite-level criteria to across-run.
- `recommendationRationale`: required when AI selected the plan.

Generic focus areas are `onboarding`, `room_flow`, `settings`, `core_gameplay`, `information_isolation`, `timing`, `reconnect`, `usability`, `accessibility`, `result_consistency`, and `custom`.

## Adapter ownership

The selected Adapter validates:

- `gameSettings`
- player range beyond catalog limits
- legal journey/scenario combinations
- `scenarioParameters`
- game-specific timers and scalable waits
- semantic actions, phases, private regions, terminal state, and result structure

Do not add game-specific fields to the core schema merely because one game needs them.

## Players and interaction

An empty `players` array generates `P1...Pn` with rotating reasoning styles. Explicit players require unique safe `id`, unique `name`, non-empty `style`, and optional `traits`.

`interaction.maximumDecisionPasses` is 0–20. `allowInaction` permits waiting, silence, skipping, or another Adapter-legal no-op. `userPacing` is `human_like`, `deliberate`, or `fast_decisions`; wall-clock safety limits remain unchanged.

## Discovery config

A planned game may only discover an Adapter:

```json
{
  "schemaVersion": "1.1",
  "game": "avalon",
  "playerCount": 5,
  "gamesToPlay": 1,
  "gameSettings": {},
  "testPurpose": {
    "selectionSource": "user_questionnaire",
    "objective": "Map the visible create/join/start/terminal user journeys and draft an Adapter.",
    "approach": "exploratory",
    "userPerspective": "first_time_player",
    "focusAreas": ["onboarding", "room_flow", "core_gameplay"],
    "journeyIds": ["discover_user_journeys"],
    "scenarioIds": [],
    "successCriteria": [{
      "id": "draft_adapter_map",
      "description": "Visible journeys, settings, actions, private regions, and terminal oracles are documented.",
      "oracle": "visible_ui",
      "required": true
    }]
  },
  "speed": { "profile": "watch" },
  "allowDiscovery": true,
  "evidence": { "mode": "logs_only" }
}
```

Exploratory Runs cannot certify the game or produce a formal product pass.

## Feature/checkpoint journey

A narrow feature test uses the same config and Run framework. Select an Adapter-declared feature journey and scenario; the Adapter supplies checkpoint requirements, while the caller supplies the objective and visible success criteria:

```json
{
  "testPurpose": {
    "selectionSource": "provided_config",
    "objective": "Verify one visible feature boundary through the normal user UI.",
    "approach": "targeted_scenario",
    "userPerspective": "experienced_player",
    "focusAreas": ["core_gameplay", "information_isolation"],
    "journeyIds": ["adapter_declared_feature_journey"],
    "scenarioIds": ["adapter_declared_feature_scenario"],
    "scenarioParameters": {},
    "successCriteria": [{
      "id": "feature_boundary_visible",
      "description": "The allowed and disallowed visible actions match the declared boundary.",
      "oracle": "visible_ui",
      "required": true
    }]
  }
}
```

The resolved config adds the Adapter-derived `completionRequirements`. Each execution records the same identity, isolation, Observation/Decision, visible action, `journey_completed`, product-integrity, and cleanup evidence as any other Run. A per-execution criterion or requirement repeats for every execution. An across-run checkpoint/criterion is recorded exactly once in the execution where its visible evidence becomes complete. A checkpoint requirement additionally records scoped private/public visible evidence plus `checkpoint_result`. Do not interpret a narrow journey pass as complete-game certification.

The questionnaire, not the config, selects `checkpointCoverage.mode` as `all_declared` or `selected`. The separate immutable CoveragePlan orders the required Adapter routes after historical reuse and is hash-bound into `plan.approved.json`. Its target IDs must exactly equal the resolved checkpoint completion requirements. Runtime replanning may change only the path for remaining CPs, never this config's objective, requirements, or verdict rules.

## Common boundaries

- `gamesToPlay`: 1–20 journey executions. For a full-game journey these are games; for a shorter journey these are repetitions.
- `speed.profile`: `watch`, `fast`, `accelerated`, or `custom`.
- Capability evidence follows the resolved entry URL: local Servers probe only the loopback private endpoint; `reused_remote_not_owned` production deployments at scale 1 record `not_applicable_remote_production` with no endpoint or response.
- `reconnect.mode`: `none`, `lobby_reload`, or `in_game_reload`.
- `evidence.mode`: only `logs_only`; reject screenshot settings.
- `resourceLifecycle`: a Skill-owned fixed policy. `cleanupAfterRun` is always `true` and cannot be disabled by a game Adapter or config.
- `allowExperimental`: required for formal experimental Adapters.
- `allowDiscovery`: required for planned-game exploration.
- `certificationCandidate`: execution-only exception for a planned Adapter. It requires explicit user authorization plus a matching Catalog policy for approach, player count, and settings. It does not promote the Adapter or provide certification by itself.
- Wall-clock decision/game limits never inherit Server time scaling.
