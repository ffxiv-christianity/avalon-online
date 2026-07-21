# One Night Werewolf Adapter

## Contract

- ID: `onenightwolf`
- Adapter contract: `2.2`
- Default entry: `http://localhost:4173/Onenightwolf/`
- Players: 3–10
- Existing tests: `npm --prefix Onenightwolf test`
- Settings: recommended/custom deck and visible discussion options of 180, 300, 420, or 600 seconds
- Scalable waits: empty night-role placeholder and Doppelganger-Insomniac delayed acknowledgement
- Journeys: `create_join_complete_game`, `repeat_complete_game`, `reconnect_identity`
- Scenarios: `vote_all_submission`, `vote_no_submission`, `vote_partial_submission`, `communication_behavior_coverage`

## Semantic UI map

- Entry: `#nameInput`, `#roomInput`, `#createRoomButton`, `#joinForm`, `#rejoinRoomButton`
- Own lobby identity: `[data-wolf-lobby-player-name]`
- Public roster/chat/log: `[data-wolf-roster]`, `[data-wolf-chat-list]`, `[data-wolf-log]`
- Settings: `[data-wolf-player-count]`, `[data-wolf-discussion]`, `[data-wolf-recommend]`, `[data-wolf-role]`
- Lobby actions: `[data-wolf-roll]`, `[data-wolf-ready]`, `[data-wolf-start]`
- Main phase: `[data-wolf-main]`
- Role confirmation: `[data-wolf-confirm-reveal]`
- Night targets: `.wolf-choice[data-group]`; submit with `[data-night-action]`; optional skip with `[data-night-skip]`
- Chat: `[data-wolf-chat-form]` and `[data-wolf-chat-input]`
- Vote target and confirm: `[data-wolf-vote]`, `[data-wolf-confirm-vote]`
- Terminal/next game: visible result under `[data-wolf-main]`; host return `[data-wolf-return]`

Chat is limited to 240 characters. Keep generated messages at or below 180 characters. Use accessible names and stable player-name text instead of button position.

## User journeys

### `create_join_complete_game`

1. P1 creates and reads the displayed room code. Other tabs join with configured names.
2. Set player count, discussion duration, and deck through visible controls.
3. Prove identity through own-name DOM and exact rendered public chat authorship; reload one tab and verify peers are unaffected.
4. Roll d100, ready every player, and start through UI.
5. On reveal, read only the current tab's role/side/ability. Log and acknowledge.
6. During night, build legal actions from enabled controls. Record private information only while it is visibly rendered in that player's tab; do not infer another actor's state from waiting text.
7. At dawn, the UI no longer renders private night information. Give the player only `ownMemory` linked to its earlier private Observation, plus newly rendered public chat. Never read `snapshot.you.privateInfo` or another non-visible client value.
8. In natural-user testing, let every player choose whether and when to vote. In targeted testing, apply only the selected Adapter scenario.
9. Append `terminal_visible`, then one `result_detail` whose `result` contains the complete normalized visible result.

### `repeat_complete_game`

After terminal result, the host returns to lobby, revalidates identity/settings, and completes the next configured game without reusing prior private facts.

### `reconnect_identity`

Perform only the configured reconnect action. Verify the same player identity and legal private view return while other tabs remain unchanged.

## Adapter-owned scenarios

- No scenario (`natural_user`): provide current public claims and remaining time; agents may speak, wait, vote, or miss the deadline.
- `communication_behavior_coverage`: constrain configured communication behavior while leaving unrelated strategy and voting autonomous; classify public claims after terminal disclosure.
- `vote_all_submission`: submit one visible vote from every player and checkpoint immediate settlement after the last submission.
- `vote_no_submission`: submit no votes and checkpoint settlement at the real discussion deadline.
- `vote_partial_submission`: read `scenarioParameters.voterIds`, submit only that subset, and checkpoint settlement at the real deadline.

These scenarios belong only to this Adapter. The generic core must not require votes, discussion, roles, or deadlines from other games.

Log every submitted vote after its owning Decision and match the target to the normalized result. For deadline scenarios, record Adapter timer checkpoints from visible DOM and prove the production wall-clock duration. Discussion deadlines are never Server-accelerated.

## Result schema

The generic `result_detail.result` contains:

- headline and reason;
- winner/side outcome;
- eliminated players;
- every submitted or missing vote;
- final roles;
- three center cards;
- complete night history.

Every player tab must normalize to the identical object. The village catching a werewolf is a gameplay outcome, not an E2E success condition unless a narrowly defined criterion is explicitly testing that result rule.

## Private boundaries

Before the terminal state, keep role, night context, visibly inspected cards, and private console output in the owning player's directory. Deck, roster, public chat, phase labels, and published log entries are public only when visible to all tabs. There is no dawn private-night-result region: preserve legally observed night information only through the owning player's `ownMemory`, linked to an earlier visible private Observation.
