"use strict";

function gameStats(game, module) {
  const roomList = [...module.rooms.values()].map((room) => {
    const onlinePlayers = room.players.filter((player) => player.online).length;
    const connections = roomConnectionCount(room.code, module.clients);
    return {
      game,
      code: room.code,
      phase: room.phase,
      players: room.players.length,
      onlinePlayers,
      connections,
      version: room.version,
      realtime: module.realtimeMetrics?.snapshot(room.code) || null,
      emptyForMs: room.emptySince ? Math.max(0, Date.now() - room.emptySince) : 0
    };
  });
  return {
    rooms: roomList.length,
    activeRooms: roomList.filter((room) => room.onlinePlayers > 0).length,
    connections: [...module.clients].filter((client) => !client.socket.destroyed).length,
    players: roomList.reduce((sum, room) => sum + room.players, 0),
    onlinePlayers: roomList.reduce((sum, room) => sum + room.onlinePlayers, 0),
    realtime: module.realtimeMetrics?.snapshot() || null,
    roomList
  };
}

function combinedStats(games) {
  const gameResults = Object.fromEntries(
    Object.entries(games).map(([game, module]) => [game, gameStats(game, module)])
  );
  const memoryUsage = process.memoryUsage();
  const totals = Object.values(gameResults).reduce((result, game) => ({
    rooms: result.rooms + game.rooms,
    activeRooms: result.activeRooms + game.activeRooms,
    connections: result.connections + game.connections,
    players: result.players + game.players,
    onlinePlayers: result.onlinePlayers + game.onlinePlayers
  }), { rooms: 0, activeRooms: 0, connections: 0, players: 0, onlinePlayers: 0 });
  return {
    generatedAt: new Date().toISOString(),
    labels: adminLabels(),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMb: {
      rss: bytesToMb(memoryUsage.rss),
      heapUsed: bytesToMb(memoryUsage.heapUsed),
      heapTotal: bytesToMb(memoryUsage.heapTotal)
    },
    totals,
    games: gameResults
  };
}

function adminLabels() {
  return {
    generatedAt: "資料產生時間。",
    uptimeSeconds: "伺服器運行秒數。",
    memoryUsageMb: {
      rss: "總記憶體 MB。",
      heapUsed: "已用 heap MB。",
      heapTotal: "總 heap MB。"
    },
    totals: {
      rooms: "房間總數。",
      activeRooms: "在線房間數。",
      connections: "WebSocket 連線數。",
      players: "玩家總數。",
      onlinePlayers: "在線玩家數。"
    },
    game: {
      rooms: "房間數。",
      activeRooms: "在線房間數。",
      connections: "WebSocket 連線數。",
      players: "玩家數。",
      onlinePlayers: "在線玩家數。"
    },
    room: {
      game: "遊戲類型。",
      code: "房間代碼。",
      phase: "遊戲階段。",
      players: "玩家數。",
      onlinePlayers: "在線玩家數。",
      connections: "WebSocket 連線數。",
      version: "狀態版本。",
      emptyForMs: "空房毫秒數。",
      realtime: "即時同步統計。"
    },
    realtime: {
      messagesSent: "送出訊息數。",
      bytesSent: "送出 bytes。",
      bytesSentMb: "送出 MB。",
      stateMessagesSent: "完整 state 次數。",
      stateBytesSent: "完整 state bytes。",
      stateBytesSentMb: "完整 state MB。",
      averageStateBytes: "平均 state bytes。",
      latestStateBytes: "最近 state bytes。",
      largestStateBytes: "最大 state bytes。",
      fullSyncRequests: "同步請求數。",
      fullSyncResponses: "完整同步回應數。",
      fullSyncSkipped: "省略完整同步數。",
      broadcasts: "廣播次數。",
      byType: "訊息類型統計。"
    }
  };
}

function createAdminRouter(games) {
  return function handleAdmin(req, res, requestUrl) {
    if (requestUrl.pathname !== "/admin" && requestUrl.pathname !== "/admin/stats") return false;
    if (!authorized(req, requestUrl)) {
      const json = requestUrl.pathname === "/admin/stats";
      res.writeHead(403, {
        "Content-Type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(json
        ? JSON.stringify({ error: "admin stats disabled or token incorrect" })
        : "Admin dashboard disabled or token incorrect");
      return true;
    }
    if (requestUrl.pathname === "/admin/stats") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(combinedStats(games), null, 2));
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(adminDashboard());
    return true;
  };
}

function authorized(req, requestUrl) {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  const token = requestUrl.searchParams.get("token") || bearerToken;
  return Boolean(process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN);
}

function adminDashboard() {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>線上桌遊後台狀態</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { max-width: 1180px; margin: 0 auto; padding: 24px; background: #171c1e; color: #f7f3eb; }
    header, .controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.4rem); }
    h2 { margin: 24px 0 10px; }
    button, label { border: 1px solid #596467; border-radius: 8px; background: #273033; color: inherit; padding: 9px 12px; }
    button { cursor: pointer; font-weight: 800; }
    label { display: inline-flex; align-items: center; gap: 8px; }
    #status { color: #d8b46d; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 18px; }
    .card, .panel { border: 1px solid #3d494c; border-radius: 12px; background: #20282b; padding: 14px; }
    .card span { display: block; color: #aeb9bb; font-size: .88rem; }
    .card strong { display: block; margin-top: 6px; font-size: 1.5rem; }
    .panel { margin-top: 14px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 820px; }
    th, td { border-bottom: 1px solid #344044; padding: 9px 8px; text-align: left; vertical-align: top; }
    th { color: #d8b46d; font-size: .9rem; }
    .muted { color: #aeb9bb; font-size: .9rem; }
    details { margin-top: 16px; }
    summary { cursor: pointer; color: #d8b46d; font-weight: 800; }
    pre { overflow: auto; min-height: 220px; border: 1px solid #3d494c; border-radius: 10px; background: #111719; padding: 16px; line-height: 1.45; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>線上桌遊後台狀態</h1>
      <p id="status">準備讀取資料…</p>
    </div>
    <div class="controls">
      <button id="refreshButton" type="button">立即更新</button>
      <label><input id="autoUpdate" type="checkbox"> 每 5 分鐘自動更新</label>
    </div>
  </header>
  <main id="summary"></main>
  <details>
    <summary>查看原始 JSON</summary>
    <pre id="output"></pre>
  </details>
  <script>
    const token = new URLSearchParams(location.search).get("token") || "";
    const output = document.getElementById("output");
    const summary = document.getElementById("summary");
    const status = document.getElementById("status");
    const autoUpdate = document.getElementById("autoUpdate");
    let timer = null;

    async function refreshStats() {
      status.textContent = "更新中…";
      try {
        const response = await fetch("/admin/stats?token=" + encodeURIComponent(token), { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "讀取失敗");
        output.textContent = JSON.stringify(data, null, 2);
        summary.innerHTML = renderSummary(data);
        status.textContent = "最後更新：" + new Date().toLocaleString();
      } catch (error) {
        status.textContent = "更新失敗：" + error.message;
      }
    }

    function renderSummary(data) {
      const totals = data.totals || {};
      const realtime = combineRealtime(data.games || {});
      const rooms = Object.values(data.games || {}).flatMap((game) => game.roomList || []);
      return \`
        <section class="cards">
          \${card("伺服器運行時間", formatDuration(data.uptimeSeconds), "Render 重啟後會歸零")}
          \${card("目前連線數", totals.connections || 0, "實際 WebSocket 連線")}
          \${card("在線玩家", \`\${totals.onlinePlayers || 0} / \${totals.players || 0}\`, "在線 / 登記玩家")}
          \${card("房間數", \`\${totals.activeRooms || 0} / \${totals.rooms || 0}\`, "有人在線 / 總房間")}
          \${card("送出資料量", formatMb(realtime.bytesSentMb), "WebSocket frame 估計值")}
          \${card("完整 state 送出", realtime.stateMessagesSent || 0, "通常是頻寬主要來源")}
          \${card("平均 state 大小", formatBytes(realtime.averageStateBytes), "越大代表 log/chat/state 越肥")}
          \${card("省下 full sync", realtime.fullSyncSkipped || 0, "版本已最新，只回 syncOk")}
        </section>
        <section class="panel">
          <h2>房間狀態</h2>
          \${rooms.length ? roomTable(rooms) : '<p class="muted">目前沒有房間。</p>'}
        </section>
        <section class="panel">
          <h2>記憶體</h2>
          <p>RSS：\${formatMb(data.memoryUsageMb?.rss)}，Heap 使用：\${formatMb(data.memoryUsageMb?.heapUsed)} / \${formatMb(data.memoryUsageMb?.heapTotal)}</p>
          <p class="muted">RSS 是 Node.js 向系統拿到的總記憶體；Heap 是 JavaScript 物件實際使用與配置容量。</p>
        </section>
      \`;
    }

    function roomTable(rooms) {
      return \`
        <table>
          <thead>
            <tr>
              <th>遊戲</th><th>房號</th><th>階段</th><th>玩家</th><th>連線</th><th>版本</th>
              <th>送出資料</th><th>完整 state</th><th>full sync</th>
            </tr>
          </thead>
          <tbody>
            \${rooms.map((room) => {
              const realtime = room.realtime || {};
              return \`
                <tr>
                  <td>\${gameLabel(room.game)}</td>
                  <td>\${escapeHtml(room.code)}</td>
                  <td>\${escapeHtml(room.phase)}</td>
                  <td>\${room.onlinePlayers || 0} / \${room.players || 0}</td>
                  <td>\${room.connections || 0}</td>
                  <td>\${room.version || 0}</td>
                  <td>\${formatMb(realtime.bytesSentMb)}</td>
                  <td>\${realtime.stateMessagesSent || 0} 次，平均 \${formatBytes(realtime.averageStateBytes)}</td>
                  <td>請求 \${realtime.fullSyncRequests || 0}，省下 \${realtime.fullSyncSkipped || 0}</td>
                </tr>
              \`;
            }).join("")}
          </tbody>
        </table>\`;
    }

    function combineRealtime(games) {
      return Object.values(games).reduce((sum, game) => {
        const realtime = game.realtime || {};
        sum.bytesSentMb += Number(realtime.bytesSentMb || 0);
        sum.stateMessagesSent += Number(realtime.stateMessagesSent || 0);
        sum.averageStateBytesNumerator += Number(realtime.stateBytesSent || 0);
        sum.averageStateBytesDenominator += Number(realtime.stateMessagesSent || 0);
        sum.fullSyncSkipped += Number(realtime.fullSyncSkipped || 0);
        return sum;
      }, {
        bytesSentMb: 0,
        stateMessagesSent: 0,
        averageStateBytesNumerator: 0,
        averageStateBytesDenominator: 0,
        fullSyncSkipped: 0,
        get averageStateBytes() {
          return this.averageStateBytesDenominator
            ? Math.round(this.averageStateBytesNumerator / this.averageStateBytesDenominator)
            : 0;
        }
      });
    }

    function card(label, value, hint) {
      return \`<article class="card"><span>\${escapeHtml(label)}</span><strong>\${escapeHtml(value)}</strong><p class="muted">\${escapeHtml(hint)}</p></article>\`;
    }

    function gameLabel(game) {
      return {
        avalon: "阿瓦隆",
        onenightwolf: "一夜狼人",
        criminaldance: "犯人在跳舞",
        loveletter: "情書",
        gangsi: "古墓迷蹤"
      }[game] || game || "未知";
    }

    function formatDuration(seconds) {
      const total = Math.max(0, Number(seconds) || 0);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = Math.floor(total % 60);
      return hours ? \`\${hours} 小時 \${minutes} 分\` : \`\${minutes} 分 \${secs} 秒\`;
    }

    function formatMb(value) {
      return \`\${Number(value || 0).toFixed(3)} MB\`;
    }

    function formatBytes(value) {
      const bytes = Number(value || 0);
      if (bytes >= 1024 * 1024) return \`\${(bytes / 1024 / 1024).toFixed(2)} MB\`;
      if (bytes >= 1024) return \`\${(bytes / 1024).toFixed(1)} KB\`;
      return \`\${bytes} B\`;
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function syncAutoUpdate() {
      if (timer) clearInterval(timer);
      timer = autoUpdate.checked ? setInterval(refreshStats, 5 * 60 * 1000) : null;
    }

    document.getElementById("refreshButton").addEventListener("click", refreshStats);
    autoUpdate.addEventListener("change", syncAutoUpdate);
    refreshStats();
  </script>
</body>
</html>`;
}

function bytesToMb(bytes) {
  return Number((Number(bytes || 0) / 1024 / 1024).toFixed(2));
}

function roomConnectionCount(roomCode, clientSet) {
  return [...clientSet].filter((client) => client.roomCode === roomCode && !client.socket.destroyed).length;
}

module.exports = { createAdminRouter, combinedStats, gameStats, bytesToMb, roomConnectionCount };
