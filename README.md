# 線上桌遊專案

https://avalon-online-lhem.onrender.com/

## 重新連線功能

- 所有遊戲都會保存 `roomCode`、`playerId` 與玩家名稱，讓玩家可在重新整理、分頁意外關閉或短暫斷線後取回原身分。
- 同一瀏覽器可保存同房間的多個玩家身分；玩家名稱輸入欄會即時比對保存過的名稱，輸入 A/B 這類曾使用名稱時，重新連線按鈕會切換成對應玩家。
- WebSocket 斷線後，若本分頁曾進入房間，前端會自動用保存的玩家身分重新加入並同步狀態。

- `Avalon/`：阿瓦隆
- `Onenightwolf/`：一夜終極狼人
- `CriminalDance/`：犯人在跳舞
- `LoveLetter/`：情書

公開網址：

- `/`、`/?room=XXXXXX`：阿瓦隆
- `/Onenightwolf/`、`/Onenightwolf/?room=XXXXXX`：一夜終極狼人
- `/CriminalDance/`、`/CriminalDance/?room=XXXXXX`：犯人在跳舞
- `/LoveLetter/`、`/LoveLetter/?room=XXXXXX`：情書

根目錄的 `server.js` 負責共用 Render service 的 HTTP 與 WebSocket 路由。阿瓦隆首頁可以在不重新整理、也不立即改變網址的情況下切換到一夜狼人大廳；成功建立或加入房間後，才會更新為一夜狼人的房間網址。


遊戲規則、房間資料與 WebSocket 訊息不共用，避免修改其中一款遊戲時影響另一款。

跨遊戲必須沿用的房間能力與 UI 定義於 [`COMMON_ROOM_FRAMEWORK.md`](./COMMON_ROOM_FRAMEWORK.md)，共用執行模組說明位於 [`Shared/README.md`](./Shared/README.md)。這兩份文件是新增遊戲與修改共用框架時的必要參考。


## 管理統計

設定環境變數 `ADMIN_TOKEN` 後，可以用以下網址查看目前房間與在線人數：

```text
https://你的網域/admin/stats?token=你的ADMIN_TOKEN
```

統計頁不顯示玩家名稱，會分別列出阿瓦隆與一夜終極狼人的房間數、連線數、玩家數、在線玩家數，以及各房間的在線人數。

也可開啟後台頁面：

```text
https://你的網域/admin?token=你的ADMIN_TOKEN
```

後台可手動更新，或選擇每 5 分鐘自動更新。自動更新會持續產生 HTTP 請求，因此在分頁保持運作時會延後 Render 免費服務休眠，並持續消耗免費執行時數。
