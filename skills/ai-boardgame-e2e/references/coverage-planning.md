# Checkpoint coverage planning

Use this contract when a questionnaire selects `feature_cp`, especially when the objective is to traverse every Adapter-declared checkpoint. It is a planning layer inside the same Adapter-driven E2E framework, not a second runner.

## Required order

1. Finish the questionnaire and resolve the Adapter-derived checkpoint completion requirements.
2. Query immutable historical evidence. Exact reusable checkpoint results are marked complete before route planning.
3. Load the Adapter `coverageModel`, or the conservative catalog-derived model when available.
4. Create a deterministic `CoveragePlan` for the remaining checkpoints.
5. Present its reused checkpoints, UI routes, expected duration, resets, randomness, uncovered checkpoints, and timing limitations in the approval summary.
6. Bind the exact CoveragePlan hash into the approved plan contract.
7. Execute its routes through visible UI and a real Server. Replan only the remaining checkpoints when observed game state makes the active route unavailable.

Never use direct WebSocket messages, Server-state mutation, engine fixtures, source-code state, or hidden player data to reach a checkpoint faster.

## Questionnaire selection

`feature_cp` answers include:

```json
{
  "checkpointCoverage": {
    "mode": "all_declared",
    "checkpointIds": []
  }
}
```

- `all_declared`: target every checkpoint in the selected Adapter CoverageModel. The Adapter is authoritative, so `checkpointIds` remains empty in the questionnaire.
- `selected`: target the explicit stable IDs in `checkpointIds`.

The resolved config's Adapter journeys/scenarios must derive checkpoint completion requirements exactly matching the CoveragePlan targets. If `all_declared` cannot be represented by the existing journey declarations, update the Adapter contract before execution; do not silently omit checkpoints.

## Adapter CoverageModel

An Adapter may export `coverageModel` with schema `1.0`:

```json
{
  "schemaVersion": "1.0",
  "game": "example-game",
  "checkpoints": [
    {
      "id": "cp.visible_boundary",
      "title": "Visible feature boundary",
      "evidenceScope": "public",
      "prerequisiteCheckpointIds": []
    }
  ],
  "setupProfiles": [
    {
      "id": "default",
      "initialStateId": "lobby",
      "gameSettings": {},
      "playerCount": { "min": 3, "max": 6 },
      "setupSeconds": 45,
      "resetSeconds": 15,
      "deterministic": true
    }
  ],
  "routes": [
    {
      "id": "route.shared-boundaries",
      "title": "Reach two compatible boundaries in one journey",
      "coversCheckpointIds": ["cp.visible_boundary"],
      "setupProfileId": "default",
      "startStateId": "lobby",
      "endStateId": "feature_ready",
      "prerequisiteCheckpointIds": [],
      "estimatedSeconds": 90,
      "requiresFreshExecution": false,
      "deterministic": true
    }
  ],
  "transitions": [
    {
      "id": "transition.return-to-lobby",
      "setupProfileId": "default",
      "fromStateId": "feature_ready",
      "toStateId": "lobby",
      "estimatedSeconds": 10,
      "resetKind": "none",
      "deterministic": true
    }
  ]
}
```

Rules:

- IDs are stable lowercase identifiers and unique in their category.
- Checkpoint prerequisites must be acyclic.
- A route lists every checkpoint it can prove during the same legal UI journey. This is how the planner co-locates compatible CPs instead of resetting after each one.
- `startStateId` and `endStateId` describe visible user states, not hidden engine states.
- `setupSeconds`, `resetSeconds`, transition time, and route time are expected wall-clock planning costs. They never prove timing correctness.
- `requiresFreshExecution` means the route cannot reuse the active room/game state.
- `deterministic: false` adds a randomness tie-break penalty; it does not ban the route.
- A route prerequisite describes evidence/state that must already have been reached through another declared route.
- Setup profiles declare required settings and player ranges. The planner uses only profiles whose setting constraints are a subset of the approved request and whose player range matches; it never changes the approved config merely to reach a CP. Route IDs remain globally unique inside one game.

When no explicit model exists, the core may derive a coarse model only from catalog journeys/scenarios that already declare checkpoint completion requirements. Each such journey becomes a fresh route with a conservative baseline. This preserves existing bounded CP journeys but is not enough for a credible `all_declared` claim when the catalog has no CP declarations. Add an explicit model to describe shared states, co-located checkpoints, and realistic costs.

## Deterministic optimization

The planner minimizes lexicographically:

1. expected total wall-clock seconds;
2. number of room/profile resets;
3. number of non-deterministic route/setup dependencies;
4. the complete route-ID sequence in lexical order.

It uses a deterministic uniform-cost search over covered checkpoints, current setup profile, and current visible state. Positive route costs ensure it does not add unrelated checkpoints merely because they exist. Identical model, request, evidence index, and completed-state input must produce the same plan and SHA-256 hash.

Limits are intentionally bounded: a single plan accepts at most 24 relevant checkpoints and 64 routes. Split larger catalogs into Adapter-declared coverage groups rather than accepting an unreviewable path.

## Historical evidence and costs

Exact current-scope evidence can remove a target checkpoint before execution. Free-text, stale-build, audit-failed, timing-incompatible, or scope-mismatched evidence cannot remove it.

Audited historical `coverage_route_completed` durations may refine planning cost without proving the current feature. For the same game, globally unique route ID, player count, and game-settings object, use the median retained duration. Otherwise use the Adapter baseline. Record `costSource` and sample count per route.

Historical cost is optimization input only. It may come from a different product digest because it is not reused as correctness evidence. A new Run still evaluates every non-reused checkpoint under the approved current scope.

## CoveragePlan request and output

Create a request with `scripts/plan-coverage.js`:

```json
{
  "schemaVersion": "1.0",
  "game": "example-game",
  "targetCheckpointIds": ["cp.visible_boundary"],
  "completedCheckpointIds": [],
  "reusedCheckpointIds": [],
  "excludedRouteIds": [],
  "playerCount": 3,
  "gameSettings": {},
  "currentSetupProfileId": null,
  "currentStateId": null
}
```

The output records target, reused, completed, support, pending, and uncovered checkpoint IDs; ordered routes and setup/state transitions; cost source; total expected seconds; resets; randomness; replan linkage; status; and `planSha256`.

`status: "incomplete"` is never a pass. Report the missing Adapter route/model and do not initialize a formal feature Run until the approved plan is complete.

## Runtime evidence and replanning

Append public sanitized events:

- `coverage_plan_created`: approved/current plan hash, the complete sanitized CoveragePlan, unchanged target/reused sets, remaining CPs, route IDs, and estimate;
- `coverage_route_started`: route, setup, visible start state, CPs, and estimate;
- `coverage_route_completed`: route, visible end state, actual wall-clock duration, CPs, and logs-only evidence references;
- `coverage_replanned`: previous/new hashes, exact remaining CP IDs, and concrete observed reason.

Each covered target also needs the normal passing `checkpoint_result`. Route completion does not replace the checkpoint oracle.

Replanning may change only the route for still-uncovered CPs. It must preserve the approved game, target IDs, reused evidence set, completion rules, pass/fail rules, and visible-UI boundary. Create the replacement plan with completed CPs, current setup/state, excluded unavailable routes, and a reason. A material scope change requires new user approval.

The final audit fails when a route is unapproved, start/completion pairing is missing, a replan chain is broken, any target lacks both completed-route and passing checkpoint evidence, or the final active plan is unfinished.
