# Avalon Adapter map

## Contract

- ID: `avalon`
- Adapter contract: `2.2`
- Lifecycle: `experimental`
- Evidence: `logs_only`; screenshots and image evidence are forbidden.

This map is derived from visible UI, semantic DOM snapshots, accessible names, public text, and rendered game logs. The discovery Run is `20260718-140404-avalon-5p`; it is exploratory and has `productVerdict: not_evaluated`.

## Contents

1. Executable baseline
2. Semantic UI map
3. Public and private regions
4. User journey and legal actions
5. Expansion inventory
6. Timing and waits
7. Terminal oracle and normalized result
8. Evidence and certification limits

## Executable baseline

Use this reusable five-player configuration:

```json
{
  "deckPreset": "recommended",
  "leaderMode": "standard",
  "publicResultDelaySeconds": 0,
  "excalibur": false,
  "ladyOfTheLake": false,
  "questTeamSizes": [2, 3, 2, 3, 3]
}
```

The visible 5-player recommended deck contains Merlin, Percival, one Loyal Servant, Morgana, and the Assassin. The Adapter supports only this baseline while experimental. Other player counts, custom decks, appointed leaders, result delays, and enabled expansions remain mapped UI rather than executable certification settings.

The AI selects this baseline because clockwise rotation removes a nonessential leadership choice, no-delay avoids avoidable public-result waits, the recommended deck is the product's visible five-player preset, and disabled expansions keep the first formal journey focused on the core loop.

## Semantic UI map

| Surface | Visible semantic contract |
|---|---|
| Entry | Heading `阿瓦隆`; labeled textboxes `你的名字` and `房間代碼或邀請連結`; buttons `建立房間` and `加入房間` |
| Room identity | Own-status card shows the player's submitted name; room code is rendered in the room panel; public chat renders create/join messages |
| Lobby readiness | Buttons `擲 d100`, then `準備`/`取消準備`; host sees `開始遊戲`; progress renders `n / 5 準備` |
| Host settings | Stable IDs `#playerCountSelect`, `#leaderModeSelect`, `#resultDelaySelect`, `#excaliburToggle`, and `#ladyToggle`; button `5 人推薦牌庫` |
| Phase header | Public text renders phase, quest index, current leader, and phase-specific progress |
| Own assignment | Private assignment heading, faction text, role description, assignment-specific information, and button `我已記住身份` |
| Team proposal | Current leader sees enabled player toggles named `<player> 未入隊`/`<player> 已入隊` and `送出隊伍`; other tabs see the same disabled toggles and a waiting message |
| Team approval | Every tab sees buttons `同意` and `不同意`; submission progress is public; settled result reveals every ballot |
| Quest submission | Team members receive assignment-legal quest cards; nonmembers see a waiting message; only aggregate submission progress is public |
| Quest result | Public heading `任務成功` or `任務失敗`, fail-card count, threshold, and team; current leader alone receives enabled `繼續` |
| Assassination | Owning Assassin tab receives one enabled target button for every other player; other tabs see only the waiting message |
| Public panels | Tabs `聊天`, `玩家`, `任務`, and `記錄`; the rendered log lists proposals, team-vote totals, quest results, and terminal reason |
| Terminal | Phase `結束`, winner heading, reason paragraph, all assignments, and host-only `重置房間` next-journey control |

Use accessible names from the current DOM snapshot for interactions. Use the stable setting IDs only after the snapshot confirms those controls. Do not infer a control from product source or room Server state.

## Public and private regions

Public before terminal:

- submitted names, room code, join/create chat, connection/readiness, d100 order, current host, leader, quest index, proposal team, team-vote progress and settled ballots;
- quest team, aggregate submission count, aggregate success/failure, anonymous fail-card count, rejection streak, quest progress, public chat, reactions, and rendered game log;
- expansion enablement, visible holder/target facts the rules explicitly make public, but never an expansion's private result.

Private until the product terminal exposes them:

- own assignment and faction;
- own assignment-derived player information;
- the association between a quest member and the submitted quest card;
- which quest-card controls appear on a particular tab when that appearance reveals alignment;
- the Assassin's target controls before settlement;
- Lady of the Lake inspection result;
- Excalibur's inspected original quest card.

Write private DOM evidence to `players/<playerId>/console.jsonl` with both `playerId` and `sourcePlayerId`. Reference it only from the same player's Observation. Never publish a player-specific quest submission; publish only the rendered aggregate result.

## User journey and legal actions

The declared journey is `create_join_complete_game`.

1. Create with the host's name, capture the visible room code, and join four independent tabs through the entry UI.
2. Prove identity with exact rendered chat plus each tab's own name. Reload one tab before game start, then prove that identity persisted and peer tabs were unaffected.
3. Apply and visibly verify every baseline setting. Each player rolls and readies from their own tab; the host starts only after `5 / 5 準備`.
4. Record each tab's private assignment evidence, then treat `我已記住身份` as a deterministic single-option acknowledgement.
5. On `team_proposal`, only the leader may toggle unique team members. `submit_team` is legal only when the selected count equals the visible quest team size.
6. On `team_vote`, each player independently chooses `approve_team` or `reject_team`. Record the public action only after the settled ballot renders.
7. If approved, only the current leader uses deterministic `continue_to_quest`.
8. On `quest_submission`, good members may use only `submit_quest_success`; an evil member may autonomously choose success or failure. Keep the choice private. Nonmembers have no strategic action.
9. On the visible aggregate quest result, only the current leader uses deterministic `continue_after_quest`.
10. Standard mode rotates proposals through the rendered d100 roster order. Record `avalon_leader_rotated` between consecutive proposals.
11. After three successes, only the Assassin's isolated agent chooses `assassinate_target`. After another natural terminal branch, do not synthesize assassination evidence.
12. Record one terminal marker, one normalized public result, and the same final state from all five tabs. Exclude reactions and host-only reset controls from normalization.

An isolated agent Decision is required for team selection, each team ballot, each quest card with more than one legal choice, and assassination. The referee may perform only a visible single-option acknowledgement or continuation.

## Expansion inventory

The visible rules describe, but the experimental baseline does not execute, these settings:

- Excalibur: every proposal's leader gives the sword to another quest member; after cards are submitted, its holder may decline or publicly target another quest member, privately inspect that member's original card, and flip it before settlement.
- Lady of the Lake: the second-highest d100 player initially holds it; after quests 2, 3, and 4, the holder inspects a player who has never held the marker, privately sees alignment, and passes the marker. Target and new holder are public; the private result is absent from the public game log.
- Appointed leader mode: the quest-ending leader appoints a player without a retired-leader marker. It is mapped but not part of the executable baseline.

Do not enable these settings in a formal baseline Run. Add targeted scenarios and real logs-only evidence before expanding executable support.

## Timing and waits

`fast` resolves to zero operation delay, 100 ms DOM polling, and Server scale 1.0. Player decisions, reconnect behavior, proposal count, quest count, and victory conditions are never scalable.

`avalon.public-result` is the only Adapter-declared scalable non-decision wait. The baseline selects the visible `不延遲` option, so no result wait is needed. For production time, `/__ai-e2e/capabilities` must visibly return HTTP 404 and the Run must record scale 1.0.

## Terminal oracle and normalized result

Terminal is visible when all tabs show phase `結束`, a winner heading, a reason paragraph, and the revealed assignments. The public `任務` and `記錄` panels supply the normalized quest summaries.

```json
{
  "outcomeId": "evil_assassination_hit",
  "winner": "evil",
  "reason": "assassin_hit_merlin",
  "summary": "Visible terminal explanation.",
  "assassinationTargetId": "P5",
  "revealedAssignments": {
    "P1": "loyal_servant",
    "P2": "assassin",
    "P3": "morgana",
    "P4": "percival",
    "P5": "merlin"
  },
  "quests": [
    { "questIndex": 1, "outcome": "success", "teamIds": ["P1", "P4"], "failCards": 0, "failsRequired": 1 }
  ]
}
```

Allowed outcomes are good after a missed assassination, evil after a hit assassination, evil after three failed quests, and evil after five rejected proposals. A formal Run passes on visible criteria and audit integrity, never because a particular side won.

## Evidence and certification limits

- Discovery used five UI-controlled tabs and no screenshots or Server room state.
- The discovery branch deliberately reached assassination only to map UI; it is not natural-user evidence and cannot certify the product.
- Formal Run `20260718-143303-avalon-5p` is complete, audited, production-time, logs-only, and natural-user. It covers baseline settings, fixed identities, private-view isolation, proposals, every player's team ballot, a rejected proposal, standard leader rotation, anonymous quest submission, three failed quests, five-tab terminal normalization, and unchanged post-game product identity.
- That natural Run ended on the third failed quest, so assassination was not reached. Keep the Adapter `experimental`; the Run is strict evidence for the baseline core loop but is not sufficient for `supported`.
- Promote to `supported` only after a separate complete production-time natural Run passes and supplies assassination-branch evidence. Otherwise retain `experimental` and name the missing gate.
