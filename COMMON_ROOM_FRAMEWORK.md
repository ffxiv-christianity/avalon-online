# 通用房間框架：網站架構契約

這是本網站開發新遊戲、修改共用 UI 與審查程式結構時的主要依據。

## 1. 名詞

- **共用（Shared）**：遊戲在執行時引用 `Shared/` 的同一份程式或資源。修改 Shared 會影響所有遊戲。
- **沿用（Game Template）**：遊戲使用相同的資料契約、畫面位置與操作方式，但內容由遊戲自行實作。
- **專屬（Game-specific）**：只屬於單一遊戲的規則、角色、階段、勝負與視覺。

不得把「複製一份相同程式」稱為共用。

## 2. 目前真正共用的執行模組

### Server

| 模組 | 責任 |
|---|---|
| `Shared/server/random.js` | 房號、玩家 ID、d100、同點亂數、延遲亂數、加密洗牌 |
| `Shared/server/room-actions.js` | 手動轉房主、踢出離線玩家與權限驗證 |
| `Shared/server/admin.js` | `ADMIN_TOKEN`、跨遊戲統計、後台頁面 |
| `Shared/server/static.js` | `/shared/*` 靜態資源 |

### Browser

| 模組 | 責任 |
|---|---|
| `Shared/public/styles.css` | 首頁、房間框架、聊天、玩家、Lightbox、規則與 RWD |
| `Shared/public/client-state.js` | 房號解析、Session、重連身分、玩家加入未讀 |
| `Shared/public/room-ui.js` | 房主指示物、轉房主、踢離線玩家 UI、連線版本顯示格式 |

## 3. 每款遊戲必須沿用的資料契約

房間至少需要：

- `code`
- `version`
- `phase`
- `hostId`
- `hostOfflineSince`
- `players`
- `playerJoinSerial`
- `playerJoinEvents`
- `chat`
- `log`
- `emptySince`

玩家至少需要：

- `id`
- `name`
- `online`
- `ready`
- `roll`
- 同點排序亂數

公開 View 至少提供：

- 房間代碼與階段
- 房主 ID
- 玩家列表與在線狀態
- 聊天、記錄與加入事件
- 目前玩家的 `id`、`name`、`isHost`

## 4. 每款遊戲必須沿用的能力

### 首頁

- 遊戲模式選擇
- 名字、房號或完整邀請連結
- 建立、加入、重新連線
- 各遊戲分開顯示自己的最近使用房間
- 完整邀請連結必須辨識所屬遊戲並自動切換模式
- 純房號不含遊戲資訊，使用目前選擇的遊戲模式
- 成功進房後才更新遊戲網址
- 各遊戲自己的規則與更新日誌

### 房間

- 四格狀態列
- 聊天、玩家、遊戲資訊、記錄
- 系統加入提示與未讀數字
- 房號與複製邀請連結
- d100 座位排序
- 準備／取消準備
- 房主設定與推薦設定

### 房主

- 準備房顯示房主指示物
- 手動轉移房主
- 房主離線超過兩分鐘後自動轉移
- 只能在準備房踢出離線玩家
- 修改設定、開始遊戲及返回準備房的權限由 Server 驗證

### 連線

- 短暫 WebSocket 斷線自動恢復原房間與身分
- 重新整理頁面回到大廳，由玩家手動重新連線
- 重連不新增玩家、不新增加入事件、不新增系統加入訊息
- 全員離線 30 分鐘後清除房間

### 隨機與安全

- 不得使用 `Math.random`
- 使用 `Shared/server/random.js`
- 所有關鍵動作由 Server 驗證
- 私人資訊由 Server 產生玩家專屬 View

## 5. RWD 契約

共用 CSS 至少處理：

- 2100px 超大型桌機
- 1500px 大型桌機
- 1280px 一般桌機
- 1180px 小型桌機
- 930px 平板
- 560px 手機
- 380px 小型手機

遊戲專屬 CSS 只能補充遊戲元件，不應重新定義整套房間框架。

## 6. 遊戲專屬責任

以下不得塞入 Shared：

- 人數限制
- 角色與牌庫
- 遊戲階段
- 行動順序
- 投票規則
- 勝利條件
- 推薦配置
- 專屬指示物
- 專屬規則文字
- 更新日誌
- 遊戲專屬 CSS

## 7. 新增第三款遊戲流程

1. 建立獨立遊戲資料夾及 WebSocket 路徑。
2. HTML 載入：
   - `/shared/styles.css`
   - `/shared/client-state.js`
   - `/shared/room-ui.js`
3. Server 引用：
   - `Shared/server/random.js`
   - `Shared/server/room-actions.js`
4. 在根 `server.js` 註冊 HTTP、WebSocket、Maintenance 與後台 `games`。
5. 使用本文件定義的房間與玩家欄位。
6. 將新遊戲加入跨遊戲 UI 契約測試。
7. 新增滿房、重連、房主權限、完整流程及勝負矩陣測試。
8. 執行根目錄 `npm test`。

## 8. 修改 Shared 的檢查流程

修改 Shared 前先判斷：

- 是否所有遊戲都需要這個行為？
- API 是否能保持遊戲規則獨立？
- 是否會改變既有房間資料格式？
- 是否需要同步調整桌機與手機？

修改後必須：

- 執行 Shared 單元測試
- 執行每款遊戲測試
- 執行跨遊戲契約測試
- 檢查兩款遊戲的桌機與手機 UI
- 更新本文件或 `Shared/README.md`

## 9. 禁止事項

- 不得把 Shared 檔案複製進遊戲資料夾。
- 不得在遊戲內重新實作加密洗牌或房號產生。
- 不得在遊戲內建立另一套後台。
- 不得只靠前端隱藏來實作權限或私人情報。
- 不得為了單一遊戲需求破壞其他遊戲的 Shared API。

`tests/shared.test.js`、`tests/architecture.test.js` 與 `tests/ui-contract.test.js` 是本文件的可執行契約。
