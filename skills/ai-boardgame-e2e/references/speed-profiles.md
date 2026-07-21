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

Record requested profile, resolved delays, actual capability result, whether the Skill managed the Server, and `timingFidelity`. Accelerated Runs may pass non-timing assertions but must mark production countdown fidelity untested.
