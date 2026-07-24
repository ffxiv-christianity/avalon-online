# E2E preflight questionnaire

This is the mandatory first reference for every new E2E request. Read this file completely before selecting an Adapter, searching historical evidence, drafting a config, opening a game page, starting a Server, or initializing a Run. This applies to natural-user, feature/checkpoint, bug-reproduction, exploratory, and certification work.

The questionnaire is a planning layer of the single Adapter-driven E2E framework. It does not define a second runner. Ask only for fields that are unanswered or contradictory. If the user delegates a choice to AI, record the concrete selected value and list that field in `delegatedFields`; do not leave it blank.

## Conversation sequence

1. Summarize facts already supplied by the user or a provided config.
2. Inspect the selected Adapter and translate human wording to Adapter journey and scenario IDs. Do not require the user to know IDs.
3. Ask only the missing or conflicting questions below. A single compact batch is preferred when the answers are independent.
4. Create a questionnaire answer JSON and validate it before querying history.
5. Search immutable historical Runs using the resulting objective and direct criterion, checkpoint, or journey IDs.
6. Present a proposed disposition: reuse exact evidence, run only the missing checkpoints, or run the full approved journey.
7. For `feature_cp`, read [coverage-planning.md](coverage-planning.md) and create a deterministic fastest legal-UI CoveragePlan for the non-reused checkpoints.
8. Present the final test contract, including completion, pass, fail, not-evaluated rules, and the CoveragePlan route/estimate when applicable.
9. Require explicit user approval. Approval of an earlier objective, a config, or general permission to test is not approval of a materially changed contract.
10. Only after approval may a new Run be initialized or test-owned resources be created.

## Questions and required answers

### A. Product and user objective

- `game`: Which catalog game or entry URL is in scope?
- `testType`: One of `natural_user`, `feature_cp`, `bug_reproduction`, `exploratory`, or `certification`.
- `objective`: What user-visible outcome, feature claim, bug, or product risk must this test decide?
- `userPerspective`: `first_time_player`, `regular_player`, `experienced_player`, or `mixed_experience`.
- `focusAreas`: One or more generic quality areas from the config schema.

Reject objectives such as “test everything,” “make a particular side win,” or “prove it works.” Rewrite them into a bounded, observable claim and ask the user to approve the rewrite.

### B. Journey and scope

- `journeyIntent`: The human-readable user journey. The resolved config stores Adapter IDs.
- `scenarioIntent`: The targeted condition or `none`. Only Adapter-declared constraints may control gameplay.
- `playerCount`: Number of simulated users.
- `gamesToPlay`: Number of journey executions, not necessarily complete games.
- `gameSettings`: The relevant user-selectable settings. Unspecified Adapter defaults must be shown in the approval summary.
- `speedProfile`: `watch`, `fast`, `accelerated`, or `custom` with its values.
- `reconnectMode`: `none`, `lobby_reload`, or `in_game_reload`.
- `playerBehavior`: Natural behavior mix or explicitly scoped personas. Silence, mistakes, deception, and non-voting are possible behavior, never mandatory global outcomes unless a declared scenario specifically needs that action boundary.
- `checkpointCoverage` for `feature_cp`:
  - `{ "mode": "all_declared", "checkpointIds": [] }` targets the Adapter's complete declared CP set;
  - `{ "mode": "selected", "checkpointIds": ["stable.cp.id"] }` targets only listed CPs.

Do not ask the user to manually order CPs. The CoveragePlan optimizer co-locates compatible CPs and chooses the fastest expected legal UI route after historical reuse. `Traverse every Adapter-declared checkpoint` is bounded only when the Adapter publishes a finite checkpoint set; list those IDs in the approval summary.

### C. Completion and verdict

- `completionStatement`: The visible state proving the selected journey ended. Completion is not the same as success.
- `passRules`: At least one rule with a stable ID, description, and visible oracle.
- `failRules`: At least one rule with a stable ID, description, and severity. Include any P0/P1, isolation, legality, or cross-tab condition that invalidates the result.
- `notEvaluated`: Explicitly list adjacent claims this test cannot prove. An empty array is allowed only after deliberate review.
- `stopConditions`: Limits or states that abort or pause execution, including user intervention and unavailable isolation.

Examples:

- A feature journey may complete when a declared checkpoint is visibly reached, then pass because an enabled and disabled action boundary matches the rule.
- A full-game journey may complete when every tab shows a terminal state, then fail because the normalized results differ.
- An accelerated journey may pass flow logic while real countdown duration remains `not_evaluated`.

### D. Historical evidence policy

- `evidenceReuse.policy`: `prefer_reuse`, `require_new_run`, or `ignore_history`.
- `evidenceReuse.requireCurrentBuild`: Normally `true`. If `false`, the result must be labeled historical and cannot claim the current build passes.
- `evidenceReuse.requireProductionTiming`: Set `true` for real-time claims.

Historical search is read-only and must occur before browser or Server work unless the user explicitly chooses `ignore_history`. Follow [evidence-reuse-contract.md](evidence-reuse-contract.md).

## Questionnaire answer artifact

Store the answer as JSON under the artifact root's `plans/` directory or another user-approved path:

```json
{
  "schemaVersion": "1.0",
  "answers": {
    "game": "gangsi",
    "testType": "feature_cp",
    "checkpointCoverage": {
      "mode": "selected",
      "checkpointIds": ["trap_placement_boundary"]
    },
    "objective": "Verify a user cannot place a trap on protected cells and can place one on a legal adjacent path.",
    "userPerspective": "experienced_player",
    "focusAreas": ["core_gameplay"],
    "journeyIntent": "Reach the Adapter-declared trap placement checkpoint through normal UI play.",
    "scenarioIntent": "Use the Adapter scenario that exposes protected and legal placement cells.",
    "playerCount": 3,
    "gamesToPlay": 1,
    "gameSettings": {},
    "speedProfile": { "profile": "fast" },
    "reconnectMode": "none",
    "playerBehavior": "Adapter-valid natural decisions outside the selected checkpoint.",
    "completionStatement": "The declared placement boundary has been observed and recorded.",
    "passRules": [
      {
        "id": "trap_boundary_visible",
        "description": "Protected cells reject placement while at least one declared legal path accepts placement.",
        "oracle": "visible_ui"
      }
    ],
    "failRules": [
      {
        "id": "illegal_trap_accepted",
        "description": "Any protected cell accepts a trap through enabled visible UI.",
        "severity": "P1"
      }
    ],
    "notEvaluated": ["Complete-game settlement", "Other maps and character combinations"],
    "stopConditions": ["User interacts with a test tab", "Isolated player context is unavailable"],
    "evidenceReuse": {
      "policy": "prefer_reuse",
      "requireCurrentBuild": true,
      "requireProductionTiming": false
    }
  },
  "delegatedFields": [],
  "unanswered": [],
  "conflicts": []
}
```

`unanswered` and `conflicts` must both be empty before a draft test contract can be created.

## Approval summary

Before requesting approval, state all of the following in plain language:

- objective and simulated user perspective;
- selected Adapter journey/scenario, player count, repetitions, and settings;
- visible completion requirements;
- pass, fail, and not-evaluated rules;
- requested and actual speed/timing fidelity, including local capability probe or remote-production not-applicable disposition;
- planned product identity kind: local source or deployed HTML/JS/CSS fingerprint, including any source/Server claims that remain not evaluated;
- historical evidence disposition and cited Run IDs;
- proposed execution: no new Run, minimal missing-checkpoint Run, or full Run;
- for `feature_cp`, target/reused/pending CP IDs, ordered route IDs, expected duration, reset/randomness counts, and any uncovered CP;
- resource ownership and cleanup boundary.

Treat only an explicit affirmative response to this summary as approval. If any field changes afterward, regenerate the draft and ask again.
