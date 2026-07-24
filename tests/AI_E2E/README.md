# AI Boardgame E2E

This directory stores reusable configs and logs-only real-game Runs for the generic `ai-boardgame-e2e` Skill.

## Current architecture

The Core represents a user test, not one game's rules. New `schemaVersion: "1.1"` configs explicitly record:

- who the simulated user is;
- the test objective and focus areas;
- Adapter-declared user journeys;
- optional Adapter-declared targeted scenarios;
- observable success criteria;
- player count, journey repetitions, settings, speed, reconnect, and personas.

Game settings, rules, phases, legal actions, timers, private regions, terminal oracle, and result schema belong to each Adapter. Terms such as vote, mission, role, hand, round, score, or map are never mandatory Core concepts.

Runs use one requirement-driven completion contract. Full-game journeys typically require a visible terminal plus matching final state from every tab; feature/CP journeys may require only Adapter-declared visible checkpoints. Both use the same player isolation, evidence writer, audit, report, and cleanup path. A narrow pass proves only its declared requirements and criteria; it does not certify complete-game flow or unrelated settings.

Feature/CP work additionally uses one hash-bound CoveragePlan inside that same framework. An Adapter declares checkpoints, visible states, setup profiles, compatible shared routes, transitions, expected cost, reset boundaries, and randomness. The planner removes exactly reusable CP evidence, then chooses the minimum expected wall-clock route; ties prefer fewer resets, less randomness, and lexical route ID. CoveragePlan targets form one finite Run-level set: three routes across three executions still require one result per target, not the full target set three times. Missing routes produce an incomplete plan, not a passing result.

## Planning choices

Every new E2E request begins with the Skill's mandatory `references/e2e-questionnaire.md`, even when the user supplies a config or asks for a narrow feature test. The completed questionnaire defines objective, scope, completion, pass, fail, not-evaluated, timing, history-reuse, and cleanup boundaries. The Skill asks only missing or conflicting fields and requires explicit approval of the resolved contract before initializing a schema 1.1 Run.

Before opening a game or starting a Server, the Skill builds a sanitized read-only index of retained Runs and queries direct criterion/checkpoint/journey IDs. Exact current-build evidence can answer the request without a new Run; partial evidence reduces execution to missing requirements; stale or scope-mismatched evidence is historical context only. Free-text matches never prove an exact pass by themselves, and the index never copies private observations or rationales.

For a request to traverse all CPs, the questionnaire records `checkpointCoverage.mode: "all_declared"`; the user does not manually order CPs. Audited prior route durations can improve the time estimate, while all non-reused CPs still require new visible-UI evidence. Runtime replanning is limited to still-uncovered CPs when observed state invalidates a route.

- `natural_user`: autonomous bounded users; no forced winner, action, mistake, or behavior quota.
- `targeted_scenario`: controls only an Adapter-declared scenario.
- `mixed`: natural journey plus selected scenario checkpoints.
- `exploratory`: discovers a planned game's visible journeys and drafts its Adapter; cannot certify the game.

The test purpose may come from a user questionnaire, provided config, or explicit AI recommendation. AI-selected plans must include a rationale and cannot silently change the objective during a Run.

## Generic evidence

New Runs use generic events such as:

- `journey_started`
- `coverage_plan_created`
- `coverage_route_started`
- `coverage_route_completed`
- `coverage_replanned`
- `phase_observed`
- `action_observed`
- `adapter_checkpoint`
- `checkpoint_result`
- `journey_completed`
- `usability_observation`
- `terminal_visible`
- `result_detail`
- `criterion_result`
- `resource_cleanup`

All operations use visible semantic UI and a real Server. No screenshots or image evidence are allowed. Private facts remain in the owning player's directory until visibly public.

## Resource lifecycle

Every newly initialized Run uses `resourceLifecycle.policyVersion: "1.0"` with `cleanupAfterRun: true`; this policy cannot be disabled by a config or Adapter. On success, failure, abort, timeout, or user stop, the runner closes only tabs/contexts it created, releases its isolated players, stops only exact processes/Servers it started, and removes only its temporary runtime files. Reused Servers, user tabs, other tasks' resources, and Run evidence are preserved.

A complete Run must append one passing `resource_cleanup` event after final-state evidence and before `product_build_verified`. Uncertain ownership is preserved and reported, never guessed.

Formal product identity is honest to the tested surface. A checkout-bound local Server records Git/source-tree identity. An independently deployed URL records a recomputable manifest fingerprint of the final entry HTML and its referenced JS/CSS; it does not claim the local checkout's commit or digest. The same identity kind and value must match before and after the Run.

Capability evidence follows the Server boundary: accelerated and local production Servers probe only the loopback `__ai-e2e` endpoint, while an unowned remote production deployment at scale 1 records `not_applicable_remote_production` without an endpoint or fabricated response. Remote E2E never probes or exposes a private capability route.

## Adapter status

- `planned`: exploratory discovery only.
- `experimental`: real execution with explicit opt-in.
- `supported`: declared journeys/settings/scenarios, product tests, strict Runs, information isolation, cross-tab results, and production-time evidence have passed.

All five current catalog games have executable experimental Adapter contract 2.2 implementations:

- One Night Werewolf: executable, but retained strict certification evidence still needs replacement under the current original-UI contract.
- Avalon: five-player baseline evidence passes; assassination and expansion profiles remain incomplete.
- Criminal Dance: eight-player base-game evidence passes; smaller counts and expansions remain incomplete.
- Love Letter: two-player default and four-player custom-target evidence pass; the broader matrix remains incomplete.
- Gangsi: three-player Classic fixed-map and Hunt random-map evidence pass; broader player/map/ability coverage remains incomplete.

`experimental` means the mapped profiles can run with explicit opt-in. It does not mean the entire game's configuration matrix is `supported`.

## Repository policy

Commit the Skill source, Adapters, references, deterministic tests, and reusable configs. Do not commit the installed personal Skill copy or the full `runs/` tree by default. Retain selected immutable passing Runs in private CI/object storage with product/config/audit/artifact hashes, and keep only a curated certification index in Git. If complete raw evidence must live in the repository, use a private repository with Git LFS and explicitly review each accepted Run.

## Compatibility

Existing `schemaVersion: "1.0"` One Night Werewolf configs and retained Runs remain available for regression comparison. Their `natural_play`, `behavior_matrix`, and `rules_matrix` fields are legacy Adapter-specific syntax and must not be used as the Core model for new games.

Some compatibility Runs used temporary E2E-induced UI that was not part of the original game, including 120/900-second discussion choices or a dawn private-result region. Compatibility Runs are not strict 1.1 certification evidence. Do not overwrite them.
