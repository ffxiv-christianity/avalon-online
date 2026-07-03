"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const avalonServer = fs.readFileSync(path.join(root, "Avalon", "server.js"), "utf8");
const wolfServer = fs.readFileSync(path.join(root, "Onenightwolf", "server.js"), "utf8");
const wolfGame = fs.readFileSync(path.join(root, "Onenightwolf", "game.js"), "utf8");
const criminalServer = fs.readFileSync(path.join(root, "CriminalDance", "server.js"), "utf8");
const criminalGame = fs.readFileSync(path.join(root, "CriminalDance", "game.js"), "utf8");
const rootServer = fs.readFileSync(path.join(root, "server.js"), "utf8");
const frameworkContract = fs.readFileSync(path.join(root, "COMMON_ROOM_FRAMEWORK.md"), "utf8");

[avalonServer, wolfServer, wolfGame, criminalServer, criminalGame].forEach((source) => {
  assert(!source.includes("Math.random"), "Game code must not use Math.random");
});

assert(avalonServer.includes("../Shared/server/random"));
assert(wolfGame.includes("../Shared/server/random"));
assert(criminalGame.includes("../Shared/server/random"));
assert(avalonServer.includes("../Shared/server/room-actions"));
assert(wolfGame.includes("../Shared/server/room-actions"));
assert(criminalGame.includes("../Shared/server/room-actions"));
assert(rootServer.includes("./Shared/server/admin"));
assert(rootServer.includes("./Shared/server/static"));
assert(avalonServer.includes("../Shared/server/realtime-contract"));
assert(wolfServer.includes("../Shared/server/realtime-contract"));
assert(criminalServer.includes("../Shared/server/realtime-contract"));
assert(rootServer.includes("./CriminalDance/server"));

assert(!/function\s+shuffle\s*\(/.test(avalonServer));
assert(!/function\s+shuffle\s*\(/.test(wolfGame));
assert(!/function\s+shuffle\s*\(/.test(criminalGame));
assert(!/function\s+serveAdminStats\s*\(/.test(avalonServer));
assert(!fs.existsSync(path.join(root, "Avalon", "public", "styles.css")));
assert(!fs.existsSync(path.join(root, "Avalon", "public", "client-state.js")));

[
  "新遊戲的強制產品契約",
  "固定頁面方格",
  "Shared、模板與遊戲專屬的責任邊界",
  "新遊戲完成標準",
  "遊戲可推進性契約",
  "每個狀態都有出口",
  "私密角色",
  "快速重連",
  "d100",
  "RWD"
].forEach((requirement) => {
  assert(frameworkContract.includes(requirement), `framework contract is missing: ${requirement}`);
});

console.log("shared architecture contract tests passed");
