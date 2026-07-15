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
const sharedPlayerName = fs.readFileSync(path.join(root, "Shared", "public", "player-name.js"), "utf8");
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
const gangsiPage = fs.readFileSync(path.join(root, "Gangsi", "public", "index.html"), "utf8");
const gangsiScript = fs.readFileSync(path.join(root, "Gangsi", "public", "gangsi.js"), "utf8");
const gangsiStyles = fs.readFileSync(path.join(root, "Gangsi", "public", "gangsi.css"), "utf8");
const frameworkDoc = fs.readFileSync(path.join(root, "COMMON_ROOM_FRAMEWORK.md"), "utf8");
const complianceMatrixDoc = fs.readFileSync(path.join(root, "docs", "FRAMEWORK_COMPLIANCE_MATRIX.md"), "utf8");
const newGameChecklistDoc = fs.readFileSync(path.join(root, "docs", "NEW_GAME_CHECKLIST.md"), "utf8");
const loveMobileStyles = loveStyles.slice(loveStyles.indexOf("@media (max-width: 560px)"), loveStyles.indexOf("@media (max-width: 380px)"));

[
  ["Avalon", avalonPage, "王者之劍改依官方規則執行"],
  ["Onenightwolf", wolfPage, "夜間行動順序與能力改以初始牌判定"],
  ["CriminalDance", criminalPage, "統一房間名稱契約"],
  ["LoveLetter", lovePage, "所有其他玩家受女僕保護時仍可無效果打出"]
].forEach(([game, page, releaseNote]) => {
  assert(page.includes("最新版本 2026/07/13"), `${game} release note date must be current`);
  assert(page.includes(releaseNote), `${game} release note must describe its actual changes`);
});

[
  ["Avalon", avalonPage, avalonScript],
  ["Onenightwolf", wolfPage, wolfScript],
  ["CriminalDance", criminalPage, criminalScript],
  ["LoveLetter", lovePage, loveScript],
  ["Gangsi", gangsiPage, gangsiScript]
].forEach(([game, page, script]) => {
  assert(page.includes('id="nameInput" maxlength="12"'), `${game} name input must expose the 12 half-width-unit limit`);
  assert(page.includes('<script src="/shared/player-name.js"></script>'), `${game} must load the Shared player-name contract`);
  assert(script.includes("SharedPlayerName.bindPlayerNameInput"), `${game} must bind the Shared player-name contract`);
  assert(script.includes("SharedPlayerName.cleanPlayerName"), `${game} must clean submitted or restored names through Shared`);
});
assert(sharedPlayerName.includes("MAX_PLAYER_NAME_WIDTH = 12"), "Shared player-name width must remain 12");
assert(avalonScript.includes("本次任務的王者之劍持有者"), "Avalon voting must identify the selected Excalibur holder");
assert(wolfScript.includes('class="wolf-night-flow-center"'), "One Night Wolf night flow must include center-card information");
assert(
  wolfScript.indexOf('class="wolf-night-flow-center"') < wolfScript.indexOf("</details>`;", wolfScript.indexOf("function nightFlow")),
  "center-card information must be inside the night-flow section"
);
assert(!wolfScript.includes('<p class="wolf-center-result">中央牌：'), "center cards must not remain duplicated outside the night flow");

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
assert(avalonPage.includes("從未持有過湖中女神的其他玩家"), "Avalon rules must exclude every previous Lady holder from inspection");
assert(avalonPage.includes("最初持有者也不能成為之後的查驗對象"), "Avalon rules must explicitly explain that the initial Lady holder cannot be inspected");
assert(avalonScript.includes("最初持有者也不能被查驗"), "Avalon lobby setting help must match the Lady inspection restriction");
assert(avalonScript.includes("被查驗者將接過指示物"), "Avalon Lady phase help must explain the token transfer");
assert(avalonPage.includes("每次組隊時領袖都必須將劍交給參與任務的其他玩家"), "Avalon rules must require an Excalibur holder on every proposal");
assert(avalonPage.includes("發動時立即公開持劍者與目標"), "Avalon rules must publish the Excalibur target when it is used");
assert(!avalonScript.includes("excaliburUnique"), "removed Excalibur uniqueness option must not remain in the UI");
assert(avalonScript.includes("player.id !== room.activeExcaliburHolderId"), "Excalibur holder must not be offered as their own target");
assert(avalonScript.includes("room.excaliburPublicResult"), "Excalibur public target must render before mission resolution");
assert(avalonPage.includes('window.location.href = "/Onenightwolf/"'), "Avalon game selector must navigate to the One Night Wolf index");
assert(avalonPage.includes('window.location.href = "/CriminalDance/"'), "Avalon game selector must navigate to the CriminalDance index");
assert(avalonPage.includes('window.location.href = "/LoveLetter/"'), "Avalon game selector must navigate to the LoveLetter index");
assert(avalonPage.includes('window.location.href = "/Gangsi/"'), "Avalon game selector must navigate to the Gangsi index");
assert(wolfPage.includes('window.location.href = "/"'), "One Night Wolf game selector must navigate to the Avalon index");
assert(wolfPage.includes('window.location.href = "/CriminalDance/"'), "One Night Wolf game selector must navigate to the CriminalDance index");
assert(wolfPage.includes('window.location.href = "/LoveLetter/"'), "One Night Wolf game selector must navigate to the LoveLetter index");
assert(wolfPage.includes('window.location.href = "/Gangsi/"'), "One Night Wolf game selector must navigate to the Gangsi index");
assert(criminalPage.includes('window.location.href = "/"'), "CriminalDance game selector must navigate to the Avalon index");
assert(criminalPage.includes('window.location.href = "/Onenightwolf/"'), "CriminalDance game selector must navigate to the One Night Wolf index");
assert(criminalPage.includes('window.location.href = "/LoveLetter/"'), "CriminalDance game selector must navigate to the LoveLetter index");
assert(criminalPage.includes('window.location.href = "/Gangsi/"'), "CriminalDance game selector must navigate to the Gangsi index");
assert(lovePage.includes('window.location.href = "/"'), "LoveLetter game selector must navigate to the Avalon index");
assert(lovePage.includes('window.location.href = "/Onenightwolf/"'), "LoveLetter game selector must navigate to the One Night Wolf index");
assert(lovePage.includes('window.location.href = "/CriminalDance/"'), "LoveLetter game selector must navigate to the CriminalDance index");
assert(lovePage.includes('window.location.href = "/Gangsi/"'), "LoveLetter game selector must navigate to the Gangsi index");
assert(gangsiScript.includes('avalon: "/"') && gangsiScript.includes('loveletter: "/LoveLetter/"'), "Gangsi game selector must navigate to the existing game indexes");
assert(gangsiPage.includes('data-shell-view="join"') && gangsiPage.includes('data-shell-view="room"'), "Gangsi must use the Shared join and room shell");
assert(gangsiPage.includes('data-shell-layout="lobby"') && gangsiPage.includes('data-shell-layout="game"'), "Gangsi must use the Shared lobby and game layouts");
assert(gangsiPage.includes('class="gangsi-game-main template-game-main-table"'), "Gangsi board room must expose the shared main-table marker");
assert(gangsiPage.includes('class="template-game-action-row"'), "Gangsi board room must expose the shared action-row marker");
assert(gangsiPage.includes("template-game-control-row"), "Gangsi board room must expose the shared control-row marker");
assert(gangsiScript.includes("template-game-turn-badge") && gangsiScript.includes("template-game-turn-pulse"), "Gangsi board room must expose the shared turn markers");
assert(gangsiScript.includes("SharedRoomUI.playerMatrix") && gangsiScript.includes("SharedRoomUI.seatNumber"), "Gangsi board room must use the shared player matrix");
assert(gangsiScript.includes("SharedRoomUI.actionInfoBlock") && gangsiScript.includes("SharedRoomUI.handPanel"), "Gangsi board room must use shared information and hand panels");
assert(!gangsiPage.includes("status-strip"), "Gangsi board room intentionally removes the four-card desktop status strip");
assert(!gangsiStyles.includes(".gangsi-room-summary"), "Gangsi board room must keep the desktop status-strip space available for the board");
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
  "template-game-control-row",
  "template-game-turn-badge"
].forEach((className) => {
  assert(criminalScript.includes(className), `CriminalDance shared game template class is missing: ${className}`);
  assert(loveScript.includes(className), `LoveLetter shared game template class is missing: ${className}`);
});
[
  ".template-game-control-row",
  ".template-game-action-info-block",
  ".template-game-action-row",
  ".template-game-turn-badge",
  ".template-game-turn-pulse"
].forEach((selector) => assert(sharedStyles.includes(selector), `Shared main-game presentation style is missing: ${selector}`));
assert(sharedStyles.includes("@keyframes template-game-turn-pulse"), "Shared turn pulse animation is missing");
assert(sharedStyles.includes("prefers-reduced-motion: reduce") && sharedStyles.includes(".template-game-turn-pulse"), "Shared turn pulse must support reduced motion");
assert(sharedStyles.includes("--template-game-turn-pulse-shadow"), "Shared turn pulse must expose a game-color variable");
assert(sharedStyles.includes(".button-row.template-game-action-row"), "Shared mobile button-row rules must not stretch main-game action rows vertically");
assert(!criminalStyles.includes("@keyframes criminal-turn-pulse"), "CriminalDance must use the shared turn pulse animation");
assert(!loveStyles.includes("@keyframes love-turn-pulse"), "LoveLetter must use the shared turn pulse animation");
assert(criminalStyles.includes("--template-game-turn-pulse-shadow") && loveStyles.includes("--template-game-turn-pulse-shadow"), "Games may only customize turn pulse color through the shared variable");
["template-game-action-row", "template-game-turn-pulse"].forEach((className) => {
  assert(criminalScript.includes(className), `CriminalDance shared presentation marker is missing: ${className}`);
  assert(loveScript.includes(className), `LoveLetter shared presentation marker is missing: ${className}`);
});
assert(frameworkDoc.includes("新型主遊戲框架由 CriminalDance、LoveLetter 與 Gangsi 驗證"), "Framework doc must include Gangsi in the newer main-game template");
assert(frameworkDoc.includes("棋盤式主遊戲框架則由 Gangsi 驗證"), "Framework doc must define the board-game specialization");
assert(frameworkDoc.includes("Avalon 與 Onenightwolf 的既有主流程已穩定，除非重構，不要求為了形式一致而回套所有新型主遊戲"), "Framework doc must not force Avalon/Onenightwolf to backfill newer main-game markers");
assert(frameworkDoc.includes("docs/FRAMEWORK_COMPLIANCE_MATRIX.md"), "Framework doc must link the compliance matrix");
assert(frameworkDoc.includes("docs/NEW_GAME_CHECKLIST.md"), "Framework doc must link the new game checklist");
[
  "Avalon",
  "Onenightwolf",
  "CriminalDance",
  "LoveLetter",
  "Gangsi",
  "Global Shell",
  "Shared Runtime",
  "Roster Template",
  "New Main Game Template",
  "Board Game Template",
  "Server View Boundary",
  "No-dead-end Coverage"
].forEach((item) => assert(complianceMatrixDoc.includes(item), `Compliance matrix is missing: ${item}`));
assert(complianceMatrixDoc.includes("既有穩定主流程，暫不回套"), "Compliance matrix must document legacy stable main-flow games");
assert(complianceMatrixDoc.includes("新增遊戲時，必須更新本矩陣"), "Compliance matrix must require updates for new games");
[
  "基本註冊",
  "房間與連線",
  "新型主遊戲框架判定",
  "棋盤式遊戲判定",
  "Template Marker",
  "Server View",
  "Action Info",
  "可推進性",
  "測試",
  "RWD 與視覺",
  "Release"
].forEach((heading) => assert(newGameChecklistDoc.includes(heading), `New game checklist is missing section: ${heading}`));
[
  "SharedRoomClient.createActionRequest()",
  "SharedRoomUI.playerMatrix()",
  "SharedRoomUI.handPanel()",
  "SharedRoomUI.actionInfoBlock()",
  "template-game-action-row",
  "合法格、方向與完整路徑由 Server 提供",
  "實際遊戲是否隱藏每格座標",
  "you.pendingAction",
  "公開訊息不得洩漏秘密牌名",
  "至少跑 10 次完整流程",
  "更新 `docs/FRAMEWORK_COMPLIANCE_MATRIX.md`"
].forEach((item) => assert(newGameChecklistDoc.includes(item), `New game checklist is missing requirement: ${item}`));
[
  "Visual QA 分層",
  "白箱 layout 測試",
  "黑箱截圖測試",
  "壓力測試",
  "三層 Visual QA 都必須產出可檢查結果",
  "白箱產出 marker/overlap report 與結構截圖",
  "黑箱產出正常遊戲截圖",
  "壓力產出最大內容截圖",
  "三層 Visual QA 都必須涵蓋完整房間階段",
  "不可只截主遊戲視窗",
  "準備大廳、主遊戲與結算／等待回大廳",
  "Shared room shell 的 Visual QA 必須覆蓋五款遊戲",
  "Avalon、Onenightwolf、CriminalDance、LoveLetter、Gangsi",
  "新型及棋盤式主遊戲 template marker 檢查只套用在使用該 template 的遊戲",
  "正式 Visual QA 必須載入原本遊戲頁面與原本前端 renderer",
  "使用各遊戲原本 server view schema",
  "不得用手刻靜態 HTML fixture 取代實際遊戲架構截圖",
  "黑箱與壓力截圖都必須使用最大玩家數矩陣",
  "最大玩家矩陣",
  "惡意長名字",
  "最大或接近最大分數",
  "公開牌、棄牌堆、打出牌與公開標記",
  "不得只用理想最小畫面",
  "gitignore 的臨時目錄"
].forEach((item) => assert(newGameChecklistDoc.includes(item), `Visual QA checklist is missing requirement: ${item}`));
[
  "白箱 layout 測試、黑箱截圖測試與壓力測試",
  "三層測試都必須產出對應截圖或 report",
  "準備大廳、主遊戲與結算／等待回大廳",
  "不可只截主遊戲視窗",
  "Shared room shell 的 Visual QA 必須覆蓋五款遊戲",
  "Avalon、Onenightwolf、CriminalDance、LoveLetter、Gangsi",
  "新型及棋盤式主遊戲 template marker 檢查只套用在使用該 template 的遊戲",
  "正式 Visual QA 必須載入原本遊戲頁面與原本前端 renderer",
  "使用各遊戲原本 server view schema",
  "不得用手刻靜態 HTML fixture 取代實際遊戲架構截圖",
  "黑箱與壓力截圖都必須使用最大玩家矩陣",
  "最大玩家矩陣",
  "最多常見公開牌／棄牌／打出牌／公開標記",
  "不得只用理想最小畫面",
  "未經明確決定不得進正式 commit"
].forEach((item) => assert(frameworkDoc.includes(item), `Framework Visual QA contract is missing: ${item}`));
[
  "新型主遊戲框架實作清單",
  "棋盤式主遊戲 template",
  "新型 Server View 邊界",
  "Action Info 訊息政策",
  "Template Marker 命名規則"
].forEach((heading) => assert(frameworkDoc.includes(heading), `Framework doc is missing required new-game contract section: ${heading}`));
[
  "是否需要玩家矩陣",
  "是否需要手牌、角色牌、選牌",
  "是否需要桌面公開區",
  "是否屬於棋盤式遊戲",
  "是否需要公開資訊欄、私密資訊欄或行動資訊欄",
  "是否需要右上角目前回合提示",
  "是否需要主流程確認／取消按鈕列",
  "手機版主流程順序"
].forEach((item) => assert(frameworkDoc.includes(item), `Framework checklist is missing: ${item}`));
[
  "結構化地圖",
  "Server-authoritative 移動",
  "實際遊戲格子不得常駐顯示座標",
  "合法移動清單、記錄、提示文字與錯誤訊息都不能成為旁通道",
  "最大支援地圖"
].forEach((item) => assert(frameworkDoc.includes(item), `Board-game framework contract is missing: ${item}`));
[
  "room.players[]",
  "you.pendingAction",
  "you.actionInfo",
  "前端不得自行推導秘密或權限",
  "Server-authoritative 清單"
].forEach((item) => assert(frameworkDoc.includes(item), `Server View contract is missing: ${item}`));
[
  "公開行動應寫給所有玩家",
  "私密結果只寫給相關玩家",
  "公開訊息不得洩漏秘密牌名",
  "結算畫面應保留本局最後一段 action info",
  "renderSeatBadges"
].forEach((item) => assert(frameworkDoc.includes(item), `Action info policy is missing: ${item}`));
[
  "無合法目標",
  "無可交換牌",
  "牌庫空",
  "所有目標受保護",
  "行動可無效果打出"
].forEach((item) => assert(frameworkDoc.includes(item), `Progression no-dead-end contract is missing: ${item}`));
[
  "template-game-*",
  "template-player-*",
  "template-seat-*",
  "template class 不得承載單一遊戲規則",
  "至少跑 10 次完整流程"
].forEach((item) => assert(frameworkDoc.includes(item), `Template/test contract is missing: ${item}`));
assert(loveGame.includes("setPublicActionInfo"), "LoveLetter must list public action info like CriminalDance");
assert(loveGame.includes("你從蓋牌抽到了"), "LoveLetter Prince burn-card draw must create private action info");
assert(loveGame.includes("抽走了蓋牌"), "LoveLetter Prince burn-card draw must create public action info");
assert(loveScript.includes("renderTableZones()") && loveScript.includes("${renderActionInfo()}"), "LoveLetter result screens must keep public table and action information visible");
["rosterTokens", "playerMatrix", "seatNumber", "actionInfoBlock", "handPanel", "cardStateClasses"].forEach((helper) => {
  assert(sharedRoomUi.includes(`function ${helper}`), `SharedRoomUI helper is missing: ${helper}`);
  assert(criminalScript.includes(`SharedRoomUI.${helper}`), `CriminalDance must use SharedRoomUI.${helper}`);
  assert(loveScript.includes(`SharedRoomUI.${helper}`), `LoveLetter must use SharedRoomUI.${helper}`);
});
assert(sharedRoomUi.includes("template-game-player-matrix"), "Shared player matrix helper must render the template marker");
assert(sharedRoomUi.includes("template-seat-number"), "Shared seat number helper must render the template marker");
assert(sharedRoomUi.includes("function seatToneClass") && sharedRoomUi.includes("seatToneClass(seatIndex)"), "Shared seat numbers and seat-bound game objects must use one tone helper");
assert(sharedRoomUi.includes("template-game-action-info-block"), "Shared action info helper must render the template marker");
assert(sharedRoomUi.includes("template-game-hand-panel"), "Shared hand panel helper must render the template marker");
assert(sharedRoomUi.includes("function resultRows") && sharedRoomUi.includes("template-result-row"), "Shared result row helper must support reusable result rows");
assert(loveScript.includes("SharedRoomUI.resultRows"), "LoveLetter remaining-hand result rows must use the shared result row helper");
assert(sharedStyles.includes(".template-result-player-name") && sharedStyles.includes("text-overflow: ellipsis"), "Shared result rows must truncate long player names");
assert(sharedStyles.includes(".template-result-score") && sharedStyles.includes("min-width: max-content"), "Shared result score column must not be squeezed by remaining items");
assert(loveScript.includes('className: "love-action-info-block"') && loveScript.includes('bodyClassName: "love-private"'), "LoveLetter shared action info must keep the original action-info classes");
assert(criminalScript.includes('className: "criminal-action-info-block"') && criminalScript.includes('bodyClassName: "criminal-private"'), "CriminalDance shared action info must keep the original action-info classes");
assert(loveScript.includes("renderMessage: renderActionMessage") && loveScript.includes("let output = renderSeatBadges(value)") && criminalScript.includes("renderMessage: renderSeatBadges"), "Shared action info must keep game-specific #N badge rendering");
assert(loveScript.includes('className: "love-action-panel"') && loveScript.includes('gridClassName: "love-hand"'), "LoveLetter shared hand panel must keep the original hand classes");
assert(criminalScript.includes('gridClassName: "criminal-hand"'), "CriminalDance shared hand panel must keep the original hand grid class");
assert(loveScript.includes("cardNumberBadge(card.value)"), "LoveLetter hand cards must keep game-specific card number rendering");
assert(loveScript.includes("const playableNow = isPlayableNow(card.uid, isYourTurn)") && loveScript.includes("伯爵夫人在手時不可打出"), "LoveLetter hand rules must remain game-specific");
assert(criminalScript.includes("cardDescription(card.id, isTurn)") && criminalScript.includes("isPlayable(card.id)"), "CriminalDance hand rules must remain game-specific");
assert(criminalScript.includes("titleHtml: renderSeatBadges(title)"), "CriminalDance pending hand panel must preserve seat badge title HTML");
assert(sharedStyles.includes(".template-seat-number.seat-tone-1"), "Shared template seat number tone styles are missing");
assertCssRuleIncludes(sharedStyles, ".template-seat-number", "width: 28px");
assertCssRuleIncludes(sharedStyles, ".template-seat-number", "height: 28px");
assertCssRuleIncludes(sharedStyles, ".template-seat-number", "border-radius: 50%");
assertCssRuleIncludes(sharedStyles, ".template-seat-number", "background: var(--seat-tone-bg)");
assert(gangsiScript.includes("SharedRoomUI.seatToneClass(index)"), "Gangsi adventurer pieces must follow their shared seat tone");
assert(gangsiScript.includes("seatToneByPlayerId.get(piece.controllerId)"), "Gangsi board pieces must follow their controller seat tone");
assert(!gangsiScript.includes('gangsi-piece-token is-mummy seat-tone-'), "Gangsi mummy piece must keep its fixed role color");
assertCssRuleIncludes(gangsiStyles, ".gangsi-piece-token", "background: var(--seat-tone-bg, #fff)");
assertCssRuleIncludes(gangsiStyles, ".gangsi-board-piece", "background: var(--seat-tone-bg, #fff)");
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
assert(sharedRoomUi.includes('tokens.push(token("host", "房主"))'), "Shared roster token policy must render host token last");
assert(sharedRoomUi.includes('resultPhases = ["roundResult", "matchResult", "result"]'), "Shared roster token policy must hide state tokens in result phases by default");
assert(!loveScript.includes('SharedRoomUI.token("info"'), "LoveLetter roster must not duplicate protected state tokens from the player matrix");
assert(!loveScript.includes('SharedRoomUI.token("danger"'), "LoveLetter roster must not duplicate eliminated state tokens from the player matrix");
assert(loveScript.includes("renderSeatBadges"), "LoveLetter action info must render #N messages with shared seat badges");
assert(loveScript.includes("renderScoreHearts"), "LoveLetter score display must render affection hearts");
assert(loveScript.includes('statusCard("芳心", scoreHeartsText(highScore))'), "LoveLetter status score must use affection hearts");
assert(!loveScript.includes("${player.score} 分"), "LoveLetter player scores must not render as plain points");
assert(lovePage.includes("若牌庫已空，改拿開局時暗置的蓋牌"), "LoveLetter rules must explain Prince drawing the setup burn card");
assert(lovePage.includes("<h3>勝利條件</h3>"), "LoveLetter rules must include victory conditions");
assert(lovePage.includes("牌庫耗盡時，所有未出局玩家公開手牌並比較數值"), "LoveLetter rules must explain deck-empty victory");
["template-game-main-table"].forEach((className) => {
  const criminalCount = (criminalScript.match(new RegExp(className, "g")) || []).length;
  const loveCount = (loveScript.match(new RegExp(className, "g")) || []).length;
  assert.strictEqual(criminalCount, loveCount, `CriminalDance and LoveLetter must call ${className} in the same main-game phases`);
});
assert.strictEqual(
  (criminalScript.match(/SharedRoomUI\.playerMatrix/g) || []).length,
  (loveScript.match(/SharedRoomUI\.playerMatrix/g) || []).length,
  "CriminalDance and LoveLetter must render player matrices through SharedRoomUI in the same main-game phases"
);

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
assert(frameworkDoc.includes("roundResult.revealedHands") && frameworkDoc.includes("renderHandCardFace()"), "Framework docs must define the public remaining-hand reveal reference contract");
assert(newGameChecklistDoc.includes("結算時是否需要公開所有玩家或未出局玩家的剩餘手牌"), "New game checklist must explicitly ask whether settlement needs remaining hand reveals");
assert(frameworkDoc.includes("尚未達到目標分數時只能提供「開始下一局」") && frameworkDoc.includes("整場結束後，只能提供「返回大廳」"), "Framework docs must define score-based result action policy");
assert(newGameChecklistDoc.includes("未達目標分數的本局結算只能開始下一局"), "New game checklist must include score-based result action policy");
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
assert(sharedRoomUi.includes('token("turn", "目前回合")'), "Shared roster token policy must provide the current-turn token");
assert(criminalScript.includes("SharedRoomUI.rosterTokens"), "CriminalDance must use shared roster token policy instead of a leader token");
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
