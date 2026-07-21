# Gangsi Adapter

Adapter contract: `2.2`. Lifecycle: `experimental`. Evidence is `logs_only`; screenshots and image evidence are forbidden.

Gangsi is a 2–5 player asymmetric chase game. The experimental Adapter validates the mapped visible settings, while strict AI E2E certification currently covers only these two three-player profiles:

- `classic_fixed_3p`: classic mode, fixed `classic` map.
- `hunt_random_3p`: Hunt mode, random map selection resolved by the product when the host starts.

All game actions must come from the in-app Browser's visible semantic UI. Do not use WebSocket calls, server state, engine fixtures, or screenshots as action or result evidence.

## Identity and lobby

- Entry: `textbox "你的名字"`, `textbox "房間代碼或邀請連結"`, `button "建立房間"`, `button "加入房間"`.
- Reconnect: `button "以 <name> 重新連線"` after a visible reload.
- Public identity: each tab's `heading "你的狀態"` card plus an identity message in `textbox "輸入訊息"` and `button "送出"`.
- Host settings: `combobox "遊戲模式"`, `combobox "遊戲人數"`, `combobox "地圖"`, `checkbox "隨機地圖"`.
- Setup: role buttons in `group "選擇你的角色"`, `textbox "冒險者棋子文字"`, Hunt profession/type comboboxes, `button "擲 d100"`, `button "準備"`, and host `button "進入遊戲房間"`.

The product requires exactly one mummy. Hunt additionally requires distinct adventurer professions and one mummy type. Token labels commit on the textbox `input` event.

## Game semantics

The public phase heading and action-information log are the primary phase oracle. Current-player controls appear only on the acting tab.

- Adventurer preparation: continue/unlock, profession ability, mechanism action, or roll.
- Adventurer roll: roll/reroll unlocked dice and select one enabled numeric or arrow die.
- Numeric move: click each visible `button.is-legal-target` in order, then `button "確認移動"`.
- Arrow move: select one enabled direction in `group "箭頭方向"`.
- Treasure end step: `button "揭露寶藏"` or `button "暫不揭露"` when shown.
- Mummy preparation: optional type ability, then `button "擲提燈怪骰"`.
- Mummy move: click visible legal board cells and optionally `button "結束移動"`.
- Terminal: visible `dialog` labelled by the result title, `heading "勝利結果"`, and `button "關閉"`. After closing, the host uses `button "返回準備大廳"`.

Board-cell accessible names contain coordinates, terrain, treasure/mechanism labels, and only the tokens visible to that tab. Inspect the semantic DOM immediately before every action; never infer legal cells from source code.

## Information isolation

Player observations may record these owning-tab regions only:

- Adventurer: own mission cards, own profession state/cooldown, own pending choices, and own visible positions.
- Mummy: masked shared dice when appropriate, hidden adventurer positions, own type state/cooldown, and own ability results such as trap placement or invisibility.

Never place mission identities, hidden positions, trap coordinates, or actor-only ability details in public evidence. Public evidence may include shared roster/status, settings, phase, map name, shared dice after reveal, shared Hunt objectives, public action log, captures that the UI broadcasts, and terminal results.

Strict formal evidence additionally requires:

- Every private console record names both the owning `playerId` and its identical `sourcePlayerId`.
- `publicFacts[].text` is byte-for-byte identical to the referenced public timeline event's `evidenceText`; summaries or aliases are not evidence references.
- `ownMemory` remains empty unless memory has an explicit owning-player source; another tab's state is never memory.
- A Decision's `action` exactly matches one entry in that Observation's `legalActions`, with explicit `targets` (including an empty array).
- Criterion sources are exactly `visible_dom` or `cross_tab_consistency`; identity and isolation booleans must be explicit, and final isolation fields must be `pass`.

## Normalized outcomes

- `classic_adventurer_completed`
- `classic_mummy_life_tokens`
- `hunt_adventurer_escape`
- `hunt_mummy_elimination`

The normalized result records visible `mode`, `winner`, `winnerPlayerId`, `mapId`, `mapName`, and `summary`. Classic includes public mummy-score/task totals. Hunt includes every visible adventurer terminal row, the mummy terminal row, and escaped/dead totals.

## Certification scope

The Adapter remains experimental. Two complete production-time, logs-only formal Runs are certified:

- `classic_fixed_3p`: Run `20260720-184703-gangsi-3p`, three players, Classic mode, fixed `classic` map.
- `hunt_random_3p`: Run `20260720-192210-gangsi-3p`, three players, Hunt mode, random map selection (resolved after start to `test-map` / 蟹制地圖1).

The Adapter accepts the UI-mapped Classic 2–5 and Hunt 3–5 player ranges, fixed maps with a declared visible `mapId`, and random selection without a pre-start `mapId`. Acceptance is configuration validation, not certification. Classic 2/4/5, Hunt 4/5, other map combinations, the two-player multi-token flow, unexercised professions and mummy types, other ability/mechanism/tracking/invisibility/escape/result branches, in-game reconnect, and consecutive games remain mapped but uncertified until separately audited.
