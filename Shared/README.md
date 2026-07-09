# Shared 執行層

這個資料夾不是範例，而是所有遊戲在正式執行時共同引用的程式。

## 重新連線

- `public/client-state.js` 負責保存與選擇本機玩家身分，包含 `roomCode`、`playerId`、玩家名稱與最近使用時間。
- 同一瀏覽器可保存同房間的多個玩家身分；各遊戲的玩家名稱輸入欄會即時比對保存過的名稱，讓重新連線按鈕切換到對應玩家。
- WebSocket 斷線後，曾進入房間的分頁會用保存的玩家身分重新送出 `joinRoom`，恢復控制權並同步完整狀態。

## Server

- `server/random.js`：加密房號、玩家 ID、d100、同點亂數、延遲亂數與 Fisher–Yates 洗牌。
- `server/room-actions.js`：轉移房主與踢出離線玩家。
- `server/admin.js`：跨遊戲後台授權、統計資料與後台頁面。
- `server/static.js`：提供 `/shared/*` 靜態資源。

## Public

- `public/styles.css`：首頁、房間、聊天、玩家列表、Lightbox、規則與 RWD 的基礎樣式。
- `public/client-state.js`：房號與邀請遊戲解析、本機 Session、最近房間、重連身分及玩家加入未讀計算。
- `public/room-ui.js`：房主指示物、玩家列表 token policy、玩家矩陣 wrapper、座位編號、手牌 UI wrapper、行動資訊 wrapper、轉房主與踢離線玩家 UI。

## 框架層級

- 全站房間框架：首頁、房間 shell、聊天、玩家列表、記錄、重連、toast、房主操作與結算操作列，適用所有遊戲。
- 新型主遊戲框架：玩家矩陣、手牌／選牌區、行動資訊欄、主流程確認列與右上角回合提示，目前由 CriminalDance 與 LoveLetter 驗證，後續新遊戲若有相同結構應優先採用。
- Avalon 與 Onenightwolf 是較早穩定的主流程實作；除非重構，不要求為了形式一致而回套新型主遊戲框架的所有 `template-*` marker。

## 使用規則

1. 通用功能先修改 Shared，再由所有遊戲共同取得變更。
2. 不得在遊戲資料夾複製 Shared 函式後自行修改。
3. 遊戲專屬角色、階段、勝負與外觀留在遊戲資料夾。
4. 玩家列表 token 應使用 `SharedRoomUI.rosterTokens()`；房主 token 固定最後，結算階段預設只保留房主 token。
5. 使用新型主遊戲框架且需要玩家矩陣的遊戲，應使用 `SharedRoomUI.playerMatrix()` 和 `SharedRoomUI.seatNumber()`；矩陣內每位玩家的公開資訊與動畫仍由遊戲自行渲染。
6. 使用新型主遊戲框架且有手牌或選牌區的遊戲，應使用 `SharedRoomUI.handPanel()` 與 `SharedRoomUI.cardStateClasses()` 固定外框、grid、selected/disabled class；可操作規則、不可操作原因、牌面能力文字與 action payload 仍由遊戲自行提供。
7. 使用新型主遊戲框架的主遊戲 presentation，應使用 `template-game-control-row`、`template-game-action-row`、`template-game-turn-badge` 與 `template-game-turn-pulse` 固定位置、按鈕列尺寸與「輪到你」呼吸渲染；行動流程、目標選擇、確認條件與 payload 仍由遊戲自行提供。
8. 使用新型主遊戲框架且有行動資訊欄的遊戲，應使用 `SharedRoomUI.actionInfoBlock()`；訊息內容、私密/公開資料來源與 `#N` badge 渲染仍由遊戲自行提供。
9. 修改 Shared 後必須執行根目錄 `npm test`。
10. 新遊戲必須加入 `tests/ui-contract.test.js`、`tests/architecture.test.js`、`tests/server-stats.test.js` 與後台的 `games` 註冊表。
