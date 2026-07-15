"use strict";

const http = require("http");
const avalon = require("./Avalon/server");
const onenightwolf = require("./Onenightwolf/server");
const criminaldance = require("./CriminalDance/server");
const loveletter = require("./LoveLetter/server");
const gangsi = require("./Gangsi/server");
const { createAdminRouter, combinedStats: collectCombinedStats, gameStats } = require("./Shared/server/admin");
const { serveSharedStatic } = require("./Shared/server/static");

const PORT = Number(process.env.PORT || 4173);
const games = { avalon, onenightwolf, criminaldance, loveletter, gangsi };
const handleAdmin = createAdminRouter(games);

function createServer() {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
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
  createServer().listen(PORT, () => {
    console.log(`Online tabletop host running at http://localhost:${PORT}`);
  });
}

module.exports = { createServer, combinedStats, gameStats };
