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
const lovePage = fs.readFileSync(path.join(root, "LoveLetter", "public", "index.html"), "utf8");
const loveScript = fs.readFileSync(path.join(root, "LoveLetter", "public", "loveletter.js"), "utf8");
const loveStyles = fs.readFileSync(path.join(root, "LoveLetter", "public", "loveletter.css"), "utf8");
const loveGame = fs.readFileSync(path.join(root, "LoveLetter", "game.js"), "utf8");
const loveMobileStyles = loveStyles.slice(loveStyles.indexOf("@media (max-width: 560px)"), loveStyles.indexOf("@media (max-width: 380px)"));

function cssRulesForSelector(css, selector) {
  const rules = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(css)) !== null) {
    const selectors = match[1].split(",").map((item) => item.trim());
    if (selectors.includes(selector)) rules.push(match[2]);
  }
  return rules;
}

function assertCssRuleIncludes(css, selector, declaration) {
  assert(
    cssRulesForSelector(css, selector).some((rule) => rule.includes(declaration)),
    `${selector} must include ${declaration}`
  );
}

function assertCssRuleExcludes(css, selector, declaration) {
  assert(
    cssRulesForSelector(css, selector).every((rule) => !rule.includes(declaration)),
    `${selector} must not include ${declaration}`
  );
}

const avalonMainStart = avalonPage.indexOf('<main class="app-shell">');
const avalonMainEnd = avalonPage.indexOf("</main>");
assert(!avalonPage.includes('id="wolfRoomView"'), "Avalon index should not embed the One Night Wolf room shell");
assert(avalonPage.includes('window.location.href = "/Onenightwolf/"'), "Avalon game selector must navigate to the One Night Wolf index");
assert(avalonPage.includes('window.location.href = "/CriminalDance/"'), "Avalon game selector must navigate to the CriminalDance index");
assert(avalonPage.includes('window.location.href = "/LoveLetter/"'), "Avalon game selector must navigate to the LoveLetter index");
assert(wolfPage.includes('window.location.href = "/"'), "One Night Wolf game selector must navigate to the Avalon index");
assert(wolfPage.includes('window.location.href = "/CriminalDance/"'), "One Night Wolf game selector must navigate to the CriminalDance index");
assert(wolfPage.includes('window.location.href = "/LoveLetter/"'), "One Night Wolf game selector must navigate to the LoveLetter index");
assert(criminalPage.includes('window.location.href = "/"'), "CriminalDance game selector must navigate to the Avalon index");
assert(criminalPage.includes('window.location.href = "/Onenightwolf/"'), "CriminalDance game selector must navigate to the One Night Wolf index");
assert(criminalPage.includes('window.location.href = "/LoveLetter/"'), "CriminalDance game selector must navigate to the LoveLetter index");
assert(lovePage.includes('window.location.href = "/"'), "LoveLetter game selector must navigate to the Avalon index");
assert(lovePage.includes('window.location.href = "/Onenightwolf/"'), "LoveLetter game selector must navigate to the One Night Wolf index");
assert(lovePage.includes('window.location.href = "/CriminalDance/"'), "LoveLetter game selector must navigate to the CriminalDance index");
assert(criminalPage.includes('href="/favicon.svg?v=2"'), "CriminalDance must use the shared favicon");
assert(lovePage.includes('href="/favicon.svg?v=2"'), "LoveLetter must use the shared favicon");
assert(criminalPage.includes('href="/assets/icons/apple-touch-icon.png"'), "CriminalDance must use the shared apple touch icon");
assert(lovePage.includes('href="/assets/icons/apple-touch-icon.png"'), "LoveLetter must use the shared apple touch icon");
assert(criminalStyles.includes(".criminal-opening-lightbox .identity-header .eyebrow"), "CriminalDance opening lightbox eyebrow must use game color");
assert(criminalScript.includes("const CARD_ICONS"), "CriminalDance hand card icon library is missing");
assert.strictEqual((criminalScript.match(/criminal-card-icon/g) || []).length, 1, "CriminalDance card icons should render only in the hand cards");
assert(criminalScript.includes("&nbsp;"), "CriminalDance seat badges must keep the seat number attached to the following player name");
assert(criminalScript.includes("cardDescription(card.id, isTurn)"), "CriminalDance hand cards must route helper text through turn-aware descriptions");
assert(criminalScript.includes("state?.playable === false && state.reason"), "CriminalDance hand cards must explain rule-disabled cards only when it is your turn");
[
  "seatAnimationClasses",
  "persistentSeatClasses",
  "pendingSeatClasses",
  "culpritRevealClass",
  "roundResultSeatClass",
  "inspectorTargetIds"
].forEach((helper) => assert(criminalScript.includes(helper), `CriminalDance seat animation helper is missing: ${helper}`));
assert(criminalScript.includes("criminal-result-table"), "CriminalDance result screens must keep the player seat matrix visible for result pulses");
[
  "template-game-main-table",
  "template-game-player-matrix",
  "template-game-control-row",
  "template-game-hand-panel",
  "template-game-action-info-block",
  "template-game-turn-badge",
  "template-seat-number"
].forEach((className) => {
  assert(criminalScript.includes(className), `CriminalDance shared game template class is missing: ${className}`);
  assert(loveScript.includes(className), `LoveLetter shared game template class is missing: ${className}`);
});
assert(loveGame.includes("setPublicActionInfo"), "LoveLetter must list public action info like CriminalDance");
assert(loveGame.includes("你從蓋牌抽到了"), "LoveLetter Prince burn-card draw must create private action info");
assert(loveGame.includes("抽走了蓋牌"), "LoveLetter Prince burn-card draw must create public action info");
assert(loveScript.includes("renderTableZones()") && loveScript.includes("${renderActionInfo()}"), "LoveLetter result screens must keep public table and action information visible");
assert(sharedStyles.includes(".template-seat-number.seat-tone-1"), "Shared template seat number tone styles are missing");
assert(sharedRoomUi.includes("template-player-token"), "Shared player tokens must carry the template-player-token marker");
assert(sharedStyles.includes(".token {"), "Shared player token base style is missing");
assert(sharedStyles.includes("width: 34px"), "Shared player tokens must align to the player list template size");
assert(sharedStyles.includes("height: 34px"), "Shared player tokens must align to the player list template size");
assertCssRuleIncludes(sharedStyles, ".token", "font-size: 1rem");
assertCssRuleIncludes(sharedStyles, ".token-stack", "justify-self: end");
assertCssRuleIncludes(sharedStyles, ".token-stack", "justify-content: flex-end");
assertCssRuleIncludes(sharedStyles, ".token-stack", "width: 78px");
assert(sharedStyles.includes("grid-template-columns: 34px minmax(0, 1fr) 78px"), "Shared player cards must reserve a fixed right-side token column");
assert(sharedStyles.includes("grid-template-columns: 30px minmax(0, 1fr) 65px"), "Shared mobile player cards must reserve a fixed right-side token column");
assert(sharedStyles.includes("width: 65px"), "Shared mobile player token stack must keep enough right-side width for two tokens");
const loveRosterTokenFunction = loveScript.slice(loveScript.indexOf("function renderRosterTokens"), loveScript.indexOf("function showRosterStateTokens"));
assert(!loveRosterTokenFunction.includes('SharedRoomUI.token("info"'), "LoveLetter roster must not duplicate protected state tokens from the player matrix");
assert(!loveRosterTokenFunction.includes('SharedRoomUI.token("danger"'), "LoveLetter roster must not duplicate eliminated state tokens from the player matrix");
assert(loveRosterTokenFunction.indexOf('SharedRoomUI.token("turn", "目前回合")') < loveRosterTokenFunction.indexOf('SharedRoomUI.token("host", "房主")'), "LoveLetter roster must render host token at the far right after turn token");
assert(criminalScript.indexOf('player.id === snapshot.room.currentPlayerId ? SharedRoomUI.token("turn", "目前回合")') < criminalScript.indexOf('player.id === snapshot.room.hostId ? SharedRoomUI.token("host", "房主")'), "CriminalDance roster must render host token at the far right after state tokens");
assert(loveScript.includes("function showRosterStateTokens()"), "LoveLetter roster must gate non-host player tokens by phase");
assert(loveScript.includes('snapshot.room.phase !== "roundResult" && snapshot.room.phase !== "matchResult"'), "LoveLetter result roster must hide all non-host tokens");
assert(loveScript.includes("template-seat-number seat-tone-"), "LoveLetter seat numbers must apply shared seat tone colors");
assert(loveScript.includes("renderSeatBadges"), "LoveLetter action info must render #N messages with shared seat badges");
assert(loveScript.includes("renderScoreHearts"), "LoveLetter score display must render affection hearts");
assert(loveScript.includes('statusCard("芳心", scoreHeartsText(highScore))'), "LoveLetter status score must use affection hearts");
assert(!loveScript.includes("${player.score} 分"), "LoveLetter player scores must not render as plain points");
assert(lovePage.includes("若牌庫已空，改拿開局時暗置的蓋牌"), "LoveLetter rules must explain Prince drawing the setup burn card");
assert(lovePage.includes("<h3>勝利條件</h3>"), "LoveLetter rules must include victory conditions");
assert(lovePage.includes("牌庫耗盡時，所有未出局玩家公開手牌並比較數值"), "LoveLetter rules must explain deck-empty victory");
["template-game-main-table", "template-game-player-matrix"].forEach((className) => {
  const criminalCount = (criminalScript.match(new RegExp(className, "g")) || []).length;
  const loveCount = (loveScript.match(new RegExp(className, "g")) || []).length;
  assert.strictEqual(criminalCount, loveCount, `CriminalDance and LoveLetter must call ${className} in the same main-game phases`);
});

[
  ".status-card strong",
  ".player-meta",
  ".log-list li",
  ".chat-message strong",
  ".chat-message span",
  ".phase-header p",
  ".action-card-status",
  ".validation",
  ".notice"
].forEach((selector) => assertCssRuleIncludes(sharedStyles, selector, "overflow-wrap: anywhere"));
[
  "overflow: hidden",
  "text-overflow: ellipsis",
  "white-space: nowrap"
].forEach((declaration) => assertCssRuleIncludes(sharedStyles, ".player-name-line strong", declaration));
[
  "overflow-y: scroll",
  "scrollbar-gutter: stable"
].forEach((declaration) => assertCssRuleIncludes(sharedStyles, ".chat-list", declaration));
[
  ".criminal-action-info-block",
  ".criminal-private",
  ".criminal-private p",
  ".criminal-seat-title",
  ".criminal-card strong",
  ".criminal-action-panel h3",
  ".criminal-score"
].forEach((selector) => assertCssRuleIncludes(criminalStyles, selector, selector === ".criminal-action-info-block" ? "max-width: 100%" : "overflow-wrap: anywhere"));
[
  ".love-role-card strong",
  ".love-role-card > div > span",
  ".love-private p",
  ".love-seat-title strong",
  ".love-card strong",
  ".love-card small",
  ".love-result-row span"
].forEach((selector) => assertCssRuleIncludes(loveStyles, selector, "overflow-wrap: anywhere"));
assertCssRuleIncludes(loveStyles, ".love-target-grid .secondary-button", "background: transparent");
assertCssRuleIncludes(loveStyles, ".love-target-grid .secondary-button.selected", "background: transparent");
assertCssRuleIncludes(loveStyles, ".rules-role-list .love-numbered-label", "font-size: 1.13rem");
assertCssRuleIncludes(loveStyles, ".rules-role-list .love-numbered-label .love-card-name", "font-size: 1.13rem");
assertCssRuleIncludes(loveStyles, ".rules-role-list dd", "font-size: .94rem");
assertCssRuleIncludes(loveStyles, ".love-result-table + .love-result", "margin-top: 22px");
assertCssRuleIncludes(loveStyles, ".love-score-hearts", "white-space: nowrap");
assertCssRuleIncludes(loveStyles, ".love-score-heart-text", "font-size: 1rem");
assertCssRuleIncludes(loveStyles, ".love-brand-mark", "color: #d04f7f");
assert(!loveStyles.includes('body:has([data-game="loveletter"]) .eyebrow'), "LoveLetter must not tint every eyebrow pink");
assert(loveMobileStyles.includes(".love-table-zones") && loveMobileStyles.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "LoveLetter mobile table zones must keep draw and burn piles on one row");
assert(loveMobileStyles.includes(".love-zone-wide") && loveMobileStyles.includes("grid-column: 1 / -1"), "LoveLetter public burn zone must span the full mobile row");
assertCssRuleExcludes(criminalStyles, ".criminal-private p", "display: flex");
[
  ".criminal-seat.seat-accomplice",
  ".criminal-seat.seat-inspector-target",
  ".criminal-seat.seat-dog-target",
  ".criminal-seat.seat-detective-scan::before",
  ".criminal-seat.seat-detective-miss::after",
  ".criminal-seat.seat-culprit-reveal::after",
  ".criminal-seat.seat-round-win-civilian",
  ".criminal-seat.seat-round-win-culprit",
  ".criminal-seat.seat-round-win-authority"
].forEach((selector) => assert(cssRulesForSelector(criminalStyles, selector).length > 0, `CriminalDance seat animation style is missing: ${selector}`));
[
  ".criminal-seat.seat-round-win-civilian",
  ".criminal-seat.seat-round-win-culprit",
  ".criminal-seat.seat-round-win-authority"
].forEach((selector) => assertCssRuleIncludes(criminalStyles, selector, "border-color"));
[
  "criminal-seat-detective-scan",
  "criminal-seat-detective-miss",
  "criminal-seat-culprit-reveal",
  "criminal-seat-dog-pulse",
  "prefers-reduced-motion: reduce"
].forEach((token) => assert(criminalStyles.includes(token), `CriminalDance seat animation token is missing: ${token}`));

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
  assert(lovePage.includes(text), `LoveLetter login UI is missing: ${text}`);
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
  assert(lovePage.includes(className), `LoveLetter room framework is missing: ${className}`);
});
assert(avalonPage.includes("settings-grid"), "Avalon settings grid shell is missing");
assert(wolfPage.includes("settings-grid"), "One Night Wolf settings grid shell is missing");
assert(criminalPage.includes("settings-grid"), "CriminalDance settings grid shell is missing");
assert(lovePage.includes("settings-grid"), "LoveLetter settings grid shell is missing");
assert(sharedStyles.includes(".start-button"), "Shared lobby start button style is missing");
assert(avalonScript.includes("class=\"start-button\""), "Avalon lobby start action must use the shared start-button");
assert(wolfScript.includes("class=\"start-button\""), "One Night Wolf lobby start action must use the shared start-button");
assert(criminalScript.includes("class=\"start-button\""), "CriminalDance lobby start action must use the shared start-button");
assert(loveScript.includes("class=\"start-button\""), "LoveLetter lobby start action must use the shared start-button");
assert(sharedStyles.includes(".validation-list"), "Shared validation list spacing is missing");
assert(sharedStyles.includes(".validation.error"), "Shared validation error style is missing");
assert(sharedStyles.includes(".setting-option"), "Shared setting option style is missing");
assert(avalonScript.includes("field setting-option"), "Avalon setting toggles must use the shared setting-option");
assert(criminalPage.includes("field setting-option"), "CriminalDance setting toggles must use the shared setting-option");
assert(lovePage.includes("field setting-option"), "LoveLetter setting toggles must use the shared setting-option");
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
  assert(lovePage.includes(token), `LoveLetter shared shell contract is missing: ${token}`);
});
assert(avalonScript.includes("lobbyTemplate"), "Avalon lobby must be mounted from the HTML shell template");
assert(avalonScript.includes("replaceChildren(fragment)"), "Avalon lobby render must clone and mount the HTML template");
assert(!avalonScript.includes("renderLegacyLobby"), "Avalon legacy JS lobby framework must be removed");
assert(!wolfScript.includes("page.roomView.innerHTML"), "One Night Wolf must fill the HTML room shell instead of rebuilding it in JS");
assert(criminalScript.includes("lobbyTemplate"), "CriminalDance lobby must be mounted from the HTML shell template");
assert(criminalScript.includes("replaceChildren(fragment)"), "CriminalDance lobby render must clone and mount the HTML template");
assert(!criminalScript.includes("page.roomView.innerHTML"), "CriminalDance must fill the HTML room shell instead of rebuilding it in JS");
assert(loveScript.includes("lobbyTemplate"), "LoveLetter lobby must be mounted from the HTML shell template");
assert(loveScript.includes("replaceChildren(fragment)"), "LoveLetter lobby render must clone and mount the HTML template");
assert(!loveScript.includes("page.roomView.innerHTML"), "LoveLetter must fill the HTML room shell instead of rebuilding it in JS");
assert(avalonPage.includes('id="mobileStatusSummary"'), "Avalon mobile status summary mount is missing");
assert(wolfScript.includes("mobileStatusSummary()"), "One Night Wolf mobile status summary is missing");
assert(sharedRoomUi.includes("mobileStatusSummary"), "Shared mobile status summary template is missing");
assert(avalonScript.includes("SharedRoomUI.mobileStatusSummary"), "Avalon must use the shared mobile status summary");
assert(wolfScript.includes("SharedRoomUI.mobileStatusSummary"), "One Night Wolf must use the shared mobile status summary");
assert(criminalScript.includes("SharedRoomUI.mobileStatusSummary"), "CriminalDance must use the shared mobile status summary");
assert(loveScript.includes("SharedRoomUI.mobileStatusSummary"), "LoveLetter must use the shared mobile status summary");
assert(sharedStyles.includes(".room-view > .status-strip"), "Shared mobile status cards must be hidden");
assert(sharedStyles.includes(".room-view:not(.lobby-mode) > .mobile-status-summary"), "Shared in-game mobile summary rule is missing");
assert(sharedStyles.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"), "Shared mobile status summary must use the compact three-column layout");
assert(!sharedStyles.includes(".mobile-status-summary-item + .mobile-status-summary-item::before"), "Mobile status summary must not use inline dot separators");
assert(sharedStyles.includes("height: clamp(360px, 60dvh, 520px)"), "Shared mobile side panel must reuse the removed status-card space");

["聊天", "玩家", "記錄", "玩家順序", "複製邀請連結"].forEach((text) => {
  assert(avalonPage.includes(text), `Avalon common room text is missing: ${text}`);
  assert(wolfPage.includes(text), `One Night Wolf common room text is missing: ${text}`);
  assert(lovePage.includes(text), `LoveLetter common room text is missing: ${text}`);
});

["930px", "560px", "380px"].forEach((breakpoint) => {
  assert(sharedStyles.includes(`@media (max-width: ${breakpoint})`), `Shared styles are missing breakpoint ${breakpoint}`);
  assert(wolfStyles.includes(`@media (max-width: ${breakpoint})`), `Wolf styles are missing breakpoint ${breakpoint}`);
});
assert(criminalStyles.includes("@media (max-width: 560px)"), "CriminalDance styles must include mobile rules");
assert(loveStyles.includes("@media (max-width: 560px)"), "LoveLetter styles must include mobile rules");

assert(sharedStyles.includes(".chat-message.system"), "Shared system chat style is missing");
assert(avalonScript.includes('entry.playerId === "system"'), "Avalon system chat rendering is missing");
assert(wolfScript.includes('entry.playerId === "system"'), "One Night Wolf system chat rendering is missing");
assert(criminalScript.includes('entry.playerId === "system"'), "CriminalDance system chat rendering is missing");
assert(loveScript.includes('entry.playerId === "system"'), "LoveLetter system chat rendering is missing");
assert(avalonScript.includes("escapeHtml(entry.name)}:</strong>"), "Avalon player chat name must include a colon");
assert(wolfScript.includes("escapeHtml(entry.name)}:</strong>"), "One Night Wolf player chat name must include a colon");
assert(criminalScript.includes("escapeHtml(entry.name)}:</strong>"), "CriminalDance player chat name must include a colon");
assert(loveScript.includes("escapeHtml(entry.name)}:</strong>"), "LoveLetter player chat name must include a colon");

["transferHost", "kickOfflinePlayer"].forEach((feature) => {
  assert(sharedRoomUi.includes(feature), `Shared room capability is missing: ${feature}`);
});
assert(avalonScript.includes("SharedRoomUI.bindHostControls"), "Avalon must bind Shared host controls");
assert(wolfScript.includes("SharedRoomUI.bindHostControls"), "One Night Wolf must bind Shared host controls");
assert(criminalScript.includes("SharedRoomUI.bindHostControls"), "CriminalDance must bind Shared host controls");
assert(loveScript.includes("SharedRoomUI.bindHostControls"), "LoveLetter must bind Shared host controls");
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
assert(lovePage.includes("/shared/styles.css"), "LoveLetter must load Shared styles");
assert(lovePage.includes("/shared/client-state.js"), "LoveLetter must load Shared client state");
assert(lovePage.includes("/shared/room-ui.js"), "LoveLetter must load Shared room UI");
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
assert(loveScript.includes("SharedRoomUI.logEntries"), "LoveLetter must use the shared newest-first log renderer");
assert(sharedStyles.includes(".token.turn"), "Shared current-turn token style is missing");
assert(criminalScript.includes('token("turn"'), "CriminalDance must use a current-turn token instead of the leader token");
assert(sharedStyles.includes(".result-action-row"), "Shared result action spacing is missing");
assert(criminalScript.includes("result-action-row"), "CriminalDance result actions must use shared result spacing");
assert(criminalScript.includes("primary-button\" data-next-round"), "CriminalDance next-round action must use a normal primary button");
assert(!criminalScript.includes("start-button\" data-next-round"), "CriminalDance next-round action must not use the oversized lobby start button");
assert(loveScript.includes("result-action-row"), "LoveLetter result actions must use shared result spacing");
assert(loveScript.includes("primary-button\" data-next-round"), "LoveLetter next-round action must use a normal primary button");
assert(!loveScript.includes("start-button\" data-next-round"), "LoveLetter next-round action must not use the oversized lobby start button");
assert(sharedRoomUi.includes("captureScroll"), "Shared scroll preservation is missing");
assert(sharedRoomUi.includes("restoreScroll"), "Shared scroll restoration is missing");
assert(sharedRoomUi.includes("updateChatUnread"), "Shared chat unread policy is missing");
assert(sharedRoomUi.includes("bindChatReadState"), "Shared chat read-state binding is missing");
assert(sharedRoomUi.includes("readLatestChat"), "Shared open-chat behavior is missing");
assert(sharedStyles.includes("overscroll-behavior: contain"), "Shared nested scroll containment is missing");
assert(avalonScript.includes("SharedRoomUI.captureScroll"), "Avalon must preserve chat reading position");
assert(wolfScript.includes("SharedRoomUI.captureScroll"), "One Night Wolf must preserve chat reading position");
assert(criminalScript.includes("SharedRoomUI.captureScroll"), "CriminalDance must preserve chat reading position");
assert(loveScript.includes("SharedRoomUI.captureScroll"), "LoveLetter must preserve chat reading position");
assert(avalonScript.includes("SharedRoomUI.updateChatUnread"), "Avalon must use shared chat unread policy");
assert(wolfScript.includes("SharedRoomUI.updateChatUnread"), "One Night Wolf must use shared chat unread policy");
assert(criminalScript.includes("SharedRoomUI.updateChatUnread"), "CriminalDance must use shared chat unread policy");
assert(loveScript.includes("SharedRoomUI.updateChatUnread"), "LoveLetter must use shared chat unread policy");
assert(avalonScript.includes("SharedRoomUI.bindChatReadState"), "Avalon must clear unread at chat bottom");
assert(wolfScript.includes("SharedRoomUI.bindChatReadState"), "One Night Wolf must clear unread at chat bottom");
assert(criminalScript.includes("SharedRoomUI.bindChatReadState"), "CriminalDance must clear unread at chat bottom");
assert(loveScript.includes("SharedRoomUI.bindChatReadState"), "LoveLetter must clear unread at chat bottom");
assert(avalonScript.includes("SharedRoomUI.readLatestChat"), "Avalon must use shared open-chat behavior");
assert(wolfScript.includes("SharedRoomUI.readLatestChat"), "One Night Wolf must use shared open-chat behavior");
assert(criminalScript.includes("SharedRoomUI.readLatestChat"), "CriminalDance must use shared open-chat behavior");
assert(loveScript.includes("SharedRoomUI.readLatestChat"), "LoveLetter must use shared open-chat behavior");
assert(!avalonScript.includes("els.chatList.scrollTop = els.chatList.scrollHeight"), "Avalon tab switching must not discard chat reading position");
assert(sharedStyles.includes(".shared-toast"), "Shared toast positioning is missing");
assert(sharedStyles.includes("list-style-position: inside"), "Shared log list markers must stay inside mobile panels");
assert(sharedStyles.includes("text-indent: -1.65em"), "Shared log list entries must keep hanging indent alignment");
assert(avalonScript.includes("SharedRoomUI.showToast(message)"), "Avalon must use the shared toast");
assert(wolfScript.includes("SharedRoomUI.showToast(message)"), "One Night Wolf must use the shared toast");
assert(criminalScript.includes("SharedRoomUI.showToast(message)"), "CriminalDance must use the shared toast");
assert(loveScript.includes("SharedRoomUI.showToast(message)"), "LoveLetter must use the shared toast");
assert(sharedRoomUi.includes("playerCardClasses"), "Shared player identity highlighting is missing");
assert(sharedStyles.includes(".player-card.is-self"), "Shared self player highlight style is missing");
assert(!sharedStyles.includes(".player-card.leader {"), "Leader identity must not control player-card highlighting");
assert(avalonScript.includes("SharedRoomUI.playerCardClasses"), "Avalon must use shared self highlighting");
assert(wolfScript.includes("SharedRoomUI.playerCardClasses"), "One Night Wolf must use shared self highlighting");
assert(criminalScript.includes("SharedRoomUI.playerCardClasses"), "CriminalDance must use shared self highlighting");
assert(loveScript.includes("SharedRoomUI.playerCardClasses"), "LoveLetter must use shared self highlighting");
assert(!wolfScript.includes("slice(-200)"), "One Night Wolf UI must not truncate room history");
assert(avalonScript.includes('room.phase === "lobby"'));
assert(avalonScript.includes('{ label: "房主", name: host?.name || "未指定" }'));
assert(avalonScript.includes('{ label: "領袖", name: leader?.name || "未開始" }'));
assert(avalonScript.includes("createActionRequest"), "Avalon must use shared action requests");
assert(wolfScript.includes("createActionRequest"), "One Night Wolf must use shared action requests");
assert(criminalScript.includes("createActionRequest"), "CriminalDance must use shared action requests");
assert(loveScript.includes("createActionRequest"), "LoveLetter must use shared action requests");
[avalonScript, wolfScript, criminalScript, loveScript].forEach((script, index) => {
  const label = ["Avalon", "One Night Wolf", "CriminalDance", "LoveLetter"][index];
  assert(script.includes("hadRoomConnection"), `${label} must remember whether this tab had joined a room before reconnecting`);
  assert(script.includes('type: "joinRoom"'), `${label} must rejoin with the saved player session after socket reconnect`);
  assert(script.includes('nameInput.addEventListener("input"'), `${label} must update the rejoin target while the player name changes`);
  assert(script.includes("namedSession"), `${label} must prefer an exact typed player name when choosing a rejoin session`);
});
assert(!criminalScript.includes("const saved = selectedSession || findRoomSession"), "CriminalDance rejoin clicks must prefer the current name/room inputs over the stale selected session");
assert(!loveScript.includes("const saved = selectedSession || findRoomSession"), "LoveLetter rejoin clicks must prefer the current name/room inputs over the stale selected session");
assert(wolfScript.includes("function enterWolfRoomShell"), "One Night Wolf must enter the wolf room shell after joining or receiving wolf state");
assert(wolfScript.includes("page.joinView.classList.add(\"hidden\")"), "One Night Wolf must hide the join view after a successful join");
assert(avalonScript.includes("showControlLock"), "Avalon must support multi-tab takeover");
assert(wolfScript.includes("showControlLock"), "One Night Wolf must support multi-tab takeover");
assert(criminalScript.includes("showControlLock"), "CriminalDance must support multi-tab takeover");
assert(loveScript.includes("showControlLock"), "LoveLetter must support multi-tab takeover");
assert(avalonScript.includes("clearInvalidSession"), "Avalon must use shared invalid session cleanup");
assert(wolfScript.includes("clearInvalidSession"), "One Night Wolf must use shared invalid session cleanup");
assert(criminalScript.includes("clearInvalidSession"), "CriminalDance must use shared invalid session cleanup");
assert(loveScript.includes("clearInvalidSession"), "LoveLetter must use shared invalid session cleanup");
assert(avalonScript.includes('gameLabel(item.game || "avalon")'), "Avalon recent rooms must show their game");
assert(wolfScript.includes('gameLabel(item.game || "onenightwolf")'), "One Night Wolf recent rooms must show their game");
assert(criminalScript.includes('gameLabel(item.game || "criminaldance")'), "CriminalDance recent rooms must show their game");
assert(loveScript.includes('gameLabel(item.game || "loveletter")'), "LoveLetter recent rooms must show their game");
assert(sharedRoomUi.includes("bindHostControls"), "Shared host controls are missing");
assert(!wolfScript.includes("return SharedRoomClient.listSessions(store)[0] || null"), "One Night Wolf must not treat the latest saved session as the current tab session");
assert(!criminalScript.includes("return SharedRoomClient.listSessions(store)[0] || null"), "CriminalDance must not treat the latest saved session as the current tab session");
assert(!loveScript.includes("return SharedRoomClient.listSessions(store)[0] || null"), "LoveLetter must not treat the latest saved session as the current tab session");

console.log("cross-game UI contract tests passed");
