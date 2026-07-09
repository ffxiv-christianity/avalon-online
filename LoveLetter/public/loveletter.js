(function initializeLoveLetter(global) {
  "use strict";

  const STORAGE_KEY = "loveletter-sessions";
  const TAB_KEY = "loveletter-tab-player";
  const CLIENT_INSTANCE_ID = crypto.randomUUID();
  const DEFAULT_TARGET_SCORES = { 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 };
  const CARD_NAMES = {
    spy: "間諜",
    guard: "衛兵",
    priest: "神父",
    baron: "男爵",
    handmaid: "侍女",
    prince: "王子",
    chancellor: "大臣",
    king: "國王",
    countess: "伯爵夫人",
    princess: "公主"
  };
  const CARD_HELP = {
    spy: "結算時可能額外得分。",
    guard: "猜中指定玩家手牌則對方出局。",
    priest: "私下查看指定玩家手牌。",
    baron: "私下比手牌，低者出局。",
    handmaid: "保護自己到下次回合。",
    prince: "指定玩家棄牌並抽牌。",
    chancellor: "抽最多 2 張，保留 1 張。",
    king: "與指定玩家交換手牌。",
    countess: "與國王或王子同手時必出。",
    princess: "打出或棄掉即出局。"
  };
  const CARD_VALUES = {
    spy: 0,
    guard: 1,
    priest: 2,
    baron: 3,
    handmaid: 4,
    prince: 5,
    chancellor: 6,
    king: 7,
    countess: 8,
    princess: 9
  };
  const CARD_COUNTS = {
    spy: 2,
    guard: 6,
    priest: 2,
    baron: 2,
    handmaid: 2,
    prince: 2,
    chancellor: 2,
    king: 1,
    countess: 1,
    princess: 1
  };
  const CARD_ORDER = ["spy", "guard", "priest", "baron", "handmaid", "prince", "chancellor", "king", "countess", "princess"];

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
  let selectedCardId = null;
  let selectedTargetId = null;
  let selectedGuessCardId = null;
  let chancellorKeepId = null;
  let chancellorBottomIds = [];

  const page = {};

  window.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    page.mode = document.getElementById("gameModeSelect");
    page.joinView = document.getElementById("joinView");
    page.roomView = document.getElementById("loveLetterRoomView");
    page.lobbyTemplate = document.getElementById("loveLetterLobbyTemplate");
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

    bindEvents();
    const queryRoom = roomFromUrl();
    if (queryRoom) page.roomInput.value = queryRoom;
    if (selectedSession?.name) page.nameInput.value = selectedSession.name;
    renderRecentSessions();
    syncRejoin();
    connect();
  }

  function connect() {
    socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/loveletter`);
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
          game: "loveletter",
          lastUsedAt: Date.now()
        };
        saveSession(selectedSession);
        sessionStorage.setItem(TAB_KEY, message.playerId);
        history.replaceState({ game: "loveletter" }, "", SharedRoomClient.roomUrlPath("/LoveLetter/", message.roomCode));
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
      const name = page.nameInput.value.trim();
      if (!name) return showToast("請先輸入名字。");
      sendRaw({ type: "createRoom", name });
    });
    page.joinForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = page.nameInput.value.trim();
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
      const button = event.target.closest("[data-love-recent-player]");
      if (!button) return;
      const saved = sessionStore().sessions[button.dataset.loveRecentPlayer];
      if (!saved) return;
      page.nameInput.value = saved.name || "";
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
    renderMain();
  }

  function renderStatus() {
    const room = snapshot.room;
    const host = room.players.find((player) => player.id === room.hostId);
    const current = room.players.find((player) => player.id === room.currentPlayerId);
    const highScore = Math.max(0, ...room.players.map((player) => player.score || 0));
    page.statusStrip.innerHTML = [
      statusCard("階段", phaseLabel(room.phase)),
      statusCard("目前玩家", current?.name || "未開始"),
      statusCard("房主", host?.name || "未指定"),
      statusCard("芳心", scoreHeartsText(highScore))
    ].join("");
    page.mobileStatusSummary.innerHTML = SharedRoomUI.mobileStatusSummary([
      { label: "階段", value: phaseLabel(room.phase) },
      { label: "玩家", value: current?.name || "未開始" },
      { label: "芳心", value: scoreHeartsText(highScore) }
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
            ${player.roll ? `d100: ${player.roll}` : "未擲骰"}${player.ready ? " · 已準備" : ""} · ${player.online ? "在線" : "離線"}${rosterScoreHearts(player)}
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
    page.roleList.innerHTML = deckPreview();
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
    page.mainPanel.classList.remove("love-main-your-turn");
    if (snapshot.room.phase === "lobby") return renderLobby();
    if (snapshot.room.phase === "roundResult") return renderRoundResult();
    if (snapshot.room.phase === "matchResult") return renderMatchResult();
    return renderPlaying();
  }

  function renderLobby() {
    const fragment = page.lobbyTemplate.content.cloneNode(true);
    fragment.querySelector("[data-template-slot='phase-header']").innerHTML = phaseHeader("大廳", "設定人數與目標分數，擲 d100 並準備。");
    fragment.querySelector("[data-love-lobby-player-name]").textContent = snapshot.you.name;
    fragment.querySelector("[data-love-lobby-roll-status]").textContent = currentPlayer()?.roll
      ? `d100: ${currentPlayer().roll}`
      : "尚未擲骰";
    const readyButton = fragment.querySelector("[data-love-ready]");
    readyButton.textContent = currentPlayer()?.ready ? "取消準備" : "準備";
    readyButton.disabled = !currentPlayer()?.roll;
    const rollButton = fragment.querySelector("[data-love-roll]");
    rollButton.disabled = Boolean(currentPlayer()?.roll);
    const playerCount = fragment.querySelector("[data-love-player-count]");
    playerCount.value = String(snapshot.room.settings.playerCount);
    playerCount.disabled = !snapshot.you.isHost;
    const targetScore = fragment.querySelector("[data-love-target-score]");
    targetScore.value = String(snapshot.room.settings.targetScore);
    targetScore.disabled = !snapshot.you.isHost;
    fragment.querySelector("[data-love-lobby-deck]").innerHTML = deckPreview();
    const validation = validateLobbyClient();
    fragment.querySelector("[data-love-lobby-validation]").innerHTML = validation.length
      ? validation.map((message) => `<div class="validation error">${escapeHtml(message)}</div>`).join("")
      : `<div class="validation ok">房間設定已完成，可以開始遊戲。</div>`;
    fragment.querySelector("[data-love-lobby-start-control]").innerHTML = snapshot.you.isHost
      ? `<button class="start-button" data-love-start type="button" ${validation.length ? "disabled" : ""}>開始遊戲</button>`
      : `<div class="notice">等待房主開始遊戲。</div>`;
    page.mainPanel.replaceChildren(fragment);
  }

  function renderPlaying() {
    const isYourTurn = snapshot.room.phase === "playing" && snapshot.room.currentPlayerId === snapshot.you.id;
    const pending = snapshot.you.pendingAction;
    page.mainPanel.classList.toggle("love-main-your-turn", Boolean(isYourTurn || pending));
    page.mainPanel.innerHTML = `
      ${isYourTurn || pending ? renderTurnBadge() : ""}
      ${phaseHeader(phaseLabel(snapshot.room.phase), mainSubtitle())}
      <section class="love-table template-game-main-table">
        ${renderTableZones()}
        ${SharedRoomUI.playerMatrix({ players: snapshot.room.players, renderSeat, className: "love-seat-grid" })}
        <div class="love-control-row template-game-control-row">
          ${pending ? renderChancellorPending(pending) : renderHandControls(isYourTurn)}
          ${renderActionInfo()}
        </div>
      </section>
    `;
  }

  function renderTableZones() {
    const publicBurns = snapshot.room.publicBurnCards || [];
    return `
      <section class="love-table-zones" aria-label="桌面牌區">
        <article class="love-zone-card">
          <span>抽牌堆</span>
          <strong>${snapshot.room.deckCount} 張</strong>
        </article>
        <article class="love-zone-card">
          <span>蓋牌</span>
          <strong>${snapshot.room.phase === "lobby" ? "未設置" : "1 張"}</strong>
        </article>
        <article class="love-zone-card love-zone-wide">
          <span>公開移除</span>
          <div class="love-played">
            ${publicBurns.length
              ? publicBurns.map((card) => `<span class="love-mini-card card-${card.id}">${cardNumberBadge(card.value)}<span>${escapeHtml(card.name)}</span></span>`).join("")
              : `<small>${snapshot.room.settings.playerCount === 2 ? "尚未設置" : "僅 2 人局使用"}</small>`}
          </div>
        </article>
      </section>
    `;
  }

  function renderSeat(player) {
    return `
      <article class="love-seat ${player.eliminated ? "is-eliminated" : ""} ${player.protected ? "is-protected" : ""}">
        <div class="love-seat-head">
          <div class="love-seat-title">
            ${SharedRoomUI.seatNumber(player.index, "love-seat-number")}
            <strong title="${escapeHtml(player.name)}">${escapeHtml(player.name)}</strong>
          </div>
          ${renderScoreHearts(player.score)}
        </div>
        <small>${player.handCount} 張手牌${player.eliminated ? " · 出局" : ""}${player.protected ? " · 受保護" : ""}</small>
        ${renderPile("棄牌堆", player.discardPile, "尚未棄牌")}
      </article>
    `;
  }

  function renderPile(label, cards, emptyText) {
    return `
      <div class="love-pile">
        <span>${escapeHtml(label)}</span>
        <div class="love-played">
          ${cards.length
            ? cards.map((card) => `<span class="love-mini-card card-${card.id}">${cardNumberBadge(card.value)}<span>${escapeHtml(card.name)}</span></span>`).join("")
            : `<small>${escapeHtml(emptyText)}</small>`}
        </div>
      </div>
    `;
  }

  function renderHandControls(isYourTurn) {
    if (currentPlayer()?.eliminated) return `<div class="notice">你已出局，等待本局結束。</div>`;
    const selected = selectedCard();
    return SharedRoomUI.handPanel({
      title: "你的手牌",
      className: "love-action-panel",
      gridClassName: "love-hand",
      items: snapshot.you.hand,
      renderItem: (card) => {
        const playableNow = isPlayableNow(card.uid, isYourTurn);
        return `
          <button class="${SharedRoomUI.cardStateClasses({
            className: `love-card card-${card.id}`,
            selected: selectedCardId === card.uid && isYourTurn,
            disabled: !playableNow
          })}" data-card-id="${escapeHtml(card.uid)}" type="button" ${playableNow ? "" : "disabled"}>
            ${renderHandCardFace(card, cardPlayable(card.uid) ? CARD_HELP[card.id] || "" : "伯爵夫人在手時不可打出")}
          </button>
        `;
      },
      footer: isYourTurn
        ? selected ? renderSelectedCardControls(selected) : `<p class="notice">選一張手牌後確認打出。</p>`
        : `<p class="notice">等待 ${escapeHtml(nameById(snapshot.room.currentPlayerId))} 出牌。你仍可查看自己的手牌。</p>`
    });
  }

  function renderSelectedCardControls(card) {
    const targets = targetIdsForCard(card.id).map((targetId) => playerById(targetId)).filter(Boolean);
    const guardWithoutTargets = card.id === "guard" && targets.length === 0;
    const needsTarget = ["guard", "priest", "baron", "prince", "king"].includes(card.id) && !guardWithoutTargets;
    const needsGuess = card.id === "guard" && !guardWithoutTargets;
    return `
      <div class="love-selected-panel">
        <h3>打出 ${escapeHtml(card.name)}</h3>
        ${guardWithoutTargets ? `<p class="notice">所有其他玩家都受保護，衛兵可以打出但無效果。</p>` : ""}
        ${needsTarget ? `
          <div class="love-target-grid">
            ${targets.length ? targets.map((player) => `
              <button class="secondary-button ${selectedTargetId === player.id ? "selected" : ""}" data-target-id="${escapeHtml(player.id)}" type="button">
                ${SharedRoomUI.seatNumber(player.index, "love-seat-number")}
                <span>${escapeHtml(player.name)}</span>
              </button>
            `).join("") : `<div class="notice">目前沒有合法目標。</div>`}
          </div>
        ` : ""}
        ${needsGuess ? `
          <div class="field">
            <span>猜測牌名</span>
            <div class="love-guess-grid">
              ${CARD_ORDER.filter((id) => id !== "guard").map((id) => `
                <button class="love-guess-card ${selectedGuessCardId === id ? "selected" : ""} card-${id}" data-guess-card-id="${id}" type="button">
                  ${cardNumberBadge(CARD_VALUES[id])}
                  <span>${CARD_NAMES[id]}</span>
                </button>
              `).join("")}
            </div>
          </div>
        ` : ""}
        <div class="button-row template-game-action-row">
          <button class="primary-button" data-play-selected type="button" ${canConfirmSelected(card) ? "" : "disabled"}>確認打出</button>
          <button class="ghost-button" data-clear-selection type="button">取消</button>
        </div>
      </div>
    `;
  }

  function renderChancellorPending(pending) {
    const cards = pending.cards || [];
    const keep = chancellorKeepId || cards[0]?.uid || "";
    if (!chancellorKeepId && keep) chancellorKeepId = keep;
    const bottomIds = cards.filter((card) => card.uid !== keep).map((card) => card.uid);
    if (!chancellorBottomIds.length) chancellorBottomIds = bottomIds;
    return SharedRoomUI.handPanel({
      title: "大臣：選擇保留一張",
      className: "love-action-panel",
      gridClassName: "love-hand",
      items: cards,
      renderItem: (card) => `
        <button class="${SharedRoomUI.cardStateClasses({
          className: `love-card card-${card.id}`,
          selected: chancellorKeepId === card.uid
        })}" data-chancellor-keep="${escapeHtml(card.uid)}" type="button">
          ${renderHandCardFace(card, `${CARD_HELP[card.id] || ""} ${chancellorKeepId === card.uid ? "保留" : "放回牌庫底"}`)}
        </button>
      `,
      footer: `
        <p class="notice">未保留的牌會依目前順序放回牌庫底。</p>
        <div class="button-row template-game-action-row">
          <button class="primary-button" data-confirm-chancellor type="button">確認選擇</button>
        </div>
      `
    });
  }

  function renderActionInfo() {
    return SharedRoomUI.actionInfoBlock({
      messages: snapshot.you.actionInfo?.messages || [],
      className: "love-action-info-block",
      bodyClassName: "love-private",
      renderMessage: renderSeatBadges
    });
  }

  function renderRoundResult() {
    page.mainPanel.innerHTML = `
      ${phaseHeader("本局結算", snapshot.room.roundResult?.reason || "本局結束。")}
      <section class="love-table template-game-main-table love-result-table">
        ${renderTableZones()}
        ${SharedRoomUI.playerMatrix({ players: snapshot.room.players, renderSeat, className: "love-seat-grid" })}
      </section>
      <section class="love-result">
        ${renderActionInfo()}
        <div class="love-score-grid">
          ${renderResultRows((player) => renderScoreHearts(player.score, { gain: snapshot.room.roundResult?.roundScores?.[player.id] || 0 }))}
        </div>
        ${snapshot.you.isHost ? `<div class="result-action-row"><button class="primary-button" data-next-round type="button">開始下一局</button></div>` : ""}
      </section>
    `;
  }

  function renderHandCardFace(card, helperText = "", { compact = false } = {}) {
    return `
      ${cardNumberBadge(card.value)}
      <strong>${escapeHtml(card.name)}</strong>
      ${compact ? "" : `<small>${escapeHtml(helperText)}</small>`}
    `;
  }

  function renderMatchResult() {
    const winners = snapshot.room.matchResult?.winners || [];
    page.mainPanel.innerHTML = `
      ${phaseHeader("整場結束", `勝利者：${winners.map((player) => player.name).join("、") || "未定"}`)}
      <section class="love-table template-game-main-table love-result-table">
        ${renderTableZones()}
        ${SharedRoomUI.playerMatrix({ players: snapshot.room.players, renderSeat, className: "love-seat-grid" })}
      </section>
      <section class="love-result">
        ${renderActionInfo()}
        <div class="love-score-grid">
          ${renderResultRows((player) => renderScoreHearts(player.score))}
        </div>
        ${snapshot.you.isHost ? `<div class="result-action-row"><button class="danger-button" data-reset-match type="button">返回大廳</button></div>` : ""}
      </section>
    `;
  }

  function renderResultRows(renderScore) {
    return SharedRoomUI.resultRows({
      players: snapshot.room.players,
      rowClassName: "love-result-row",
      playerClassName: "love-result-player",
      remainingClassName: "love-result-hand",
      scoreClassName: "love-result-score",
      renderScore,
      isWinner: (player) => Boolean(revealedHandByPlayerId(player.id)?.isWinner),
      getRemainingItems: (player) => revealedHandByPlayerId(player.id)?.cards || [],
      renderRemainingItem: (card) => `<span class="love-revealed-card card-${card.id}" title="${escapeHtml(card.name)}">${renderHandCardFace(card, "", { compact: true })}</span>`,
      emptyRemainingText: "無手牌",
      remainingLabel: "剩餘手牌"
    });
  }

  function revealedHandByPlayerId(playerId) {
    return (snapshot.room.roundResult?.revealedHands || []).find((entry) => entry.playerId === playerId) || null;
  }

  function handleMainClick(event) {
    if (event.target.closest("[data-love-roll]")) return sendAction("roll");
    if (event.target.closest("[data-love-ready]")) return sendAction("toggleReady");
    if (event.target.closest("[data-love-start]")) return sendAction("startGame");
    const card = event.target.closest("[data-card-id]");
    if (card) {
      selectedCardId = card.dataset.cardId;
      selectedTargetId = null;
      selectedGuessCardId = null;
      renderMain();
      return;
    }
    const target = event.target.closest("[data-target-id]");
    if (target) {
      selectedTargetId = target.dataset.targetId;
      renderMain();
      return;
    }
    const guess = event.target.closest("[data-guess-card-id]");
    if (guess) {
      selectedGuessCardId = guess.dataset.guessCardId;
      renderMain();
      return;
    }
    const keep = event.target.closest("[data-chancellor-keep]");
    if (keep) {
      chancellorKeepId = keep.dataset.chancellorKeep;
      chancellorBottomIds = (snapshot.you.pendingAction?.cards || [])
        .map((item) => item.uid)
        .filter((uid) => uid !== chancellorKeepId);
      renderMain();
      return;
    }
    if (event.target.closest("[data-clear-selection]")) {
      clearSelection();
      renderMain();
      return;
    }
    if (event.target.closest("[data-play-selected]")) {
      const cardToPlay = selectedCard();
      if (!cardToPlay) return;
      const payload = { cardId: cardToPlay.uid };
      if (selectedTargetId) payload.targetId = selectedTargetId;
      if (selectedGuessCardId) payload.guessCardId = selectedGuessCardId;
      clearSelection();
      sendAction("playCard", payload);
      return;
    }
    if (event.target.closest("[data-confirm-chancellor]")) {
      const pending = snapshot.you.pendingAction;
      if (!pending || !chancellorKeepId) return;
      sendAction("chooseChancellorKeep", {
        keepCardInstanceId: chancellorKeepId,
        bottomCardInstanceIds: (pending.cards || []).map((item) => item.uid).filter((uid) => uid !== chancellorKeepId)
      });
      chancellorKeepId = null;
      chancellorBottomIds = [];
      return;
    }
    if (event.target.closest("[data-next-round]")) return sendAction("nextRound");
    if (event.target.closest("[data-reset-match]")) return sendAction("resetMatch");
  }

  function handleMainChange(event) {
    const playerCount = event.target.closest("[data-love-player-count]");
    if (playerCount) {
      const count = Number(playerCount.value);
      sendSettings({ playerCount: count, targetScore: DEFAULT_TARGET_SCORES[count] });
      return;
    }
    const targetScore = event.target.closest("[data-love-target-score]");
    if (targetScore) {
      sendSettings({ targetScore: Number(targetScore.value) });
      return;
    }
  }

  function sendSettings(partial) {
    sendAction("updateSettings", {
      playerCount: partial.playerCount || snapshot.room.settings.playerCount,
      targetScore: partial.targetScore || snapshot.room.settings.targetScore
    });
  }

  function canConfirmSelected(card) {
    if (!card) return false;
    if (["priest", "baron", "prince", "king"].includes(card.id)) return Boolean(selectedTargetId);
    if (card.id === "guard") return targetIdsForCard("guard").length === 0 || Boolean(selectedTargetId && selectedGuessCardId);
    return true;
  }

  function targetIdsForCard(cardId) {
    return snapshot.you.legalTargets?.[cardId] || [];
  }

  function selectedCard() {
    return snapshot?.you?.hand?.find((card) => card.uid === selectedCardId) || null;
  }

  function cardPlayable(cardUid) {
    return snapshot.you.playableCards.find((card) => card.uid === cardUid)?.playable !== false;
  }

  function isPlayableNow(cardUid, isYourTurn) {
    return Boolean(isYourTurn && cardPlayable(cardUid));
  }

  function clearSelection() {
    selectedCardId = null;
    selectedTargetId = null;
    selectedGuessCardId = null;
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

  function deckPreview() {
    return CARD_ORDER.map((card) => `
      <article class="love-role-card card-${card}">
        <div>
          <strong class="love-numbered-label">${cardNumberBadge(CARD_VALUES[card])}<span class="love-card-name">${CARD_NAMES[card]}</span></strong>
          <span>${CARD_HELP[card]}</span>
        </div>
        <output>× ${CARD_COUNTS[card]}</output>
      </article>
    `).join("");
  }

  function currentPlayer() {
    return snapshot.room.players.find((player) => player.id === snapshot.you.id);
  }

  function playerById(playerId) {
    return snapshot.room.players.find((player) => player.id === playerId) || null;
  }

  function nameById(playerId) {
    return playerById(playerId)?.name || "未知玩家";
  }

  function renderSeatBadges(value) {
    return escapeHtml(value).replace(/#([1-8])(\s+)?/g, (_, number, trailingSpace) => (
      `${SharedRoomUI.seatNumber(Number(number) - 1, "love-seat-number")}${trailingSpace ? "&nbsp;" : ""}`
    ));
  }

  function scoreHeartsText(score) {
    const current = Number(score) || 0;
    const target = Number(snapshot.room.settings.targetScore) || 0;
    const hearts = "♥".repeat(current);
    return hearts ? `${hearts} ${current}/${target}` : `${current}/${target}`;
  }

  function renderScoreHearts(score, { gain = 0 } = {}) {
    const current = Number(score) || 0;
    const target = Number(snapshot.room.settings.targetScore) || 0;
    const hearts = "♥".repeat(current);
    const gainText = Number(gain) > 0 ? `<span class="love-score-gain">+${"♥".repeat(Number(gain))}</span>` : "";
    return `<span class="love-score-hearts">${gainText}<span class="love-score-heart-text">${escapeHtml(hearts)}</span><span class="love-score-count">${current}/${target}</span></span>`;
  }

  function rosterScoreHearts(player) {
    const hearts = "♥".repeat(Number(player.score) || 0);
    return hearts ? ` · <span class="love-score-hearts love-roster-score"><span class="love-score-heart-text">${escapeHtml(hearts)}</span></span>` : "";
  }

  function mainSubtitle() {
    if (snapshot.room.phase === "pendingChancellor") return "等待大臣選擇保留的牌。";
    return snapshot.room.currentPlayerId === snapshot.you.id ? "輪到你抽牌後出牌。" : `等待 ${nameById(snapshot.room.currentPlayerId)} 出牌。`;
  }

  function phaseLabel(phase) {
    return {
      lobby: "大廳",
      playing: "出牌",
      pendingChancellor: "大臣",
      roundResult: "本局結算",
      matchResult: "整場結束"
    }[phase] || phase;
  }

  function cardNumberBadge(value) {
    return `<span class="love-card-number">${escapeHtml(String(value))}</span>`;
  }

  function renderTurnBadge() {
    return `
      <div class="love-turn-badge template-game-turn-badge" role="status" aria-live="polite">
        <span class="love-turn-pulse template-game-turn-pulse" aria-hidden="true"></span>
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
    const url = `${location.origin}/LoveLetter/?room=${snapshot.room.code}`;
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
      <button class="recent-session-button" data-love-recent-player="${escapeHtml(item.playerId)}" type="button">
        <span class="recent-session-game">${escapeHtml(SharedRoomClient.gameLabel(item.game || "loveletter"))}</span>
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

  global.LoveLetter = { parseRoomCode };
}(window));
