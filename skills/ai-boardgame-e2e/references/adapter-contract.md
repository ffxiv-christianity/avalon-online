# Adapter contract 2.2

An Adapter translates a game's visible user experience into the generic E2E contract. The core must not know the game's rules.

## Catalog declaration

Each game declares:

- canonical ID, display name, entry URL, status, and player range;
- `adapterModule` and `adapterContractVersion`;
- existing product test command;
- scalable non-decision waits;
- identity proof and public-communication capability;
- user journeys with stable IDs, human-readable titles, and completion requirements;
- optional targeted scenarios with stable IDs, titles, Adapter-owned parameters, and any additional completion requirements;
- supported visible oracles.

Every game gets one directly linked reference for human-readable UI mapping. Executable validation belongs in its Adapter module, not in core scripts.

## Module interface

An executable Adapter exports:

```text
id
contractVersion
validateSettings(gameSettings, context, errors)
resolvePurpose(testPurpose, context, errors)
publicTimelineFields (optional)
validatePublicEvent(kind, event, context, errors) (optional)
validatePlayerEvent(kind, event, context, errors) (optional)
validateResult(result, context, errors) (optional)
auditRun(context, errors, warnings) (optional)
coverageModel (optional schema 1.0; required for optimized all-checkpoint traversal)
```

Adapter hooks may validate game-specific semantics but must not weaken common evidence, information-isolation, visible-UI, finalization, or logs-only rules.

## Required user-experience map

Define:

1. Semantic DOM for entry, own identity, roster, settings, current phase/state, enabled legal actions, private regions, public communication, timers, terminal state, and next journey.
2. UI-only workflows for every declared journey.
3. Settings schema, defaults, cross-field rules, and player-count limits.
4. Visible DOM to `PlayerObservation` conversion.
5. `PlayerDecision` to semantic UI action mapping and legality checks.
6. Public/private visibility classification for every observed field.
7. Terminal oracle and normalized result schema suitable for cross-tab comparison.
8. Targeted scenarios, owned parameters, controlled actions, expected checkpoints, and untouched autonomous decisions.
9. Non-decision waits eligible for scaling; use an empty list when none exists.
10. Product tests and the certification matrix for declared journeys and scenarios.
11. For checkpoint suites, the visible states, setup profiles, compatible/co-located CP routes, transitions, prerequisite CPs, reset boundaries, expected costs, and randomness flags in a CoverageModel.

Game-specific nouns such as vote, mission, card, role, score, round, map, or assassination remain in this map. Do not promote them to required core fields.

## Common events and invariants

All Adapters use generic evidence where possible:

- `journey_started`
- `coverage_plan_created`
- `coverage_route_started`
- `coverage_route_completed`
- `coverage_replanned`
- `checkpoint_result`
- `journey_completed`
- `phase_observed`
- `action_observed`
- `adapter_checkpoint`
- `usability_observation`
- `terminal_visible`
- `result_detail`
- `criterion_result`

The core always enforces:

- stable tab/player identity;
- isolated player agents and private facts;
- visible legal UI actions only;
- source → Observation → Decision → action ordering;
- every completion requirement derived from the selected journey/scenario declarations;
- one result for every explicit success criterion;
- logs-only evidence and immutable finalization.
- Run-owned resource cleanup under the core lifecycle policy; this is not a game rule and must not be reimplemented by individual Adapters.

## Targeted scenarios

A scenario declares exactly what it controls. For example, an Adapter may control a submission pattern, reconnection point, optional expansion, timer boundary, or unusual legal action. The referee must leave all unrelated strategic decisions autonomous.

Do not use targeted scenario behavior as evidence of typical users. Do not require every game Adapter to implement the same scenario categories.

## One completion contract

There is one E2E execution, evidence, audit, report, and cleanup framework. A complete-game journey and a feature/checkpoint journey differ only in the requirements declared by their Adapter; they are not separate modes or runners.

Each journey declares `completionRequirements`. A selected scenario may add requirements but cannot remove the journey's requirements. The core derives the merged array into the resolved config, and callers cannot weaken or replace it. Requirement kinds are:

- `terminal_visible`: exactly one visible terminal plus an Adapter-valid normalized `result_detail` for each execution;
- `cross_tab_final_state`: one identical normalized final state from every configured player tab;
- `checkpoint`: exactly one passing `checkpoint_result` for its declared `checkpointId`, backed by scoped visible evidence. It defaults to `scope: "per_execution"`; use `scope: "across_run"` when different executions/routes collectively satisfy one finite suite.

Example Adapter declarations:

```json
{
  "id": "complete_game",
  "completionRequirements": [
    { "id": "visible_terminal", "kind": "terminal_visible" },
    { "id": "cross_tab_result", "kind": "cross_tab_final_state" }
  ]
}
```

```json
{
  "id": "verify_feature_boundary",
  "completionRequirements": [
    { "id": "feature_boundary_visible", "kind": "checkpoint", "checkpointId": "feature_boundary_visible" }
  ]
}
```

Every execution appends one `journey_completed` per selected journey after its requirements are satisfied. Its `requirementIds` contains every per-execution requirement plus the run-scoped requirements evidenced in that execution. Across all executions, those IDs plus approved reused checkpoints must cover the resolved contract. Checkpoint evidence may reference public visible DOM as `public:<evidenceId>` or one player's private visible DOM as `<playerId>:<evidenceId>`. Public `checkpoint_result` and `journey_completed` events contain only verdict metadata and references, never private evidence content.

A feature/checkpoint journey keeps the same product tests, real Server/UI interaction, player identity and decision isolation, source provenance, success criteria, product digest verification, and cleanup. Its pass proves only the declared requirements and criteria; it does not certify complete-game settlement, unrelated rules, normal-user behavior, or the entire Adapter.

`gamesToPlay` remains the compatibility field name and means journey execution count. A full-game journey therefore counts games; a shorter journey counts repetitions of that same journey.

## CoverageModel extension

Read [coverage-planning.md](coverage-planning.md) before defining CP traversal. CoverageModel is declarative Adapter metadata consumed by the generic deterministic planner; it is not executable game logic and does not create another runner.

Declare stable checkpoints, setup profiles, visible states, routes, and transitions. Put every CP that can be proven in the same legal UI state/journey on the same route so the planner may avoid redundant setup. Mark a fresh-game requirement and non-deterministic dependency explicitly. Cost estimates describe expected wall-clock planning cost only and cannot serve as timing evidence.

If an Adapter has catalog journeys with checkpoint completion requirements but no explicit CoverageModel, the core may derive one conservative fresh route per journey. This compatibility fallback cannot invent undeclared CPs or co-location and should be replaced before claiming meaningful `all_declared` optimization.

The planner reuses only exact checkpoint evidence, then minimizes expected wall-clock seconds, resets, randomness, and route ID in that order. Historical route duration medians may replace cost estimates but never replace current correctness evidence. A model with an unreachable requested checkpoint produces `incomplete`, never pass.

## Adding a feature/CP journey

Add feature or checkpoint coverage by extending the selected game Adapter, never by forking the core framework:

1. Give the user journey a stable ID, visible start state, semantic UI path, and explicit stop state.
2. Declare the minimum `completionRequirements`. Use checkpoints only for product behavior visible to one or more player tabs; keep terminal/cross-tab requirements when the objective needs them.
3. If setup must be constrained, add a targeted scenario that owns only those parameters/actions. Unrelated player choices remain autonomous.
4. Validate game-specific checkpoint payloads in Adapter hooks. The core validates evidence scope, ordering, isolation, cardinality, finalization, and cleanup.
5. Define success criteria separately from completion. Reaching a checkpoint means the journey finished; whether the observed behavior is correct is the criterion/product verdict.
6. Stop once all requirements and criteria have evidence, then use the normal `journey_completed`, cleanup, product verification, audit, and report path.

Do not use source code, Server state, engine fixtures, or another player's private log as a CP oracle. Do not add a core `if (game === ...)` branch or tune a second player/runner model for feature tests.

## Discovery workflow

For a planned game:

1. Run only `exploratory` with `allowDiscovery: true`.
2. Inspect visible DOM and accessible names as a first-time user.
3. Map entry, identity, settings, phase transitions, legal actions, private regions, public state, and terminal oracles.
4. Draft the catalog capabilities, game reference, and module validation.
5. Add deterministic schema/UI tests.
6. Promote to `experimental` before any formal gameplay verdict.

Discovery may identify product defects, but absence of an Adapter is `not_evaluated`, not a passing product result.

## Certification gates

A planned Adapter may run one explicitly authorized certification candidate without changing Catalog status when its Catalog entry declares an enabled, narrowly bounded `certificationCandidate` policy. The resolved config must set `certificationCandidate: true` and match every authorized approach, player count, and setting profile. This exception exists only to collect the first real evidence: validation or initialization does not promote the Adapter, and an incomplete, aborted, failed, or unaudited candidate leaves every status and evidence array unchanged.

For every promoted Adapter, retain logs-only real Runs proving:

- exact product-preflight command and one honest stable identity: local Git/source digest/dirty flag, or a recomputable deployed HTML/JS/CSS manifest fingerprint under [product-identity.md](product-identity.md);
- actual Server/capability mode;
- isolated-agent provenance for every player;
- Adapter-declared identity proof before the first journey action;
- provenance for every Observation and Decision;
- required scenario checkpoints when scenarios are selected;
- every Adapter-derived completion requirement and one matching `journey_completed` per execution;
- every success criterion evaluated from its declared visible oracle;
- unchanged post-game product digest and one final `run_finished`.

Use statuses:

- `planned`: discovery only;
- `experimental`: real execution with explicit opt-in, not formal support certification;
- `supported`: declared journeys, settings, tests, isolation audit, results, and at least one production-time Run passed.

Do not mark an Adapter supported solely from schema tests, engine tests, or an exploratory Run.
