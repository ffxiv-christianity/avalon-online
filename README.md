# 阿瓦隆線上主持工具

這是多人即時版本。它使用 Node.js 伺服器與 WebSocket 同步房間狀態。

## 本機啟動

```powershell
cd C:\Users\louis\Documents\Codex\2026-06-15\5-3\outputs\avalon-online
node server.js
```

開啟：

```text
http://localhost:4173
```

同一 Wi-Fi 的朋友可用你的區網 IP 加入，例如：

```text
http://192.168.1.20:4173
```

## 外網部署

請把這個資料夾當成一個 GitHub repo 的根目錄：

```text
C:\Users\louis\Documents\Codex\2026-06-15\5-3\outputs\avalon-online
```

也就是 repo 根目錄應該直接看得到：

```text
server.js
package.json
render.yaml
public/
```

推薦部署到 Render：

1. 在 GitHub 建立一個新 repo，例如 `avalon-online-host`。
2. 把 `outputs/avalon-online` 這個資料夾內容 push 到該 repo。
3. 到 Render 建立 Web Service，連接這個 GitHub repo。
4. Render 會讀到 `render.yaml`，使用 `npm install` build，使用 `npm start` 啟動。
5. 部署完成後會得到類似 `https://avalon-online-host.onrender.com` 的外網網址。

這個外網網址就是所有玩家共用的入口；因為後端也是同一個 Node.js + WebSocket process，所以投票、聊天、任務提交會同步更新。

## GitHub Pages 能不能同步？

不能只靠 GitHub Pages 完成同步。GitHub Pages 只適合放靜態前端，也就是 HTML、CSS、JavaScript。這個工具需要 WebSocket 後端保存房間、投票、任務牌、聊天與重連狀態。

可行部署方式：

- 前端和後端一起部署到 Render、Railway、Fly.io、VPS 等支援 Node.js + WebSocket 的平台。
- 或前端放 GitHub Pages，後端另部署到支援 WebSocket 的平台，再把前端的 WebSocket URL 改到該後端。

## 斷線與重連

每位玩家加入後，瀏覽器會把 `roomCode` 與 `playerId` 存在 localStorage。

- 重新整理、網頁意外關閉、短暫斷線：回到同一個房間網址，按「以某某重新連線」即可拿回原玩家 ID。
- 邀請連結第一次打開：不會自動拿舊 ID，必須輸入名字加入。
- 若遊戲已開始且玩家 ID 遺失，系統不會讓新玩家插入進行中的遊戲；建議等該玩家用原瀏覽器重連後再繼續。
- 沒有倒數限制，投票、任務、刺殺等階段會停在目前進度等待玩家回來。

## 遊戲未完成就退出會不會占用 process？

會占用該 Node.js 伺服器中的一個房間物件，但不會替每個房間開新 process。所有房間都存在同一個 Node process 的記憶體內。

目前版本已加入 6 小時自動清房：房間建立 6 小時後會從記憶體移除。若要長期公開部署，之後還可以再加上：

- 所有玩家斷線後保留 30 到 60 分鐘再清除
- 房主手動關閉房間

## 已支援

- 房間代碼與邀請連結
- 每位玩家自己的裝置加入
- 四到十人遊玩
- 玩家 d100 擲骰，且只能擲一次；開始後依點數由大到小排序
- 每位玩家準備，全部準備後才可開始
- 房主指示
- 房主設定牌庫與每輪任務人數，保留各人數推薦值
- 即時投票進度，例如 `0 / 5` 到 `5 / 5`
- 全員投完自動公開明票
- 任務牌匿名提交，只公開失敗牌數
- 聖劍領袖指示物、退役領袖徽章、職業圖示
- 指定領袖模式下，已有退役領袖徽章者不可再被指定
- 投票失敗時照正常順時針輪替，且未出任務的領袖不會拿退役領袖徽章
- 打字聊天

## GAS 可以拿來做同步嗎？

可以做「近即時」同步，但不適合做這個版本目前需要的真正即時同步。

Google Apps Script Web App 的官方模型是 `doGet(e)` / `doPost(e)` 回傳 HTML 或文字資料，前端也可以用 `google.script.run` 非同步呼叫伺服器函式。這代表它適合做表單、查詢、寫入 Google Sheet、輪詢狀態等 HTTP request/response 工作。

但阿瓦隆這種多人桌遊比較需要伺服器主動把投票、聊天、任務提交結果推送給所有玩家。GAS 沒有像 Node WebSocket 這樣常駐連線推送的模式；若硬做，通常會變成每個玩家每 1 到 3 秒輪詢一次 GAS 或 Google Sheet。五人小局勉強可行，但延遲較高、容易撞到 Apps Script 併發/配額限制，也比較難處理同時投票、斷線重連與匿名任務牌。

建議：

- 想要穩定即時：維持 Node.js + WebSocket。
- 想要零伺服器、低頻更新：可以做 GAS + Google Sheet + 輪詢版，但體驗會比較慢。
- 折衷方案：前端放 GitHub Pages，後端用 Firebase / Supabase / Render / Railway 其中一種。
