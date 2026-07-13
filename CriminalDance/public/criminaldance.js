(function initializeCriminalDance(global) {
  "use strict";

  const STORAGE_KEY = "criminaldance-sessions";
  const TAB_KEY = "criminaldance-tab-player";
  const CLIENT_INSTANCE_ID = crypto.randomUUID();
  const CARD_NAMES = {
    first_discoverer: "第一發現者",
    culprit: "犯人",
    alibi: "不在場證明",
    accomplice: "共犯",
    detective: "偵探",
    witness: "目擊者",
    ordinary: "普通人",
    dog: "神犬",
    information_exchange: "情報交換",
    rumor: "謠言",
    trade: "交易",
    inspector: "警部",
    boy: "少年"
  };
  const CARD_ICONS = {
    first_discoverer: "🔍",
    culprit: "🎭",
    alibi: "🧾",
    accomplice: "🔗",
    detective: "🔎",
    witness: "👁️",
    ordinary: "🙂",
    dog: "🐾",
    information_exchange: "➡️",
    rumor: "💬",
    trade: "🔄",
    inspector: "👮",
    boy: "👦"
  };
  const CARD_HELP = {
    first_discoverer: "持有者先出，第一回合必須打出。",
    culprit: "最後一張手牌時可打出並讓犯人陣營得分。",
    alibi: "犯人同時持有時，偵探指定也不會抓到犯人。",
    accomplice: "打出後加入犯人陣營，與犯人共同勝負。",
    detective: "手牌 3 張以下可打出，指定玩家查犯人。",
    witness: "指定玩家並私下查看對方所有手牌。",
    ordinary: "無效果。",
    dog: "指定玩家自己棄一張；棄犯人則神犬抓到犯人。",
    information_exchange: "所有有手牌玩家同時向左傳一張原本手牌。",
    rumor: "由打出者開始，依座位順時針向右手邊玩家抽一張，先暫放桌前。",
    trade: "與一位有手牌玩家各自秘密選一張同時交換。",
    inspector: "替換神犬。3 張以下可打出，本局結束時命中犯人則 +3。",
    boy: "替換 1 張目擊者。開局得知初始犯人位置。"
  };
  const CARD_ORDER = [
    "culprit",
    "accomplice",
    "first_discoverer",
    "alibi",
    "detective",
    "witness",
    "ordinary",
    "dog",
    "inspector",
    "boy",
    "information_exchange",
    "rumor",
    "trade"
  ];
  const BASE_COUNTS = {
    first_discoverer: 1,
    culprit: 1,
    alibi: 5,
    accomplice: 2,
    detective: 4,
    witness: 3,
    ordinary: 2,
    dog: 1,
    information_exchange: 4,
    rumor: 5,
    trade: 4
  };
  const REQUIRED = {
    3: { first_discoverer: 1, culprit: 1, detective: 1, alibi: 1 },
    4: { first_discoverer: 1, culprit: 1, detective: 1, alibi: 1, accomplice: 1 },
    5: { first_discoverer: 1, culprit: 1, detective: 1, alibi: 2, accomplice: 1 },
    6: { first_discoverer: 1, culprit: 1, detective: 2, alibi: 2, accomplice: 2 },
    7: { first_discoverer: 1, culprit: 1, detective: 2, alibi: 3, accomplice: 2 }
  };

  let socket = null;
  let snapshot = null;
  let lastVersion = 0;
  let hasControl = true;
  let hadRoomConnection = false;
  let actionSequence = 0;
  let selectedSession = readSelectedSession();
  let activeInfoTab = "chat";
  let infoRoomCode = null;
  let lastObservedChatId = null;
  let unreadChatCount = 0;
  let lastPlayerJoinSerial = 0;
  let unreadRosterCount = 0;
  let selectedCard = null;
  let selectedCardIndex = null;
  let selectedTargetId = null;
  let selectedGiveCard = null;
  let selectedGiveCardIndex = null;
  let selectedPendingAction = null;
  let selectedPendingCard = null;
  let selectedPendingCardIndex = null;
  let lastMainRenderKey = null;

  const page = {};

  window.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    page.mode = document.getElementById("gameModeSelect");
    page.joinView = document.getElementById("joinView");
    page.roomView = document.getElementById("criminalRoomView");
    page.lobbyTemplate = document.getElementById("criminalLobbyTemplate");
    page.joinForm = document.getElementById("joinForm");
    page.nameInput = document.getElementById("nameInput");
    page.roomInput = document.getElementById("roomInput");
    page.createButton = document.getElementById("createRoomButton");
    page.rejoinButton = document.getElementById("rejoinRoomButton");
    page.recentSessions = document.getElementById("recentSessions");
    page.recentSessionList = document.getElementById("recentSessionList");
    page.connection = document.getElementById("connectionChip");
    page.statusStrip = document.getElementById("statusStrip");
    page.mobileStatusSummary = document.getElementById("mobileStatusSummary");
    page.roomCodes = document.querySelectorAll(".room-code-value");
    page.copyButtons = document.querySelectorAll("[data-copy-link]");
    page.infoTabs = document.getElementById("infoTabs");
    page.chatUnread = document.getElementById("chatUnread");
    page.rosterUnread = document.getElementById("rosterUnread");
    page.chatList = document.getElementById("chatList");
    page.chatForm = document.getElementById("chatForm");
    page.chatInput = document.getElementById("chatInput");
    page.roster = document.getElementById("roster");
    page.roleList = document.getElementById("roleList");
    page.logList = document.getElementById("logList");
    page.mainPanel = document.getElementById("mainPanel");
    page.rulesOverlay = document.getElementById("rulesOverlay");
    page.openRules = document.getElementById("openRulesButton");
    page.closeRules = document.getElementById("closeRulesButton");

    SharedPlayerName.bindPlayerNameInput(page.nameInput);
    bindEvents();
    const queryRoom = roomFromUrl();
    if (queryRoom) page.roomInput.value = queryRoom;
    if (selectedSession?.name) page.nameInput.value = SharedPlayerName.cleanPlayerName(selectedSession.name);
    renderRecentSessions();
    syncRejoin();
    connect();
  }

  function connect() {
    socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/criminaldance`);
    socket.addEventListener("open", () => {
      setConnection("已連線");
      if (hadRoomConnection && selectedSession?.roomCode && selectedSession?.playerId) {
        sendRaw({
          type: "joinRoom",
          roomCode: selectedSession.roomCode,
          playerId: selectedSession.playerId,
          name: selectedSession.name || ""
        });
        return;
      }
      requestSync();
    });
    socket.addEventListener("close", () => {
      setConnection("請稍後");
      window.setTimeout(connect, 1200);
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "joined") {
        hasControl = true;
        hadRoomConnection = true;
        SharedRoomUI.clearControlLock();
        selectedSession = {
          roomCode: message.roomCode,
          playerId: message.playerId,
          name: page.nameInput.value.trim() || selectedSession?.name || "",
          game: "criminaldance",
          lastUsedAt: Date.now()
        };
        saveSession(selectedSession);
        sessionStorage.setItem(TAB_KEY, message.playerId);
        history.replaceState({ game: "criminaldance" }, "", SharedRoomClient.roomUrlPath("/CriminalDance/", message.roomCode));
        syncRejoin();
        requestSync();
        return;
      }
      if (message.type === "controlGranted") {
        hasControl = true;
        SharedRoomUI.clearControlLock();
        requestSync();
        return;
      }
      if (message.type === "ping") {
        sendRaw({ type: "pong", at: message.at });
        return;
      }
      if (message.type === "syncOk") {
        lastVersion = message.version || lastVersion;
        setConnection(SharedRoomUI.connectionStatusText(lastVersion));
        return;
      }
      if (message.type === "state") {
        snapshot = message;
        lastVersion = message.room.version || lastVersion;
        setConnection(SharedRoomUI.connectionStatusText(lastVersion));
        render();
        return;
      }
      if (message.type === "error") {
        if (message.code === SharedRoomClient.SESSION_ERROR_CODES.sessionReplaced) {
          hasControl = false;
          SharedRoomUI.showControlLock(takeControl);
          showToast(message.message);
          return;
        }
        if ([
          SharedRoomClient.SESSION_ERROR_CODES.staleRoomVersion,
          SharedRoomClient.SESSION_ERROR_CODES.actionAlreadyConfirmed
        ].includes(message.code)) requestSync();
        clearInvalidSession(message);
        showToast(message.message);
      }
    });
  }

  function bindEvents() {
    page.createButton.addEventListener("click", () => {
      const name = SharedPlayerName.cleanPlayerName(page.nameInput.value);
      if (!name) return showToast("請先輸入名字。");
      sendRaw({ type: "createRoom", name });
    });
    page.joinForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = SharedPlayerName.cleanPlayerName(page.nameInput.value);
      const roomCode = parseRoomCode(page.roomInput.value);
      if (!name) return showToast("請先輸入名字。");
      if (!roomCode) return showToast("請輸入有效的房間代碼或邀請連結。");
      sendRaw({ type: "joinRoom", roomCode, name });
    });
    page.rejoinButton.addEventListener("click", () => {
      const saved = findRoomSession(parseRoomCode(page.roomInput.value) || roomFromUrl()) || selectedSession;
      if (!saved) return;
      sendRaw({ type: "joinRoom", roomCode: saved.roomCode, playerId: saved.playerId, name: saved.name || "" });
    });
    page.recentSessionList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-criminal-recent-player]");
      if (!button) return;
      const saved = sessionStore().sessions[button.dataset.criminalRecentPlayer];
      if (!saved) return;
      page.nameInput.value = SharedPlayerName.cleanPlayerName(saved.name || "");
      page.roomInput.value = saved.roomCode;
      selectedSession = saved;
      sessionStorage.setItem(TAB_KEY, saved.playerId);
      sendRaw({ type: "joinRoom", roomCode: saved.roomCode, playerId: saved.playerId, name: saved.name || "" });
    });
    page.roomInput.addEventListener("input", syncRejoin);
    page.nameInput.addEventListener("input", syncRejoin);
    page.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const message = page.chatInput.value.trim();
      if (!message) return;
      sendAction("chat", { message });
      page.chatInput.value = "";
    });
    page.infoTabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-info-tab]");
      if (!button || button.classList.contains("hidden")) return;
      activeInfoTab = button.dataset.infoTab;
      if (activeInfoTab === "chat") unreadChatCount = 0;
      if (activeInfoTab === "roster") unreadRosterCount = 0;
      renderInfoTabs();
      if (activeInfoTab === "chat") SharedRoomUI.readLatestChat(page.chatList);
    });
    SharedRoomUI.bindChatReadState(page.chatList, () => {
      unreadChatCount = 0;
      renderInfoTabs();
    });
    page.copyButtons.forEach((button) => button.addEventListener("click", copyInvite));
    page.openRules.addEventListener("click", openRules);
    page.closeRules.addEventListener("click", closeRules);
    page.rulesOverlay.addEventListener("click", (event) => {
      if (event.target === page.rulesOverlay) closeRules();
    });
    page.mainPanel.addEventListener("click", handleMainClick);
    page.mainPanel.addEventListener("change", handleMainChange);
  }

  function render() {
    if (!snapshot) return;
    document.body.classList.add("room-active");
    page.joinView.classList.add("hidden");
    page.roomView.classList.remove("hidden");
    page.roomView.classList.toggle("lobby-mode", snapshot.room.phase === "lobby");
    page.roomCodes.forEach((element) => { element.textContent = snapshot.room.code; });
    const chatScrollState = SharedRoomUI.captureScroll(page.chatList);
    syncInfoUnread(chatScrollState);
    renderInfoTabs();
    renderStatus();
    renderRoster();
    renderDecks();
    renderLog();
    renderChat(chatScrollState);
    renderMainIfChanged();
  }

  function renderMainIfChanged() {
    const nextKey = mainRenderKey();
    if (nextKey === lastMainRenderKey) return;
    lastMainRenderKey = nextKey;
    renderMain();
  }

  function mainRenderKey() {
    return JSON.stringify({
      roomCode: snapshot.room.code,
      phase: snapshot.room.phase,
      settings: snapshot.room.settings,
      currentPlayerId: snapshot.room.currentPlayerId,
      startingPlayerId: snapshot.room.startingPlayerId,
      turnNumber: snapshot.room.turnNumber,
      pendingAction: snapshot.room.pendingAction,
      roundResult: snapshot.room.roundResult,
      matchResult: snapshot.room.matchResult,
      players: snapshot.room.players.map((player) => ({
        id: player.id,
        name: player.name,
        ready: player.ready,
        roll: player.roll,
        score: player.score,
        handCount: player.handCount,
        tableCards: player.tableCards,
        publicCards: player.publicCards,
        index: player.index
      })),
      you: {
        id: snapshot.you.id,
        isHost: snapshot.you.isHost,
        hand: snapshot.you.hand,
        actionInfo: snapshot.you.actionInfo,
        openingInfo: snapshot.you.openingInfo,
        playableCards: snapshot.you.playableCards,
        pendingAction: snapshot.you.pendingAction
      }
    });
  }

  function renderStatus() {
    const room = snapshot.room;
    const host = room.players.find((player) => player.id === room.hostId);
    const current = room.players.find((player) => player.id === room.currentPlayerId);
    page.statusStrip.innerHTML = [
      statusCard("階段", phaseLabel(room.phase)),
      statusCard("目前玩家", current?.name || "未開始"),
      statusCard("房主", host?.name || "未指定"),
      statusCard("最高分", String(Math.max(0, ...room.players.map((player) => player.score || 0))))
    ].join("");
    page.mobileStatusSummary.innerHTML = SharedRoomUI.mobileStatusSummary([
      { label: "階段", value: phaseLabel(room.phase) },
      { label: "玩家", value: current?.name || "未開始" },
      { label: "最高分", value: String(Math.max(0, ...room.players.map((player) => player.score || 0))) }
    ]);
  }

  function renderRoster() {
    page.roster.innerHTML = snapshot.room.players.map((player) => `
      <article class="player-card ${SharedRoomUI.playerCardClasses({
        playerId: player.id,
        viewerId: snapshot.you.id,
        online: player.online
      })}" ${player.id === snapshot.you.id ? 'aria-current="true"' : ""}>
        <div class="seat">${player.index + 1}</div>
        <div>
          <div class="player-name-line"><strong>${escapeHtml(player.name)}</strong></div>
          <div class="player-meta">
            ${player.roll ? `d100: ${player.roll}` : "未擲骰"}${player.ready ? " · 已準備" : ""} · ${player.online ? "在線" : "離線"} · <span class="criminal-score">${player.score} 分</span>
          </div>
          ${SharedRoomUI.hostControls({
            viewerIsHost: snapshot.you.isHost,
            player,
            hostId: snapshot.room.hostId,
            phase: snapshot.room.phase
          })}
        </div>
        <div class="token-stack">${renderRosterTokens(player)}</div>
      </article>
    `).join("");
    SharedRoomUI.bindHostControls(page.roster, sendAction);
  }

  function renderRosterTokens(player) {
    return SharedRoomUI.rosterTokens({
      player,
      hostId: snapshot.room.hostId,
      currentPlayerId: snapshot.room.currentPlayerId,
      phase: snapshot.room.phase
    });
  }

  function renderDecks() {
    page.roleList.innerHTML = deckPreview(snapshot.room.settings, { detailedPool: false });
  }

  function renderLog() {
    page.logList.innerHTML = SharedRoomUI.logEntries(snapshot.room.log, escapeHtml);
  }

  function renderChat(scrollState) {
    page.chatList.innerHTML = snapshot.room.chat.map((entry) => `
      <div class="chat-message ${entry.playerId === "system" ? "system" : ""}">
        ${entry.playerId === "system" ? "" : `<strong>${escapeHtml(entry.name)}:</strong>`}
        <span>${escapeHtml(entry.message)}</span>
      </div>
    `).join("");
    SharedRoomUI.restoreScroll(page.chatList, scrollState);
  }

  function renderMain() {
    page.mainPanel.classList.remove("criminal-main-your-turn");
    if (snapshot.room.phase === "lobby") return renderLobby();
    if (snapshot.room.phase === "roundResult") return renderRoundResult();
    if (snapshot.room.phase === "matchResult") return renderMatchResult();
    return renderPlaying();
  }

  function renderLobby() {
    const fragment = page.lobbyTemplate.content.cloneNode(true);
    fragment.querySelector("[data-template-slot='phase-header']").innerHTML = phaseHeader("大廳", "設定人數、擲 d100 並準備。");
    fragment.querySelector("[data-criminal-lobby-player-name]").textContent = snapshot.you.name;
    fragment.querySelector("[data-criminal-lobby-roll-status]").textContent = currentPlayer()?.roll
      ? `d100: ${currentPlayer().roll}`
      : "尚未擲骰";
    const readyButton = fragment.querySelector("[data-criminal-ready]");
    readyButton.textContent = currentPlayer()?.ready ? "取消準備" : "準備";
    readyButton.disabled = !currentPlayer()?.roll;
    const rollButton = fragment.querySelector("[data-criminal-roll]");
    rollButton.disabled = Boolean(currentPlayer()?.roll);
    const playerCount = fragment.querySelector("[data-criminal-player-count]");
    playerCount.value = String(snapshot.room.settings.playerCount);
    playerCount.disabled = !snapshot.you.isHost;
    fragment.querySelectorAll("[data-criminal-expansion]").forEach((input) => {
      input.checked = Boolean(snapshot.room.settings.expansions[input.dataset.criminalExpansion]);
      input.disabled = !snapshot.you.isHost;
    });
    fragment.querySelector("[data-criminal-lobby-deck]").innerHTML = deckPreview(snapshot.room.settings, { detailedPool: true });
    const validation = validateLobbyClient();
    fragment.querySelector("[data-criminal-lobby-validation]").innerHTML = validation.length
      ? validation.map((message) => `<div class="validation error">${escapeHtml(message)}</div>`).join("")
      : `<div class="validation ok">房間設定已完成，可以開始遊戲。</div>`;
    fragment.querySelector("[data-criminal-lobby-start-control]").innerHTML = snapshot.you.isHost
      ? `<button class="start-button" data-criminal-start type="button" ${validation.length ? "disabled" : ""}>開始遊戲</button>`
      : `<div class="notice">等待房主開始遊戲。</div>`;
    page.mainPanel.replaceChildren(fragment);
  }

  function renderPlaying() {
    if (snapshot.you.openingInfo) return renderOpeningInfo();
    const pending = snapshot.you.pendingAction;
    const publicPending = snapshot.room.pendingAction;
    const isYourTurn = snapshot.room.phase === "playing" && snapshot.room.currentPlayerId === snapshot.you.id;
    const showTurnPrompt = Boolean(pending || isYourTurn);
    page.mainPanel.classList.toggle("criminal-main-your-turn", showTurnPrompt);
    page.mainPanel.innerHTML = `
      ${showTurnPrompt ? renderTurnBadge() : ""}
      ${phaseHeader(phaseLabel(snapshot.room.phase), mainSubtitle())}
      <section class="criminal-table template-game-main-table">
        ${SharedRoomUI.playerMatrix({ players: snapshot.room.players, renderSeat, className: "criminal-seat-grid" })}
        <div class="criminal-control-row template-game-control-row">
          <div class="criminal-control-main">
            ${pending ? renderPendingAction(pending) : renderPublicPendingAction(publicPending) || renderHandControls()}
          </div>
          ${renderActionInfo()}
        </div>
      </section>
    `;
  }

  function renderSeat(player) {
    const playedCards = player.tableCards.filter((card) => card !== "accomplice");
    const publicCards = [
      ...player.tableCards.filter((card) => card === "accomplice").map((card) => ({ card })),
      ...player.publicCards
    ];
    return `
      <article class="${seatAnimationClasses(player)}">
        <div class="criminal-seat-head">
          <div class="criminal-seat-title">
            ${SharedRoomUI.seatNumber(player.index, "criminal-seat-number")}
            <strong title="${escapeHtml(player.name)}">${escapeHtml(player.name)}</strong>
          </div>
          <span>${player.score} 分</span>
        </div>
        <small>${player.handCount} 張手牌</small>
        ${renderPile("打出牌堆", playedCards.map((card) => ({ card })), "尚未出牌", "played")}
        ${renderPile("公開牌堆", publicCards, "沒有公開牌", "public")}
      </article>
    `;
  }

  function renderPile(label, cards, emptyText, kind) {
    return `
      <div class="criminal-pile criminal-pile-${kind}">
        <span>${escapeHtml(label)}</span>
        <div class="criminal-played">
          ${cards.length
            ? cards.map((item) => renderPileCard(item, kind)).join("")
            : `<small>${escapeHtml(emptyText)}</small>`}
        </div>
      </div>
    `;
  }

  function renderPileCard(item, kind) {
    const target = item.targetId ? playerById(item.targetId) : null;
    const isPublic = kind === "public";
    return `
      <span class="${isPublic ? "criminal-public-card" : "criminal-pill"} card-${item.card} ${item.targetId ? "has-subtitle" : ""}">
        <span>${cardName(item.card)}</span>
        ${target ? `<small title="${escapeHtml(target.name)}">${SharedRoomUI.seatNumber(target.index, "criminal-seat-number")} ${escapeHtml(target.name)}</small>` : ""}
      </span>
    `;
  }

  function seatAnimationClasses(player) {
    return [
      "criminal-seat",
      ...persistentSeatClasses(player),
      ...pendingSeatClasses(player),
      culpritRevealClass(player),
      roundResultSeatClass(player)
    ].filter(Boolean).join(" ");
  }

  function persistentSeatClasses(player) {
    const classes = [];
    if (player.tableCards.includes("accomplice")) classes.push("seat-accomplice");
    if (inspectorTargetIds().has(player.id)) classes.push("seat-inspector-target");
    return classes;
  }

  function pendingSeatClasses(player) {
    const pending = snapshot.room.pendingAction;
    if (pending?.type === "detectiveResult" && pending.targetId === player.id) {
      return [
        "seat-detective-scan",
        pending.caught ? "seat-culprit-reveal" : "seat-detective-miss"
      ];
    }
    if (pending?.type === "dogDiscard" && pending.targetId === player.id) return ["seat-dog-target"];
    return [];
  }

  function culpritRevealClass(player) {
    const result = snapshot.room.roundResult;
    return result?.culpritId === player.id ? "seat-culprit-reveal" : "";
  }

  function roundResultSeatClass(player) {
    const result = snapshot.room.roundResult;
    if (!result?.roundScores?.[player.id]) return "";
    if (result.type === "culprit") return "seat-round-win-culprit";
    if (result.type === "detective") return "seat-round-win-civilian";
    if (result.type === "dog" || result.type === "inspector") return "seat-round-win-authority";
    return "";
  }

  function inspectorTargetIds() {
    return new Set(snapshot.room.players.flatMap((player) => (
      player.publicCards
        .filter((item) => item.card === "inspector" && item.targetId)
        .map((item) => item.targetId)
    )));
  }

  function renderActionInfo() {
    return SharedRoomUI.actionInfoBlock({
      messages: snapshot.you.actionInfo?.messages || [],
      className: "criminal-action-info-block",
      bodyClassName: "criminal-private",
      renderMessage: renderSeatBadges
    });
  }

  function renderOpeningInfo() {
    const clues = snapshot.you.openingInfo?.clues || [];
    const hasFirstDiscoverer = clues.some((clue) => clue.type === "first_discoverer");
    page.mainPanel.innerHTML = `
      ${phaseHeader("開場資訊", hasFirstDiscoverer ? "確認後會直接打出第一發現者。" : "請確認自己的開場資訊。")}
      <div class="identity-overlay">
        <section class="identity-lightbox good criminal-opening-lightbox" role="dialog" aria-modal="true" aria-label="開場資訊">
          <header class="identity-header">
            <span class="role-icon good">${hasFirstDiscoverer ? cardIcon("first_discoverer") : cardIcon("boy")}</span>
            <div>
              <p class="eyebrow">Criminal Dance</p>
              <h2>開場發動能力</h2>
              <p>${hasFirstDiscoverer ? "第一發現者必須先打出。" : "這些資訊只顯示給你。"}</p>
            </div>
          </header>
          <div class="identity-clues">
            ${clues.map((clue) => `
              <section class="identity-clue neutral">
                <div class="identity-clue-heading">
                  <h3>${escapeHtml(clue.title)}</h3>
                  <p>${renderSeatBadges(clue.message)}</p>
                </div>
              </section>
            `).join("")}
          </div>
          <footer class="identity-footer">
            <span>${hasFirstDiscoverer ? "按下確認會立即打出第一發現者。" : "確認後回到遊戲主畫面。"}</span>
            <button class="primary-button" ${hasFirstDiscoverer ? "data-play-first-discoverer" : "data-confirm-opening-info"} type="button">
              ${hasFirstDiscoverer ? "打出第一發現者" : "我已記住"}
            </button>
          </footer>
        </section>
      </div>
    `;
  }

  function renderHandControls() {
    const isTurn = snapshot.room.phase === "playing" && snapshot.room.currentPlayerId === snapshot.you.id;
    return SharedRoomUI.handPanel({
      title: "你的手牌",
      gridClassName: "criminal-hand",
      items: snapshot.you.hand,
      renderItem: (card, index) => {
        const playableNow = isTurn && isPlayable(card.id);
        return `
          <button class="${SharedRoomUI.cardStateClasses({
            className: "criminal-card",
            selected: selectedCardIndex === index,
            disabled: !playableNow
          })}" data-card="${card.id}" data-card-index="${index}" type="button" ${playableNow ? "" : "disabled"}>
            <strong><span class="criminal-card-icon" aria-hidden="true">${escapeHtml(cardIcon(card.id))}</span>${escapeHtml(card.name)}</strong>
            <small>${escapeHtml(cardDescription(card.id, isTurn))}</small>
          </button>
        `;
      },
      footer: selectedCard ? renderSelectedCardControls() : ""
    });
  }

  function renderSelectedCardControls() {
    const tradeGiveOptions = snapshot.you.hand
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => card.id !== "trade");
    const tradeHasGiveOptions = selectedCard === "trade" && tradeGiveOptions.length > 0;
    const needsTarget = ["detective", "witness", "dog", "inspector"].includes(selectedCard) || tradeHasGiveOptions;
    const needsGive = tradeHasGiveOptions;
    return `
      <div class="criminal-action-panel">
        ${selectedCard === "trade" && !tradeGiveOptions.length ? `
          <div class="notice">
            你沒有可交換的其他手牌。交易可以打出，但不會產生效果。
          </div>` : ""}
        ${needsTarget ? `
          <div class="criminal-action-group">
            <h3>指定玩家</h3>
            <div class="criminal-choice-grid">
              ${snapshot.room.players.filter((player) => player.id !== snapshot.you.id).map((player) => `
                <button class="criminal-card ${selectedTargetId === player.id ? "selected" : ""}" data-target="${player.id}" type="button" ${targetDisabled(player) ? "disabled" : ""}>
                  <strong>${SharedRoomUI.seatNumber(player.index, "criminal-seat-number")} ${escapeHtml(player.name)}</strong>
                  <small>${player.handCount} 張手牌</small>
                </button>
              `).join("")}
            </div>
          </div>` : ""}
        ${needsGive ? `
          <div class="criminal-action-group">
            <h3>選擇要交換的手牌</h3>
            <div class="criminal-choice-grid">
              ${tradeGiveOptions.map(({ card, index }) => `
                <button class="criminal-card ${selectedGiveCardIndex === index ? "selected" : ""}" data-give-card="${card.id}" data-give-card-index="${index}" type="button">
                  <strong>${escapeHtml(card.name)}</strong>
                </button>
              `).join("")}
            </div>
          </div>` : ""}
        <div class="criminal-action-row template-game-action-row">
          <button class="primary-button" data-play-selected type="button" ${canConfirmSelected() ? "" : "disabled"}>打出 ${cardName(selectedCard)}</button>
          <button class="ghost-button" data-clear-selection type="button">取消</button>
        </div>
      </div>
    `;
  }

  function renderPendingAction(pending) {
    if (pending.type === "rumorDraw") {
      return `
        <section class="criminal-action-panel template-game-hand-panel criminal-turn-action">
          <div class="notice">
            <strong>謠言輪到你抽牌。</strong>
            <p>請逆時針從 ${renderSeatBadges(playerLabelById(pending.sourceId))} 抽一張牌。抽到的牌會先放在桌前，所有人完成後才加入手牌。</p>
          </div>
          <div class="criminal-action-row template-game-action-row">
            <button class="primary-button" data-rumor-draw type="button">抽一張牌</button>
          </div>
        </section>
      `;
    }
    if (pending.type === "dogDiscard") {
      return renderCardSelection("神犬指定你棄一張牌", "dogDiscard", snapshot.you.hand, true);
    }
    if (pending.type === "informationExchange") {
      return renderCardSelection(`情報交換：選一張效果開始時的手牌，順時針給 ${pending.targetId ? playerLabelById(pending.targetId) : pending.targetName || "左邊玩家"}`, "informationExchangeSelect", pending.cards.map((id) => ({ id, name: cardName(id) })), true);
    }
    if (pending.type === "trade") {
      return renderCardSelection("交易：選一張手牌與對方交換", "tradeSelect", snapshot.you.hand, true);
    }
    return `<div class="notice">等待其他玩家操作。</div>`;
  }

  function renderPublicPendingAction(pending) {
    if (pending?.type === "detectiveResult") {
      const actorName = playerLabelById(pending.actorId);
      const targetName = playerLabelById(pending.targetId);
      const isActor = pending.actorId === snapshot.you.id;
      return `
        <section class="criminal-action-panel">
          <div class="notice">
            <strong>${pending.caught ? "偵探查到犯人！" : "偵探沒有查到犯人。"}</strong>
          <p>${renderSeatBadges(actorName)} 指定了 ${renderSeatBadges(targetName)}。${pending.caught ? "本局即將結束。" : "遊戲將繼續。"}</p>
          </div>
          ${isActor
            ? `<div class="criminal-action-row template-game-action-row"><button class="primary-button" data-confirm-detective-result type="button">${pending.caught ? "進入本局結算" : "繼續遊戲"}</button></div>`
            : `<div class="notice">等待 ${renderSeatBadges(actorName)} 確認偵探結果。</div>`}
        </section>
      `;
    }
    if (pending?.type !== "rumor") return "";
    const actorName = playerLabelById(pending.actorId);
    const confirmedCount = pending.confirmedCount ?? pending.completedCount ?? 0;
    return `
      <section class="criminal-action-panel">
        <div class="notice">
          <strong>${renderSeatBadges(actorName)} 打出的謠言正在發動。</strong>
          <p>由 ${renderSeatBadges(actorName)} 開始，依座位順時針執行；每位玩家逆時針從右手邊玩家抽一張牌，全部完成後才加入手牌。</p>
          <p>等待所有玩家確認抽牌，進度 ${confirmedCount} / ${pending.totalCount}。</p>
        </div>
        <div class="notice">還沒確認的玩家會看到「現在換你」提示。</div>
      </section>
    `;
  }

  function renderCardSelection(title, action, cards, highlightTurn = false) {
    return SharedRoomUI.handPanel({
      titleHtml: renderSeatBadges(title),
      className: "criminal-action-panel",
      stateClassName: highlightTurn ? "criminal-turn-action" : "",
      gridClassName: "criminal-hand",
      items: cards,
      renderItem: (card, index) => `
        <button class="${SharedRoomUI.cardStateClasses({
          className: "criminal-card",
          selected: selectedPendingAction === action && selectedPendingCardIndex === index
        })}" data-pending-action="${action}" data-pending-card="${card.id}" data-pending-card-index="${index}" type="button">
          <strong>${escapeHtml(card.name)}</strong>
        </button>
      `,
      footer: `
        <div class="criminal-action-row template-game-action-row">
          <button class="primary-button" data-confirm-pending-card type="button" ${selectedPendingAction === action && selectedPendingCard ? "" : "disabled"}>確認選擇</button>
        </div>
      `
    });
  }

  function renderRoundResult() {
    const result = snapshot.room.roundResult;
    page.mainPanel.innerHTML = `
      ${phaseHeader("本局結算", resultTitle(result.type))}
      <section class="criminal-table template-game-main-table criminal-result-table">
        ${SharedRoomUI.playerMatrix({ players: snapshot.room.players, renderSeat, className: "criminal-seat-grid" })}
      </section>
      <div class="criminal-score-grid">
        ${snapshot.room.players.map((player) => `
          <div class="criminal-result-row">
            <span>${escapeHtml(player.name)}</span>
            <strong>+${result.roundScores[player.id] || 0} / ${player.score} 分</strong>
          </div>
        `).join("")}
      </div>
      ${snapshot.you.isHost ? `<div class="result-action-row"><button class="primary-button" data-next-round type="button">開始下一局</button></div>` : `<div class="notice">等待房主開始下一局。</div>`}
    `;
  }

  function renderMatchResult() {
    const result = snapshot.room.matchResult;
    page.mainPanel.innerHTML = `
      ${phaseHeader("整場結束", `勝利者：${result.winners.map((player) => player.name).join("、")}`)}
      <section class="criminal-table template-game-main-table criminal-result-table">
        ${SharedRoomUI.playerMatrix({ players: snapshot.room.players, renderSeat, className: "criminal-seat-grid" })}
      </section>
      <div class="criminal-score-grid">
        ${snapshot.room.players.map((player) => `
          <div class="criminal-result-row">
            <span>${escapeHtml(player.name)}</span>
            <strong>${player.score} 分</strong>
          </div>
        `).join("")}
      </div>
      ${snapshot.you.isHost ? `<div class="result-action-row"><button class="danger-button" data-reset-match type="button">返回大廳</button></div>` : ""}
    `;
  }

  function handleMainClick(event) {
    const roll = event.target.closest("[data-criminal-roll]");
    if (roll) return sendAction("roll");
    const ready = event.target.closest("[data-criminal-ready]");
    if (ready) return sendAction("toggleReady");
    const start = event.target.closest("[data-criminal-start]");
    if (start) return sendAction("startGame");
    if (event.target.closest("[data-confirm-opening-info]")) return sendAction("confirmOpeningInfo");
    if (event.target.closest("[data-play-first-discoverer]")) return sendAction("playCard", { card: "first_discoverer" });
    if (event.target.closest("[data-rumor-draw]")) return sendAction("rumorDraw");
    if (event.target.closest("[data-confirm-detective-result]")) return sendAction("confirmDetectiveResult");
    const card = event.target.closest("[data-card]");
    if (card) {
      selectedCard = card.dataset.card;
      selectedCardIndex = Number(card.dataset.cardIndex);
      selectedTargetId = null;
      selectedGiveCard = null;
      selectedGiveCardIndex = null;
      renderMain();
      return;
    }
    const target = event.target.closest("[data-target]");
    if (target) {
      selectedTargetId = target.dataset.target;
      renderMain();
      return;
    }
    const give = event.target.closest("[data-give-card]");
    if (give) {
      selectedGiveCard = give.dataset.giveCard;
      selectedGiveCardIndex = Number(give.dataset.giveCardIndex);
      renderMain();
      return;
    }
    if (event.target.closest("[data-clear-selection]")) {
      clearSelection();
      renderMain();
      return;
    }
    if (event.target.closest("[data-play-selected]")) {
      const payload = { card: selectedCard };
      if (selectedTargetId) payload.targetId = selectedTargetId;
      if (selectedGiveCard) payload.giveCard = selectedGiveCard;
      clearSelection();
      sendAction("playCard", payload);
      return;
    }
    const pending = event.target.closest("[data-pending-action]");
    if (pending) {
      selectedPendingAction = pending.dataset.pendingAction;
      selectedPendingCard = pending.dataset.pendingCard;
      selectedPendingCardIndex = Number(pending.dataset.pendingCardIndex);
      renderMain();
      return;
    }
    if (event.target.closest("[data-confirm-pending-card]")) {
      if (selectedPendingAction && selectedPendingCard) {
        sendAction(selectedPendingAction, { card: selectedPendingCard });
        clearPendingSelection();
      }
      return;
    }
    if (event.target.closest("[data-next-round]")) return sendAction("nextRound");
    if (event.target.closest("[data-reset-match]")) return sendAction("resetMatch");
  }

  function handleMainChange(event) {
    const playerCount = event.target.closest("[data-criminal-player-count]");
    if (playerCount) {
      sendSettings({ playerCount: Number(playerCount.value) });
      return;
    }
    const expansion = event.target.closest("[data-criminal-expansion]");
    if (expansion) {
      sendSettings({
        expansions: {
          ...snapshot.room.settings.expansions,
          [expansion.dataset.criminalExpansion]: expansion.checked
        }
      });
    }
  }

  function sendSettings(partial) {
    sendAction("updateSettings", {
      playerCount: partial.playerCount || snapshot.room.settings.playerCount,
      expansions: partial.expansions || snapshot.room.settings.expansions
    });
  }

  function syncInfoUnread(chatScrollState) {
    const room = snapshot.room;
    const chat = room.chat || [];
    if (infoRoomCode !== room.code) {
      infoRoomCode = room.code;
      lastObservedChatId = chat.at(-1)?.id || null;
      unreadChatCount = 0;
      lastPlayerJoinSerial = SharedRoomClient.latestJoinSerial(room.playerJoinEvents || []);
      unreadRosterCount = 0;
      activeInfoTab = "chat";
      return;
    }
    const chatUpdate = SharedRoomUI.updateChatUnread({
      entries: chat,
      lastObservedId: lastObservedChatId,
      viewerId: snapshot.you.id,
      chatActive: activeInfoTab === "chat",
      chatAtBottom: chatScrollState?.atBottom ?? true,
      currentCount: unreadChatCount
    });
    unreadChatCount = chatUpdate.count;
    lastObservedChatId = chatUpdate.lastObservedId;
    const joinUpdate = SharedRoomClient.unreadPlayerJoins(
      room.playerJoinEvents || [],
      lastPlayerJoinSerial,
      snapshot.you.id,
      activeInfoTab === "roster"
    );
    unreadRosterCount += joinUpdate.count;
    lastPlayerJoinSerial = joinUpdate.lastSerial;
    if (activeInfoTab === "roster") unreadRosterCount = 0;
  }

  function renderInfoTabs() {
    const isLobby = snapshot?.room.phase === "lobby";
    if (isLobby && activeInfoTab === "log") activeInfoTab = "chat";
    page.infoTabs.querySelectorAll("[data-info-tab]").forEach((button) => {
      const unavailable = isLobby && button.classList.contains("game-only-tab");
      button.classList.toggle("hidden", unavailable);
      button.classList.toggle("active", button.dataset.infoTab === activeInfoTab);
    });
    document.querySelectorAll("[data-info-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.infoPanel === activeInfoTab);
    });
    page.chatUnread.textContent = String(unreadChatCount);
    page.chatUnread.classList.toggle("hidden", unreadChatCount === 0);
    page.rosterUnread.textContent = String(unreadRosterCount);
    page.rosterUnread.classList.toggle("hidden", unreadRosterCount === 0);
  }

  function validateLobbyClient() {
    const messages = [];
    if (snapshot.room.players.length !== snapshot.room.settings.playerCount) {
      messages.push(`需要 ${snapshot.room.settings.playerCount} 位玩家，目前 ${snapshot.room.players.length} 位。`);
    }
    if (snapshot.room.players.some((player) => !player.roll)) messages.push("所有玩家都需要先擲 d100。");
    if (snapshot.room.players.some((player) => !player.ready)) messages.push("所有玩家都需要準備。");
    return messages;
  }

  function deckPlan(settings) {
    const counts = { ...BASE_COUNTS };
    if (settings.expansions?.inspector) {
      counts.dog -= 1;
      counts.inspector = 1;
    }
    if (settings.expansions?.boy) {
      counts.witness -= 1;
      counts.boy = 1;
    }
    const playerCount = Number(settings.playerCount);
    if (playerCount === 8) {
      return {
        playerCount,
        fullDeck: true,
        requiredCounts: counts,
        poolCounts: {},
        poolDrawCount: 0,
        totalCards: 32
      };
    }
    const required = REQUIRED[playerCount] || REQUIRED[4];
    const poolCounts = { ...counts };
    Object.entries(required).forEach(([card, count]) => { poolCounts[card] -= count; });
    const requiredTotal = countCards(required);
    return {
      playerCount,
      fullDeck: false,
      requiredCounts: required,
      poolCounts,
      poolDrawCount: playerCount * 4 - requiredTotal,
      totalCards: playerCount * 4
    };
  }

  function deckPreview(settings, { detailedPool }) {
    const plan = deckPlan(settings);
    if (plan.fullDeck) {
      return `
        <section class="criminal-deck-section">
          <div class="criminal-deck-section-head">
            <h3>必要卡牌</h3>
            <span>全部 ${plan.totalCards} 張</span>
          </div>
          ${roleCardsFromCounts(plan.requiredCounts)}
        </section>
        <section class="criminal-deck-section">
          <div class="criminal-deck-section-head">
            <h3>隨機卡池</h3>
            <span>0 張</span>
          </div>
          ${summaryCard("無隨機補牌", "8 人局使用替換後的全部牌庫，直接洗牌發牌。", 0, "neutral-team")}
        </section>
      `;
    }
    return `
      <section class="criminal-deck-section">
        <div class="criminal-deck-section-head">
          <h3>必要卡牌</h3>
          <span>${countCards(plan.requiredCounts)} 張固定加入</span>
        </div>
        ${roleCardsFromCounts(plan.requiredCounts)}
      </section>
      <section class="criminal-deck-section">
        <div class="criminal-deck-section-head">
          <h3>隨機卡池</h3>
          <span>從卡池抽 ${plan.poolDrawCount} 張</span>
        </div>
        ${detailedPool
          ? roleCardsFromCounts(plan.poolCounts)
          : summaryCard("其餘卡牌", `從替換後的隨機卡池抽 ${plan.poolDrawCount} 張；遊戲開始時才洗牌抽出。`, plan.poolDrawCount, "neutral-team")}
      </section>
    `;
  }

  function roleCardsFromCounts(counts) {
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .sort(([left], [right]) => cardSortIndex(left) - cardSortIndex(right) || cardName(left).localeCompare(cardName(right), "zh-Hant"))
      .map(([card, count]) => `
        <article class="criminal-role-card ${roleCardClass(card)}">
          <div>
            <strong>${cardName(card)}</strong>
            ${roleLabel(card) ? `<span>${roleLabel(card)}</span>` : ""}
          </div>
          <output>× ${count}</output>
        </article>
      `)
      .join("");
  }

  function summaryCard(title, description, count, tone) {
    return `
      <article class="criminal-role-card ${tone}">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(description)}</span>
        </div>
        <output>× ${count}</output>
      </article>
    `;
  }

  function roleCardClass(card) {
    if (card === "culprit" || card === "accomplice") return "culprit-team";
    return "civilian-team";
  }

  function cardSortIndex(card) {
    const index = CARD_ORDER.indexOf(card);
    return index >= 0 ? index : CARD_ORDER.length;
  }

  function countCards(counts) {
    return Object.values(counts).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
  }

  function roleLabel(card) {
    return card === "culprit" || card === "accomplice" ? "犯人陣營" : "";
  }

  function isPlayable(card) {
    return playableCardState(card)?.playable;
  }

  function playableCardState(card) {
    return snapshot.you.playableCards.find((item) => item.id === card);
  }

  function cardDescription(card, isTurn) {
    const state = playableCardState(card);
    return isTurn && state?.playable === false && state.reason ? state.reason : cardHelp(card);
  }

  function targetDisabled(player) {
    return ["dog", "trade"].includes(selectedCard) && player.handCount <= 0;
  }

  function canConfirmSelected() {
    if (!selectedCard) return false;
    if (["detective", "witness", "dog", "inspector"].includes(selectedCard)) return Boolean(selectedTargetId);
    if (selectedCard === "trade") {
      const hasGiveOptions = snapshot.you.hand.some((card) => card.id !== "trade");
      return hasGiveOptions ? Boolean(selectedTargetId && selectedGiveCard) : true;
    }
    return true;
  }

  function clearSelection() {
    selectedCard = null;
    selectedCardIndex = null;
    selectedTargetId = null;
    selectedGiveCard = null;
    selectedGiveCardIndex = null;
  }

  function clearPendingSelection() {
    selectedPendingAction = null;
    selectedPendingCard = null;
    selectedPendingCardIndex = null;
  }

  function cardHelp(card) {
    return {
      first_discoverer: "第一回合必出",
      culprit: "最後一張時可逃脫",
      alibi: "保護犯人躲過偵探",
      accomplice: "打出後加入犯人陣營",
      detective: "3 張以下可查人",
      witness: "查看一位玩家手牌",
      ordinary: "無效果",
      dog: "指定玩家自己棄牌",
      information_exchange: "全員同時向左傳牌",
      rumor: "由打出者開始向右抽牌",
      trade: "與指定玩家秘密交換",
      inspector: "3 張以下可放到玩家面前",
      boy: "開局得知初始犯人"
    }[card] || "";
  }

  function currentPlayer() {
    return snapshot.room.players.find((player) => player.id === snapshot.you.id);
  }

  function mainSubtitle() {
    if (snapshot.room.phase === "pendingDogDiscard") return "等待被神犬指定的玩家棄牌。";
    if (snapshot.room.phase === "pendingDetectiveResult") return "偵探結果公開中，等待確認。";
    if (snapshot.room.phase === "pendingInformationExchange") return "等待所有有手牌的玩家選牌。";
    if (snapshot.room.phase === "pendingRumor") return "謠言正在發動，等待確認後依座位順時針抽牌。";
    if (snapshot.room.phase === "pendingTrade") return "等待交易對象選牌。";
    return snapshot.room.currentPlayerId === snapshot.you.id ? "輪到你出牌。" : `等待 ${nameById(snapshot.room.currentPlayerId)} 出牌。`;
  }

  function phaseLabel(phase) {
    return {
      lobby: "大廳",
      playing: "出牌",
      pendingDetectiveResult: "偵探結果",
      pendingDogDiscard: "神犬",
      pendingInformationExchange: "情報交換",
      pendingRumor: "謠言",
      pendingTrade: "交易",
      roundResult: "本局結算",
      matchResult: "整場結束"
    }[phase] || phase;
  }

  function resultTitle(type) {
    return {
      culprit: "犯人逃脫成功",
      detective: "偵探抓到犯人",
      dog: "神犬抓到犯人",
      inspector: "警部抓到犯人"
    }[type] || "本局結束";
  }

  function cardName(card) {
    return CARD_NAMES[card] || card;
  }

  function cardIcon(card) {
    return CARD_ICONS[card] || "□";
  }

  function nameById(playerId) {
    return snapshot.room.players.find((player) => player.id === playerId)?.name || "未知玩家";
  }

  function playerById(playerId) {
    return snapshot.room.players.find((player) => player.id === playerId) || null;
  }

  function playerLabelById(playerId) {
    const player = playerById(playerId);
    return player ? `#${player.index + 1} ${player.name}` : "未知玩家";
  }

  function renderSeatBadges(value) {
    return escapeHtml(value).replace(/#([1-8])(\s+)?/g, (_, number, trailingSpace) => (
      `${SharedRoomUI.seatNumber(Number(number) - 1, "criminal-seat-number")}${trailingSpace ? "&nbsp;" : ""}`
    ));
  }

  function renderTurnBadge() {
    return `
      <div class="criminal-turn-badge template-game-turn-badge" role="status" aria-live="polite">
        <span class="criminal-turn-pulse template-game-turn-pulse" aria-hidden="true"></span>
        <strong>現在換你</strong>
      </div>
    `;
  }

  function phaseHeader(title, subtitle) {
    return `<div class="phase-header"><div><p class="eyebrow">${phaseLabel(snapshot.room.phase)}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div></div>`;
  }

  function statusCard(label, value) {
    return `<div class="status-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  async function copyInvite() {
    const url = `${location.origin}/CriminalDance/?room=${snapshot.room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("邀請連結已複製。");
    } catch {
      prompt("複製邀請連結", url);
    }
  }

  function openRules() {
    page.rulesOverlay.classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function closeRules() {
    page.rulesOverlay.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  function sendAction(action, payload = {}) {
    if (!hasControl) {
      SharedRoomUI.showControlLock(takeControl);
      return;
    }
    actionSequence += 1;
    sendRaw(SharedRoomClient.createActionRequest({
      action,
      payload,
      roomVersion: snapshot?.room?.version || lastVersion,
      clientId: CLIENT_INSTANCE_ID,
      sequence: actionSequence
    }));
  }

  function takeControl() {
    const target = selectedSession || findRoomSession(roomFromUrl());
    if (!target?.roomCode || !target?.playerId) return;
    sendRaw({ type: "takeControl", roomCode: target.roomCode, playerId: target.playerId });
  }

  function requestSync() {
    sendRaw({ type: "sync", version: lastVersion });
  }

  function sendRaw(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  function setConnection(text) {
    page.connection.textContent = text;
  }

  function showToast(message) {
    SharedRoomUI.showToast(message);
  }

  function parseRoomCode(value) {
    return SharedRoomClient.parseRoomCode(value, location.href);
  }

  function roomFromUrl() {
    return parseRoomCode(new URLSearchParams(location.search).get("room"));
  }

  function sessionStore() {
    return SharedRoomClient.normalizeSessionStore(localStorage.getItem(STORAGE_KEY));
  }

  function saveSession(session) {
    const store = SharedRoomClient.saveSession(sessionStore(), session);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    renderRecentSessions();
  }

  function readSelectedSession() {
    const store = sessionStore();
    const tabPlayerId = sessionStorage.getItem(TAB_KEY);
    return SharedRoomClient.selectSession(store, {
      roomCode: roomFromUrl(),
      playerId: tabPlayerId
    });
  }

  function findRoomSession(roomCode) {
    if (!roomCode) return null;
    const tabPlayerId = sessionStorage.getItem(TAB_KEY);
    const name = page.nameInput.value.trim();
    const store = sessionStore();
    const sessions = SharedRoomClient.listSessions(store);
    const normalizedRoom = roomCode.toUpperCase();
    const normalizedName = name.toLocaleLowerCase();
    const namedSession = name
      ? sessions.find((session) => (
        session.roomCode.toUpperCase() === normalizedRoom
        && String(session.name || "").toLocaleLowerCase() === normalizedName
      ))
      : null;
    return namedSession
      || SharedRoomClient.selectSession(store, { roomCode, playerId: tabPlayerId })
      || sessions.find((session) => session.roomCode === roomCode)
      || null;
  }

  function syncRejoin() {
    const roomCode = parseRoomCode(page.roomInput.value) || roomFromUrl();
    const saved = findRoomSession(roomCode);
    page.rejoinButton.classList.toggle("hidden", !saved);
    if (saved) page.rejoinButton.textContent = `以 ${saved.name || "原玩家"} 重新連線`;
  }

  function renderRecentSessions() {
    const recent = SharedRoomClient.listSessions(sessionStore()).slice(0, 4);
    page.recentSessions.classList.toggle("hidden", recent.length === 0);
    page.recentSessionList.innerHTML = recent.map((item) => `
      <button class="recent-session-button" data-criminal-recent-player="${escapeHtml(item.playerId)}" type="button">
        <span class="recent-session-game">${escapeHtml(SharedRoomClient.gameLabel(item.game || "criminaldance"))}</span>
        <span class="recent-session-details">
          <strong>${escapeHtml(item.name || "原玩家")}</strong>
          <small>房間 ${escapeHtml(item.roomCode)}</small>
        </span>
        <span>重新連線</span>
      </button>
    `).join("");
  }

  function clearInvalidSession(message) {
    if (![SharedRoomClient.SESSION_ERROR_CODES.roomNotFound, SharedRoomClient.SESSION_ERROR_CODES.playerNotFound].includes(message.code)) return;
    const nextStore = SharedRoomClient.clearInvalidSession(sessionStore(), {
      errorCode: message.code,
      roomCode: selectedSession?.roomCode || parseRoomCode(page.roomInput.value),
      playerId: selectedSession?.playerId || sessionStorage.getItem(TAB_KEY) || ""
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore));
    selectedSession = null;
    sessionStorage.removeItem(TAB_KEY);
    renderRecentSessions();
    syncRejoin();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  global.CriminalDance = { parseRoomCode };
}(window));
