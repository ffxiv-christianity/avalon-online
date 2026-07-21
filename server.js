"use strict";

const http = require("http");
const avalon = require("./Avalon/server");
const onenightwolf = require("./Onenightwolf/server");
const criminaldance = require("./CriminalDance/server");
const loveletter = require("./LoveLetter/server");
const gangsi = require("./Gangsi/server");
const { createAdminRouter, combinedStats: collectCombinedStats, gameStats } = require("./Shared/server/admin");
const { serveSharedStatic } = require("./Shared/server/static");
const e2eTime = require("./Shared/server/e2e-time");

const PORT = Number(process.env.PORT || 4173);
const games = { avalon, onenightwolf, criminaldance, loveletter, gangsi };
const handleAdmin = createAdminRouter(games);

function createServer() {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    if (requestUrl.pathname === "/__ai-e2e/capabilities") {
      const capabilities = e2eTime.capabilities();
      if (!capabilities.enabled) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "AI E2E mode is not enabled" }));
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify(capabilities));
      return;
    }
    if (handleAdmin(req, res, requestUrl)) return;
    if (serveSharedStatic(req, res, requestUrl)) return;
    if (requestUrl.pathname === "/Onenightwolf" || requestUrl.pathname.startsWith("/Onenightwolf/")) {
      onenightwolf.serveStatic(req, res);
      return;
    }
    if (requestUrl.pathname === "/CriminalDance" || requestUrl.pathname.startsWith("/CriminalDance/")) {
      criminaldance.serveStatic(req, res);
      return;
    }
    if (requestUrl.pathname === "/LoveLetter" || requestUrl.pathname.startsWith("/LoveLetter/")) {
      loveletter.serveStatic(req, res);
      return;
    }
    if (requestUrl.pathname === "/Gangsi" || requestUrl.pathname.startsWith("/Gangsi/")) {
      gangsi.serveStatic(req, res);
      return;
    }
    avalon.serveStatic(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws/onenightwolf") {
      onenightwolf.handleUpgrade(req, socket, head);
      return;
    }
    if (req.url === "/ws/criminaldance") {
      criminaldance.handleUpgrade(req, socket, head);
      return;
    }
    if (req.url === "/ws/loveletter") {
      loveletter.handleUpgrade(req, socket, head);
      return;
    }
    if (req.url === "/ws/gangsi") {
      gangsi.handleUpgrade(req, socket, head);
      return;
    }
    avalon.handleUpgrade(req, socket, head);
  });

  avalon.attachMaintenance(server);
  onenightwolf.attachMaintenance(server);
  criminaldance.attachMaintenance(server);
  loveletter.attachMaintenance(server);
  gangsi.attachMaintenance(server);
  return server;
}

function combinedStats() {
  return collectCombinedStats(games);
}

if (require.main === module) {
  const listenHost = e2eTime.config().enabled ? "127.0.0.1" : undefined;
  createServer().listen(PORT, listenHost, () => {
    console.log(`Online tabletop host running at http://${listenHost || "localhost"}:${PORT}`);
  });
}

module.exports = { createServer, combinedStats, gameStats };
