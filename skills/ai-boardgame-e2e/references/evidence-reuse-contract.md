# Historical evidence query and reuse contract

Historical evidence can reduce unnecessary E2E execution, but it cannot broaden what an earlier Run proved. Querying is a read-only preflight stage of the same E2E framework.

## Required order

1. Complete the mandatory questionnaire in [e2e-questionnaire.md](e2e-questionnaire.md).
2. Resolve the candidate config and Adapter IDs.
3. Compute the current product-source digest when `requireCurrentBuild` is true.
4. Build a sanitized index from immutable Run directories.
5. Query direct criterion, checkpoint, and journey IDs. Free-text terms may discover candidates but never establish exact reuse by themselves.
6. Inspect the cited public events and re-audit any exact candidate with the current auditor.
7. Classify the evidence, show the classification to the user, and include it in the approval contract.
8. For `feature_cp`, remove only exactly reusable CPs and create the CoveragePlan for the remainder under [coverage-planning.md](coverage-planning.md).
9. Initialize a Run only when the approved disposition requires new execution.

## Classifications

- `exact_reuse`: Direct required IDs and expected results are present; the Run is complete, current audit passes, blocking findings are absent, scope matches, required timing fidelity matches, and the product-source digest matches when required. No new Run is needed.
- `partial_reuse`: Some direct claims or useful free-text candidates match and remain current, but one or more required claims are missing. Execute only the missing Adapter checkpoints or journey requirements when possible.
- `historical_only`: Relevant evidence exists but build identity, settings, player scope, timing fidelity, audit, or isolation requirements do not match. It informs planning but cannot decide the current-build verdict.
- `no_evidence`: No relevant retained Run was found. Execute the approved journey.

An exact reused result may prove either a pass or a fail. It must preserve the earlier criterion/checkpoint result; never reinterpret a failed event as passing evidence. Absence of a logged error is not positive evidence.

## Exact-reuse gates

All applicable gates must pass:

- identical game and directly requested Adapter IDs;
- matching current `productSourceSha256` when current-build evidence is required;
- matching player count and requested game-setting constraints;
- current read-only audit passes;
- Run status is `complete` and verdict is compatible with the requested expected result;
- no P0, unresolved P1, or decision-isolation failure;
- required information-isolation fields pass unless the approved query explicitly excludes isolation from scope;
- production timing when the claim concerns real countdown duration;
- every cited criterion/checkpoint result includes evidence references;
- every requested journey completion is explicitly logged.

Legacy Runs without a current direct event can be useful candidates, but cannot satisfy that direct gate. Do not infer a checkpoint from prose in `summary.md` or `notes`.

## Sanitized index

The index may contain:

- Run/config/audit identity and paths;
- game, player count, settings fingerprint, speed, timing fidelity, journey/scenario IDs;
- product digest and Git identity;
- criterion/checkpoint/journey IDs, boolean results, and evidence reference IDs;
- verdict, finding counts, isolation statuses, and current audit status.

It must not contain private observations, private rationales, role/hand contents, private console text, chat content, screenshots, or copied evidence text. Evidence reference IDs are pointers, not disclosure permission.

The generated index is a disposable cache. The immutable Run remains the source of truth.

The sanitized index may also contain `coverage_route_completed` route IDs, setup-profile IDs, checkpoint IDs, duration milliseconds, and public game settings. These fields refine expected route cost only. They contain no private facts or evidence text and cannot establish feature correctness. The planner uses the median audited duration for the same game, globally unique route ID, player count, and settings; otherwise it uses the Adapter baseline.

## Query request

Use direct IDs whenever available:

```json
{
  "schemaVersion": "1.0",
  "game": "gangsi",
  "expectedResult": "pass",
  "requiredCriterionIds": ["trap_boundary_visible"],
  "requiredCheckpointIds": ["trap_placement_boundary"],
  "requiredJourneyIds": ["adapter_declared_feature_journey"],
  "searchTerms": ["trap", "protected cell"],
  "playerCount": 3,
  "gameSettings": {},
  "requireCurrentBuild": true,
  "currentProductSourceSha256": "<sha256>",
  "requireProductionTiming": false,
  "requireIsolation": true
}
```

If no stable direct IDs exist in older evidence, use terms to find candidates, inspect their public events, and then either map a verified direct ID or classify the result as partial/historical. Terms alone never produce `exact_reuse`.

## Commands

```text
node <skill>/scripts/index-evidence.js --runs <artifact-root>/runs --output <index.json>
node <skill>/scripts/query-evidence.js --index <index.json> --query <query.json> --output <assessment.json>
```

Omit `--index` and pass `--runs` to build and query a fresh in-memory index. These commands must not write to a Run directory.

## Reuse output and reporting

An evidence-only decision must cite immutable Run IDs plus direct event IDs/evidence references. Do not initialize an empty replacement Run. Report:

- `executionResult: not_run_reused_evidence`;
- the current-build or historical scope;
- the retained product verdict for each claim;
- claims not evaluated;
- the query and index hashes.

For partial evidence, copy no old private data into the new Run. Link prior Run IDs in the approved plan, execute only the missing requirements through the normal Adapter runner, and report old versus new evidence separately.
