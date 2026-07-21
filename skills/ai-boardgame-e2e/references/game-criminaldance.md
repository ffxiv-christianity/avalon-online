# 犯人在跳舞 Adapter map

Adapter contract: `2.2`. Lifecycle: `experimental`. Evidence is `logs_only`; screenshots and image evidence are forbidden.

本文件的正式 UX 契約來自可見 UI、語意 DOM、可存取名稱、公開文字、Console 與結構化 Logs-only 證據。探索 Run 為 `20260718-154041-criminaldance-4p`，`productVerdict` 必須維持 `not_evaluated`。產品程式與既有測試只用來交叉理解候選規則，不可替代 UI 證據。

## 1. 狀態與可選測試 profiles

Catalog 已由正式 Run `20260719-113144-criminaldance-8p` 升為 `experimental`。這次只認證八人基本牌組的 `natural_user` 完整 match；警部、少年與兩擴充同開仍是 `planned`，不得由基本局結果推論為已認證。

Adapter 提供四個可選測試 profile；每一個都完整進行一場計分達 10 的 match：

| Profile | `inspector` | `juvenile` | 必選 scenario | 候選設定檔 |
|---|---:|---:|---|---|
| 基本牌組 | false | false | 無（`natural_user`） | `criminaldance-8p-natural-fast.json`（已認證八人）；`criminaldance-4p-natural-fast.json`（未認證） |
| 警部擴充 | true | false | `inspector_public_marker` | `criminaldance-4p-inspector-targeted-fast.json` |
| 少年擴充 | false | true | `juvenile_opening_clue` | `criminaldance-4p-juvenile-targeted-fast.json` |
| 兩擴充同開 | true | true | 上述兩個 scenario | `criminaldance-4p-inspector-juvenile-targeted-fast.json` |

第一個通過的 formal baseline 設定如下：

```json
{
  "playerCount": 8,
  "gameSettings": {
    "inspector": false,
    "juvenile": false
  },
  "gamesToPlay": 1,
  "speed": { "profile": "fast", "serverTimeScale": 1.0 },
  "evidence": { "mode": "logs_only" },
  "reconnect": { "mode": "none" }
}
```

選擇理由：八人是產品可見上限並使用完整 32 張基本牌組；關閉警部與少年擴充可隔離基本牌組；`fast` 只移除操作延遲，產品 Server 仍以 1.0 生產時間執行；遊戲沒有安全、可縮放、且不涉及玩家決策的等待，因此 `scalableWaits` 是空陣列。三個擴充 profile 都可選測試，但仍不是已認證能力。

## 2. 房間、身分與 Lobby

| Surface | 可見契約 |
|---|---|
| 入口 | 玩家名稱、房號輸入、建立房間、加入房間；重新整理後可見明確的「以 `<名稱>` 重新連線」入口 |
| 房號 | 房間內固定顯示六碼房間代碼與複製邀請連結 |
| 本人身分 | 每個分頁由自己的重新連線／加入流程與私有手牌區證明身分；建立、加入訊息會出現在公開聊天 |
| 玩家名單 | 玩家面板顯示座位、名稱、上線、Ready、d100、分數、房主；Lobby 房主可移交房主 |
| 玩家數 | 可見選項為 3–8；加入人數超過新選項時，產品顯示錯誤且拒絕設定 |
| 擴充 | Lobby 有 `警部擴充` 與 `少年擴充` 兩個獨立開關；可同時啟用；非房主只能看見 disabled mirror |
| 準備 | 每個玩家從自己的分頁擲 d100 後才能 Ready；任何房主設定變更會使準備失效；全員 Ready 後只有房主可開始 |
| 座位順序 | d100 由大到小形成公開座位順序；首位行動者不是固定第一座，而是持有第一發現者的玩家 |

探索中實際看見 4 人擲出 P4=93、P1=87、P2=50、P3=27，座位順序跨四頁一致為 P4、P1、P2、P3。持有第一發現者的玩家收到私有強制開場 Modal，確認後公開打出該牌。

可見的 Lobby usability finding：四人已加入時，房主把玩家數改成 3，產品正確拒絕並顯示「目前玩家數超過新的房間人數。」，但房主的 `<select>` 暫時仍顯示 3，其他分頁保持 4；這是 P2 視覺狀態不同步，不可由 Adapter 修產品。

## 3. 牌組與擴充

可見牌庫規則列出完整 32 張基本牌：

| 牌 | 張數 | Card ID |
|---|---:|---|
| 第一發現者 | 1 | `first_finder` |
| 犯人 | 1 | `culprit` |
| 不在場證明 | 5 | `alibi` |
| 共犯 | 2 | `accomplice` |
| 偵探 | 4 | `detective` |
| 目擊者 | 3 | `witness` |
| 普通人 | 2 | `ordinary` |
| 狗 | 1 | `dog` |
| 情報交換 | 4 | `information_exchange` |
| 謠言 | 5 | `rumor` |
| 交易 | 4 | `trade` |

每人每局 4 張，3–8 人分別使用 12、16、20、24、28、32 張。3–7 人先放入該人數可見的必要牌，再補隨機基本牌；8 人使用完整基本牌組。必要牌表：

- 3 人：第一發現者、犯人、偵探、不在場證明。
- 4 人：再加入一張共犯。
- 5 人：至少兩張不在場證明與一張共犯。
- 6 人：至少兩張偵探、兩張不在場證明、兩張共犯。
- 7 人：至少兩張偵探、三張不在場證明、兩張共犯。

警部擴充把基本牌組的狗替換成 1 張 `inspector`。少年擴充把 1 張目擊者替換成 1 張 `juvenile`。兩個開關可同時啟用，沒有互斥欄位。設定與 scenario 必須精確配對：開啟警部就必須選 `inspector_public_marker`，開啟少年就必須選 `juvenile_opening_clue`，關閉時也不得殘留對應 scenario。兩者與組合 profile 都維持 `planned`，直到各自有完整 formal Run。

## 4. 公開與私人邊界

公開欄位：

- 房號、名稱、房主、連線、Ready、d100、座位順序、設定與牌庫說明；
- 目前階段、目前行動玩家、各玩家手牌張數、打出牌堆、公開牌堆、分數；
- 公開聊天、公開行動紀錄、卡名、目標（若規則公開）、強制流程進度；
- 偵探命中／未命中、局結算原因、每人局分／總分、整場勝者與終場分數。

只能提供給同一玩家代理的私人欄位：

- 自己的精確手牌、抽牌後手牌、每張牌 enabled/disabled 與可見理由；
- 自己的第一發現者或少年開場提示；
- 自己在情報交換、謠言、狗棄牌、交易回覆中的可選牌與結果；
- 目擊者只讓出牌者看見的目標精確手牌；
- 自己送出／收到／被抽走／抽到的精確卡名。

其他玩家只能看見張數、公開打出牌、公開牌、公開目標與進度。探索中，P1 用目擊者查看 P3 時只有 P1 看見 P3 的精確三張牌；P2 用狗指定 P4 時只有 P4 看見自己的三個棄牌選項；情報交換與謠言結束後，每頁只顯示該身分自己的送收卡名。

不要讀取或發布 Server 房間物件、WebSocket payload、牌庫順序或 fixture。產品程式裡的 `you`／scrubbed room 結構不是 Run 證據。

## 5. Observation 與 Decision

每次策略 Decision 的 Observation 只包含：

```text
自己目前可見的精確手牌
自己每張牌的合法狀態與可見原因
公開座位、手牌張數、打出牌、公開牌、目前階段與行動者
公開紀錄與分數
同一玩家先前 Observation 所形成的 ownMemory
```

Decision 至少回傳 `actionId`、可選的 `cardId`／`targetId`／`cardIndex`，以及同一 Observation 的 `evidenceRefs`。裁判只能執行單一可見選項（例如第一發現者確認、玩家已決定後的 UI click）或核對證據，不得替玩家挑牌、挑目標或確認策略。

### 合法 UI action map

| 卡／流程 | 可見 UI 流程 |
|---|---|
| 第一發現者 | 私有 Modal 只有 `打出第一發現者`，不可取消 |
| 犯人 | 只有手上最後一張時 enabled；確認後直接結束本局 |
| 不在場證明、普通人、共犯、少年 | 選牌後顯示 `打出 <牌名>` 與 `取消`；沒有目標 |
| 偵探 | 手牌 3 張以下才 enabled；選另一玩家後確認；命中／未命中公開，只有出牌者按 `進入本局結算` 或 `繼續遊戲` |
| 目擊者 | 選另一玩家；精確手牌只在出牌者的行動資訊中顯示 |
| 狗 | 選仍有手牌的另一玩家；目標玩家從自己的可見牌中選一張棄掉並確認；若棄到犯人結算，否則狗轉移到目標手牌 |
| 情報交換 | 全員各自在自己的分頁選一張牌，畫面顯示固定的順時針接收者；全部確認後同時交換；每人只看自己的送收結果 |
| 謠言 | 出牌後全員各有一個 `抽一張牌`；從右手邊玩家抽取，先暫存，4/4 後同時加入手牌；每人只看自己的抽到／被抽走結果 |
| 交易 | 出牌者選另一玩家與自己要給出的非交易牌，確認前可取消；目標再從自己的手牌選回贈牌並確認；若出牌者只剩交易則可無效果打出 |
| 警部 | 手牌 3 張以下才 enabled；指定另一玩家並留下公開 marker；局結束時若 marker 指中犯人，警部結果可覆蓋原結局 |

所有選牌、選目標、取消與確認都必須在相同玩家分頁的可見 UI 完成。Adapter 以 enabled 控制、disabled 原因、可見目標按鈕與確認按鈕共同判定合法性；不得自行推算一個 UI 沒有提供的 action。

## 6. User journeys 與 targeted scenarios

正式 user journey 是 `create_join_complete_match`：建立房間、所有設定人數的固定身分加入、設定牌組、各自擲骰／Ready、逐局玩到最高分至少 10、所有玩家頁抵達相同終場、正規化結果。八人基本牌組已通過；3–7 人與所有擴充組合尚未認證。

探索 journey 是 `discover_user_journeys`，只能搭配 `approach: exploratory` 與 `allowDiscovery: true`。

已宣告的 targeted scenarios：

- `forced_first_finder`
- `detective_resolution`
- `dog_forced_discard`
- `witness_visibility`
- `information_exchange`
- `rumor_simultaneous_draw`
- `trade_exchange`
- `culprit_last_card`
- `inspector_public_marker`（planned）
- `juvenile_opening_clue`（planned）

Scenario 只能控制被宣告的前置條件或單一強制步驟，其餘策略仍由隔離玩家自主。首次 `natural_user` formal baseline 不指定 scenario。擴充測試使用 `targeted_scenario` 或 `mixed`；開關與 scenario 必須精確配對，兩個 scenario 可同時選取。

擴充專屬稽核 checkpoint：

- 警部：至少一筆 `criminaldance_inspector_marker_observed`，證明 actor、target 與公開 marker 在四頁一致；若 marker 覆蓋局結果，只接受 `inspector_caught_culprit`。
- 少年：至少一筆 `criminaldance_juvenile_clue_isolation_checked`，只公開「四名參與者中恰有一個 holder prompt、非 holder 為零」的聚合結果與一個 opaque 私人 evidence ref，不公開持有人身分或提示內容。

Adapter 不控制發牌、牌庫順序或 fixture。若完整 match 中沒有自然出現所選擴充 checkpoint，該 targeted Run 缺少必要證據，不能通過，也不可用產品 Hook 補造。

## 7. 重新整理與多分頁

探索中於情報交換尚未全部提交時重新整理 P1：入口顯示 `以 舞者甲 重新連線`，重新連線後 P1 的精確手牌與待選提示恢復；P2、P3、P4 分頁維持原身分與原進度。共享瀏覽器的最近房間清單會列出這個瀏覽器曾用過的四個公開名稱；這不是其他玩家手牌洩漏，但容易誤選身分，正式 Run 必須在每個策略動作前重新核對固定 tab/player mapping。

Formal baseline 依使用者指定使用 `reconnect.mode: none`；探索證據不得當作 formal reconnect certification。

## 8. 終局 oracle 與 normalized result

局結算不是整場終局。每局結算顯示原因、公開打出牌、公開牌、剩餘張數、局分與累計分；只有房主可開始下一局。任一局後最高總分達 10，所有分頁進入 `整場結算`，顯示勝者名稱、所有玩家終場分數與公開桌面；若最高分並列，所有最高分玩家都是 winner。房主可見的重設控制不屬於 normalized result。

```json
{
  "outcomeId": "match_score_threshold",
  "winnerIds": ["P2"],
  "targetScore": 10,
  "totalScores": { "P1": 7, "P2": 10, "P3": 8, "P4": 9 },
  "rounds": [
    {
      "roundIndex": 1,
      "outcomeId": "detective_caught_culprit",
      "actorId": "P2",
      "culpritId": "P1",
      "scoreDeltas": { "P1": 0, "P2": 2, "P3": 1, "P4": 1 },
      "totalScores": { "P1": 0, "P2": 2, "P3": 1, "P4": 1 },
      "playedCards": { "P1": [], "P2": ["detective"], "P3": [], "P4": ["first_finder"] },
      "publicCards": { "P1": [], "P2": [], "P3": [], "P4": [] }
    }
  ],
  "summary": "All tabs visibly show the same match winner and final scores."
}
```

允許的局結果為 `culprit_escaped`、`detective_caught_culprit`、`dog_caught_culprit`、`inspector_caught_culprit`。Adapter 稽核每局的分數連續性、終場最高分、10 分門檻、跨分頁完全相同的 normalized result，以及 custom events 與 `result_detail` 的一致性。

## 9. Evidence 與認證限制

- 探索只使用四個 UI 分頁、語意 DOM 與 Logs-only 證據；沒有截圖，也沒有 `screenshots` 目錄。
- 探索已覆蓋建房／加入、房號／身分／房主、玩家數與兩擴充、d100／Ready／開始、私人手牌、合法 disabled 原因、目標／取消／確認、第一發現者、目擊者、狗、情報交換、謠言、偵探、重新整理恢復與跨頁局結算。
- 八人正式基本局已涵蓋完整交易雙方交換；犯人最後一張 targeted scenario、3–7 人、警部、少年及兩擴充同開仍需要各自的 formal evidence；基本局通過不會認證擴充。
- Adapter 工具測試與產品單元測試不是產品 E2E 通過證據。
- 八人基本 profile 已符合 `fork_turns: "none"`、零代理工具呼叫、固定分頁身分、私人手牌隔離、合法 UI action 與跨頁終局一致，因此 Catalog 是 `experimental`。擴充 profile 仍個別維持 `planned`。
- 本次已提供一局 `serverTimeScale: 1.0` 的完整通過證據，但首次認證仍只升為 `experimental`；不因單局自動宣稱整款遊戲或擴充達到 `supported`。

## 10. 首次八人 formal Run 與 recorder 契約

`20260718-191500-criminaldance-8p` 已由八個 `fork_turns: "none"` 的隔離代理，透過八個固定玩家分頁完成自然行動牌局；八頁都顯示同一終局：第 8 輪結束，P4 以 10 分獲勝。這次仍是 `incomplete` / `not_evaluated`，因 append-only Observation／Decision provenance 未通過正式稽核（2014 個 recorder-contract errors），不可用來升級 Catalog。

Adapter 2.2 對後續正式 Run 強制以下記錄契約：

- 先 append 可見的公開／私人來源證據，再 append 引用它的 Observation；整個 Run 的 `evidenceId` 不得重複。
- Observation fact 的 `text` 必須與來源 `evidenceText`（或 public-chat `message`）逐字相同；摘要需有自己的可見證據。
- 每個合法選擇編碼為 `action` 或 `action:target`。Decision 的 `action` 只放 action ID，`targets` 放依序的 target ID。
- 交易出牌同時包含兩個策略選擇，使用 `play_trade_give_<giveCardId>:<targetId>`；只有可見的「只剩交易、無效果打出」流程使用無目標的 `play_trade`。
- 出牌使用 `play_<cardId>`；強制流程使用 `confirm_first_finder`、`dog_discard_<cardId>`、`information_exchange_<cardId>:<recipientId>`、`rumor_draw`、`trade_reply_<cardId>` 或 `continue_detective_result`。
- Decision 的 `evidenceRefs` 只能引用同一 Observation 的 `publicFacts[n]`、`privateFacts[n]`、`legalActions[n]` 或 `ownMemory[n]`；不得直接填 `evidenceId`。
- 房間互動前記錄 `product_test`；可見 UI 證明牌局開始時記錄 `game_started`。

這次基本牌局沒有啟用警部或少年。兩者與合併擴充仍保留為可選 targeted profiles，狀態全部為 `planned`，需各自完成正式 Run 才能認證。

## 11. 首次通過的八人正式 Run

`20260719-113144-criminaldance-8p` 由八個 `fork_turns: "none"` 的持續隔離代理，透過八個固定且不同身分的分頁完成 8 輪自然行動基本局。全程使用可見 UI、語意 DOM、公開文字與 Logs-only 證據，沒有截圖；Server 為既有的 production-time `4173`，`serverTimeScale: 1.0`，capability endpoint 為 404，沒有測試加速 Hook。

八頁一致顯示 `整場結束`，勝者為 P2 舞者乙與 P5 舞者戊（並列 10 分），終場分數為 P1=7、P2=10、P3=5、P4=9、P5=10、P6=5、P7=8、P8=6。Run 封存為 `complete` / `pass`；最終稽核為 406 個 Observation、406 個 Decision、449 筆公開 timeline events、8 份 normalized final states、0 errors、0 warnings。嚴格認證範圍只有八人基本牌組。
