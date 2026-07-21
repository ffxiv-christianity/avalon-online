# Information isolation protocol

## Roles

- The referee controls browser tabs, validates Adapter legality, and writes logs. It may inspect every tab but cannot choose player strategy or transmit secrets.
- A player agent decides for exactly one stable identity. It receives no browser, project, filesystem, other-player log, or referee context.

## PlayerObservation

```json
{
  "observationId": "P1-g1-003",
  "gameIndex": 1,
  "phase": "adapter_phase_id",
  "publicFacts": [{
    "text": "A public timer shows 94 seconds remaining",
    "evidenceId": "g1-public-timer-094",
    "visibility": "public",
    "source": "visible_dom"
  }],
  "privateFacts": [{
    "text": "Private information visible only in P1's tab",
    "evidenceId": "P1-g1-private-1",
    "visibility": "private",
    "source": "visible_dom",
    "sourcePlayerId": "P1"
  }],
  "legalActions": ["adapter_action_id:target_id"],
  "ownMemory": [{
    "text": "I previously chose to wait",
    "sourceObservationId": "P1-g1-002"
  }]
}
```

Every fact is a provenance object. Public DOM evidence must be visible to every configured player and resolve to an earlier public event with matching game, ID, and text. Public chat evidence must resolve to an earlier rendered message. Private facts must resolve to earlier visible DOM evidence inside the owning player's directory and carry the same `sourcePlayerId`. Memory may reference only an earlier Observation from that player.

Never put inferred Server state, another tab's DOM, referee knowledge, or unrendered communication into an Observation.

## PlayerDecision

```json
{
  "observationId": "P1-g1-003",
  "action": "adapter_action_id",
  "targets": ["target_id"],
  "publicMessage": null,
  "timingIntent": "act_now",
  "privateRationale": "...",
  "evidenceRefs": ["publicFacts[0]", "privateFacts[0]"],
  "readyToAct": true
}
```

The Adapter defines action IDs, targets, phases, and whether waiting/inaction is legal. The core validates only that the Decision follows its Observation, uses an Adapter-declared legal action, cites same-Observation evidence, and precedes the visible UI action.

`timingIntent` may be `act_now` or `wait` generically. An Adapter may add stable timing intents for its own actions. No particular action—vote, draw, mission, skip, score, or otherwise—is mandatory across all games.

For each material player-controlled UI action:

1. Record the visible legal action in an Observation.
2. Record the owning player's Decision.
3. Execute through that player's visible tab.
4. Record private or public action evidence according to actual visibility.
5. Match Adapter-declared checkpoints and terminal results after the action.

The referee may execute a deterministic single-option acknowledgement after recording it. It may not synthesize a strategic choice.

## Natural-user behavior

Treat style and traits as tendencies. A bounded user may misunderstand a plausible public claim, revise beliefs, wait, omit an optional action, communicate selectively, or make an incorrect choice. Do not inject correct answers, reward collective accuracy, or require an error quota.

When the Adapter exposes public communication, public messages become facts only after rendering in shared UI. Silence or inaction is valid only if the Adapter exposes it as legal or the configured timer naturally permits it.

Targeted scenarios constrain only their declared actions. They are coverage evidence, not evidence of typical behavior.

## Writer and evidence order

The writer serializes processes with a Run-local lock, reserves order before append, and assigns immutable wall-clock time, monotonic time, and `writerOrder`. A crash may leave an unused order but cannot reuse one.

The required order is:

```text
visible source evidence < Observation < Decision < UI action evidence < checkpoint/terminal result
```

Before public result data or final-state logs, append an Adapter-valid `terminal_visible` marker from visible DOM. Only then may information that the product made public enter generic `result_detail` and reports.

## Stop conditions

- Wrong-tab private information, identity swap, or secret transmission: P0 and abort.
- A player reasons from an unprovided secret: decision-isolation failure and invalid formal result.
- Three consecutive invalid choices for one Decision, or configured maximum: abort.
- Adapter cannot determine legal visible actions or terminal oracle: abort formal execution and open an exploratory Adapter-discovery Run.

Keep public and private logs separate during play. Merge private game information into public reports only after the product's terminal state visibly exposes it.
