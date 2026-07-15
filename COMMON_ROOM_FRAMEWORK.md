# 通用房間框架：網站架構契約

這是本網站開發新遊戲、修改共用 UI 與審查程式結構時的主要依據。

配套文件：

- `docs/FRAMEWORK_COMPLIANCE_MATRIX.md`：目前各遊戲套用全站房間框架與新型主遊戲框架的狀態。
- `docs/NEW_GAME_CHECKLIST.md`：新增遊戲前必填的實作、Server View、行動資訊、可推進性與測試清單。

## 重新連線規格

- 加入房間後，client 需要保存 `roomCode`、`playerId`、玩家名稱與最近使用時間。
- 目前分頁使用的 `playerId` 放在 `sessionStorage`，最近使用玩家身分放在 `localStorage`，避免分享網址洩漏玩家 ID。
- 同一瀏覽器可保存同房間的多個玩家身分；當玩家名稱輸入欄變更時，UI 需要即時以「房號 + 精準名稱」優先挑選重新連線目標，再 fallback 到目前分頁的 `playerId` 或最近 session。
- 玩家名稱統一使用 `Shared/public/player-name.js`：最多 12 個半形寬度單位，ASCII 與半形字元算 1，中文、全形字元與表情符號算 2。前端必須即時限制，Server 必須再次用同一函式清理，遊戲不得各自定義不同上限。
- WebSocket 斷線重開後，若該分頁曾成功進入房間，client 需要自動送出 `joinRoom` 並帶入保存的 `playerId`，再同步完整狀態。

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
| `Shared/server/realtime-contract.js` | 統一錯誤碼、分頁控制權、actionId 去重與 roomVersion 防護 |
| `Shared/server/admin.js` | `ADMIN_TOKEN`、跨遊戲統計、後台頁面 |
| `Shared/server/static.js` | `/shared/*` 靜態資源 |

### Browser

| 模組 | 責任 |
|---|---|
| `Shared/public/styles.css` | 首頁、房間框架、聊天、玩家、Lightbox、規則與 RWD |
| `Shared/public/client-state.js` | 房號解析、Session、重連身分、失效清理、遊戲模式標籤、標準 action 封包、玩家加入未讀 |
| `Shared/public/room-ui.js` | 房主操作、玩家列表 token policy、玩家矩陣 wrapper、座位編號、手牌 UI wrapper、行動資訊 wrapper、連線版本顯示、多分頁唯讀與接管 UI |

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

## 7. 新增遊戲流程

新增任何遊戲前，開發者或 AI 必須先閱讀本文件，並把新遊戲視為「套用既有房間框架的玩法模組」，不得從空白頁面或另一套 UI 重新開始。

新增遊戲前也必須填寫或更新 `docs/NEW_GAME_CHECKLIST.md`，完成後同步更新 `docs/FRAMEWORK_COMPLIANCE_MATRIX.md`。

新遊戲的預設實作方向：

- 沿用既有首頁、房間 template、狀態列、側欄、聊天、玩家、記錄、邀請連結、規則視窗與更新日誌位置。
- 沿用 Shared button、panel、card、lightbox、toast、RWD 斷點與多分頁控制權樣式。
- 只新增遊戲必要的 phase UI、角色／牌庫／陣營呈現、規則文字及結果畫面。
- 開始設計主遊戲畫面前，必須明確確認該遊戲是否需要玩家矩陣、是否需要手牌區、是否需要公開資訊欄、是否需要私密資訊欄及行動資訊欄；需要者必須套用本文件的固定 template 框架。
- 私密訊息、角色資訊、查驗結果、技能結果與任何只屬於單一玩家的情報，必須由 Server View 產生並只下發給該玩家；前端不得自行推導或接受 client payload 覆寫。
- 新遊戲不得複製 Avalon 或 Onenightwolf 的整套前端／後端流程當作起點；若需要相同行為，必須使用 Shared 模組或抽成可參數化 helper。
- 完成時必須補齊遊戲專屬測試、跨遊戲 UI contract、私密資訊隔離測試與完整流程可推進測試。

### 新型主遊戲框架實作清單

開始實作後續新遊戲前，必須先回答並記錄下列問題；答案決定哪些 Shared template 必須套用：

- 是否需要玩家矩陣或玩家摘要卡；需要時使用 `SharedRoomUI.playerMatrix()` 與 `SharedRoomUI.seatNumber()`。
- 是否需要手牌、角色牌、選牌或其他玩家可選物件；需要時使用 `SharedRoomUI.handPanel()` 與 `SharedRoomUI.cardStateClasses()` 固定 UI 外框與 selected/disabled 狀態。
- 是否需要桌面公開區，例如抽牌堆、棄牌堆、蓋牌、公開移除、公開牌區、任務區或其他全員可見資訊；需要時應放在主桌面區，不可塞進聊天或記錄。
- 是否屬於棋盤式遊戲；若是，必須先定義結構化地圖、格子／節點屬性、通行圖譜、特殊區域、棋子可見性與合法移動來源，不得把地圖規則寫死在前端 DOM。
- 是否需要公開資訊欄、私密資訊欄或行動資訊欄；需要行動資訊時使用 `SharedRoomUI.actionInfoBlock()`，公開/私密訊息由 Server View 提供。
- 是否需要右上角目前回合提示；需要時使用 `template-game-turn-badge` 與 `template-game-turn-pulse`，提示只在目前玩家可操作或需確認時顯示。
- 是否需要主流程確認／取消按鈕列；需要時使用 `template-game-action-row`，按鈕是否 disabled、確認條件與 action payload 仍由遊戲決定。
- 是否需要結算或整場結束後房主操作；需要時使用 Shared `.result-action-row`，不得沿用大廳 `.start-button`。
- 手機版主流程順序必須先決定：桌面公開區、玩家矩陣、手牌／操作、行動資訊欄，且不得因隱藏桌機內容而缺功能。
- 棋盤式遊戲必須決定桌機與手機的棋盤縮放／捲動方式、最大地圖尺寸、棋子堆疊與座標是否顯示；實際遊戲預設不顯示每格座標，座標只保留在 `aria-label`、編輯器或除錯工具。

### 新型 Server View 邊界

新型主遊戲框架不要求所有遊戲使用完全相同欄位名稱，但 Server View 必須能回答下列問題，前端不得自行推導秘密或權限：

- `room.phase`、`room.currentPlayerId` 或等價欄位：現在是什麼階段、輪到誰或等待誰。
- `room.players[]`：每位玩家的公開座位序、在線狀態、分數或公開狀態、公開牌堆或公開標記；不得包含其他玩家手牌或秘密身份。
- `room.publicZones` 或遊戲等價欄位：全員可見的牌堆、桌面區、棄牌區、移除區、任務或流程公開資訊。
- `you.hand`、`you.role`、`you.privateInfo` 或遊戲等價欄位：只屬於目前玩家的手牌、角色、查驗、抽牌、交換、夜晚結果等秘密資訊。
- `you.pendingAction`：目前玩家是否需要操作、操作類型、可選項目的 Server-authoritative 清單；前端只能呈現與送回選擇，不得自行增加合法選項。
- 棋盤式遊戲的可走格、方向、完整路徑與障礙判定也屬於 Server-authoritative 清單；前端只能高亮伺服器允許的目標。若某陣營不能知道其他棋子位置，其 View 與合法移動資料都不得旁洩位置資訊。
- `you.actionInfo`：目前玩家可閱讀的公開與私密行動訊息；其他玩家不能從自己的 View 取得不屬於自己的私密結果。
- 結算 View 必須保留足夠公開資訊，讓玩家理解誰觸發結算、哪些玩家得分、哪些公開牌或公開狀態影響結果。

### Action Info 訊息政策

行動資訊不是聊天紀錄，也不是 debug log；它用來讓玩家理解剛發生的公開行動與自己的私密結果。

- 公開行動應寫給所有玩家，例如「#N A 對 #M B 發動男爵」、「#N A 打出王子」。
- 私密結果只寫給相關玩家，例如抽到的牌、看到的手牌、交換出去與收到的牌、查驗結果。
- 交換或抽牌必須同時描述方向與卡牌名稱，例如「你用 X 牌和 #N A 交換了 Y 牌」；公開訊息不得洩漏秘密牌名。
- 指定、保護、出局、棄牌、無效果與結算原因應有公知結果，避免其他玩家看不懂流程為何推進。
- 結算畫面應保留本局最後一段 action info 或等價公開摘要，不得只顯示分數。
- `#N` 座位 badge 由遊戲提供的 `renderMessage` 或 `renderSeatBadges()` 處理，Shared 只負責 action info 外框。

### Template Marker 命名規則

新增框架物件時必須使用可辨識的 `template-*` 前綴，且語意分層如下：

- `template-game-*`：主遊戲流程與桌面框架，例如 `template-game-main-table`、`template-game-control-row`、`template-game-hand-panel`、`template-game-action-info-block`、`template-game-action-row`、`template-game-turn-badge`。
- `template-player-*`：玩家列表與房主／狀態 token，例如 `template-player-token`。
- `template-seat-*`：座位、玩家矩陣與 `#N` 資訊，例如 `template-seat-number`。
- 遊戲專屬 class 可與 template class 並存；template class 不得承載單一遊戲規則。

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
8. 更新 `docs/FRAMEWORK_COMPLIANCE_MATRIX.md`。
9. 執行根目錄 `npm test`。

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

## 10. 新遊戲的強制產品契約

往後開發第三款及後續桌遊時，除非遊戲規則本身確實不適用，以下功能不得省略，也不得各自重新發明一套。

### 首頁與連線

- 使用共同首頁、遊戲模式選單、玩家名稱與房號輸入方式。
- 建立房間、加入房間、最近使用房間與快速重連。
- 最近房間必須顯示遊戲模式、玩家名稱／ID 與房間代碼。
- 使用穩定錯誤代碼處理失效房間與失效玩家，不得依賴錯誤文案判斷。
- 房間不存在時刪除該房間所有本機 Session；玩家不存在時只刪除該玩家 Session。
- 邀請網址必須能辨識遊戲模式並自動切換。
- 連線狀態與 `room.version` 同步次數使用 Shared 統一格式。
- 一般錯誤、成功與操作提示使用 Shared 固定 toast；connection chip 只顯示連線及同步狀態，不得用來承載長錯誤文案。
- 瀏覽器標題、favicon、遊戲名稱及網址必須隨模式正確更新。
- 同一玩家 ID 同時出現在多個分頁時，最後加入的分頁取得控制權；舊分頁保持即時唯讀並可手動接管。
- 不得以整個瀏覽器為單位禁止多分頁，因為同一裝置仍需允許不同玩家 ID 同時測試或遊玩。

### 準備大廳

- 固定包含房間狀態、玩家數、房號與複製邀請連結。
- 玩家列表、房主指示物、轉移房主與踢除離線玩家。
- d100 擲骰及依骰點決定座位／順序。
- 玩家準備按鈕及全員準備檢查。
- 新玩家加入時，Server 必須拒絕與房內既有玩家重複的名稱；比對應使用清理後名稱且不分大小寫。既有玩家以 playerId 重連時不套用重複名稱拒絕。
- 房主設定遊戲人數、規則選項、牌庫／角色配置與推薦配置。
- 設定錯誤與警告必須在主視窗清楚呈現。
- 可隨時查看完整遊戲規則。

### 遊戲房間

- 固定保留聊天、玩家、記錄及本局啟用內容等資訊分頁。
- 玩家列表的卡片高亮固定表示「目前登入的玩家本人」；領袖、房主、技能持有者與目前行動者一律使用 token 或主流程提示，不得共用高亮語意。
- 玩家列表 token 必須使用 `SharedRoomUI.rosterTokens()`。房主 token 固定為最右側 token；目前回合與遊戲狀態 token 必須出現在房主 token 左側；結算階段預設只保留房主 token。若玩家矩陣已清楚呈現出局、保護或其他桌面狀態，玩家列表不得重複顯示這些狀態 token。
- 聊天與玩家加入未讀數字提示。
- 系統事件寫入記錄；聊天只保留適合公開對話的內容。
- 單局進行期間聊天與記錄皆不設筆數上限，也不得只在 View 截取最後數筆。
- 返回準備房時聊天與記錄必須一起清空；新一局不得看見上一局的聊天或記錄。
- 聊天室滾輪與觸控捲動必須限制在聊天區，不得帶動整頁；玩家正在閱讀舊訊息時，房間更新或新訊息不得強制拉回底部。
- 聊天分頁開啟但不在底部時，新訊息仍視為未讀並累積數字；手動捲回底部後清除未讀。
- 只有原本停留在底部時才自動跟隨最新訊息；切換回聊天分頁時直接置底並清除未讀。
- 房間階段、玩家狀態、房主與同步版本由 Server View 提供。
- 所有會改變遊戲狀態的選擇，必須有明確確認按鈕。
- 已確認的投票或不可逆行動必須鎖定，不得再修改。
- 所有狀態操作必須帶有唯一 `actionId` 與操作當下的 `roomVersion`。
- Server 必須拒絕重複 `actionId`、舊版本操作及非控制分頁的操作；不得只靠前端停用按鈕。
- 聊天與表情可以忽略版本落差，但仍需 actionId 防止同一封包重送。
- 私密角色、查驗結果、技能結果及其他秘密資訊使用共同 lightbox。
- 主遊戲畫面只保留玩家需要持續記憶的摘要；需要圖像記憶或短暫揭露的資訊交由 lightbox 支援。
- 遊戲結束後可回到同一房間大廳並重設準備狀態。

### RWD 與可用性

- 必須覆蓋既有 Shared 斷點與桌機、平板、手機版。
- 不得以橫向捲動作為主要操作流程；內容優先自然換行、堆疊或分頁。
- 手機版保留相同功能，不得只隱藏桌機功能。
- 按鈕、選項與確認區必須適合觸控操作。
- 動畫只能輔助狀態辨識，並支援 `prefers-reduced-motion`。
- 文字、陣營色彩與狀態不可只依賴顏色辨識。

## 11. 固定頁面方格

所有遊戲使用相同的頁面骨架與區塊順序，保持簡潔、清楚及低視覺負擔。

### 首頁

1. 共用頂部列：網站／遊戲名稱、連線狀態、規則按鈕。
2. 共用登入卡：模式選擇、玩家名稱、房號、建立／加入／快速重連。
3. 最近房間。
4. HTML 更新日誌。

### 房間

1. 共用頂部列。
2. 狀態列：階段、玩家數、房號及遊戲必要摘要。
3. 主要方格：
   - 左側：聊天、玩家、記錄、本局啟用內容。
   - 中央：準備大廳或遊戲主流程。
   - 房間資訊：桌機置於側欄，手機依共同順序移至主內容下方。
4. 規則與私密資訊使用 overlay／lightbox，不額外擠壓主方格。

方格尺寸、間距、卡片圓角、按鈕層級、狀態色彩及 RWD 斷點優先由 `Shared/public/styles.css` 控制。遊戲專屬 CSS 只能補充角色、陣營、階段或規則所需樣式，不得重寫共用骨架。

狀態卡的外觀、數量與 RWD 屬於 Shared UI；卡片內容屬於遊戲及階段語意。準備大廳若存在房主，應顯示目前房主；遊戲開始後才改為該遊戲的領袖、行動者或其他遊戲專屬摘要。不得在準備階段顯示尚未生效的遊戲職位。採用下述棋盤式主遊戲框架時，可在桌機與手機都省略四張狀態卡，把空間留給棋盤，但仍須在主控制區呈現必要數值與階段資訊。

本文件中的主遊戲框架分成三層：全站房間框架已適用 Avalon、Onenightwolf、CriminalDance、LoveLetter 與 Gangsi；新型主遊戲框架由 CriminalDance、LoveLetter 與 Gangsi 驗證，包含玩家矩陣、手牌／選牌區、行動資訊欄、主流程確認列與右上角回合提示；棋盤式主遊戲框架則由 Gangsi 驗證，在新型主遊戲框架上增加結構化棋盤、Server-authoritative 移動、棋子可見性與棋盤優先的空間規則。後續新遊戲應依玩法套用相應層級；Avalon 與 Onenightwolf 的既有主流程已穩定，除非重構，不要求為了形式一致而回套所有新型主遊戲 `template-*` marker。

多人主畫面若使用玩家矩陣或玩家摘要卡，必須保留座位號、分數／狀態、目前行動者與必要公開資訊。玩家名稱必須使用 `min-width: 0`、`text-overflow: ellipsis` 或等效做法處理惡意長名字，完整名稱可放在 `title` 或詳細區，不得讓卡片撐破主視窗。

若遊戲適合使用玩家矩陣，玩家矩陣也屬於固定 template 框架的一部分：新增遊戲時必須先確認主流程是否需要玩家矩陣；需要時必須使用 `SharedRoomUI.playerMatrix()` 產生矩陣 wrapper，並沿用既有矩陣的座位號、玩家名稱截斷、分數／狀態、目前行動者 token、公開資訊堆疊與 RWD 欄數規則，只能依玩家上限調整欄數。座位編號 `#N` 也屬於 template 資訊，必須使用 `SharedRoomUI.seatNumber()` 產生 `template-seat-number` marker；其圓形、固定尺寸與 `seat-tone-1` 至 `seat-tone-8` 配色由 Shared template 統一。與玩家座位綁定的遊戲物件可使用 `SharedRoomUI.seatToneClass()` 沿用同一配色；角色專屬固定配色可由遊戲明確覆寫。

CriminalDance 與 LoveLetter 的主遊戲框架應視為新型主遊戲 template：主桌面、玩家矩陣、控制列、手牌／選牌區、行動資訊欄與目前回合 badge 的位置一致。玩家矩陣 wrapper、座位編號與玩家列表 token policy 屬於 `SharedRoomUI` helper；`template-game-control-row`、`template-game-action-row`、`template-game-turn-badge` 與 `template-game-turn-pulse` 屬於 Shared presentation contract，只固定位置、按鈕列尺寸與「輪到你」呼吸渲染。玩家上限、矩陣欄數、桌面牌區、公開牌區、動畫與其他規則表現仍屬遊戲專屬實作，不應寫成跨遊戲差異白名單。

棋盤式主遊戲 template 沿用新型主遊戲的 `template-game-main-table`、玩家矩陣、控制列、手牌、行動資訊與回合 badge，但主桌面以棋盤為第一優先。地圖必須是可驗證的結構化資料，將格子／節點、牆壁或邊、入口、特殊區域與物件位置分開表示；遊戲邏輯只依這些固定屬性互動，載入不同地圖時不得改寫棋子或角色規則。前端不得自行推導通行、穿越、停止、抓捕或揭露結果，所有合法目標及最終狀態都由 Server View 提供。

棋盤式主遊戲可以省略桌機四張 `status-strip`，但玩家生命、任務進度、骰子／資源、目前階段與行動者仍須在玩家矩陣或控制區保持可掃讀。實際遊戲格子不得常駐顯示座標；座標可保留在地圖編輯器、無障礙名稱與開發工具。棋盤需使用固定行列、`aspect-ratio` 或等價約束防止棋子與標籤改變格子尺寸；超出可用寬度時使用可預期的縮放或局部捲動，不得壓縮到文字、棋子或操作重疊。

若不同陣營對棋子位置的可見性不同，Server View 必須為每位 viewer 建立不同棋盤資料。隱藏位置不能只靠 CSS、透明度或前端不渲染處理，且合法移動清單、記錄、提示文字與錯誤訊息都不能成為旁通道。公開任務進度可按類別與數量提供，但未揭露的精確物件 ID、手牌與位置仍應留在擁有者的 private View。

遊戲若有「打出牌堆」「置於面前的公開牌」「指定到某位玩家的公開標記」等資訊，可以用遊戲專屬小籌碼呈現；籌碼可有副標，但尺寸、間距與截斷規則必須跟主畫面矩陣一致。只屬於單一玩家的換牌、抽牌、查驗方向與結果，仍屬 Server View 的私密資訊，不得公開成全桌流程圖。

若新型主遊戲框架有手牌或可選卡牌，手牌區也屬於固定 template 框架的一部分：手牌應固定出現在主流程控制區，並使用 `SharedRoomUI.handPanel()` 產生外框、標題、grid 與 `template-game-hand-panel` marker；單張牌的 selected/disabled 狀態 class 應使用 `SharedRoomUI.cardStateClasses()` 組合。Shared 只固定 UI 框架，不得包含牌能否打出、不可操作原因、牌面能力、目標選擇或送出 payload 等細部規則。非自己回合仍可查看手牌但不可操作；非自己回合造成的不可操作只需要 disabled，不改變牌面能力描述。若牌在自己回合因規則條件不可操作，例如 LoveLetter 伯爵夫人限制王子／國王，或 CriminalDance 偵探／警部因手牌數超過 3 張不可打出，則必須 disabled 且清楚說明原因。手牌標題、牌名、輔助小字與 disabled 樣式應沿用既有手牌卡片密度，輔助小字應使用緊湊字級與行高，不得撐破主視窗。牌面數字、圖示或角標必須維持固定尺寸，不能因文字或 flex 壓縮而變形。

新型主遊戲框架的公開資訊、私密資訊與行動資訊應使用固定的資訊欄位置：主流程左側或上方保留玩家矩陣／桌面公開資訊，右側或下方保留行動資訊欄。行動資訊欄必須使用 `SharedRoomUI.actionInfoBlock()`，保留固定標題、固定空狀態文案與 `template-game-action-info-block` marker；訊息內容、公開/私密資料來源與 `#N` badge 渲染仍由遊戲提供。行動資訊應像 CriminalDance 一樣由 Server View 列出公開動作；若有私密結果，應附加在同一個玩家自己的 action info 中，其他玩家只能看到公開動作。私密資訊只能來自 Server View。若需要新增 template class，應使用 `template-*` 前綴，讓新遊戲能清楚辨識框架物件，例如 `template-game-main-table`、`template-game-player-matrix`、`template-game-control-row`、`template-game-hand-panel`、`template-game-action-info-block` 與 `template-game-turn-badge`，並可同時保留遊戲專屬 class。

新型主遊戲框架的「現在換你」或等價目前回合提示必須固定在主遊戲視窗右上角，以浮動 badge 呈現，不得擠壓玩家矩陣、手牌或資訊欄。該 badge 應使用 `template-game-turn-badge`，內部呼吸點使用 `template-game-turn-pulse`；提示只在目前玩家可操作或需確認時顯示，並由 Shared CSS 支援手機版縮小間距與 `prefers-reduced-motion`。

手機版狀態列固定採以下規則：

- 準備大廳隱藏四張 status card，將首屏空間優先留給聊天／玩家資訊與主遊戲區。
- 遊戲開始後改顯示 Shared 的單行精簡摘要，不顯示四張大卡。
- 精簡摘要最多使用三個主要資訊群組；不得橫向捲動，空間不足時以省略號處理。
- 桌機與平板仍保留四張 status card；採用棋盤式主遊戲 template 且已把必要摘要移入玩家矩陣／控制區者可以省略。

## 12. Shared、模板與遊戲專屬的責任邊界

### 必須真正 Shared

- 房號與 Session 處理、快速重連及失效清理。
- 統一錯誤代碼、分頁控制權、actionId 去重及 roomVersion 防舊操作。
- 遊戲模式辨識與最近房間標籤。
- 連線狀態與版本顯示格式。
- 房主指示物、轉房主及踢除離線玩家。
- 隨機數、洗牌、房號、玩家 ID 與 d100。
- 共用頁面骨架、按鈕、表單、聊天、玩家列表、記錄、lightbox 與 RWD 樣式。
- 後台統計及共用靜態資源路由。

### 必須使用同一模板

- 首頁、準備大廳、房間狀態列與主要方格。
- 玩家準備流程、房主設定區、推薦配置及驗證訊息。
- 大廳驗證訊息必須使用 `.validation-list` 包住 `.validation error|warn|ok`，不得以段落預設 margin 自行排版。
- 大廳「開始遊戲」必須使用 Shared 的 `.start-button`，不得用一般 `.primary-button` 取代。
- 房主設定中的 checkbox / toggle 選項必須使用 Shared 的 `.field.setting-option` 結構；遊戲專屬 CSS 不得重寫 checkbox 尺寸、選項卡片間距或開始按鈕間距。
- 聊天／玩家／記錄未讀提示。
- 記錄清單必須使用 Shared log helper，最新事件顯示在最上方。
- 私密資訊揭露、確認按鈕與不可逆操作鎖定。
- 規則視窗、更新日誌與遊戲結束返回大廳。
- 結算或整場結束後的房主操作按鈕，必須放在 Shared `.result-action-row` 中，以維持一致間距；按鈕本身使用一般 `.primary-button` 或 `.danger-button`，不得沿用大廳 `.start-button` 尺寸。
- 若遊戲採多局計分並有目標分數，本局結算且尚未達到目標分數時只能提供「開始下一局」；有人達到目標分數進入整場結束後，只能提供「返回大廳」。Server action 也必須同步限制：`nextRound` 僅允許本局結算，`resetMatch` 或等價返回大廳 action 僅允許整場結束。
- 使用新型主遊戲框架時，主遊戲控制區的確認／取消按鈕列必須使用 `.template-game-action-row`，以維持按鈕間距、手機版伸展與主流程操作位置一致；是否顯示哪些按鈕、是否 disabled、送出什麼 action 仍由遊戲自行決定。Avalon 與 Onenightwolf 的既有主流程按鈕列暫不列為本條強制回套範圍。

模板可接受遊戲提供的資料與 callback，但不得包含特定遊戲規則。

### 保留遊戲專屬

- 遊戲規則與勝利條件。
- 回合、階段、角色技能、投票與結算邏輯。
- 角色、陣營、牌庫內容及推薦組合。
- 稱號、成就、統計或其他只屬於該遊戲的系統。
- 遊戲需要的特殊主畫面資訊。

## 13. 新遊戲完成標準

新遊戲在符合以下條件前，不視為框架整合完成：

1. 通過 Shared 單元測試、架構契約測試及跨遊戲 UI 契約測試。
2. 通過建立、加入、快速重連、失效房間、失效玩家及跨遊戲邀請測試。
3. 通過滿員、完整設定與主要遊戲流程測試。
4. 若採用新型主遊戲框架，必須完成「新型主遊戲框架實作清單」，並在跨遊戲 UI contract 中檢查必要的 `template-*` marker。
5. 測試必須覆蓋所有牌庫、角色、能力或主要行動類型；含隨機流程的遊戲至少跑 10 次完整流程或同等覆蓋。
6. 驗證 action info 訊息政策：公開行動全員可見、私密結果只在相關玩家 View、結算畫面保留足夠公開摘要。
7. 驗證桌機、平板、560px 手機及 380px 小型手機版面。
8. 確認修改 Shared 後所有既有遊戲仍完整通過測試。
9. 不得以複製既有遊戲程式碼假裝共用；若兩款以上需要相同邏輯，應優先抽成 Shared API 或參數化模板。
10. 通過同玩家多分頁接管、唯讀拒絕、重複 actionId 與舊 roomVersion 測試。
11. 通過完整流程可推進性測試；任何階段都不得因零行動者、缺少角色、重複封包、過期畫面、無合法目標、無可選物件或無可用按鈕而永久卡住。
12. 視覺上必須與 Avalon、Onenightwolf 維持同一套房間風格；新增遊戲不可出現另一套頁面骨架、按鈕階層、卡片圓角、側欄順序或手機版資訊架構。
13. 所有私密資訊都必須能證明是 Server authoritative：測試需覆蓋不同 viewer 只收到自己的私密 View，且偽造 client payload 不會改變 server 私密結果。
14. 所有 lightbox、規則 overlay、私密資訊揭露與短暫記憶型資訊，必須沿用 Shared lightbox／overlay 行為；不得在遊戲內另做一套 modal。
15. 若遊戲規則要求在結算時公開剩餘手牌、隱藏角色或其他私密資訊才能驗證勝負，必須在 `roundResult` 或等價 Server View 提供結構化公開資料，不得只放在 action info 文字中。若是公開剩餘手牌，應公開玩家、牌面、比較值與是否得分，並在前端用該遊戲遊玩時的同一個牌面 renderer 或等價 helper 顯示；結算區可使用不可選的 compact 牌列，玩家名稱必須能處理超長名字。下一款需要顯示剩餘手牌的遊戲，優先使用 `Shared/public/room-ui.js` 的 `SharedRoomUI.resultRows()` 產生結果列、名稱截斷、剩餘牌列與右側分數欄，遊戲只提供資料與 compact 牌面 renderer；LoveLetter 的 `roundResult.revealedHands`、`renderResultRows()` 與 `renderHandCardFace()` 可作為參考。Shared 只定義「結算必須可驗證」與「公開牌面應重用牌面 renderer」契約，不強制所有手牌遊戲公開剩餘手牌。
16. Visual QA 截圖測試屬於按需執行的人工輔助檢查，不是每次改動或每次交付的必跑項目；若本次改動影響手機版 layout、主遊戲框架、玩家矩陣、手牌／選牌區、棋盤、桌面牌區、棄牌／打出牌堆、規則 overlay、lightbox 或大量公開資訊，交付前應先詢問是否執行 Visual QA。若執行 Visual QA，必須分清白箱 layout 測試、黑箱截圖測試與壓力測試；三層測試都必須產出對應截圖或 report，並涵蓋準備大廳、主遊戲與結算／等待回大廳，不可只截主遊戲視窗。Shared room shell 的 Visual QA 必須覆蓋五款遊戲：Avalon、Onenightwolf、CriminalDance、LoveLetter、Gangsi；新型及棋盤式主遊戲 template marker 檢查只套用在使用該 template 的遊戲。正式 Visual QA 必須載入原本遊戲頁面與原本前端 renderer，並使用各遊戲原本 server view schema；不得用手刻靜態 HTML fixture 取代實際遊戲架構截圖。黑箱與壓力截圖都必須使用最大玩家矩陣；棋盤式遊戲還必須涵蓋最大支援地圖、最多棋子／標記、合法目標高亮與隱藏棋子 viewer。壓力 fixture 必須模擬最大玩家矩陣、最長合理名字、最大或接近最大分數、最多常見公開牌／棄牌／打出牌／公開標記與多行 action info，不得只用理想最小畫面。
17. Visual QA harness、fixture、截圖 baseline 與測試專用瀏覽器依賴未經明確決定不得進正式 commit；若正式導入，必須獨立提交並限制測試入口。
18. 交付前必須執行根目錄測試；若改動 UI 或 RWD，還必須用桌機與手機寬度檢查主流程不跑版、按鈕不重疊且所有可發生的按鈕都有 handler。

## 14. 即時操作錯誤契約

Server 錯誤必須同時提供穩定 `code` 與玩家可讀的 `message`。前端只能依 `code` 決定清理、重新同步或唯讀行為，不得解析中文文案。

共用錯誤碼的玩家文案也由 `Shared/server/realtime-contract.js` 統一產生。各遊戲不得為 `ROOM_NOT_FOUND`、`PLAYER_NOT_FOUND`、`ROOM_FULL` 等共用狀態自行撰寫不同文字；只有 `INVALID_ACTION` 等遊戲規則錯誤可以保留遊戲專屬說明。

至少保留以下共用代碼：

- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `PLAYER_NOT_FOUND`
- `ROOM_FULL`
- `GAME_ALREADY_STARTED`
- `NOT_HOST`
- `NOT_YOUR_TURN`
- `SESSION_REPLACED`
- `STALE_ROOM_VERSION`
- `ACTION_ALREADY_CONFIRMED`
- `INVALID_ACTION`

標準處理：

- `SESSION_REPLACED`：舊分頁進入唯讀，顯示接管按鈕。
- 接管必須使用獨立的 `takeControl` 訊息；只可驗證並接管既有房間、既有玩家，不得呼叫建立房間或新玩家流程。
- 接管成功回覆 `controlGranted`，原控制分頁收到 `SESSION_REPLACED` 並立刻轉為唯讀。
- 手機版隱藏桌面狀態卡後，釋出的垂直空間必須分配給共用資訊側欄（以聊天室為主要受益區），不能只留下空白或維持原本的矮高度。
- `STALE_ROOM_VERSION`：重新同步，不自動重送原操作。
- `ACTION_ALREADY_CONFIRMED`：視為先前操作已完成並同步最新狀態。
- `ROOM_NOT_FOUND`／`ROOM_EXPIRED`：刪除該房間所有快速重連紀錄。
- `PLAYER_NOT_FOUND`：只刪除該玩家快速重連紀錄。

斷線玩家的自動等待、跳過或代行政策目前不列入強制框架；本網站的使用情境允許玩家直接重開房間。若未來需要，必須採用「Shared 離線偵測與 UI、遊戲自行定義超時結果」的邊界。

## 15. 遊戲可推進性契約

所有遊戲流程必須符合「每個狀態都有出口」的原則。無法繼續遊戲屬於最高優先級的阻斷問題。

### Server 必須保證

- 每個 `phase` 都有至少一個合法事件可前往下一狀態。
- 階段沒有實際行動者時自動跳過，不得等待不存在的玩家。
- 本局未啟用的角色、牌或擴充階段必須直接跳過。
- 每張可打出的牌、角色能力或行動都必須定義無合法目標時的出口，例如無目標可指定、所有目標受保護、無可交換牌、牌庫空、棄牌堆空、玩家已出局或只剩自己。
- 若規則允許行動無效果，Server 必須接受該行動、寫入公開 action info 並推進流程；不得要求前端提供不存在的目標或卡牌。
- 所有指定玩家完成後立即推進，不得依賴額外且不可見的前端操作。
- 延遲與倒數必須有明確截止時間及 Server 端推進機制。
- 強制截止時間必須在排程器與操作入口同時檢查，避免截止瞬間的延遲封包被錯誤接受。
- 同一 action 重送只能回傳最新狀態，不得再次執行，也不得阻止後續新 action。
- 舊 `roomVersion` 被拒絕後必須回傳最新 View，讓玩家能立即重新操作。
- 多分頁控制權接管後，新控制分頁必須能繼續原階段；舊分頁不得影響推進。
- 結算、特殊技能與平票等所有分支最終必須到達下一階段、結果或返回大廳。
- 遇到不可能恢復的內部狀態時，應回傳明確錯誤並允許房主安全返回大廳；不得沉默卡住。

### Client 必須保證

- 輪到玩家時一定呈現可操作且可確認的控制項。
- 尚未符合條件時，必須清楚說明缺少什麼，不可只留下 disabled 按鈕。
- 若 Server View 表示行動可無效果打出，前端必須顯示原因並提供可確認按鈕；不得因目標清單或選牌清單為空而永久 disabled。
- 操作送出後可暫時鎖定；收到錯誤或最新 View 後必須解除或重建控制項。
- `STALE_ROOM_VERSION` 與 `ACTION_ALREADY_CONFIRMED` 必須觸發同步，不得讓畫面停留在失效狀態。
- 唯讀分頁必須清楚顯示接管方式。
- 自動推進中的等待狀態必須有可辨識文字，不能呈現空白主畫面。

### 每款遊戲必測情況

- 最少人數、最多人數。
- 推薦設定與所有可啟用內容同時開啟。
- 某個階段的角色／行動者全部位於中央、牌庫或本局未啟用。
- 同角色有一人、多人及零人需要行動。
- 所有合法跳過、不行動、平票與特殊勝利分支。
- 所有無合法目標或無可選物件的出口，例如全員受保護、無可交換手牌、指定目標沒有手牌、牌庫或桌面區為空、玩家已出局。測試必須以資料驅動方式列舉每一張需要目標的牌／每一個需要目標的能力，不得只抽測同類型中的單一卡牌。
- 角色複製、身分交換與連鎖死亡必須逐角色驗證能力、陣營、最終身分及勝負結算。
- 延後結算的特殊階段（例如獵人反擊）必須以最終死亡名單重新判定勝負，不得沿用進入特殊階段前的暫定結果。
- 最後一位玩家確認後是否立即推進。
- 同一按鈕快速連點及相同 actionId 重送。
- 使用舊 roomVersion 操作後能否同步並繼續。
- 同玩家多分頁接管前後能否繼續目前階段。
- 結束後返回大廳、重設準備並開始下一局。

每新增一個 `phase`、特殊角色或擴充規則，都必須同時新增「如何離開此狀態」的測試，不得只測進入該狀態。
