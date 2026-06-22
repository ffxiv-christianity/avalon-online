"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const avalonServer = fs.readFileSync(path.join(root, "Avalon", "server.js"), "utf8");
const wolfServer = fs.readFileSync(path.join(root, "Onenightwolf", "server.js"), "utf8");
const wolfGame = fs.readFileSync(path.join(root, "Onenightwolf", "game.js"), "utf8");
const rootServer = fs.readFileSync(path.join(root, "server.js"), "utf8");

[avalonServer, wolfServer, wolfGame].forEach((source) => {
  assert(!source.includes("Math.random"), "Game code must not use Math.random");
});

assert(avalonServer.includes("../Shared/server/random"));
assert(wolfGame.includes("../Shared/server/random"));
assert(avalonServer.includes("../Shared/server/room-actions"));
assert(wolfGame.includes("../Shared/server/room-actions"));
assert(rootServer.includes("./Shared/server/admin"));
assert(rootServer.includes("./Shared/server/static"));

assert(!/function\s+shuffle\s*\(/.test(avalonServer));
assert(!/function\s+shuffle\s*\(/.test(wolfGame));
assert(!/function\s+serveAdminStats\s*\(/.test(avalonServer));
assert(!fs.existsSync(path.join(root, "Avalon", "public", "styles.css")));
assert(!fs.existsSync(path.join(root, "Avalon", "public", "client-state.js")));

console.log("shared architecture contract tests passed");
