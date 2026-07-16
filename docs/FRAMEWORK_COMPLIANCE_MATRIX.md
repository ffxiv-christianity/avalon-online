# Framework Compliance Matrix

這份矩陣用來區分「全站房間框架」、「新型主遊戲框架」與「棋盤式主遊戲框架」的套用範圍。CriminalDance / LoveLetter 驗證卡牌與玩家矩陣型流程；Gangsi 驗證在相同基礎上以棋盤為主的流程。Avalon / Onenightwolf 的穩定主流程不因此被要求立即回套。

## 框架層級

- **Global Shell**：首頁、房間 shell、狀態列、側欄、聊天、玩家列表、記錄、規則視窗、更新日誌、RWD、重連與多分頁控制權。
- **Shared Runtime**：`Shared/server/random.js`、`Shared/server/room-actions.js`、`Shared/server/realtime-contract.js`、`Shared/public/client-state.js`、Shared 靜態資源與後台註冊。
- **Roster Template**：玩家列表本人高亮、房主操作、玩家 token policy、房主 token 靠右。
- **New Main Game Template**：玩家矩陣、手牌／選牌、桌面公開區、行動資訊、主流程確認列、右上角回合提示。
- **Board Game Template**：結構化地圖與圖譜、棋盤優先 layout、Server-authoritative 合法移動、棋子可見性隔離、座標隱藏與固定格子尺寸。
- **Server View Boundary**：公開 View 與 private `you.*` 資訊分離，私密結果只能由 Server 下發。
- **No-dead-end Coverage**：測試覆蓋無合法目標、無可選物件、空牌堆、被阻擋、跳過與無效果可推進。

## 目前套用狀態

| 遊戲 | Global Shell | Shared Runtime | Roster Template | New Main Game Template | Board Game Template | Server View Boundary | No-dead-end Coverage |
|---|---|---|---|---|---|---|---|
| Avalon | 已套用 | 已套用 | 已套用 | 既有穩定主流程，暫不回套 | 不適用 | 已套用 | 已測主要流程 |
| Onenightwolf | 已套用 | 已套用 | 已套用 | 既有穩定主流程，暫不回套 | 不適用 | 已套用 | 已測主要流程 |
| CriminalDance | 已套用 | 已套用 | 已套用 | 已套用 | 不適用 | 已套用 | 已測主要流程與 10 次流程 |
| LoveLetter | 已套用 | 已套用 | 已套用 | 已套用 | 不適用 | 已套用 | 已測主要流程與 10 次流程 |
| Gangsi | 已套用 | 已套用 | 已套用 | 已套用 | 已套用 | 已套用，經典與獵殺模式依 viewer 隔離位置、任務、陷阱、類型與匿名事件 | 已測經典／獵殺完整流程、特殊能力、雙出口、密道與 10 次隨機流程 |

補充：LoveLetter 的無合法目標覆蓋必須逐卡驗證衛兵、神父、男爵與國王；隨機完整流程不能取代刻意建立「所有其他玩家都受保護」的契約測試。

補充：Gangsi 的完整隨機流程以資料驅動的等價覆蓋取代不可控的長時間漫遊；經典與獵殺各至少執行 10 次完整流程。獵殺模式另以刻意情境逐一驗證職業、提燈怪能力、受傷、守護、機關、雙出口、密道、追蹤及 viewer 資訊隔離。

## New Main Game Template 檢查欄位

新遊戲若採用新型主遊戲框架，至少需要在跨遊戲 UI contract 中檢查以下項目：

- `template-game-main-table`
- `template-game-player-matrix` 或明確說明不需要玩家矩陣
- `template-seat-number` 或明確說明不使用座位矩陣
- `template-game-control-row`
- `template-game-hand-panel` 或明確說明不需要手牌／選牌
- `template-game-action-info-block` 或明確說明不需要行動資訊欄
- `template-game-action-row` 或明確說明沒有主流程確認列
- `template-game-turn-badge` 與 `template-game-turn-pulse` 或明確說明沒有目前行動者提示

## Board Game Template 檢查欄位

棋盤式遊戲除上述項目外，還必須檢查：

- 地圖 JSON 能獨立驗證邊界、牆壁／通行邊、特殊區域、物件位置與唯一 ID。
- 遊戲規則只依地圖 class／屬性互動，切換地圖不改變棋子規則。
- Server View 提供合法格、方向或路徑；前端不自行計算或擴大合法目標。
- 每個 viewer 的棋子位置、手牌、記錄與錯誤訊息都遵守同一套隱私邊界。
- 實際遊戲格子不常駐顯示座標，且棋子、標記、hover 或 loading 不會改變格子尺寸。
- 省略桌機 `status-strip` 時，生命、任務、資源、階段與目前行動者仍可從玩家矩陣或控制區讀取。
- RWD 與 Visual QA 涵蓋最大地圖、最大玩家／棋子數、長名稱、合法目標高亮與隱藏棋子 viewer。

## 維護規則

- 新增遊戲時，必須更新本矩陣。
- 若新遊戲採用新型或棋盤式主遊戲框架，必須同時更新 `tests/ui-contract.test.js` 的契約檢查。
- 若重構 Avalon 或 Onenightwolf 並回套新型主遊戲框架，必須在本矩陣中從「既有穩定主流程，暫不回套」改為「已套用」，並補足對應 contract。
- 本矩陣描述框架套用狀態，不替代遊戲規則測試。
