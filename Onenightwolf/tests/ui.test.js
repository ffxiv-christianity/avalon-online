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
assert(script.includes("tab-badge"));
assert(script.includes("<h2>記錄</h2>"));
assert(script.includes("角色卡"));
assert(script.includes("loneWerewolf"));
assert(script.includes("場上有多名狼人，因此不能查看中央牌"));
assert(script.includes("player.id !== snapshot.you.id"));
assert(script.includes("enabledRoleCards()"));
assert(script.includes("投票已鎖定"));
assert(script.includes("wolf-vote-guide"));
assert(styles.includes(".wolf-vote-guide"));
assert(script.includes("<h2>玩家順序</h2>"));
assert(script.includes("<h2>記錄</h2>"));
assert(script.includes('chat-message system'));
assert(script.includes("SharedRoomUI.hostControls"));
assert(script.includes("SharedRoomUI.bindHostControls"));
assert(script.includes('SharedRoomUI.token("host"'));
assert(script.includes("SharedRoomClient.parseRoomCode"));
assert(script.includes("hadRoomConnection"));
assert(script.includes("socket !== connection"));
assert(script.includes("openWolfRules"));
["1500px", "930px", "560px", "380px"].forEach((breakpoint) => {
  assert(styles.includes(`@media (max-width: ${breakpoint})`) || styles.includes(`@media (min-width: ${breakpoint})`), `missing RWD breakpoint ${breakpoint}`);
});
assert(page.includes("更新日誌"));
assert(page.includes("快速斷線重連"));
assert(script.includes('fetch("/Onenightwolf/"'));
assert(styles.includes(".role-row.neutral"));
assert(styles.includes(".role-icon.neutral"));
assert(styles.includes(".identity-lightbox.neutral"));
assert(styles.includes(".wolf-enabled-card.werewolf"));
assert(styles.includes(".wolf-enabled-card.village"));
assert(styles.includes(".wolf-enabled-card.neutral"));
assert(script.includes('["tanner", "neutral"].includes(role.team)'));

console.log("onenightwolf UI tests passed");
