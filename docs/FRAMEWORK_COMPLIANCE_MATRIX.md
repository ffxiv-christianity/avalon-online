# Framework Compliance Matrix

這份矩陣用來區分「全站房間框架」與「新型主遊戲框架」的套用範圍，避免把 CriminalDance / LoveLetter 萃取出的新型主流程誤解成 Avalon / Onenightwolf 也必須立即回套。

## 框架層級

- **Global Shell**：首頁、房間 shell、狀態列、側欄、聊天、玩家列表、記錄、規則視窗、更新日誌、RWD、重連與多分頁控制權。
- **Shared Runtime**：`Shared/server/random.js`、`Shared/server/room-actions.js`、`Shared/server/realtime-contract.js`、`Shared/public/client-state.js`、Shared 靜態資源與後台註冊。
- **Roster Template**：玩家列表本人高亮、房主操作、玩家 token policy、房主 token 靠右。
- **New Main Game Template**：玩家矩陣、手牌／選牌、桌面公開區、行動資訊、主流程確認列、右上角回合提示。
- **Server View Boundary**：公開 View 與 private `you.*` 資訊分離，私密結果只能由 Server 下發。
- **No-dead-end Coverage**：測試覆蓋無合法目標、無可選物件、空牌堆、跳過與無效果可推進。

## 目前套用狀態

| 遊戲 | Global Shell | Shared Runtime | Roster Template | New Main Game Template | Server View Boundary | No-dead-end Coverage |
|---|---|---|---|---|---|---|
| Avalon | 已套用 | 已套用 | 已套用 | 既有穩定主流程，暫不回套 | 已套用 | 已測主要流程 |
| Onenightwolf | 已套用 | 已套用 | 已套用 | 既有穩定主流程，暫不回套 | 已套用 | 已測主要流程 |
| CriminalDance | 已套用 | 已套用 | 已套用 | 已套用 | 已套用 | 已測主要流程與 10 次流程 |
| LoveLetter | 已套用 | 已套用 | 已套用 | 已套用 | 已套用 | 已測主要流程與 10 次流程 |

補充：LoveLetter 的無合法目標覆蓋必須逐卡驗證衛兵、神父、男爵與國王；隨機完整流程不能取代刻意建立「所有其他玩家都受保護」的契約測試。

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

## 維護規則

- 新增遊戲時，必須更新本矩陣。
- 若新遊戲採用新型主遊戲框架，必須同時更新 `tests/ui-contract.test.js` 的契約檢查。
- 若重構 Avalon 或 Onenightwolf 並回套新型主遊戲框架，必須在本矩陣中從「既有穩定主流程，暫不回套」改為「已套用」，並補足對應 contract。
- 本矩陣描述框架套用狀態，不替代遊戲規則測試。
