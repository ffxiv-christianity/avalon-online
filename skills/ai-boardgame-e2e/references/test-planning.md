# Test planning

The complete and mandatory question set is [e2e-questionnaire.md](e2e-questionnaire.md). Read it first. This reference explains how to translate the approved answers into one Adapter-driven journey; it must not introduce a second questionnaire or runner.

Ask only unanswered or contradictory fields. “AI decides” delegates selection but does not remove the field: record a concrete value and list it in `delegatedFields`. Do not ask the user to know Adapter identifiers. Present human-readable catalog titles, then store selected IDs in the resolved config.

Before browser or Server work, follow [evidence-reuse-contract.md](evidence-reuse-contract.md). Historical evidence determines whether the approved scope needs no new Run, a minimal missing-checkpoint Run, or a full Run. It never changes the objective or verdict rules without renewed user approval.

For `feature_cp`, also follow [coverage-planning.md](coverage-planning.md). When the user requests every CP, treat the finite Adapter CoverageModel as the boundary, remove exactly reusable CPs, and let the deterministic planner order/co-locate the remainder. Do not ask the user to design a route the Adapter can calculate.

## AI recommendation

When the user delegates planning:

1. Inspect Adapter capabilities and current status.
2. Prefer one small complete user journey at production time before long or targeted coverage.
3. Use `natural_user` for general playability and usability objectives.
4. Add a targeted scenario only when it directly answers the stated risk; never select every scenario by default.
5. For a narrow regression or debugging objective, select a journey with sufficient checkpoint requirements. For complete-flow and settlement claims, select a journey requiring terminal and cross-tab result evidence. Both use the same Run framework.
6. Prefer first-time-player perspective for onboarding uncertainty and mixed experience for social multiplayer interactions.
7. Include information isolation and result consistency whenever the game has multiple private views.
8. Derive observable criteria from visible UI or cross-tab consistency, never from hidden Server state.
9. Record `selectionSource: "ai_recommended"` and explain the tradeoff in `recommendationRationale`.

AI recommendation is an explicit plan, not permission to change the objective mid-Run. If visible evidence reveals a different risk, finish or abort the current Run and create a new plan.

## Purpose quality checks

A valid purpose answers:

- Who is the simulated user?
- What journey are they attempting?
- What product property is being evaluated?
- Which decisions remain autonomous?
- Which Adapter scenario, if any, is deliberately constrained?
- What visible evidence determines pass, fail, or not evaluated?

`Traverse all Adapter-declared CPs` is acceptable only after listing the finite CP set and its observable criteria; it does not imply all settings, outcomes, or game rules.

Reject purposes that merely say “test everything,” prescribe a desired winner, or confuse scenario coverage with normal user behavior.
