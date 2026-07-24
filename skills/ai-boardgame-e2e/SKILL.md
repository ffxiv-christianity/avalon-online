---
name: ai-boardgame-e2e
description: Plan, optimize, execute, and audit real multiplayer web board-game E2E tests from a user's perspective using a mandatory preflight questionnaire, conservative historical-evidence reuse, deterministic all-checkpoint route planning, explicit plan approval, isolated AI players, adjustable speed, logs-only evidence, per-game Adapters, and ownership-safe cleanup. Use when Codex must define or ask for a test objective, traverse all or selected checkpoints by the fastest legal UI path, reuse prior Run evidence, test any catalog game or discover a missing Adapter, vary player counts/settings/journeys/scenarios, verify private-information isolation, certify a game Adapter, or debug a visible feature without hard-coding one game's rules into the core workflow.
---

# AI Boardgame E2E

Test the visible website and real Server as users experience them. Keep game rules, settings, phases, actions, timers, and result structure inside the selected Adapter. Keep the Skill core limited to planning, user journeys, legal UI interaction, information isolation, evidence, and audit integrity.

**Mandatory first action:** read [e2e-questionnaire.md](references/e2e-questionnaire.md) completely before planning any E2E request, including a provided config, feature/checkpoint request, history-only question, or request to “just run” a test. Do not open the game, start a Server, initialize a Run, or create test-owned resources before the questionnaire, historical-evidence disposition, and explicit approval are complete.

## Plan the test before opening the game

After the mandatory questionnaire, read [test-planning.md](references/test-planning.md) and [config-schema.md](references/config-schema.md). For every `feature_cp` request, also read [coverage-planning.md](references/coverage-planning.md) before proposing execution.

1. If the user supplied a complete `schemaVersion: "1.1"` config, validate it.
2. Otherwise ask only the unanswered questionnaire items: game, user perspective, objective, focus areas, journeys, targeted scenarios, player count, journey repetitions, settings, speed, reconnect coverage, and player styles.
3. If the user says “you decide,” inspect the catalog and Adapter, choose a small high-value plan, and record `selectionSource: "ai_recommended"` plus a concrete rationale. Never silently invent an objective.
4. Turn the answers into an explicit `testPurpose` with observable success criteria. A criterion describes user-visible behavior, not an expected winner or strategy answer.
5. Let the selected Adapter journey/scenario derive one immutable `completionRequirements` array. Complete-game and feature/checkpoint tests use the same framework; only their requirements differ.
6. Save the reusable config under the artifact root's `configs/`. Default to `D:\Codex\avalon-online\tests\AI_E2E` for this project.
7. Validate the questionnaire artifact. `unanswered` and `conflicts` must be empty. A delegated field still needs a concrete recorded value.
8. Read [evidence-reuse-contract.md](references/evidence-reuse-contract.md), compute the current product digest when required, and query retained Runs before any browser or Server work unless the approved policy is `ignore_history`.
9. Present the proposed evidence disposition and execution scope. Free-text matches are candidates only; exact reuse requires direct IDs and every freshness/scope gate.
10. For `feature_cp`, create a deterministic CoveragePlan after exact reuse removes proven CPs. `all_declared` targets every Adapter CoverageModel checkpoint. Optimize expected wall-clock time, then resets, randomness, and route ID; never optimize through hidden state or non-UI shortcuts.
11. Create a draft plan contract and summarize completion, pass, fail, not-evaluated, speed/timing, evidence reuse, CoveragePlan routes/uncovered CPs, execution scope, and cleanup boundaries.
12. Ask for explicit user approval. Only after the user approves that exact summary may the approval artifact be created. Any material change invalidates approval and requires a new draft.

Use these approaches:

- `natural_user`: let isolated players make bounded, fallible, human-like decisions. Do not prescribe actions, mistakes, winners, or outcomes.
- `targeted_scenario`: exercise only scenario IDs declared by the Adapter. The Adapter owns scenario parameters and validity.
- `mixed`: combine an ordinary user journey with selected Adapter scenarios while leaving unrelated decisions autonomous.
- `exploratory`: inspect a planned game through visible DOM to discover user journeys and draft its Adapter. It cannot produce a passing certification Run.

Do not make core-wide concepts such as “vote,” “mission,” “hand,” “round,” “role,” or “score” mandatory. They belong to whichever Adapter declares them.

## Select or discover an Adapter

Read [game-catalog.json](references/game-catalog.json) and [adapter-contract.md](references/adapter-contract.md).

- For `supported` and `experimental` entries, load the catalog's `adapterModule` and directly linked game reference.
- Require `allowExperimental: true` for an experimental formal Run.
- For a `planned` entry, normally allow only `exploratory` with `allowDiscovery: true`. A formal `certificationCandidate: true` Run is allowed only when the Catalog explicitly enables and bounds its approach, player count, and settings and the user explicitly authorizes that candidate. Keep the Catalog status `planned` until the Run passes.
- Treat Adapter-declared journeys, scenarios, settings, oracles, and scalable waits as capabilities. The core validates identifiers and delegates game semantics to the Adapter.

Legacy `schemaVersion: "1.0"` One Night Werewolf configs and Runs remain readable for compatibility. Create new work with `1.1`.

## Validate and initialize

Query history and create the approval contract first:

```text
node <skill>/scripts/validate-config.js --config <config.json>
node <skill>/scripts/index-evidence.js --runs <artifact-root>/runs --output <index.json>
node <skill>/scripts/query-evidence.js --index <index.json> --query <query.json> --output <assessment.json>
node <skill>/scripts/plan-coverage.js --request <coverage-request.json> --index <index.json> --evidence <assessment.json> --output <coverage-plan.json>
node <skill>/scripts/plan-contract.js draft --questionnaire <answers.json> --config <config.json> --evidence <assessment.json> --coverage <coverage-plan.json> --output <draft-plan.json>
```

Omit the CoveragePlan command and `--coverage` only for non-`feature_cp` work. If a requested game has no Adapter-declared checkpoints/model, report the missing Adapter capability; do not invent CPs in the core.

After presenting the draft and receiving explicit user approval:

```text
node <skill>/scripts/plan-contract.js approve --plan <draft-plan.json> --approved-by user --confirmation APPROVE --output <approved-plan.json>
node <skill>/scripts/plan-contract.js verify --plan <approved-plan.json> --config <config.json>
node <skill>/scripts/init-run.js --config <config.json> --plan <approved-plan.json>
```

If the approved decision is `reuse_only`, cite the immutable evidence and do not initialize a Run. Otherwise stop after any validation or approval failure, preserve old Runs, and use the emitted unique directory. New schema 1.1 Runs cannot initialize without an approved plan whose questionnaire, config, and evidence-assessment hashes still match.

A certification candidate is an execution gate, not a promotion. Record the Catalog authorization in the resolved config and Run evidence; never broaden it to another approach, player count, or setting profile without a new explicit authorization.

## Preflight the environment

Read [speed-profiles.md](references/speed-profiles.md), [product-identity.md](references/product-identity.md), and [resource-lifecycle.md](references/resource-lifecycle.md).

1. Confirm the Adapter entry URL is reachable.
2. Select one honest product identity. For a local checkout-bound Server, run its existing product tests and record `local_source`. For a deployment without verifiable source provenance, capture `deployed_web_assets` from the entry HTML and its referenced JS/CSS and state the narrower preflight scope; never copy the local Git/source digest into deployment evidence.
3. Reuse a healthy Server for production-time profiles. For local scale below 1, require loopback, matching `/__ai-e2e/capabilities`, and Adapter-declared scalable waits. For an unowned remote deployment at scale 1, do not probe any private capability endpoint; record `not_applicable_remote_production` instead.
4. Ask before stopping or replacing a running Server.
5. Use the Browser skill and in-app browser for all game actions. Do not play through direct WebSocket, Server state, fixtures, or standalone automation.
6. Create a task-local ownership ledger before opening tabs or starting processes. Record exact identity for every resource this Run creates; resources that already exist are reused, never owned.

## Create isolated users

Read [isolation-protocol.md](references/isolation-protocol.md). Act as referee, not strategist.

For each configured player:

1. Create one persistent subagent with `fork_turns: "none"`.
2. Give it no tools, browser, project, filesystem, other-player context, or referee secrets.
3. Give it only its persona, user perspective, legally visible Observation, legal actions, own memory, and game objective when legally visible.
4. In `natural_user`, request a plausible bounded-user decision under uncertainty. Never inject the correct answer or require a lie, silence, error, action, or win.
5. In a targeted scenario, constrain only the actions explicitly owned by that Adapter scenario. Leave every other strategic choice with the player.
6. Record unique agent provenance before play. Abort a formal Run if isolated agents are unavailable.

## Execute Adapter-declared user journeys

1. Open one tab per player and keep a stable `tab -> playerId` map.
2. Execute the selected `journeyIds` through semantic visible controls. When an approved CoveragePlan exists, append `coverage_plan_created` and follow its ordered routes.
3. Prove identity using the Adapter's declared identity oracle. Use exact chat messages only when the game exposes shared chat; otherwise use own-identity DOM plus cross-tab isolation.
4. Configure every room/game setting through UI and verify the rendered value.
5. Before each material action, read the current tab only and build `PlayerObservation` provenance objects.
6. Ask the owning player for `PlayerDecision`; validate it against visible `legalActions` and the Adapter action map.
7. Execute the valid decision in that player's tab. The referee may perform only deterministic single-option acknowledgements.
8. Record public communication only after it renders in shared UI.
9. Record phase, action, timer, usability, and Adapter checkpoints with generic event types. Do not infer hidden Server state.
10. Satisfy the Adapter-derived completion requirements. `terminal_visible` requires a visible terminal and Adapter-valid normalized result; `cross_tab_final_state` requires the same normalized result from every player tab; `checkpoint` requires scoped visible evidence plus `checkpoint_result`. Requirements default to `per_execution`; checkpoints explicitly marked `across_run`, or targeted by an approved CoveragePlan, are satisfied once across the Run and distributed to the execution that produced their evidence.
11. Around every CoveragePlan route append `coverage_route_started` and `coverage_route_completed` with actual duration and evidence refs. If visible random/current state makes a route unavailable, replan only remaining CPs, log `coverage_replanned`, and preserve the approved objective and verdict rules.
12. After each execution's requirements are satisfied, append one `journey_completed` per selected journey. List every per-execution requirement plus only the run-scoped checkpoints actually evidenced in that execution; their union with approved reused checkpoints must satisfy the full Run contract. Do not fabricate terminal, final-state, or checkpoint evidence that the journey does not reach.
13. Evaluate each configured success criterion with its declared visible oracle. Gameplay outcomes do not determine the E2E verdict unless the stated objective specifically tests that outcome rule.

Pause immediately if the user interacts with a test tab.

## Write logs only

Use the writer after every material observation, decision, public UI action, phase transition, criterion result, and terminal result:

```text
node <skill>/scripts/append-event.js --run <run-dir> --scope player --player P1 --kind observation --input <event.json>
node <skill>/scripts/append-event.js --run <run-dir> --scope player --player P1 --kind decision --input <event.json>
node <skill>/scripts/append-event.js --run <run-dir> --scope public --kind timeline --input <event.json>
```

Never create screenshots or image evidence. Keep private DOM and console facts in the owning player's directory until the product itself exposes them publicly. Use generic public events such as `journey_started`, `coverage_plan_created`, `coverage_route_started`, `coverage_route_completed`, `coverage_replanned`, `phase_observed`, `action_observed`, `adapter_checkpoint`, `checkpoint_result`, `journey_completed`, `usability_observation`, `terminal_visible`, `result_detail`, and `criterion_result`. Adapter-specific payloads must pass the Adapter validator.

The writer serializes concurrent appends, assigns immutable timestamps and order, and uses resumable two-phase finalization. Never batch-recover missing evidence or append after `run_finished`.

## Clean up Run-owned resources

Follow [resource-lifecycle.md](references/resource-lifecycle.md) on every exit path, including success, failure, abort, timeout, and user-requested stop.

Close or stop only resources recorded as created by this Run and whose identity still matches. Release isolated players, close Run-owned tabs/contexts, stop Run-started processes/Servers, and remove Run-created temporary runtime files. Preserve reused Servers, user tabs, other tasks' resources, and the immutable Run evidence directory. If ownership is uncertain, preserve the resource and report it instead of guessing.

After all available game evidence is written, append exactly one `resource_cleanup` event. A new complete Run cannot pass unless cleanup status is `passed`, reused resources were preserved, and no Run-owned resource remains unresolved.

## Audit and report

1. Complete resource cleanup after the last journey and append `resource_cleanup`.
2. Recompute the same product identity kind. Fail if the local source identity or deployed asset manifest changed during play.
3. Append `product_build_verified` immediately before finalization.
4. Finalize once with actual status, verdict, findings, journey/game results, isolation, Server/capability data, agent provenance, and product identity.
5. Let finalization run deterministic audit and reporting. Re-run manually only when inspecting:

```text
node <skill>/scripts/audit-run.js --run <run-dir>
node <skill>/scripts/build-report.js --run <run-dir>
```

Fail a formal result for P0, unresolved P1, decision-isolation failure, invalid provenance, illegal UI action, missing required criterion evidence, public secret leakage, image evidence, or inconsistent terminal results. Report timing fidelity separately. Report natural-user behavior distributions descriptively; never set a required lie, error, action, or win rate.

## Add game support

Create or revise one Adapter at a time. Keep game-specific selectors, schemas, scenarios, timers, results, coverage checkpoints/routes/states/costs, and audit hooks outside the core. Declare each journey's completion requirements and optional CoverageModel instead of creating a second runner or completion framework. Promote `planned -> experimental -> supported` only through the evidence gates in [adapter-contract.md](references/adapter-contract.md). The goal is broad game availability through consistent Adapter principles, not one universal hard-coded rule flow.
