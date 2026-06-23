"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const avalonPage = fs.readFileSync(path.join(root, "Avalon", "public", "index.html"), "utf8");
const avalonScript = fs.readFileSync(path.join(root, "Avalon", "public", "app.js"), "utf8");
const sharedStyles = fs.readFileSync(path.join(root, "Shared", "public", "styles.css"), "utf8");
const sharedClient = fs.readFileSync(path.join(root, "Shared", "public", "client-state.js"), "utf8");
const sharedRoomUi = fs.readFileSync(path.join(root, "Shared", "public", "room-ui.js"), "utf8");
const wolfPage = fs.readFileSync(path.join(root, "Onenightwolf", "public", "index.html"), "utf8");
const wolfScript = fs.readFileSync(path.join(root, "Onenightwolf", "public", "onenightwolf.js"), "utf8");
const wolfStyles = fs.readFileSync(path.join(root, "Onenightwolf", "public", "onenightwolf.css"), "utf8");

const avalonMainStart = avalonPage.indexOf('<main class="app-shell">');
const avalonMainEnd = avalonPage.indexOf("</main>");
const embeddedWolfRoom = avalonPage.indexOf('id="wolfRoomView"');
assert(embeddedWolfRoom > avalonMainStart && embeddedWolfRoom < avalonMainEnd, "Embedded wolf room must stay inside the shared app shell");

[
  "遊戲模式",
  "你的名字",
  "房間代碼或邀請連結",
  "建立房間",
  "加入房間",
  "重新連線"
].forEach((text) => {
  assert(avalonPage.includes(text), `Avalon login UI is missing: ${text}`);
  assert(wolfPage.includes(text), `One Night Wolf login UI is missing: ${text}`);
});

[
  "status-strip",
  "game-layout",
  "side-panel",
  "info-tabs",
  "chat-panel",
  "roster-panel",
  "main-panel",
  "desktop-room-panel",
  "mobile-room-panel"
].forEach((className) => {
  assert(avalonPage.includes(className), `Avalon room framework is missing: ${className}`);
  assert(wolfScript.includes(className), `One Night Wolf room framework is missing: ${className}`);
});

["聊天", "玩家", "記錄", "玩家順序", "複製邀請連結"].forEach((text) => {
  assert(avalonPage.includes(text), `Avalon common room text is missing: ${text}`);
  assert(wolfScript.includes(text), `One Night Wolf common room text is missing: ${text}`);
});

["930px", "560px", "380px"].forEach((breakpoint) => {
  assert(sharedStyles.includes(`@media (max-width: ${breakpoint})`), `Shared styles are missing breakpoint ${breakpoint}`);
  assert(wolfStyles.includes(`@media (max-width: ${breakpoint})`), `Wolf styles are missing breakpoint ${breakpoint}`);
});

assert(sharedStyles.includes(".chat-message.system"), "Shared system chat style is missing");
assert(avalonScript.includes('entry.playerId === "system"'), "Avalon system chat rendering is missing");
assert(wolfScript.includes('entry.playerId === "system"'), "One Night Wolf system chat rendering is missing");

["transferHost", "kickOfflinePlayer"].forEach((feature) => {
  assert(sharedRoomUi.includes(feature), `Shared room capability is missing: ${feature}`);
});
assert(avalonScript.includes("SharedRoomUI.bindHostControls"), "Avalon must bind Shared host controls");
assert(wolfScript.includes("SharedRoomUI.bindHostControls"), "One Night Wolf must bind Shared host controls");
assert(avalonPage.includes("openRulesButton"), "Avalon always-available rules button is missing");
assert(wolfScript.includes("openWolfRules"), "One Night Wolf always-available rules action is missing");
assert(avalonScript.includes('token("host"'), "Avalon host token is missing");
assert(wolfScript.includes('SharedRoomUI.token("host"'), "One Night Wolf host token is missing");
assert(avalonPage.includes("/shared/styles.css") && wolfPage.includes("/shared/styles.css"), "Games must load Shared styles");
assert(avalonPage.includes("/shared/client-state.js") && wolfPage.includes("/shared/client-state.js"), "Games must load Shared client state");
assert(avalonPage.includes("/shared/room-ui.js") && wolfPage.includes("/shared/room-ui.js"), "Games must load Shared room UI");
assert(sharedClient.includes("SharedRoomClient"), "Shared client API is missing");
assert(sharedClient.includes("inviteGame"), "Shared invite game detection is missing");
assert(sharedClient.includes("clearInvalidSession"), "Shared invalid session cleanup is missing");
assert(sharedClient.includes("SESSION_ERROR_CODES"), "Shared session error contract is missing");
assert(sharedClient.includes("createActionRequest"), "Shared action request contract is missing");
assert(sharedRoomUi.includes("showControlLock"), "Shared multi-tab control UI is missing");
assert(sharedRoomUi.includes("showToast"), "Shared toast UI is missing");
assert(sharedStyles.includes(".shared-toast"), "Shared toast positioning is missing");
assert(avalonScript.includes("SharedRoomUI.showToast(message)"), "Avalon must use the shared toast");
assert(wolfScript.includes("SharedRoomUI.showToast(message)"), "One Night Wolf must use the shared toast");
assert(sharedRoomUi.includes("playerCardClasses"), "Shared player identity highlighting is missing");
assert(sharedStyles.includes(".player-card.is-self"), "Shared self player highlight style is missing");
assert(!sharedStyles.includes(".player-card.leader {"), "Leader identity must not control player-card highlighting");
assert(avalonScript.includes("SharedRoomUI.playerCardClasses"), "Avalon must use shared self highlighting");
assert(wolfScript.includes("SharedRoomUI.playerCardClasses"), "One Night Wolf must use shared self highlighting");
assert(avalonScript.includes('room.phase === "lobby"'));
assert(avalonScript.includes('{ label: "房主", name: host?.name || "未指定" }'));
assert(avalonScript.includes('{ label: "領袖", name: leader?.name || "未開始" }'));
assert(avalonScript.includes("createActionRequest"), "Avalon must use shared action requests");
assert(wolfScript.includes("createActionRequest"), "One Night Wolf must use shared action requests");
assert(avalonScript.includes("showControlLock"), "Avalon must support multi-tab takeover");
assert(wolfScript.includes("showControlLock"), "One Night Wolf must support multi-tab takeover");
assert(avalonScript.includes("clearInvalidSession"), "Avalon must use shared invalid session cleanup");
assert(wolfScript.includes("clearInvalidSession"), "One Night Wolf must use shared invalid session cleanup");
assert(avalonScript.includes('gameLabel(item.game || "avalon")'), "Avalon recent rooms must show their game");
assert(wolfScript.includes('gameLabel(item.game || "onenightwolf")'), "One Night Wolf recent rooms must show their game");
assert(sharedRoomUi.includes("bindHostControls"), "Shared host controls are missing");

console.log("cross-game UI contract tests passed");
