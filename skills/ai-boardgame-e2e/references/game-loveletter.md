# Love Letter Adapter (`loveletter`)

## Status and scope

- Contract: `2.2`
- Lifecycle: `experimental`
- Entry: `http://localhost:4173/LoveLetter/`
- Visible player range: 2–6
- Visible target-heart range: 1–9
- UI defaults: 2 players → 6, 3 → 5, 4 → 4, 5/6 → 3
- Evidence: `logs_only`; screenshots and image evidence are forbidden.
- Safe scalable waits: none (`scalableWaits: []`).
- Certified profiles: two-player visible default target 6 and four-player AI-selected target 1.

This Adapter owns all Love Letter concepts. The generic runner must not learn card names, hand rules, heart scoring, protected/eliminated states, or round-settlement logic.

## User journeys

`create_join_complete_match` is the formal journey:

1. Open the visible entry UI, enter a player name, and create a room.
2. Join every other isolated tab with the visible room code and a distinct name.
3. Prove identity with each tab's own status, a shared public-chat identity message, and one visible reload/reconnect while peer tabs remain unaffected.
4. Verify host-only player-count and target-heart controls, synchronized values, roll d100, ready, and start.
5. Play every round through enabled cards, rendered targets, pending choices, and visible confirmations until the match terminal.
6. After each non-terminal round, the host uses the visible next-round control. At match terminal, normalize every tab to the same result; only the host may additionally expose `返回大廳`.

`discover_user_journeys` is retained only for the completed planned-stage discovery history. Once the Catalog entry is experimental, new formal configurations use `create_join_complete_match`.

## Identity and communication oracle

- Every tab must visibly agree on room code, host, roster, phase, and public join/reconnect events.
- The reloaded player must click its own named reconnect control. Other tabs must remain in-room and unchanged.
- Each tab proves its own identity from its `你的狀態`/own player area.
- A public chat exists. Chat evidence uses `contentClass: "public_chat"` and must be visible to every configured player. Chat is useful for identity proof but is not a required strategic flow.

## Host settings contract

The target is the spinbutton labelled `目標分數`. A submitted change is not proven by the host field alone. The host must focus the field, remove the old digits, type the new value, then click another visible lobby control to fire the UI `change` path. Continue only when every tab's heart header and guest-disabled field show the same target.

For a default run, record `selectionSource: "ui_default"`. For a custom run, record `selectionSource: "ai_selected_visible_ui"` plus the isolated/non-strategic selection rationale. The chosen target must differ from the visible player-count default.

## Public and private information

Public on every tab:

- room code, host, roster, rolls, ready state, settings, phase, current player;
- draw-pile count, face-down count, two-player public removals;
- per-player hand counts, public discards, protection, elimination, heart totals;
- public actor/card/target/Guard-guess outcome, round result, match result, and terminal card reveal.

Private to one owner tab and one isolated player agent:

- exact own hand and own draw;
- enabled/disabled card controls and rendered legal targets;
- Guard guess panel, Priest exact-card result, Baron comparison detail, King exchange identities, Chancellor keep/bottom choices, and other own action details.

Before public terminal reveal, no exact other-player hand may enter public logs or another player's Observation. A private visible-DOM source event must include both `playerId` and `sourcePlayerId`, equal to the owning log directory, plus `contentClass: "private_ui"`.

## Observation and Decision mapping

Each Observation fact is copied byte-for-byte from an earlier source event:

- public DOM → public timeline, `source: "visible_dom"`, `contentClass: "public_ui"`, every player in `visibleToPlayerIds`;
- public chat → `public/chat.log`, `source: "public_chat"`, `contentClass: "public_chat"`;
- private DOM → owning player's console, `source: "visible_dom"`, `contentClass: "private_ui"`, `playerId` and `sourcePlayerId` equal the owner.

Canonical legal actions include:

- `play_card:<cardId>`
- `play_card:<cardId>:<targetPlayerId>`
- `guess_card:<guessCardId>:<targetPlayerId>` as a second Observation after Guard exposes the guess panel
- `choose_chancellor_keep:<visibleOptionId>` and `choose_chancellor_bottom:<visibleOptionId>`
- pure confirmations/transitions such as `confirm_action`, `start_next_round`, and `return_lobby`.

A Decision stores the action portion in `action` and player targets in `targets`. Evidence references are only same-Observation indexes such as `legalActions[1]` and `privateFacts[0]`.

## Legal-action rules

- Use only enabled card controls and target/guess buttons rendered on the active player's own tab.
- Guard cannot guess Guard. It is a two-stage decision when a target exists.
- Guard, Priest, Baron, or King may be visibly playable without a target only when every other player is protected and the UI explicitly says the card has no effect.
- Prince always uses one rendered target and may target self.
- Countess must be the only strategic card action when the visible UI enforces the King/Prince combination.
- Playing or discarding Princess eliminates that player.
- Eliminated, waiting, or pending-confirmation players cannot perform a strategic action absent an enabled UI control.
- Chancellor keep/bottom order comes exclusively from its private pending panel.

## Round and match oracles

A round settlement records:

- sequential `roundIndex`;
- `endCause`: `one_active_player` or `deck_exhausted`;
- visible winner(s), eliminated players, heart deltas and totals;
- publicly revealed remaining cards for every player.

Spy may add one extra heart only when the visible round result awards it to the unique surviving player who used Spy. No Adapter rule may predict that award before it appears.

The normalized match result is identical on all tabs:

```json
{
  "outcomeId": "target_hearts_reached",
  "winnerIds": ["P1"],
  "targetHearts": 6,
  "heartTotals": { "P1": 6, "P2": 4 },
  "roundCount": 8,
  "rounds": [
    {
      "roundIndex": 1,
      "endCause": "one_active_player",
      "winnerIds": ["P1"],
      "eliminatedPlayerIds": ["P2"],
      "heartDeltas": { "P1": 1, "P2": 0 },
      "totalHearts": { "P1": 1, "P2": 0 },
      "revealedRemainingCards": { "P1": ["countess"], "P2": ["prince"] }
    }
  ],
  "summary": "Visible terminal explanation"
}
```

## Adapter-specific audit evidence

Every formal game requires exactly one `loveletter_settings_verified`, exactly one `loveletter_information_isolation_checked`, one `loveletter_round_started` and `loveletter_round_settled` pair per round, exactly one `loveletter_match_settled`, one generic terminal/result pair, and one normalized final-state record per player tab.

The match result must exactly reproduce the ordered settlement events and the final public heart totals. Source digest verification is recorded immediately before finalize.

## Mapped but uncertified

- deck-exhaustion high-card/discard-sum settlement and ties;
- forced Countess with King or Prince in the same hand;
- full matches with 3, 5, or 6 players;
- target-heart values 2-5 and 7-9, plus unexercised player-count and target combinations;
- the broader multi-player matrix of simultaneous protection, elimination, and no-legal-target states.

No targeted scenario is declared yet. Observed special branches are mapped as natural-play behavior; a future targeted scenario may be added only after its visible control boundary is specified and certified.

## Certification evidence and policy

Only complete, formally finalized Runs that pass the latest `audit-run.js` are registered:

- `two_player_default`: `20260719-225603-loveletter-2p` (2 players, visible default target 6);
- `four_player_custom`: `20260719-233201-loveletter-4p` (4 players, AI-selected visible target 1).

These Runs certify player counts 2 and 4 only for their exercised settings and observed natural branches. The Adapter remains `experimental`; do not mark it `supported` until the full intended player-count, settings, and special-rule matrix passes.
