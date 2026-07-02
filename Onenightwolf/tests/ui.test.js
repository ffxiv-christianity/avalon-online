"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "..", "public");
const script = fs.readFileSync(path.join(publicDir, "onenightwolf.js"), "utf8");
const styles = fs.readFileSync(path.join(publicDir, "onenightwolf.css"), "utf8");
const page = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");

[
  "確認投票",
  "確認開槍",
  "確認行動",
  "確認交換",
  "data-wolf-confirm-vote",
  "data-wolf-confirm-hunter",
  "data-wolf-confirm-reveal"
].forEach((text) => assert(script.includes(text), `missing UI confirmation: ${text}`));

assert(!script.includes("系統正在模擬實體主持人的等待時間"));
assert(!script.includes("function wolfReleaseNotes"));
assert(page.includes("tab-badge"));
assert(page.includes("<h2>記錄</h2>"));
assert(page.includes("角色卡"));
assert(script.includes("loneWerewolf"));
assert(script.includes("場上有多名狼人，因此不能查看中央牌"));
assert(script.includes("player.id !== snapshot.you.id"));
assert(script.includes("enabledRoleCards()"));
assert(!script.includes("cardsPanel()"));
assert(script.includes("renderMainPanel();"));
assert(script.includes("mainPanel.innerHTML = mainPhase();"));
assert(script.includes("bindRoomEvents();"));
assert(!script.includes("bindRoomEventsInternal"));
assert(!script.includes("boundRoomEvents"));
assert(!script.includes("data-wolf-chat-badge"));
assert(!script.includes("data-wolf-roster-badge"));
assert(!script.includes("data-wolf-copy"));
assert(script.includes("bindCoreRoomEvents();"));
assert(script.includes("handleCoreRoomSubmit"));
assert(script.includes('sendAction("chat", { message })'));
assert(script.includes('sendAction("toggleReady")'));
assert(script.includes('sendAction("startGame")'));
assert(script.includes('sendAction("confirmReveal")'));
assert(script.includes('sendAction("vote", { targetId: pendingVoteTargetId })'));
assert(!script.includes('sendAction("ready")'));
assert(!script.includes('sendAction("start")'));
assert(script.includes("settingsPayload({ deck"));

const coreClickHandler = script.slice(
  script.indexOf("function handleCoreRoomClick"),
  script.indexOf("function handleCoreRoomSubmit")
);
[
  "data-wolf-roll",
  "data-wolf-ready",
  "data-wolf-start",
  "data-wolf-confirm-reveal",
  "data-wolf-confirm-vote",
  "wolf-choice",
  "data-night-action",
  "data-night-skip",
  "data-wolf-vote",
  "data-wolf-hunter-target",
  "data-wolf-confirm-hunter",
  "data-wolf-recommend",
  "data-copy-link",
  "data-wolf-role"
].forEach((selector) => assert(coreClickHandler.includes(selector), `${selector} must be handled by delegated room click flow`));

const buttonDataAttrs = [...new Set(
  [...`${page}\n${script}`.matchAll(/<button\b[^>]*>/g)]
    .flatMap((match) => [...match[0].matchAll(/\s(data-[\w-]+)(?:=|\s|>)/g)].map((attrMatch) => attrMatch[1]))
)].sort();

[
  "data-copy-link",
  "data-night-action",
  "data-night-skip",
  "data-wolf-confirm-hunter",
  "data-wolf-confirm-reveal",
  "data-wolf-confirm-vote",
  "data-wolf-ready",
  "data-wolf-recommend",
  "data-wolf-return",
  "data-wolf-role",
  "data-wolf-roll",
  "data-wolf-start",
  "data-wolf-tab",
  "data-wolf-vote"
].forEach((selector) => assert(buttonDataAttrs.includes(selector), `${selector} should be present in rendered button markup`));

buttonDataAttrs
  .filter((selector) => selector.startsWith("data-wolf-") || selector.startsWith("data-night-") || selector === "data-copy-link")
  .forEach((selector) => assert(script.includes(selector), `${selector} button must have a JS handler or render flow`));

[
  ['data-wolf-confirm-reveal', 'sendAction("confirmReveal")'],
  ['data-wolf-confirm-vote', 'sendAction("vote"'],
  ['data-wolf-confirm-hunter', 'sendAction("hunterShot"'],
  ['data-wolf-ready', 'sendAction("toggleReady")'],
  ['data-wolf-return', 'sendAction("returnLobby")'],
  ['data-wolf-roll', 'sendAction("roll")'],
  ['data-wolf-start', 'sendAction("startGame")'],
  ['data-night-action', 'sendAction("nightAction"'],
  ['data-night-skip', 'sendAction("nightAction", { skip: true })']
].forEach(([selector, action]) => {
  assert(script.includes(selector), `${selector} must be handled`);
  assert(script.includes(action), `${selector} must call ${action}`);
});
assert(script.includes("toggleWolfChoice("));
assert(script.includes("clearOpposingNightChoiceGroup(group)"));
assert(script.includes('const opposingGroup = group === "player" ? "center" : "player"'));
assert(script.includes("refreshNightActionButtons("));
assert(!script.includes("data-requires-selection type="), "night action selection requirements must be explicit");
[
  'data-requires-selection="player"',
  'data-requires-selection="center"',
  'data-requires-selection="seer"',
  'data-requires-selection="two-players"'
].forEach((requirement) => assert(script.includes(requirement), `${requirement} must be represented in night controls`));
const nightActions = [...new Set([...script.matchAll(/data-night-action="([^"]+)"/g)].map((match) => match[1]))].sort();
[
  "ack",
  "doppelganger",
  "drunk",
  "robber",
  "seer",
  "troublemaker",
  "werewolf"
].forEach((action) => assert(nightActions.includes(action), `missing night action button: ${action}`));
const handleNightActionBody = script.slice(
  script.indexOf("function handleNightAction"),
  script.indexOf("function selectedChoices")
);
nightActions.forEach((action) => assert(handleNightActionBody.includes(`action === "${action}"`), `${action} must be handled by handleNightAction`));
[
  "doppelgangerNightControls",
  "werewolfNightControls",
  "minionNightControls",
  "masonNightControls",
  "insomniacNightControls",
  "seerNightControls",
  "robberNightControls",
  "troublemakerNightControls",
  "drunkNightControls"
].forEach((renderer) => assert(script.includes(`function ${renderer}()`), `${renderer} must render the role phase`));
assert(script.includes("return (renderers[role] || ackNightControls)();"));
[
  'requires === "player"',
  'requires === "center"',
  'requires === "seer"',
  'requires === "two-players"',
  'action === "werewolf"',
  'action === "drunk"'
].forEach((rule) => assert(script.includes(rule), `night button enable rule is missing: ${rule}`));
assert(script.includes("function logEntries()"));
assert(script.includes("settingsPayload({ playerCount"));
assert(script.includes("settingsPayload({ discussionSeconds"));
assert(script.includes("snapshot.recommendedDecks"));
assert(script.includes("copyInvite();"));
assert(page.includes('<option value="300" selected>5 分鐘</option>'));
assert(page.includes("wolf-rules-role-grid"));
assert(page.includes("遊戲設置"));
assert(page.includes("夜晚行動順序"));
assert(page.includes("化身幽靈複製爪牙：</strong>在化身幽靈階段立即確認狼人。"));
assert(page.includes("化身幽靈複製失眠者：</strong>在正版失眠者行動後查看自己目前的牌。"));
assert(!page.includes("在化身幽靈階段立即確認狼人；複製失眠者"));
assert(script.includes("投票已鎖定"));
assert(script.includes("wolf-vote-guide"));
assert(styles.includes(".wolf-vote-guide"));
assert(script.includes("投票結果"));
assert(script.includes("voteSummary(result)"));
assert(script.includes("wolf-vote-summary"));
assert(script.includes("wolf-vote-meter"));
assert(script.includes("--vote-fill: ${percent}%"));
assert(!script.includes('style="width: ${percent}%'));
assert(script.includes("最高票"));
assert(script.includes("連帶出局"));
assert(script.includes("未投票／廢票"));
assert(page.includes("討論時間結束後直接結算"));
assert(script.includes("未投票視為廢票"));
assert(page.includes("化身幽靈複製預言家、強盜、搗蛋鬼或酒鬼"));
assert(page.includes("該玩家的最終角色是化身幽靈最初複製的角色"));
assert(page.includes("多名獵人需要反擊時依 d100 座位順序行動"));
assert(script.includes("選擇一名其他玩家，或選擇兩張中央牌"));
assert(script.includes("預言家請選擇查看一位其他玩家的牌"));
assert(styles.includes(".wolf-vote-result"));
assert(styles.includes(".wolf-vote-summary"));
assert(styles.includes(".wolf-vote-meter"));
assert(styles.includes("width: var(--vote-fill, 0%)"));
assert(styles.includes("var(--blue, #1f5d7a)"));
assert(!styles.includes("var(--evil, #a64c3a)"));
assert(page.includes("<h2>玩家順序</h2>"));
assert(page.includes("<h2>記錄</h2>"));
assert(script.includes('chat-message system'));
assert(script.includes("SharedRoomUI.hostControls"));
assert(script.includes("SharedRoomUI.bindHostControls"));
assert(script.includes('SharedRoomUI.token("host"'));
assert(script.includes("SharedRoomClient.parseRoomCode"));
assert(script.includes("SharedRoomClient.inviteGame"));
assert(script.includes("renderWolfRecentSessions"));
assert(script.includes("data-wolf-recent-player"));
assert(page.includes('id="recentSessions"'));
assert(script.includes("hadRoomConnection"));
assert(script.includes("socket !== connection"));
assert(script.includes("playerId: selectedSession.playerId"));
assert(script.includes("openWolfRules"));
assert(script.includes("lastVersion = message.room.version || lastVersion"));
assert(script.includes("SharedRoomUI.connectionStatusText(lastVersion)"));
assert(script.includes("clearInvalidWolfSession(message)"));
assert(script.includes("SharedRoomClient.clearInvalidSession"));
assert(script.includes("SharedRoomClient.SESSION_ERROR_CODES.roomNotFound"));
assert(script.includes("lastRoomPhase"));
assert(script.includes('lastRoomPhase !== "lobby" && room.phase === "lobby"'));
assert(script.includes("unreadRosterCount = 0;"));
assert(script.includes('game: "onenightwolf"'));
assert(script.includes('gameLabel(item.game || "onenightwolf")'));
assert(script.includes('const AVALON_PAGE_TITLE = "阿瓦隆線上版"'));
assert(script.includes('const WOLF_PAGE_TITLE = "一夜終極狼人"'));
assert(script.includes("document.title = wolf ? WOLF_PAGE_TITLE : AVALON_PAGE_TITLE"));
assert(script.includes("document.title = WOLF_PAGE_TITLE"));
["1500px", "930px", "560px", "380px"].forEach((breakpoint) => {
  assert(styles.includes(`@media (max-width: ${breakpoint})`) || styles.includes(`@media (min-width: ${breakpoint})`), `missing RWD breakpoint ${breakpoint}`);
});
assert(page.includes("更新日誌"));
assert(page.includes("快速斷線重連"));
assert(script.includes('fetch("/Onenightwolf/"'));
assert(styles.includes("body.wolf-mode .rules-header .eyebrow"));
assert(styles.includes("body.wolf-mode .rules-header .eyebrow {\n  color: var(--evil);"));
assert(styles.includes(".role-row.neutral"));
assert(styles.includes(".role-icon.neutral"));
assert(styles.includes(".identity-lightbox.neutral"));
assert(styles.includes(".wolf-enabled-card.werewolf"));
assert(styles.includes(".wolf-enabled-card.village"));
assert(styles.includes(".wolf-enabled-card.neutral"));
assert(script.includes('["tanner", "neutral"].includes(role.team)'));
assert(script.includes("夜晚行動順序"));
assert(script.includes("nightOrderTrack()"));
assert(script.includes("wolf-night-action"));
assert(script.includes("roleDisplayName(room.night.actionRole)"));
assert(script.includes("輪到你行動${actionRoleName ? ` - 你是${actionRoleName}` : \"\"}"));
assert(script.includes("function nightWaitingPanel(night)"));
assert(script.includes('night.role === "privateNightAction"'));
assert(script.includes("夜晚流程正在收尾"));
assert(script.includes("請稍候，系統即將進入討論。"));
assert(page.includes("天亮前每位玩家只會看到自己的初始角色牌；輪到你行動時，行動區會提示你當下執行的角色。"));
assert(page.includes("每個階段由當下持有該角色牌的玩家行動"));
assert(styles.includes(".wolf-night-step.active"));
assert(styles.includes(".wolf-night-step.done"));
assert(!styles.includes(".wolf-night-step.disabled"));
assert(!script.includes("本局未啟用"));
assert(styles.includes("@media (prefers-reduced-motion: reduce)"));

console.log("onenightwolf UI tests passed");
