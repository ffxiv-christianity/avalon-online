# Speed profiles

## Presets

| Profile | Operation delay | DOM poll | Server scale | Narration |
|---|---:|---:|---:|---|
| `watch` | 800 ms | 250 ms | 1.0 | all public actions |
| `fast` | 0 ms | 100 ms | 1.0 | milestones |
| `accelerated` | 0 ms | 100 ms | 0.1 | milestones |

For `custom`, accept operation delay 0–3000 ms, DOM poll 50–1000 ms, Server scale 0.1–1.0, and narration `all_public`, `milestones`, or `none`.

## Safety boundary

Apply the Server scale only to adapter-declared non-decision waits. Currently these are One Night Werewolf's empty/night placeholder waits and Avalon's public result delay.

Never scale player discussion, AI decision limits, WebSocket maintenance, reconnect backoff, room cleanup, host transfer, game turn counts, target scores, or victory conditions. Do not patch global clocks or browser timers.

Allow Server scale below 1 only for loopback URLs. Require `AI_E2E_MODE=1` and `AI_E2E_TIME_SCALE=<0.1..1>`. Confirm `/__ai-e2e/capabilities` before play. If a running Server does not match, ask before restart and never silently fall back.

Use three capability dispositions:

- Local accelerated: probe the exact loopback `/__ai-e2e/capabilities` endpoint and require HTTP 200, the requested scale, `enabled: true`, `accelerated_waits`, and all Adapter scalable waits.
- Local production time: probe the exact loopback endpoint and require HTTP 404 plus disabled scale 1.0.
- Reused remote production: require `serverTimeScale: 1`, `serverManagedBySkill: "reused_remote_not_owned"`, and one `server_capability` event with `status: "not_applicable_remote_production"`. Omit both `endpoint` and `response`; never probe, expose, or record a private E2E endpoint on a deployment.

Remote acceleration is invalid. A remote Run cannot claim `not_applicable_remote_production` when its scale is below 1 or its ownership mode differs.

Record requested profile, resolved delays, actual capability result, whether the Skill managed the Server, and `timingFidelity`. Accelerated Runs may pass non-timing assertions but must mark production countdown fidelity untested.
