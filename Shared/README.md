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
- `public/room-ui.js`：房主指示物、轉房主與踢離線玩家 UI。

## 使用規則

1. 通用功能先修改 Shared，再由所有遊戲共同取得變更。
2. 不得在遊戲資料夾複製 Shared 函式後自行修改。
3. 遊戲專屬角色、階段、勝負與外觀留在遊戲資料夾。
4. 修改 Shared 後必須執行根目錄 `npm test`。
5. 新遊戲必須加入 `tests/ui-contract.test.js`、`tests/architecture.test.js`、`tests/server-stats.test.js` 與後台的 `games` 註冊表。
