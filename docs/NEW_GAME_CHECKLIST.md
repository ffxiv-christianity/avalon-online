# New Game Checklist

新增桌遊前，先填寫這份清單。清單的目的不是限制玩法，而是確保新遊戲套用既有房間框架、明確決定是否採用新型主遊戲框架，並在實作前釐清 Server View、行動資訊與測試邊界。

## 1. 基本註冊

- [ ] 建立獨立遊戲資料夾。
- [ ] 建立獨立 HTTP 路徑與 WebSocket 路徑。
- [ ] 在根 `server.js` 註冊 HTTP、WebSocket、maintenance 與後台 `games`。
- [ ] HTML 載入 `/shared/styles.css`、`/shared/client-state.js`、`/shared/room-ui.js`。
- [ ] Server 使用 `Shared/server/random.js`。
- [ ] Server 使用 `Shared/server/room-actions.js`。
- [ ] Client 使用 `SharedRoomClient.createActionRequest()`。

## 2. 房間與連線

- [ ] 房間包含 `code`、`version`、`phase`、`hostId`、`hostOfflineSince`、`players`、`playerJoinSerial`、`playerJoinEvents`、`chat`、`log`、`emptySince`。
- [ ] 玩家包含 `id`、`name`、`online`、`ready`、`roll` 與同點排序亂數。
- [ ] 建立、加入、快速重連、失效房間與失效玩家都有測試。
- [ ] 同一玩家多分頁接管、唯讀拒絕、重複 `actionId`、舊 `roomVersion` 都有測試。
- [ ] 回到大廳時清空上一局聊天與記錄。

## 3. 新型主遊戲框架判定

- [ ] 是否需要玩家矩陣或玩家摘要卡。
- [ ] 是否需要手牌、角色牌、選牌或其他玩家可選物件。
- [ ] 是否需要桌面公開區，例如抽牌堆、棄牌堆、蓋牌、公開牌、任務區或移除區。
- [ ] 是否需要公開資訊欄。
- [ ] 是否需要私密資訊欄。
- [ ] 是否需要行動資訊欄。
- [ ] 是否需要右上角目前回合提示。
- [ ] 是否需要主流程確認／取消按鈕列。
- [ ] 是否需要結算或整場結束後房主操作列。
- [ ] 結算時是否需要公開所有玩家或未出局玩家的剩餘手牌。

### 棋盤式遊戲判定

- [ ] 是否以格線、節點或區域作為主要遊戲空間；若是，採用 Board Game Template。
- [ ] 地圖使用結構化 JSON 表示尺寸、牆壁／通行邊、特殊區域、物件位置與 metadata，並可獨立驗證。
- [ ] 地圖 class／屬性和棋子規則分離，載入不同地圖不改寫角色互動。
- [ ] 是否有不同 viewer 的棋子位置、物件或手牌可見性差異。
- [ ] 是否省略桌機 `status-strip`；若省略，生命、任務、資源、階段與行動者移到玩家矩陣或控制區。
- [ ] 實際遊戲是否隱藏每格座標，並把座標保留在 `aria-label`、編輯器或開發工具。

## 4. Template Marker

- [ ] 主桌面使用 `template-game-main-table`。
- [ ] 玩家矩陣使用 `SharedRoomUI.playerMatrix()`，並保留 `template-game-player-matrix`。
- [ ] 座位編號使用 `SharedRoomUI.seatNumber()`，並保留 `template-seat-number` 的圓形、固定尺寸與座位配色；與座位綁定的物件使用 `SharedRoomUI.seatToneClass()` 沿用相同配色。
- [ ] 主流程控制列使用 `template-game-control-row`。
- [ ] 手牌或選牌區使用 `SharedRoomUI.handPanel()`，並保留 `template-game-hand-panel`。
- [ ] 單張手牌 selected/disabled class 使用 `SharedRoomUI.cardStateClasses()`。
- [ ] 行動資訊欄使用 `SharedRoomUI.actionInfoBlock()`，並保留 `template-game-action-info-block`。
- [ ] 主流程確認列使用 `template-game-action-row`。
- [ ] 目前回合提示使用 `template-game-turn-badge` 與 `template-game-turn-pulse`。
- [ ] 玩家列表 token 使用 `SharedRoomUI.rosterTokens()`。
- [ ] 結算房主操作使用 Shared `.result-action-row`。

## 5. Server View

- [ ] `room.phase` 能描述目前階段。
- [ ] `room.currentPlayerId` 或等價欄位能描述目前行動者。
- [ ] `room.players[]` 只包含公開資料，不包含其他玩家秘密。
- [ ] `room.publicZones` 或等價欄位包含全員可見的桌面公開區。
- [ ] `you.hand`、`you.role`、`you.privateInfo` 或等價欄位只下發給目前玩家。
- [ ] `you.pendingAction` 由 Server 提供合法選項，前端不得自行增加合法目標或卡牌。
- [ ] 棋盤的合法格、方向與完整路徑由 Server 提供；前端只高亮與送回選擇。
- [ ] 隱藏棋子位置時，合法移動清單、記錄、提示與錯誤訊息也不會形成位置旁通道。
- [ ] `you.actionInfo` 分公開訊息與私密結果，只下發給可閱讀的玩家。
- [ ] 結算 View 保留足夠公開資訊，讓玩家理解觸發原因、得分與公開狀態。
- [ ] 若結算需要公開剩餘手牌、隱藏角色或其他私密資訊才能驗證勝負，`roundResult` 或等價 View 提供結構化公開資料；不要只靠 action info 文字。
- [ ] 若公開剩餘手牌，資料包含玩家、牌面、比較值與是否得分，前端使用遊玩時的同一個牌面 renderer 或等價 helper；結果列優先使用 `SharedRoomUI.resultRows()`，可參考 LoveLetter `revealedHands`、`renderResultRows()` 與 `renderHandCardFace()`。
- [ ] 已明確判斷結算時是否需要公開所有玩家或未出局玩家的剩餘手牌；若不需要，規則原因清楚。

## 6. Action Info

- [ ] 公開行動寫給所有玩家。
- [ ] 私密結果只寫給相關玩家。
- [ ] 指定、保護、出局、棄牌、無效果與結算原因有公知結果。
- [ ] 抽牌、換牌、查驗、交換等私密結果描述方向與卡牌名稱。
- [ ] 公開訊息不得洩漏秘密牌名。
- [ ] `#N` 座位資訊使用遊戲自己的 `renderSeatBadges()` 或等價 `renderMessage` 處理。
- [ ] 結算畫面保留最後一段 action info 或等價公開摘要。

## 7. 可推進性

- [ ] 每個 `phase` 都有至少一個合法出口。
- [ ] 沒有實際行動者時自動跳過。
- [ ] 未啟用角色、牌、擴充階段會直接跳過。
- [ ] 無合法目標時有出口。
- [ ] 所有目標受保護時有出口。
- [ ] 以資料驅動測試逐一列舉每張需要目標的牌與每個需要目標的能力，不以單一卡牌代表整類規則。
- [ ] 無可交換牌或無可選物件時有出口。
- [ ] 牌庫、棄牌堆、桌面區為空時有出口。
- [ ] 玩家出局、離線或只剩自己時有出口。
- [ ] 可無效果打出的行動會顯示原因、允許確認並推進。
- [ ] 前端不得因空目標清單或空選牌清單永久 disabled。
- [ ] 棋盤路徑被牆、其他棋子或特殊區域完全阻擋時，能重擲、跳過、停止或以規則指定方式推進。
- [ ] 多棋子由同一玩家控制時，每顆棋子的回合、生命、淘汰與勝負檢查都能推進。

## 8. 測試

- [ ] Shared 單元測試通過。
- [ ] 架構契約測試通過。
- [ ] 跨遊戲 UI contract 加入新遊戲。
- [ ] 後台 `games` 與 server stats 測試加入新遊戲。
- [ ] 最少人數與最多人數測試。
- [ ] 推薦設定與所有可啟用內容同時開啟測試。
- [ ] 所有牌庫、角色、能力或主要行動類型都有覆蓋。
- [ ] 含隨機流程的遊戲至少跑 10 次完整流程或同等覆蓋。
- [ ] 棋盤式遊戲以隨機流程或資料驅動等價測試涵蓋所有移動型態、阻擋、特殊區域、抓捕／碰撞、任務／物件互動與雙方勝利。
- [ ] 不同 viewer 的私密 View 隔離測試。
- [ ] 偽造 client payload 不會改變 server 私密結果。
- [ ] 無合法目標、無可選物件、空牌堆或空桌面區測試。
- [ ] 同玩家多分頁接管、唯讀拒絕、重複 actionId、舊 roomVersion 測試。
- [ ] 結束後返回大廳、重設準備並開始下一局測試。
- [ ] 多局計分遊戲：未達目標分數的本局結算只能開始下一局；達到目標分數的整場結束只能返回大廳，且 server action 不可被封包繞過。

## 9. RWD 與視覺

- [ ] 桌機版主流程不重疊。
- [ ] 平板版主流程不重疊。
- [ ] 560px 手機版主流程不重疊。
- [ ] 380px 小型手機版主流程不重疊。
- [ ] 手機版保留完整功能，不以隱藏桌機內容代替。
- [ ] 文字、按鈕、卡片、座位編號與 token 不因長名稱或長文案撐破容器。
- [ ] 玩家名稱載入並綁定 `Shared/public/player-name.js`，前後端都以 12 個半形寬度單位為上限。
- [ ] 動畫支援 `prefers-reduced-motion`。
- [ ] 棋盤使用固定行列、`aspect-ratio` 或等價約束，棋子、標記、hover 與 loading 不改變格子尺寸。
- [ ] 最大地圖在桌機、平板與手機採用可預期的縮放或局部捲動，不造成整頁水平溢出。
- [ ] 最大玩家／棋子數、同格堆疊、最長名稱與所有公開數值同時出現時不重疊。

### Visual QA 分層

- [ ] Visual QA 截圖測試屬於按需執行，不是每次改動或每次交付的必跑項目；若改到手機版 layout、主遊戲框架、玩家矩陣、手牌／選牌區、桌面牌區、棄牌／打出牌堆、規則 overlay、lightbox 或大量公開資訊，先詢問是否要執行。
- [ ] 白箱 layout 測試：檢查必要 `template-*` marker 可見、沒有水平溢出、turn badge 不重疊玩家矩陣／手牌／行動資訊。
- [ ] 黑箱截圖測試：用固定 viewport 產出桌機與手機截圖，人工或 snapshot diff 檢查實際視覺。
- [ ] 壓力測試：fixture 必須模擬最大玩家矩陣與最壞合理內容，不得只用理想最小畫面，也不得只用短名字、低分、少量卡牌的理想畫面。
- [ ] 三層 Visual QA 都必須產出可檢查結果：白箱產出 marker/overlap report 與結構截圖；黑箱產出正常遊戲截圖；壓力產出最大內容截圖。
- [ ] 三層 Visual QA 都必須涵蓋完整房間階段，不可只截主遊戲視窗；至少包含準備大廳、主遊戲與結算／等待回大廳。
- [ ] Shared room shell 的 Visual QA 必須覆蓋五款遊戲：Avalon、Onenightwolf、CriminalDance、LoveLetter、Gangsi；新型及棋盤式主遊戲 template marker 檢查只套用在使用該 template 的遊戲。
- [ ] 正式 Visual QA 必須載入原本遊戲頁面與原本前端 renderer，並使用各遊戲原本 server view schema；不得用手刻靜態 HTML fixture 取代實際遊戲架構截圖。
- [ ] 黑箱與壓力截圖都必須使用最大玩家數矩陣；差異在內容密度，黑箱使用一般合理內容，壓力使用最壞合理內容。
- [ ] 玩家矩陣壓力資料應包含最大玩家數、惡意長名字、最大或接近最大分數、最多常見狀態 token、公開牌、棄牌堆、打出牌與公開標記。
- [ ] 桌面公開區壓力資料應包含最大常見牌堆文字、棄牌堆、公開牌區、公開移除區或該遊戲等價資訊。
- [ ] 行動資訊壓力資料應包含多行公開訊息與私密訊息、`#N` badge、長玩家名稱與長卡牌名稱。
- [ ] 壓力測試需覆蓋可發生的主要組合；若組合數過多，至少覆蓋最大玩家數、最大公開資訊、最長文案與所有重要主流程區塊同時出現。
- [ ] 棋盤式遊戲的 Visual QA 額外涵蓋最大地圖、最多棋子／標記、合法路徑高亮、特殊區域與隱藏棋子 viewer。
- [ ] Visual QA harness、fixture、截圖 baseline 與測試專用瀏覽器依賴未經明確決定不得進正式 commit；可放在 gitignore 的臨時目錄。

## 10. Release

- [ ] `npm test` 通過。
- [ ] 更新 `COMMON_ROOM_FRAMEWORK.md` 或相關 docs。
- [ ] 更新 `docs/FRAMEWORK_COMPLIANCE_MATRIX.md`。
- [ ] 更新首頁 release note。
- [ ] 不啟動 production server；交付時提醒重啟本地測試服務。
