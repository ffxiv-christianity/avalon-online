# Resource lifecycle and repository policy

Resource cleanup is mandatory for every newly initialized Run. It is a core Skill responsibility, independent of the selected game and Adapter.

## Ownership boundary

At preflight, keep a task-local ownership ledger for every resource created by this Run:

- browser tabs and browser contexts;
- isolated player agents;
- background processes and Servers started by the Skill;
- temporary runtime files created outside the immutable Run artifact directory.

For a process or Server, record its exact PID, executable/command, working directory, and bound port when created. A resource is Run-owned only when this Run created it and the recorded identity still matches at cleanup time.

Never claim or stop:

- a Server, tab, context, or process that existed before the Run;
- a healthy Server merely reused by the Run;
- a user-owned tab or a resource belonging to another Codex task or Run;
- a process selected only by a broad name, port range, glob, or uncertain PID;
- any resource whose current identity no longer matches the ownership record.

When ownership is uncertain, preserve the resource and report a safe label in `unresolvedResources`. Do not guess.

## Mandatory cleanup sequence

Run this sequence on success, failure, abort, timeout, or user-requested stop. Put it in the execution workflow's `finally` path.

1. Finish recording all available game and cross-tab result evidence.
2. Close Run-owned player tabs and Run-created browser contexts.
3. Release the isolated player agents created for the Run.
4. Gracefully stop Run-started background Servers and helper processes; force-stop only the same verified PID when graceful stop fails.
5. Remove only Run-created temporary runtime files. Never delete `tests/AI_E2E/runs/<run-id>` or its logs during cleanup.
6. Preserve reused and user-owned resources.
7. Append exactly one public `resource_cleanup` event.
8. Recompute the product source identity, append `product_build_verified`, then finalize.

Required event shape:

```json
{
  "type": "resource_cleanup",
  "policyVersion": "1.0",
  "status": "passed",
  "ownedTabsClosed": 5,
  "ownedContextsClosed": 1,
  "ownedProcessesStopped": 1,
  "ownedServersStopped": 1,
  "isolatedPlayersReleased": 5,
  "temporaryArtifactsRemoved": 2,
  "reusedResourcesPreserved": true,
  "unresolvedResources": []
}
```

Use `partial` only when a Run-owned resource cannot be verified or released safely. A complete passing Run requires `passed`, an empty `unresolvedResources` array, and cleanup after all final-state evidence but before `product_build_verified`. Older retained Runs without `resourceLifecycle` remain auditable under their original contract.

## Repository policy

Commit these to the product repository:

- `skills/ai-boardgame-e2e/` source, Adapters, references, scripts, and deterministic tests;
- reusable `tests/AI_E2E/configs/` inputs;
- small synthetic compatibility fixtures when a deterministic test requires them;
- a curated certification index containing Run ID, scope, product commit/digest, config/audit hashes, artifact hash, and retention location.

Do not commit these by default:

- the installed personal copy under `C:\Users\<user>\.codex\skills`;
- the full `tests/AI_E2E/runs/` tree;
- failed scratch Runs, private rationales, private player logs, or machine-specific runtime metadata.

Raw passing Runs are still certification evidence and must be retained. Store selected immutable archives in private CI artifacts or object storage with a content hash and retention policy. If the repository itself must carry complete evidence, use a private repository plus Git LFS and commit only explicitly reviewed passing Runs. A summary or `audit.json` alone is compact but is not independently re-auditable without the referenced raw logs.
