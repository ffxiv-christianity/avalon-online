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
const criminalPage = fs.readFileSync(path.join(root, "CriminalDance", "public", "index.html"), "utf8");
const criminalScript = fs.readFileSync(path.join(root, "CriminalDance", "public", "criminaldance.js"), "utf8");
const criminalStyles = fs.readFileSync(path.join(root, "CriminalDance", "public", "criminaldance.css"), "utf8");

const avalonMainStart = avalonPage.indexOf('<main class="app-shell">');
const avalonMainEnd = avalonPage.indexOf("</main>");
assert(!avalonPage.includes('id="wolfRoomView"'), "Avalon index should not embed the One Night Wolf room shell");
assert(avalonPage.includes('window.location.href = "/Onenightwolf/"'), "Avalon game selector must navigate to the One Night Wolf index");
assert(avalonPage.includes('window.location.href = "/CriminalDance/"'), "Avalon game selector must navigate to the CriminalDance index");
assert(wolfPage.includes('window.location.href = "/"'), "One Night Wolf game selector must navigate to the Avalon index");
assert(wolfPage.includes('window.location.href = "/CriminalDance/"'), "One Night Wolf game selector must navigate to the CriminalDance index");
assert(criminalPage.includes('window.location.href = "/"'), "CriminalDance game selector must navigate to the Avalon index");
assert(criminalPage.includes('window.location.href = "/Onenightwolf/"'), "CriminalDance game selector must navigate to the One Night Wolf index");
assert(criminalPage.includes('href="/favicon.svg?v=2"'), "CriminalDance must use the shared favicon");
assert(criminalPage.includes('href="/assets/icons/apple-touch-icon.png"'), "CriminalDance must use the shared apple touch icon");
assert(criminalStyles.includes(".criminal-opening-lightbox .identity-header .eyebrow"), "CriminalDance opening lightbox eyebrow must use game color");

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
  assert(wolfPage.includes(className), `One Night Wolf room framework is missing: ${className}`);
  assert(criminalPage.includes(className), `CriminalDance room framework is missing: ${className}`);
});
assert(avalonPage.includes("settings-grid"), "Avalon settings grid shell is missing");
assert(wolfPage.includes("settings-grid"), "One Night Wolf settings grid shell is missing");
assert(criminalPage.includes("settings-grid"), "CriminalDance settings grid shell is missing");
assert(sharedStyles.includes(".start-button"), "Shared lobby start button style is missing");
assert(avalonScript.includes("class=\"start-button\""), "Avalon lobby start action must use the shared start-button");
assert(wolfScript.includes("class=\"start-button\""), "One Night Wolf lobby start action must use the shared start-button");
assert(criminalScript.includes("class=\"start-button\""), "CriminalDance lobby start action must use the shared start-button");
assert(sharedStyles.includes(".validation-list"), "Shared validation list spacing is missing");
assert(sharedStyles.includes(".validation.error"), "Shared validation error style is missing");
assert(sharedStyles.includes(".setting-option"), "Shared setting option style is missing");
assert(avalonScript.includes("field setting-option"), "Avalon setting toggles must use the shared setting-option");
assert(criminalPage.includes("field setting-option"), "CriminalDance setting toggles must use the shared setting-option");
assert(!criminalStyles.includes(".criminal-expansion-grid"), "CriminalDance must not reimplement shared setting option grids");
assert(!criminalStyles.includes(".toggle-field"), "CriminalDance must not reimplement shared checkbox sizing");

[
  'data-shell-view="join"',
  'data-shell-view="room"',
  'data-shell-layout="game"',
  'data-shell-region="info-sidebar"',
  'data-shell-panel="chat"',
  'data-shell-panel="players"',
  'data-shell-panel="progress"',
  'data-shell-panel="log"',
  'data-shell-panel="main"',
  'data-shell-template="lobby"',
  'data-shell-panel="your-status"',
  'data-shell-panel="host-settings"',
  'data-shell-panel="deck"'
].forEach((token) => {
  assert(avalonPage.includes(token), `Avalon shared shell contract is missing: ${token}`);
});
[
  'data-shell-view="join"',
  'data-shell-view="room"',
  'data-shell-layout="game"',
  'data-shell-region="info-sidebar"',
  'data-shell-panel="chat"',
  'data-shell-panel="players"',
  'data-shell-panel="progress"',
  'data-shell-panel="log"',
  'data-shell-panel="main"',
  'data-shell-template="lobby"',
  'data-shell-panel="your-status"',
  'data-shell-panel="host-settings"',
  'data-shell-panel="deck"'
].forEach((token) => {
  assert(wolfPage.includes(token), `One Night Wolf shared shell contract is missing: ${token}`);
});
[
  'data-shell-view="join"',
  'data-shell-view="room"',
  'data-shell-layout="game"',
  'data-shell-region="info-sidebar"',
  'data-shell-panel="chat"',
  'data-shell-panel="players"',
  'data-shell-panel="progress"',
  'data-shell-panel="log"',
  'data-shell-panel="main"',
  'data-shell-template="lobby"',
  'data-shell-panel="your-status"',
  'data-shell-panel="host-settings"',
  'data-shell-panel="deck"'
].forEach((token) => {
  assert(criminalPage.includes(token), `CriminalDance shared shell contract is missing: ${token}`);
});
assert(avalonScript.includes("lobbyTemplate"), "Avalon lobby must be mounted from the HTML shell template");
assert(avalonScript.includes("replaceChildren(fragment)"), "Avalon lobby render must clone and mount the HTML template");
assert(!avalonScript.includes("renderLegacyLobby"), "Avalon legacy JS lobby framework must be removed");
assert(!wolfScript.includes("page.roomView.innerHTML"), "One Night Wolf must fill the HTML room shell instead of rebuilding it in JS");
assert(criminalScript.includes("lobbyTemplate"), "CriminalDance lobby must be mounted from the HTML shell template");
assert(criminalScript.includes("replaceChildren(fragment)"), "CriminalDance lobby render must clone and mount the HTML template");
assert(!criminalScript.includes("page.roomView.innerHTML"), "CriminalDance must fill the HTML room shell instead of rebuilding it in JS");
assert(avalonPage.includes('id="mobileStatusSummary"'), "Avalon mobile status summary mount is missing");
assert(wolfScript.includes("mobileStatusSummary()"), "One Night Wolf mobile status summary is missing");
assert(sharedRoomUi.includes("mobileStatusSummary"), "Shared mobile status summary template is missing");
assert(avalonScript.includes("SharedRoomUI.mobileStatusSummary"), "Avalon must use the shared mobile status summary");
assert(wolfScript.includes("SharedRoomUI.mobileStatusSummary"), "One Night Wolf must use the shared mobile status summary");
assert(criminalScript.includes("SharedRoomUI.mobileStatusSummary"), "CriminalDance must use the shared mobile status summary");
assert(sharedStyles.includes(".room-view > .status-strip"), "Shared mobile status cards must be hidden");
assert(sharedStyles.includes(".room-view:not(.lobby-mode) > .mobile-status-summary"), "Shared in-game mobile summary rule is missing");
assert(sharedStyles.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"), "Shared mobile status summary must use the compact three-column layout");
assert(!sharedStyles.includes(".mobile-status-summary-item + .mobile-status-summary-item::before"), "Mobile status summary must not use inline dot separators");
assert(sharedStyles.includes("height: clamp(360px, 60dvh, 520px)"), "Shared mobile side panel must reuse the removed status-card space");

["聊天", "玩家", "記錄", "玩家順序", "複製邀請連結"].forEach((text) => {
  assert(avalonPage.includes(text), `Avalon common room text is missing: ${text}`);
  assert(wolfPage.includes(text), `One Night Wolf common room text is missing: ${text}`);
});

["930px", "560px", "380px"].forEach((breakpoint) => {
  assert(sharedStyles.includes(`@media (max-width: ${breakpoint})`), `Shared styles are missing breakpoint ${breakpoint}`);
  assert(wolfStyles.includes(`@media (max-width: ${breakpoint})`), `Wolf styles are missing breakpoint ${breakpoint}`);
});
assert(criminalStyles.includes("@media (max-width: 560px)"), "CriminalDance styles must include mobile rules");

assert(sharedStyles.includes(".chat-message.system"), "Shared system chat style is missing");
assert(avalonScript.includes('entry.playerId === "system"'), "Avalon system chat rendering is missing");
assert(wolfScript.includes('entry.playerId === "system"'), "One Night Wolf system chat rendering is missing");
assert(criminalScript.includes('entry.playerId === "system"'), "CriminalDance system chat rendering is missing");

["transferHost", "kickOfflinePlayer"].forEach((feature) => {
  assert(sharedRoomUi.includes(feature), `Shared room capability is missing: ${feature}`);
});
assert(avalonScript.includes("SharedRoomUI.bindHostControls"), "Avalon must bind Shared host controls");
assert(wolfScript.includes("SharedRoomUI.bindHostControls"), "One Night Wolf must bind Shared host controls");
assert(criminalScript.includes("SharedRoomUI.bindHostControls"), "CriminalDance must bind Shared host controls");
assert(avalonPage.includes("openRulesButton"), "Avalon always-available rules button is missing");
assert(wolfScript.includes("openWolfRules"), "One Night Wolf always-available rules action is missing");
assert(wolfPage.includes('id="wolfRulesContent"'), "One Night Wolf rules content shell is missing");
assert(wolfPage.includes("化身幽靈複製預言家、強盜、搗蛋鬼或酒鬼"), "One Night Wolf rules content must live in HTML");
assert(!wolfScript.includes("page.wolfRules.innerHTML"), "One Night Wolf rules overlay must not be generated in JS");
assert(!wolfScript.includes("content.innerHTML"), "One Night Wolf rules content must not be generated in JS");
assert(avalonScript.includes('token("host"'), "Avalon host token is missing");
assert(wolfScript.includes('SharedRoomUI.token("host"'), "One Night Wolf host token is missing");
assert(avalonPage.includes("/shared/styles.css") && wolfPage.includes("/shared/styles.css"), "Games must load Shared styles");
assert(avalonPage.includes("/shared/client-state.js") && wolfPage.includes("/shared/client-state.js"), "Games must load Shared client state");
assert(avalonPage.includes("/shared/room-ui.js") && wolfPage.includes("/shared/room-ui.js"), "Games must load Shared room UI");
assert(criminalPage.includes("/shared/styles.css"), "CriminalDance must load Shared styles");
assert(criminalPage.includes("/shared/client-state.js"), "CriminalDance must load Shared client state");
assert(criminalPage.includes("/shared/room-ui.js"), "CriminalDance must load Shared room UI");
assert(sharedClient.includes("SharedRoomClient"), "Shared client API is missing");
assert(sharedClient.includes("inviteGame"), "Shared invite game detection is missing");
assert(sharedClient.includes("clearInvalidSession"), "Shared invalid session cleanup is missing");
assert(sharedClient.includes("SESSION_ERROR_CODES"), "Shared session error contract is missing");
assert(sharedClient.includes("createActionRequest"), "Shared action request contract is missing");
assert(sharedRoomUi.includes("showControlLock"), "Shared multi-tab control UI is missing");
assert(sharedRoomUi.includes("showToast"), "Shared toast UI is missing");
assert(sharedRoomUi.includes("logEntries"), "Shared newest-first log renderer is missing");
assert(sharedStyles.includes("padding-left: 20px"), "Shared log list must keep template ordered-list indentation");
assert(avalonScript.includes("SharedRoomUI.logEntries"), "Avalon must use the shared newest-first log renderer");
assert(wolfScript.includes("SharedRoomUI.logEntries"), "One Night Wolf must use the shared newest-first log renderer");
assert(criminalScript.includes("SharedRoomUI.logEntries"), "CriminalDance must use the shared newest-first log renderer");
assert(sharedStyles.includes(".token.turn"), "Shared current-turn token style is missing");
assert(criminalScript.includes('token("turn"'), "CriminalDance must use a current-turn token instead of the leader token");
assert(sharedStyles.includes(".result-action-row"), "Shared result action spacing is missing");
assert(criminalScript.includes("result-action-row"), "CriminalDance result actions must use shared result spacing");
assert(criminalScript.includes("primary-button\" data-next-round"), "CriminalDance next-round action must use a normal primary button");
assert(!criminalScript.includes("start-button\" data-next-round"), "CriminalDance next-round action must not use the oversized lobby start button");
assert(sharedRoomUi.includes("captureScroll"), "Shared scroll preservation is missing");
assert(sharedRoomUi.includes("restoreScroll"), "Shared scroll restoration is missing");
assert(sharedRoomUi.includes("updateChatUnread"), "Shared chat unread policy is missing");
assert(sharedRoomUi.includes("bindChatReadState"), "Shared chat read-state binding is missing");
assert(sharedRoomUi.includes("readLatestChat"), "Shared open-chat behavior is missing");
assert(sharedStyles.includes("overscroll-behavior: contain"), "Shared nested scroll containment is missing");
assert(avalonScript.includes("SharedRoomUI.captureScroll"), "Avalon must preserve chat reading position");
assert(wolfScript.includes("SharedRoomUI.captureScroll"), "One Night Wolf must preserve chat reading position");
assert(criminalScript.includes("SharedRoomUI.captureScroll"), "CriminalDance must preserve chat reading position");
assert(avalonScript.includes("SharedRoomUI.updateChatUnread"), "Avalon must use shared chat unread policy");
assert(wolfScript.includes("SharedRoomUI.updateChatUnread"), "One Night Wolf must use shared chat unread policy");
assert(criminalScript.includes("SharedRoomUI.updateChatUnread"), "CriminalDance must use shared chat unread policy");
assert(avalonScript.includes("SharedRoomUI.bindChatReadState"), "Avalon must clear unread at chat bottom");
assert(wolfScript.includes("SharedRoomUI.bindChatReadState"), "One Night Wolf must clear unread at chat bottom");
assert(criminalScript.includes("SharedRoomUI.bindChatReadState"), "CriminalDance must clear unread at chat bottom");
assert(avalonScript.includes("SharedRoomUI.readLatestChat"), "Avalon must use shared open-chat behavior");
assert(wolfScript.includes("SharedRoomUI.readLatestChat"), "One Night Wolf must use shared open-chat behavior");
assert(criminalScript.includes("SharedRoomUI.readLatestChat"), "CriminalDance must use shared open-chat behavior");
assert(!avalonScript.includes("els.chatList.scrollTop = els.chatList.scrollHeight"), "Avalon tab switching must not discard chat reading position");
assert(sharedStyles.includes(".shared-toast"), "Shared toast positioning is missing");
assert(sharedStyles.includes("list-style-position: inside"), "Shared log list markers must stay inside mobile panels");
assert(sharedStyles.includes("text-indent: -1.65em"), "Shared log list entries must keep hanging indent alignment");
assert(avalonScript.includes("SharedRoomUI.showToast(message)"), "Avalon must use the shared toast");
assert(wolfScript.includes("SharedRoomUI.showToast(message)"), "One Night Wolf must use the shared toast");
assert(criminalScript.includes("SharedRoomUI.showToast(message)"), "CriminalDance must use the shared toast");
assert(sharedRoomUi.includes("playerCardClasses"), "Shared player identity highlighting is missing");
assert(sharedStyles.includes(".player-card.is-self"), "Shared self player highlight style is missing");
assert(!sharedStyles.includes(".player-card.leader {"), "Leader identity must not control player-card highlighting");
assert(avalonScript.includes("SharedRoomUI.playerCardClasses"), "Avalon must use shared self highlighting");
assert(wolfScript.includes("SharedRoomUI.playerCardClasses"), "One Night Wolf must use shared self highlighting");
assert(criminalScript.includes("SharedRoomUI.playerCardClasses"), "CriminalDance must use shared self highlighting");
assert(!wolfScript.includes("slice(-200)"), "One Night Wolf UI must not truncate room history");
assert(avalonScript.includes('room.phase === "lobby"'));
assert(avalonScript.includes('{ label: "房主", name: host?.name || "未指定" }'));
assert(avalonScript.includes('{ label: "領袖", name: leader?.name || "未開始" }'));
assert(avalonScript.includes("createActionRequest"), "Avalon must use shared action requests");
assert(wolfScript.includes("createActionRequest"), "One Night Wolf must use shared action requests");
assert(criminalScript.includes("createActionRequest"), "CriminalDance must use shared action requests");
assert(avalonScript.includes("showControlLock"), "Avalon must support multi-tab takeover");
assert(wolfScript.includes("showControlLock"), "One Night Wolf must support multi-tab takeover");
assert(criminalScript.includes("showControlLock"), "CriminalDance must support multi-tab takeover");
assert(avalonScript.includes("clearInvalidSession"), "Avalon must use shared invalid session cleanup");
assert(wolfScript.includes("clearInvalidSession"), "One Night Wolf must use shared invalid session cleanup");
assert(criminalScript.includes("clearInvalidSession"), "CriminalDance must use shared invalid session cleanup");
assert(avalonScript.includes('gameLabel(item.game || "avalon")'), "Avalon recent rooms must show their game");
assert(wolfScript.includes('gameLabel(item.game || "onenightwolf")'), "One Night Wolf recent rooms must show their game");
assert(criminalScript.includes('gameLabel(item.game || "criminaldance")'), "CriminalDance recent rooms must show their game");
assert(sharedRoomUi.includes("bindHostControls"), "Shared host controls are missing");
assert(!wolfScript.includes("return SharedRoomClient.listSessions(store)[0] || null"), "One Night Wolf must not treat the latest saved session as the current tab session");
assert(!criminalScript.includes("return SharedRoomClient.listSessions(store)[0] || null"), "CriminalDance must not treat the latest saved session as the current tab session");

console.log("cross-game UI contract tests passed");
