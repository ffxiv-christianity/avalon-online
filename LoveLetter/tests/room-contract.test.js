"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const loveletter = require("../server");
const game = require("../game");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "public", "loveletter.js"), "utf8");

[
  "/shared/styles.css",
  "/shared/client-state.js",
  "/shared/room-ui.js",
  'data-shell-view="join"',
  'data-shell-view="room"',
  'data-shell-layout="game"',
  'data-shell-region="info-sidebar"',
  'data-shell-panel="chat"',
  'data-shell-panel="players"',
  'data-shell-panel="main"',
  'data-shell-template="lobby"',
  'data-shell-panel="host-settings"',
  'data-shell-panel="deck"'
].forEach((token) => assert(page.includes(token), `LoveLetter page missing ${token}`));

assert(script.includes("page.lobbyTemplate.content.cloneNode(true)"));
assert(script.includes("page.mainPanel.replaceChildren(fragment)"));
assert(!script.includes("page.roomView.innerHTML"));
assert(script.includes("/ws/loveletter"));
assert(script.includes("SharedRoomClient.createActionRequest"));
assert(script.includes("SharedRoomUI.bindHostControls"));
assert(script.includes("cardNumberBadge"), "LoveLetter cards must render values through the shared number badge");
assert(!script.includes("◇"), "LoveLetter card values must not use diamond text labels");
assert(!page.includes("◇"), "LoveLetter rules must not use diamond text labels");
assert(page.includes('class="love-card-number">0</span><span class="love-card-name">間諜'), "LoveLetter rules must use the hand-card number badge style");
assert(script.includes('${cardNumberBadge(card.value)}'), "LoveLetter hand cards must use the shared number badge helper");
assert(script.includes("love-guess-card") && script.includes("data-guess-card-id"), "Guard guesses must use styled card buttons instead of plain option labels");
assert(script.includes("isPlayableNow(card.uid, isYourTurn)"), "LoveLetter unplayable hand cards must be disabled");
assert(script.includes("SharedRoomUI.handPanel"), "LoveLetter hand controls must use the shared hand panel helper");
assert(script.includes("SharedRoomUI.cardStateClasses"), "LoveLetter hand card state classes must use the shared helper");
assert(script.includes("const playableNow = isPlayableNow(card.uid, isYourTurn)"), "LoveLetter unplayable hand cards must compute playability in game rules");
assert(script.includes('["guard", "priest", "baron", "king"].includes(card.id) && targets.length === 0'), "Every other-player target card must share the no-target play rule in the UI");
assert(script.includes('["priest", "baron", "king"].includes(card.id)) return targetIdsForCard(card.id).length === 0'), "Priest, Baron and King confirmation must remain enabled with no legal opponent target");
assert(script.includes('type="button" ${playableNow ? "" : "disabled"}'), "LoveLetter hand card buttons must render a disabled attribute when unavailable");
assert(script.includes("你仍可查看自己的手牌"), "LoveLetter must let players inspect their hand outside their turn");
assert(script.includes('renderHandCardFace(card, `${CARD_HELP[card.id] || ""} ${chancellorKeepId'), "Chancellor selection must keep card ability help visible");
assert(script.includes("SharedRoomUI.actionInfoBlock"), "LoveLetter action info must use the shared action info helper");
assert(script.includes('className: "love-action-info-block"'), "LoveLetter shared action info must keep the original block class");
assert(script.includes("renderMessage: renderActionMessage"), "LoveLetter action info must use the card-aware message renderer");
assert(script.includes("snapshot.cards?.[cardId]"), "LoveLetter action info must use the server card definitions");
assert(script.includes("cardNumberBadge(definition.value)"), "LoveLetter action info card labels must reuse the shared card number badge helper");
assert(script.includes('bodyClassName: "love-private"'), "LoveLetter shared action info must keep the original body class");
assert(script.includes("renderSeatBadges"), "LoveLetter action info must render #N messages with shared seat badges");
assert(script.includes("renderScoreHearts"), "LoveLetter score display must render affection hearts");
assert(script.includes('statusCard("芳心", scoreHeartsText(highScore))'), "LoveLetter status score must use affection hearts");
assert(!script.includes("${player.score} 分"), "LoveLetter player scores must not render as plain points");
assert(script.includes("rosterScoreHearts(player)"), "LoveLetter roster scores must use the compact roster score renderer");
assert(script.includes("function rosterScoreHearts"), "LoveLetter roster must hide zero score counts and show hearts only");
assert(script.includes("function renderHandCardFace"), "LoveLetter public hand reveal must reuse the same card face helper as hand cards");
assert(script.includes("function renderResultRows") && script.includes("SharedRoomUI.resultRows"), "LoveLetter result rows must render public remaining hands through the shared result row helper");
assert(script.includes("roundResult?.revealedHands"), "LoveLetter revealed hands must come from structured roundResult data");
assert(script.includes("compact = false"), "LoveLetter settlement revealed hands must support compact non-interactive card rendering");
["template-game-turn-badge"].forEach((className) => {
  assert(script.includes(className), `LoveLetter shared game template class is missing: ${className}`);
});
assert(script.includes("SharedRoomUI.playerMatrix"), "LoveLetter player matrix must use the shared player matrix helper");
assert(script.includes("SharedRoomUI.seatNumber"), "LoveLetter seat numbers must use the shared seat-number helper");
assert((script.match(/\$\{renderTableZones\(\)\}/g) || []).length >= 3, "LoveLetter result screens must keep table zones visible");
assert((script.match(/\$\{renderActionInfo\(\)\}/g) || []).length >= 3, "LoveLetter result screens must keep action info visible");
assert(!script.includes("編號"), "LoveLetter card labels must not use the word 編號");
assert(!page.includes("編號"), "LoveLetter rules must not use the word 編號");
assert(page.includes("若牌庫已空，改拿開局時暗置的蓋牌"), "LoveLetter rules must explain Prince drawing the setup burn card");
assert(page.includes("<h3>勝利條件</h3>"), "LoveLetter rules must include victory conditions");
assert(page.includes("牌庫耗盡時，所有未出局玩家公開手牌並比較數值"), "LoveLetter rules must explain deck-empty victory");
assert(page.includes("只剩一位玩家，該玩家獲勝"), "LoveLetter rules must explain last-standing victory");
assert(page.includes("若未出局的玩家中只有一人曾打出或棄掉間諜"), "LoveLetter rules must limit the Spy bonus to the sole surviving Spy player");
assert(page.includes("同一位玩家可同時取得勝利分與間諜分"), "LoveLetter rules must explain that the round and Spy points can stack");
assert.strictEqual((page.match(/若所有其他玩家都受保護，可直接打出且不發生效果。/g) || []).length, 4, "Every other-player target card must explain the no-target protected case");
["抽牌堆", "蓋牌", "公開移除"].forEach((text) => {
  assert(script.includes(text), `LoveLetter table zones must show ${text}`);
});

const styles = fs.readFileSync(path.join(root, "public", "loveletter.css"), "utf8");
const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 560px)"), styles.indexOf("@media (max-width: 380px)"));
assert(page.includes('class="eyebrow love-brand-mark">Love Letter 2019'), "LoveLetter pink brand color must only be applied to the English brand mark");
assert(!styles.includes('body:has([data-game="loveletter"]) .eyebrow'), "LoveLetter must not tint every eyebrow pink");
assert(styles.includes(".love-brand-mark") && styles.includes("color: #d04f7f"), "LoveLetter brand mark must use the pink game color");
assert(styles.includes(".love-card-list"));
assert(styles.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "LoveLetter deck preview must render two cards per row");
assert(styles.includes(".love-seat-grid"));
assert(styles.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"), "LoveLetter player matrix must render a 3x2 desktop layout for up to 6 players");
assert(styles.includes(".love-pile"), "LoveLetter player matrix must use pile blocks like CriminalDance");
assert(styles.includes(".love-table-zones"), "LoveLetter main view must use extra space for draw and burn zones");
assert(styles.includes("@media (max-width: 560px)"), "LoveLetter must include mobile table-zone rules");
assert(mobileStyles.includes(".love-table-zones") && mobileStyles.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "LoveLetter mobile table zones must keep draw and burn piles on one row");
assert(mobileStyles.includes(".love-zone-wide") && mobileStyles.includes("grid-column: 1 / -1"), "LoveLetter public burn zone must span the full mobile row");
assert(styles.includes(".love-target-grid .secondary-button.selected"), "LoveLetter target selection must use a local selected style");
assert(styles.includes("background: transparent"), "LoveLetter target selection must not fill the selected target background");
assert(styles.includes(".rules-role-list .love-numbered-label"), "LoveLetter rules card names must have a dedicated larger style");
assert(styles.includes("font-size: 1.13rem"), "LoveLetter rules card names must be 1.2x the description size");
assert(styles.includes(".rules-role-list dd"), "LoveLetter rules descriptions must have a readable description style");
assert(styles.includes(".main-panel.love-main-your-turn"), "LoveLetter main panel must highlight the active turn");
assert(styles.includes(".love-turn-badge"));
assert(styles.includes("position: absolute"), "LoveLetter turn badge must float in the game panel corner");
assert(styles.includes("width: 28px"), "LoveLetter hand card number must keep a fixed circular width");
assert(styles.includes("height: 28px"), "LoveLetter hand card number must keep a fixed circular height");
assert(styles.includes(".love-action-info-block"), "LoveLetter action info block style is missing");
assert(styles.includes(".love-action-card-label .love-card-number"), "LoveLetter action info card numbers need a scoped fixed-size style");
assert(styles.includes("flex: 0 0 20px"), "LoveLetter action info card numbers must not shrink into ovals");
assert(styles.includes(".love-result-table + .love-result"), "LoveLetter result action info must be spaced away from the player matrix");
assert(styles.includes("margin-top: 22px"), "LoveLetter result action info spacing must be visibly larger");
assert(styles.includes(".love-revealed-card"), "LoveLetter must provide game-specific compact remaining-card appearance");
assert(styles.includes(".love-score-hearts"), "LoveLetter affection heart score style is missing");
assert(styles.includes(".love-score-heart-text"), "LoveLetter affection heart text style is missing");
assert(styles.includes("font-size: .84rem"), "LoveLetter card helper text must match CriminalDance sizing");
assert(styles.includes(".love-seat.is-eliminated"), "LoveLetter eliminated seats must have an explicit state style");
assert(styles.includes("background: #d8d0c6"), "LoveLetter eliminated seats must use a visibly darker background");
assert(styles.includes("border-color: rgba(70, 58, 52, 0.42)"), "LoveLetter eliminated seats must use a darker border");

const created = game.makeRoom("Host", "LOVEST");
const duplicateJoin = game.joinRoom(created.room, "host");
assert(duplicateJoin.error.includes("名字"), "玩家名稱不可重複，大小寫不同也不可");
const reconnectHost = game.joinRoom(created.room, "Ignored Name", created.player.id);
assert.ifError(reconnectHost.error);
assert.strictEqual(reconnectHost.player.id, created.player.id, "既有玩家重連不應被重複名稱檢查擋住");
loveletter.rooms.set(created.room.code, created.room);
const stats = loveletter.statsSnapshot();
assert(stats.roomList.some((room) => room.code === "LOVEST"));
assert(stats.roomList.every((room) => !Object.hasOwn(room, "playerNames")));

const nextHost = game.joinRoom(created.room, "Next").player;
created.player.online = false;
nextHost.online = true;
assert.strictEqual(loveletter.updateHostTransfer(created.room, 1000), true);
assert.strictEqual(loveletter.updateHostTransfer(created.room, 1000 + (2 * 60 * 1000)), true);
assert.strictEqual(created.room.hostId, nextHost.id);

loveletter.rooms.delete(created.room.code);

(async () => {
  const server = http.createServer((req, res) => loveletter.serveStatic(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/LoveLetter/`);
    assert.strictEqual(response.status, 200);
    const html = await response.text();
    assert(html.includes("情書"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("love letter room contract tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
