# Gangsi feature_cp 階段性測試報告（完成第二場後暫停）

- Run：`20260723-092129-gangsi-5p`
- CoveragePlan：`fb4166aa59efa5db318f3be3421f30addad9590ee75bcafc8bcd818e79c32ef8`
- 狀態：`incomplete`
- 產品判定：`not_evaluated`
- 已執行：2 / 3 場
- 未執行：第三場隨機地圖／飛刀手
- 正式稽核：失敗（516 errors，0 warnings）

## 場次結果

### 第一場：classic／陷阱鬼

- 預期終點：`terminal_adventurer`
- 實際終點：`terminal_adventurer`
- 結果：冒險者勝，逃生 4、死亡 0。
- 已取得可見支持：5 人獵殺大廳與 9 張團隊寶藏目標、團隊寶藏啟動追蹤、三個正常鬼回合追蹤節奏、插入回合不計數、出口逃生、冒險者五分頁終局一致、核心資訊隔離、醫生生命規則。
- 未完整覆蓋：機關骰面／進度完整集合、機關封印生命週期、陷阱鬼全部子判定、工程師完整 0／數字／X 子判定、騎士完整週期、魔法師五骰全鎖不可用。

### 第二場：test-map（蟹制地圖1）／隱形鬼

- 大廳可見設定：獵殺、固定地圖、`test-map`、5 人。
- 預期終點：`terminal_mummy`
- 實際終點：`terminal_adventurer`
- 結果：冒險者勝，逃生 2、死亡 2；五個分頁的勝方、計數及所有結算列一致。
- 隱形鬼：已可見覆蓋啟用後仍可擲骰、跨回合維持、隱形時不能抓捕、冒險者路徑忽略隱形位置、雙向碰撞停在接觸前並現形、碰撞不捕獲／不受傷、主動現形結束回合、鬼位置與移動對冒險者隱藏。
- 騎士守護：可見覆蓋相鄰與斜角目標、消耗正常回合、目標對鬼方隱藏、阻擋一次生命損失、仍會被直接捕獲並送入地牢、只在騎士自己的五個正常回合倒數，啟用與插入回合不倒數。
- 工程師／機關 B：兩次操作均顯示骰面 1 + 工程師 1；第一次 0→2，第二次理論 +2 但因上限實際 +1，2→3，隨即轉為出口 B；結算列記錄 2 次操作貢獻。
- 魔法師：三個不同正常回合各免費解鎖一顆、保留正常行動、不觸發鬼插入、單回合不能重複、全局三次耗盡；未取得「五骰全鎖時不可用」的直接證據。
- 最後生還者：P3/P4 死亡、P2 逃脫後只剩 P1，所有分頁顯示密道在 `(5,6)` 開啟。
- 終點偏差原因：P5 為避免提早捕獲而保持隱形並向密道移動，但合法骰步只到 `(5,4)`；P1 下一回合合法擲出 4，經已開出口 B 逃脫，遊戲立即成為冒險者終局。未見產品錯誤；這是批准 route 未達預定終點。

## 20 個 CP 的階段狀態

### 已記錄 checkpoint_result 通過（11）

1. `cp.hunt.5p_lobby_goal`
2. `cp.hunt.adventurer_terminal_consistency`
3. `cp.hunt.core_information_isolation`
4. `cp.hunt.exit_escape`
5. `cp.hunt.interrupt_accounting`
6. `cp.hunt.last_survivor_hatch_open`
7. `cp.hunt.mummy.invisible`
8. `cp.hunt.profession.doctor_vitality`
9. `cp.hunt.settlement_rows`
10. `cp.hunt.team_treasure_tracking_start`
11. `cp.hunt.tracking_normal_turn_cadence`

注意：上述是事件層已記錄的通過結果；因整體嚴格稽核失敗，本 Run 不能把它們宣告為正式認證通過。

### 未完成／不可正式認證（9）

- `cp.hunt.hatch_close_opens_exits`：鬼未能在終局前進入已開密道，因此密道關閉、兩機關全開、封印清除未觸發。
- `cp.hunt.mummy_terminal_consistency`：第二場沒有到木乃伊終局；實際為五分頁一致的冒險者終局。
- `cp.hunt.mechanism_progress`：有上限與貢獻證據，但未形成該 CP 的完整 route 內證據契約。
- `cp.hunt.mechanism_seal_lifecycle`：缺少完整 X 封印、跨鬼／插入回合維持、消耗完整冒險者回合、X 完成清除封印鏈。
- `cp.hunt.profession.engineer_mechanism`：數字骰與上限已見；缺工程師 0／X 分支的完整子判定。
- `cp.hunt.profession.knight_guard`：第二場可見行為已完整覆蓋，但 Adapter 把本 CP 綁定第一場，不能用第二場結果直接簽發正式 checkpoint_result。
- `cp.hunt.profession.wizard_unlock`：缺五骰全鎖時不可用。
- `cp.hunt.mummy.trap`：第一場沒有完成全部陷阱子判定。
- `cp.hunt.mummy.knife`：第三場尚未執行。

## 稽核與資訊隔離

- 行為觀察未發現跨玩家秘密外洩；`decisionIsolationFailures=0`。
- 但嚴格 logs-only 稽核未通過，主要類別為：大量 Observation／Decision 證據引用缺失、引用順序或 legalActions 不合契約；部分 public evidence 未證明五方可見；重複 evidenceId；第二場 turnIndex 不連續；缺少多個 adapter_checkpoint；第一場缺 normalized result／final-state；第三場未開始；第二場終點不符批准 route。
- 因此本階段不作產品 pass 或 fail 判定。

## 清理結果

- 五個 Run 擁有的瀏覽器分頁已關閉。
- 五個隔離玩家代理已釋放／停止。
- 房間先返回準備大廳再關閉分頁。
- 沒有 Run 擁有的本機 server 或 process 需要停止。
- 共用瀏覽器綁定及已部署網站屬重用資源，已保留且未修改。

## 待執行項目

1. 第三場（已批准）：房主在可見 UI 勾選「隨機地圖」，開始後記錄實際 `mapId`／`mapName`，使用飛刀手完成 `cp.hunt.mummy.knife`；目前尚未開始。
2. 若要補齊第二場：需要新的、針對密道收束與木乃伊終局的額外 route；依既有規則，在新增第四場前必須取得使用者新批准。
3. 在下一個正式 Run 中先修正證據產生流程：每個 Observation 必須先寫入且其 evidenceRefs／legalActions 可解析，再寫 Decision；turnIndex 從 1 連續；每個 CP 同 route 僅一個 adapter_checkpoint 與 checkpoint_result；每場都寫 terminal、normalized result、五份 final-state 及 coverage_route_completed。

