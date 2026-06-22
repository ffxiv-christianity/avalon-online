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
      emptyForMs: room.emptySince ? Math.max(0, Date.now() - room.emptySince) : 0
    };
  });
  return {
    rooms: roomList.length,
    activeRooms: roomList.filter((room) => room.onlinePlayers > 0).length,
    connections: [...module.clients].filter((client) => !client.socket.destroyed).length,
    players: roomList.reduce((sum, room) => sum + room.players, 0),
    onlinePlayers: roomList.reduce((sum, room) => sum + room.onlinePlayers, 0),
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
    body { max-width: 1100px; margin: 0 auto; padding: 24px; background: #171c1e; color: #f7f3eb; }
    header, .controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.4rem); }
    button, label { border: 1px solid #596467; border-radius: 8px; background: #273033; color: inherit; padding: 9px 12px; }
    button { cursor: pointer; font-weight: 800; }
    label { display: inline-flex; align-items: center; gap: 8px; }
    #status { color: #d8b46d; }
    pre { overflow: auto; min-height: 280px; border: 1px solid #3d494c; border-radius: 10px; background: #20282b; padding: 16px; line-height: 1.45; }
  </style>
</head>
<body>
  <header>
    <div><h1>線上桌遊後台狀態</h1><p id="status">準備讀取資料…</p></div>
    <div class="controls">
      <button id="refreshButton" type="button">立即更新</button>
      <label><input id="autoUpdate" type="checkbox"> 每 5 分鐘自動更新</label>
    </div>
  </header>
  <pre id="output"></pre>
  <script>
    const token = new URLSearchParams(location.search).get("token") || "";
    const output = document.getElementById("output");
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
        status.textContent = "最後更新：" + new Date().toLocaleString();
      } catch (error) {
        status.textContent = "更新失敗：" + error.message;
      }
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
