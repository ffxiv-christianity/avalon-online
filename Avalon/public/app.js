const STORAGE_KEY = "avalon-online-sessions";
const LEGACY_STORAGE_KEY = "avalon-online-session";
const TAB_PLAYER_KEY = "avalon-online-tab-player";
const WAKING_TEXT = "請稍後";
const STALE_STATE_MS = 12000;
const CLIENT_INSTANCE_ID = crypto.randomUUID();

let socket = null;
let snapshot = null;
let hasControl = true;
let hadRoomConnection = false;
let actionSequence = 0;
let session = readSession();
let lastStateAt = 0;
let lastMessageAt = 0;
let lastVersion = 0;
let staleTimer = null;
let activeInfoTab = "chat";
let infoRoomCode = null;
let lastObservedChatId = null;
let unreadChatCount = 0;
let renderedChatRoomCode = null;
let lastRenderedChatId = null;
let lastPlayerJoinSerial = 0;
let unreadRosterCount = 0;
let resultCountdownTimer = null;
let revealedLakeResultKey = null;
let revealedExcaliburResultKey = null;
let pendingExcaliburChoice = null;
let pendingLakeTargetId = null;

const els = {
  connectionChip: document.getElementById("connectionChip"),
  openRulesButton: document.getElementById("openRulesButton"),
  closeRulesButton: document.getElementById("closeRulesButton"),
  rulesOverlay: document.getElementById("rulesOverlay"),
  joinView: document.getElementById("joinView"),
  roomView: document.getElementById("roomView"),
  joinForm: document.getElementById("joinForm"),
  changelog: document.getElementById("changelog"),
  nameInput: document.getElementById("nameInput"),
  roomInput: document.getElementById("roomInput"),
  recentSessions: document.getElementById("recentSessions"),
  recentSessionList: document.getElementById("recentSessionList"),
  createRoomButton: document.getElementById("createRoomButton"),
  rejoinRoomButton: document.getElementById("rejoinRoomButton"),
  statusStrip: document.getElementById("statusStrip"),
  mobileStatusSummary: document.getElementById("mobileStatusSummary"),
  roomCodes: document.querySelectorAll(".room-code-value"),
  copyLinkButtons: document.querySelectorAll("[data-copy-link]"),
  roster: document.getElementById("roster"),
  scoreboard: document.getElementById("scoreboard"),
  missionTable: document.getElementById("missionTable"),
  logList: document.getElementById("logList"),
  chatList: document.getElementById("chatList"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  infoTabs: document.getElementById("infoTabs"),
  chatUnread: document.getElementById("chatUnread"),
  rosterUnread: document.getElementById("rosterUnread"),
  mainPanel: document.getElementById("mainPanel"),
  lobbyTemplate: document.getElementById("avalonLobbyTemplate")
};

function connect() {
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.addEventListener("open", () => {
    lastMessageAt = Date.now();
    setConnection("已連線");
    if (hadRoomConnection && session?.roomCode && session?.playerId) {
      sendRaw({
        type: "joinRoom",
        roomCode: session.roomCode,
        playerId: session.playerId,
        name: session.name || ""
      });
      startStaleWatcher();
      updateJoinControls();
      return;
    }
    requestFullSync();
    startStaleWatcher();
    updateJoinControls();
  });
  socket.addEventListener("close", () => {
    setConnection(WAKING_TEXT);
    stopStaleWatcher();
    window.setTimeout(connect, 1200);
  });
  socket.addEventListener("message", (event) => {
    lastMessageAt = Date.now();
    const message = JSON.parse(event.data);
    if (message.type === "joined") {
      hasControl = true;
      hadRoomConnection = true;
      SharedRoomUI.clearControlLock();
      session = {
        roomCode: message.roomCode,
        playerId: message.playerId,
        name: els.nameInput.value.trim() || session?.name || "",
        game: "avalon",
        lastUsedAt: Date.now()
      };
      writeSession(session);
      writeTabPlayerId(message.playerId);
      history.replaceState(null, "", AvalonClientState.roomUrlPath(location.pathname, message.roomCode));
      updateJoinControls();
      requestFullSync();
      return;
    }
    if (message.type === "controlGranted") {
      hasControl = true;
      SharedRoomUI.clearControlLock();
      requestFullSync();
      return;
    }
    if (message.type === "ping") {
      sendRaw({ type: "pong", at: message.at });
      return;
    }
    if (message.type === "syncOk") {
      lastVersion = message.version || lastVersion;
      setConnection(syncStatusText());
      return;
    }
    if (message.type === "state") {
      lastStateAt = Date.now();
      lastVersion = message.room.version || lastVersion;
      snapshot = message;
      setConnection(syncStatusText());
      render();
      return;
    }
    if (message.type === "error") {
      if (message.code === AvalonClientState.SESSION_ERROR_CODES.sessionReplaced) {
        hasControl = false;
        SharedRoomUI.showControlLock(takeAvalonControl);
        showToast(message.message);
        return;
      }
      if ([
        AvalonClientState.SESSION_ERROR_CODES.staleRoomVersion,
        AvalonClientState.SESSION_ERROR_CODES.actionAlreadyConfirmed
      ].includes(message.code)) requestFullSync();
      if (message.code === AvalonClientState.SESSION_ERROR_CODES.roomNotFound || isMissingRoomError(message.message)) {
        const missingRoomCode = parsedRoomCode() || session?.roomCode || "";
        if (missingRoomCode) removeStoredRoom(missingRoomCode);
      } else if (
        (message.code === AvalonClientState.SESSION_ERROR_CODES.playerNotFound || isMissingPlayerError(message.message))
        && session?.playerId
      ) {
        removeStoredSession(session.playerId);
      }
      showToast(message.message);
    }
  });
}

function bindEvents() {
  SharedPlayerName.bindPlayerNameInput(els.nameInput);
  els.chatInput.value = "";
  window.addEventListener("pageshow", () => {
    els.chatInput.value = "";
  });

  const mobileHomeQuery = window.matchMedia("(max-width: 560px)");
  const syncChangelog = () => {
    if (els.changelog) els.changelog.open = !mobileHomeQuery.matches;
  };
  syncChangelog();
  mobileHomeQuery.addEventListener("change", syncChangelog);
  els.openRulesButton.addEventListener("click", openRules);
  els.closeRulesButton.addEventListener("click", closeRules);
  els.rulesOverlay.addEventListener("click", (event) => {
    if (event.target === els.rulesOverlay) closeRules();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.rulesOverlay.classList.contains("hidden")) closeRules();
  });

  const queryRoom = new URLSearchParams(location.search).get("room");
  if (queryRoom) els.roomInput.value = queryRoom;
  const handedOffName = sessionStorage.getItem("shared-entry-name");
  if (handedOffName) {
    els.nameInput.value = SharedPlayerName.cleanPlayerName(handedOffName);
    sessionStorage.removeItem("shared-entry-name");
  }
  if (session?.playerId) writeTabPlayerId(session.playerId);
  if (queryRoom && new URLSearchParams(location.search).has("player")) {
    history.replaceState(null, "", AvalonClientState.roomUrlPath(location.pathname, queryRoom));
  }
  if (session?.name) els.nameInput.value = SharedPlayerName.cleanPlayerName(session.name);
  updateJoinControls();
  renderRecentSessions();

  els.createRoomButton.addEventListener("click", () => {
    const name = SharedPlayerName.cleanPlayerName(els.nameInput.value);
    if (!name) return showToast("請先輸入名字。");
    send({ type: "createRoom", name });
  });
  els.joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = SharedPlayerName.cleanPlayerName(els.nameInput.value);
    const roomCode = parsedRoomCode();
    if (!name) return showToast("請先輸入名字。");
    if (!roomCode) return showToast("請輸入有效的房間代碼或邀請連結。");
    els.roomInput.value = roomCode;
    send({ type: "joinRoom", roomCode, name });
  });
  els.rejoinRoomButton.addEventListener("click", () => {
    if (!session?.roomCode || !session?.playerId) return;
    send({ type: "joinRoom", roomCode: session.roomCode, playerId: session.playerId, name: session.name || "" });
  });
  els.recentSessionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-recent-player]");
    if (!button) return;
    const recentSession = sessionStore().sessions[button.dataset.recentPlayer];
    if (!recentSession) return;
    els.nameInput.value = SharedPlayerName.cleanPlayerName(recentSession.name || "");
    els.roomInput.value = recentSession.roomCode;
    session = recentSession;
    writeTabPlayerId(recentSession.playerId);
    send({
      type: "joinRoom",
      roomCode: recentSession.roomCode,
      playerId: recentSession.playerId,
      name: recentSession.name || ""
    });
  });
  els.copyLinkButtons.forEach((button) => {
    button.addEventListener("click", copyInviteLink);
  });
  els.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    sendAction("sendChat", { text });
    els.chatInput.value = "";
  });
  els.infoTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-info-tab]");
    if (!button || button.classList.contains("hidden")) return;
    activeInfoTab = button.dataset.infoTab;
    if (activeInfoTab === "chat") unreadChatCount = 0;
    if (activeInfoTab === "roster") unreadRosterCount = 0;
    renderInfoTabs();
    if (activeInfoTab === "chat") {
      SharedRoomUI.readLatestChat(els.chatList, () => {
        unreadChatCount = 0;
        renderInfoTabs();
      });
    }
  });
  SharedRoomUI.bindChatReadState(els.chatList, () => {
    if (!unreadChatCount) return;
    unreadChatCount = 0;
    renderInfoTabs();
  });
}

function openRules() {
  els.rulesOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.closeRulesButton.focus();
}

function closeRules() {
  els.rulesOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  els.openRulesButton.focus();
}

function updateJoinControls() {
  const roomCode = parsedRoomCode() || new URLSearchParams(location.search).get("room") || "";
  session = readSession({
    roomCode,
    playerId: readTabPlayerId(),
    name: els.nameInput.value.trim()
  });
  const canRejoin = Boolean(session?.roomCode && session?.playerId && session.roomCode.toUpperCase() === roomCode.toUpperCase());
  els.rejoinRoomButton.classList.toggle("hidden", !canRejoin);
  if (canRejoin) els.rejoinRoomButton.textContent = `以 ${session.name || "原玩家"} 重新連線`;
}

function parsedRoomCode() {
  return AvalonClientState.parseRoomCode(els.roomInput.value, location.href);
}

function sessionStore() {
  let legacySession = null;
  try {
    legacySession = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
  } catch {
    legacySession = null;
  }
  const rawStore = localStorage.getItem(STORAGE_KEY);
  const store = AvalonClientState.normalizeSessionStore(rawStore, legacySession);
  if (legacySession?.playerId && legacySession?.roomCode) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  return store;
}

function removeStoredSession(playerId) {
  const currentSession = sessionStore().sessions[playerId];
  const nextStore = AvalonClientState.clearInvalidSession(sessionStore(), {
    errorCode: AvalonClientState.SESSION_ERROR_CODES.playerNotFound,
    playerId
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore));
  if (session?.playerId === playerId) session = null;
  if (readTabPlayerId() === playerId) clearTabPlayerId();
  if (currentSession?.roomCode) els.roomInput.value = currentSession.roomCode;
  renderRecentSessions();
  updateJoinControls();
}

function removeStoredRoom(roomCode) {
  const nextStore = AvalonClientState.clearInvalidSession(sessionStore(), {
    errorCode: AvalonClientState.SESSION_ERROR_CODES.roomNotFound,
    roomCode
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore));
  if (session?.roomCode?.toUpperCase() === roomCode.toUpperCase()) session = null;
  clearTabPlayerId();
  els.roomInput.value = "";
  history.replaceState(null, "", location.pathname);
  renderRecentSessions();
  updateJoinControls();
}

function isMissingRoomError(message) {
  return message === "找不到這個房間。" || message.includes("自動清除");
}

function isMissingPlayerError(message) {
  return message.includes("找不到你的玩家 ID");
}

function renderRecentSessions() {
  const recent = AvalonClientState.listSessions(sessionStore()).slice(0, 4);
  els.recentSessions.classList.toggle("hidden", recent.length === 0);
  els.recentSessionList.innerHTML = recent.map((item) => `
    <button class="recent-session-button" data-recent-player="${escapeHtml(item.playerId)}" type="button">
      <span class="recent-session-game">${escapeHtml(AvalonClientState.gameLabel(item.game || "avalon"))}</span>
      <span class="recent-session-details">
        <strong>${escapeHtml(item.name || "原玩家")}</strong>
        <small>房間 ${escapeHtml(item.roomCode)}</small>
      </span>
      <span>重新連線</span>
    </button>
  `).join("");
}

function render() {
  if (document.body.classList.contains("wolf-mode")) return;
  if (!snapshot) return;
  document.body.classList.add("room-active");
  els.joinView.classList.add("hidden");
  els.roomView.classList.remove("hidden");
  els.roomView.classList.toggle("lobby-mode", snapshot.room.phase === "lobby");
  els.roomCodes.forEach((element) => {
    element.textContent = snapshot.room.code;
  });
  const chatScrollState = SharedRoomUI.captureScroll(els.chatList);
  syncInfoUnread(chatScrollState);
  renderInfoTabs();
  renderStatus();
  renderRoster();
  renderScoreboard();
  renderMissionTable();
  renderLog();
  renderChat(chatScrollState);
  renderMain();
}

async function copyInviteLink() {
  if (!snapshot) return;
  const url = `${location.origin}${location.pathname}?room=${snapshot.room.code}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast("邀請連結已複製。");
  } catch {
    prompt("複製邀請連結", url);
  }
}

function syncInfoUnread(chatScrollState) {
  const room = snapshot.room;
  const chat = room.chat || [];
  if (infoRoomCode !== room.code) {
    infoRoomCode = room.code;
    lastObservedChatId = chat.at(-1)?.id || null;
    unreadChatCount = 0;
    lastPlayerJoinSerial = AvalonClientState.latestJoinSerial(room.playerJoinEvents || []);
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

  const joinUpdate = AvalonClientState.unreadPlayerJoins(
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
  if (isLobby && ["mission", "log"].includes(activeInfoTab)) activeInfoTab = "chat";
  els.infoTabs.querySelectorAll("[data-info-tab]").forEach((button) => {
    const unavailable = isLobby && button.classList.contains("game-only-tab");
    button.classList.toggle("hidden", unavailable);
    button.classList.toggle("active", button.dataset.infoTab === activeInfoTab);
  });
  document.querySelectorAll("[data-info-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.infoPanel === activeInfoTab);
  });
  els.chatUnread.textContent = String(unreadChatCount);
  els.chatUnread.classList.toggle("hidden", unreadChatCount === 0);
  els.rosterUnread.textContent = String(unreadRosterCount);
  els.rosterUnread.classList.toggle("hidden", unreadRosterCount === 0);
}

function renderStatus() {
  const room = snapshot.room;
  const host = room.players.find((player) => player.id === room.hostId);
  const leader = room.players.find((player) => player.id === room.leaderId);
  const authority = room.phase === "lobby"
    ? { label: "房主", name: host?.name || "未指定" }
    : { label: "領袖", name: leader?.name || "未開始" };
  els.statusStrip.innerHTML = [
    statusCard("階段", phaseLabel(room.phase)),
    statusCard("任務", room.phase === "lobby" ? "設定中" : `${room.round + 1} / 5`),
    statusCard(authority.label, authority.name),
    statusCard("進度", phaseProgressText())
  ].join("");
  els.mobileStatusSummary.innerHTML = SharedRoomUI.mobileStatusSummary([
    {
      label: "階段",
      value: room.round >= 0 && room.phase !== "gameOver"
        ? `${phaseLabel(room.phase)} ${room.round + 1}/5`
        : phaseLabel(room.phase)
    },
    { label: "領袖", value: leader?.name || "未開始" },
    { label: "進度", value: phaseProgressText() }
  ]);
}

function renderRoster() {
  const room = snapshot.room;
  els.roster.innerHTML = room.players.map((player) => {
    const role = player.role ? snapshot.roles[player.role] : null;
    return `
      <article class="player-card ${SharedRoomUI.playerCardClasses({
        playerId: player.id,
        viewerId: snapshot.you.id,
        online: player.online,
        retired: player.retiredLeader
      })}" ${player.id === snapshot.you.id ? 'aria-current="true"' : ""}>
        <div class="seat">${player.index + 1}</div>
        <div>
          <div class="player-name-line">
            <strong>${escapeHtml(player.name)}</strong>
            ${renderAchievementBadge(player.achievements || [])}
          </div>
          <div class="player-meta">
            ${player.roll ? `d100: ${player.roll}` : "未擲骰"}${player.ready ? " · 已準備" : ""} · ${player.online ? "在線" : "離線"}
          </div>
          ${SharedRoomUI.hostControls({
            viewerIsHost: snapshot.you.isHost,
            player,
            hostId: snapshot.room.hostId,
            phase: room.phase
          })}
        </div>
        <div class="token-stack">
          ${room.phase === "lobby" && player.isHost ? token("host", "房主") : ""}
          ${player.isLeader ? token("leader", "領袖") : player.retiredLeader ? token("retired", "退役領袖") : ""}
          ${player.excaliburHolder ? token("excalibur", "王者之劍") : ""}
          ${player.ladyHolder ? token("lady", "湖中女神") : player.usedLady ? token("lady-used", "曾持有湖中女神") : ""}
          ${role ? roleIcon(player.role, player.side, role.mark) : ""}
        </div>
      </article>
    `;
  }).join("");
  SharedRoomUI.bindHostControls(els.roster, sendAction);
  bindAchievementPopovers();
}

function bindAchievementPopovers() {
  els.roster.querySelectorAll(".achievement-badge").forEach((badge) => {
    const popover = badge.nextElementSibling;
    if (!popover?.classList.contains("achievement-popover")) return;
    const updateDirection = () => {
      const card = badge.closest(".player-card");
      const panel = badge.closest(".info-panel");
      const cardRect = card.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      const visibleBottom = Math.min(window.innerHeight, panelRect?.bottom || window.innerHeight);
      const visibleTop = Math.max(0, panelRect?.top || 0);
      const below = visibleBottom - cardRect.bottom;
      const above = cardRect.top - visibleTop;
      popover.classList.toggle("opens-up", below < 240 && above > below);
    };
    badge.addEventListener("pointerenter", updateDirection);
    badge.addEventListener("focus", updateDirection);
  });
}

function renderAchievementBadge(achievements) {
  if (!achievements.length) return "";
  const featured = achievements.reduce((best, item) => {
    const priorityDiff = Number(item.priority || 0) - Number(best.priority || 0);
    if (priorityDiff > 0) return item;
    if (priorityDiff < 0) return best;
    return Number(item.count || 0) > Number(best.count || 0) ? item : best;
  }, achievements[0]);
  const label = achievements.length > 1 ? `${featured.name} +${achievements.length - 1}` : featured.name;
  return `
    <span class="achievement-badge" tabindex="0" aria-label="已取得 ${achievements.length} 個稱號">
      ${escapeHtml(label)}
    </span>
    <span class="achievement-popover" role="tooltip">
      ${achievements.map((item) => `
        <span class="achievement-entry">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </span>
      `).join("")}
    </span>
  `;
}

function renderScoreboard() {
  const results = snapshot.room.missionResults;
  els.scoreboard.innerHTML = Array.from({ length: 5 }, (_, index) => {
    const result = results.find((entry) => entry.round === index);
    const current = snapshot.room.phase !== "lobby" && snapshot.room.phase !== "gameOver" && snapshot.room.round === index;
    return `<div class="score-slot ${current ? "current" : ""} ${result ? result.result : ""}">${result ? (result.result === "success" ? "成功" : "失敗") : index + 1}</div>`;
  }).join("");
}

function renderMissionTable() {
  const { settings } = snapshot.room;
  const failRules = snapshot.rules[settings.playerCount].fail;
  els.missionTable.innerHTML = settings.teamSizes.map((size, index) => `
    <div class="mission-row">
      <span class="mission-round">第 ${index + 1}</span>
      <div class="mission-bar"><span style="width:${(size / settings.playerCount) * 100}%"></span></div>
      <strong class="mission-size">${size} 人${failRules[index] > 1 ? ` / ${failRules[index]} 失敗` : ""}</strong>
    </div>
  `).join("");
}

function renderLog() {
  els.logList.innerHTML = SharedRoomUI.logEntries(snapshot.room.log, escapeHtml);
}

function renderChat(scrollState) {
  const chat = snapshot.room.chat || [];
  const newestId = chat.at(-1)?.id || null;
  if (renderedChatRoomCode === snapshot.room.code && newestId === lastRenderedChatId) return;
  els.chatList.innerHTML = chat.length ? chat.map((entry) => entry.playerId === "system"
    ? `<div class="chat-message system">${escapeHtml(entry.text)}</div>`
    : `<div class="chat-message ${entry.playerId === snapshot.you.id ? "mine" : ""}">
        <span class="chat-line"><strong>${escapeHtml(entry.name)}:</strong> ${escapeHtml(entry.text)}</span>
      </div>`).join("") : `<div class="chat-empty">尚無聊天訊息</div>`;
  renderedChatRoomCode = snapshot.room.code;
  lastRenderedChatId = newestId;
  SharedRoomUI.restoreScroll(els.chatList, scrollState);
}

function renderMain() {
  window.clearTimeout(resultCountdownTimer);
  resultCountdownTimer = null;
  const phase = snapshot.room.phase;
  if (phase !== "lakeResult") revealedLakeResultKey = null;
  if (phase !== "excaliburResult") revealedExcaliburResultKey = null;
  if (phase !== "excalibur") pendingExcaliburChoice = null;
  if (phase !== "lake") pendingLakeTargetId = null;
  if (phase === "lobby") return renderLobby();
  if (phase === "reveal") return renderReveal();
  if (phase === "team") return renderTeam();
  if (phase === "vote") return renderVote();
  if (phase === "voteResult") return renderVoteResult();
  if (phase === "mission") return renderMission();
  if (phase === "excalibur") return renderExcalibur();
  if (phase === "excaliburResult") return renderExcaliburResult();
  if (phase === "missionResult") return renderMissionResult();
  if (phase === "lake") return renderLake();
  if (phase === "lakeResult") return renderLakeResult();
  if (phase === "appointLeader") return renderAppointLeader();
  if (phase === "assassination") return renderAssassination();
  if (phase === "gameOver") return renderGameOver();
}

function renderLobby() {
  const { room, you } = snapshot;
  const settings = room.settings;
  const current = currentPlayer();
  const canStart = room.canStart && you.isHost;
  const fragment = els.lobbyTemplate.content.cloneNode(true);
  const phaseHeaderSlot = fragment.querySelector("[data-template-slot='phase-header']");
  phaseHeaderSlot.insertAdjacentHTML("beforebegin", phaseHeader("準備房間", "房主設定人數、牌庫與任務人數；每位玩家擲 d100 後按準備。"));
  phaseHeaderSlot.remove();

  const readyText = current.ready ? "已準備" : "尚未準備";
  const readyAlert = fragment.querySelector(".ready-alert");
  readyAlert.classList.add(current.ready ? "ready" : "not-ready");
  readyAlert.setAttribute("aria-label", readyText);
  fragment.querySelector(".ready-alert-popover").textContent = readyText;
  fragment.querySelector("[data-lobby-player-name]").textContent = you.name;
  fragment.querySelector("[data-lobby-roll-status]").textContent = current.roll ? `你的骰點是 ${current.roll}` : "尚未擲骰";
  const rollButton = fragment.querySelector('[data-action="roll"]');
  rollButton.disabled = Boolean(current.roll);
  const readyButton = fragment.querySelector('[data-action="ready"]');
  readyButton.disabled = !current.roll;
  readyButton.textContent = current.ready ? "取消準備" : "準備";

  fragment.querySelector("[data-lobby-validation]").innerHTML = [
    ...room.validation.errors.map((message) => `<div class="validation error">${escapeHtml(message)}</div>`),
    ...room.validation.warnings.map((message) => `<div class="validation warn">${escapeHtml(message)}</div>`),
    room.canStart ? `<div class="validation ok">所有條件完成，可以開始遊戲。</div>` : ""
  ].join("");
  fragment.querySelector("[data-lobby-start-control]").innerHTML = you.isHost
    ? `<button class="start-button" data-action="start" type="button" ${canStart ? "" : "disabled"}>開始遊戲</button>`
    : `<div class="notice">等待房主開始遊戲。</div>`;

  const settingsPanel = fragment.querySelector('[data-shell-panel="host-settings"]');
  settingsPanel.classList.toggle("locked", !you.isHost);
  fragment.querySelector("[data-lobby-recommend-control]").innerHTML = you.isHost
    ? `<button class="ghost-button" data-action="recommend" type="button">${settings.playerCount} 人推薦牌庫</button>`
    : "";
  const playerCountSelect = fragment.querySelector("#playerCountSelect");
  playerCountSelect.disabled = !you.isHost;
  playerCountSelect.innerHTML = Object.keys(snapshot.rules).map((count) => (
    `<option value="${count}" ${Number(count) === settings.playerCount ? "selected" : ""}>${count} 人</option>`
  )).join("");
  const leaderSelect = fragment.querySelector("#leaderModeSelect");
  leaderSelect.disabled = !you.isHost;
  leaderSelect.value = settings.leaderMode;
  const resultDelaySelect = fragment.querySelector("#resultDelaySelect");
  resultDelaySelect.disabled = !you.isHost;
  resultDelaySelect.value = String(settings.resultDelaySeconds);

  fragment.querySelector("[data-lobby-expansions]").innerHTML = [
    settingToggle("excaliburToggle", "啟用王者之劍", settings.expansions?.excalibur, "每次組隊時，領袖必須將王者之劍交給參與任務的其他玩家。任務牌提交完畢後，持劍者可選擇不發動，或公開選擇另一名任務成員，私下查看其原本的任務牌，再翻轉並結算。", you.isHost),
    settingToggle("ladyToggle", "啟用湖中女神", settings.expansions?.ladyOfLake, "建議大於七人遊戲使用。開局由擲骰第二大的玩家持有；第 2、3、4 次任務結束後，可私下查驗一名從未持有過湖中女神的其他玩家，並將指示物交給該玩家。最初持有者也不能被查驗。", you.isHost)
  ].join("");
  fragment.querySelector("[data-lobby-team-sizes]").innerHTML = settings.teamSizes.map((size, index) => `
    <label class="field compact">
      <span>第 ${index + 1} 次</span>
      <input class="team-size-input" data-index="${index}" min="1" max="${settings.playerCount}" type="number" value="${size}" ${you.isHost ? "" : "disabled"}>
    </label>
  `).join("");

  els.mainPanel.replaceChildren(fragment);
  bindLobby(settings);
}

function bindLobby(settings) {
  els.mainPanel.querySelector('[data-action="roll"]')?.addEventListener("click", () => sendAction("roll"));
  els.mainPanel.querySelector('[data-action="ready"]')?.addEventListener("click", () => sendAction("setReady", { ready: !currentPlayer().ready }));
  els.mainPanel.querySelector('[data-action="start"]')?.addEventListener("click", () => sendAction("startGame"));
  els.mainPanel.querySelector('[data-action="recommend"]')?.addEventListener("click", () => {
    const count = settings.playerCount;
    sendAction("setSettings", {
      playerCount: count,
      roles: snapshot.recommendedDecks[count],
      teamSizes: snapshot.rules[count].team,
      leaderMode: settings.leaderMode,
      resultDelaySeconds: settings.resultDelaySeconds,
      expansions: settings.expansions
    });
  });
  const countSelect = document.getElementById("playerCountSelect");
  countSelect?.addEventListener("change", () => {
    const playerCount = Number(countSelect.value);
    sendAction("setSettings", {
      ...settings,
      playerCount,
      teamSizes: snapshot.rules[playerCount].team
    });
  });
  const leaderSelect = document.getElementById("leaderModeSelect");
  leaderSelect?.addEventListener("change", () => sendAction("setSettings", { ...settings, leaderMode: leaderSelect.value }));
  const resultDelaySelect = document.getElementById("resultDelaySelect");
  resultDelaySelect?.addEventListener("change", () => sendAction("setSettings", {
    ...settings,
    resultDelaySeconds: Number(resultDelaySelect.value)
  }));
  bindExpansionToggle("excaliburToggle", settings, (checked) => ({ ...settings.expansions, excalibur: checked }));
  bindExpansionToggle("ladyToggle", settings, (checked) => ({ ...settings.expansions, ladyOfLake: checked }));
  els.mainPanel.querySelectorAll(".team-size-input").forEach((input) => {
    input.addEventListener("change", () => {
      const teamSizes = [...settings.teamSizes];
      teamSizes[Number(input.dataset.index)] = Number(input.value);
      sendAction("setSettings", { ...settings, teamSizes });
    });
  });
  renderRoleBuilder(settings);
}

function settingToggle(id, label, checked, help, enabled) {
  return `
    <div class="field setting-option">
      <label>
        <input id="${id}" type="checkbox" ${checked ? "checked" : ""} ${enabled ? "" : "disabled"}>
        ${label}
      </label>
      <span class="help-dot" tabindex="0">?</span>
      <span class="help-popover">${escapeHtml(help)}</span>
    </div>
  `;
}

function bindExpansionToggle(id, settings, buildExpansions) {
  const input = document.getElementById(id);
  input?.addEventListener("change", () => {
    sendAction("setSettings", { ...settings, expansions: buildExpansions(input.checked) });
  });
}

function renderRoleBuilder(settings) {
  const root = document.getElementById("roleBuilder");
  if (!root) return;
  root.innerHTML = Object.entries(snapshot.roles).map(([key, role]) => `
    <article class="role-row ${role.side}">
      ${roleIcon(key, role.side, role.mark)}
      <div>
        <strong>${role.name}</strong>
        <p>${roleNote(key, role, settings)}</p>
      </div>
      <div class="counter">
        <button data-role="${key}" data-delta="-1" type="button" ${snapshot.you.isHost ? "" : "disabled"}>-</button>
        <output>${settings.roles[key] || 0}</output>
        <button data-role="${key}" data-delta="1" type="button" ${snapshot.you.isHost ? "" : "disabled"}>+</button>
      </div>
    </article>
  `).join("");
  root.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const role = button.dataset.role;
      const roles = { ...settings.roles };
      roles[role] = Math.max(0, Math.min(snapshot.roles[role].max, (roles[role] || 0) + Number(button.dataset.delta)));
      sendAction("setSettings", { ...settings, roles });
    });
  });
}

function renderReveal() {
  const { room, you } = snapshot;
  els.mainPanel.innerHTML = `
    <div class="identity-overlay">
      <section class="identity-lightbox ${you.side}">
        <header class="identity-header">
          ${roleIcon(you.role, you.side, you.roleMark)}
          <div>
            <p class="eyebrow">${you.side === "good" ? "正義方" : "邪惡方"}</p>
            <h2>${escapeHtml(you.roleName)}</h2>
            <p>${escapeHtml(roleNote(you.role, snapshot.roles[you.role], room.settings))}</p>
          </div>
        </header>
        <div class="identity-clues">
          ${(you.identityClues || []).map(renderIdentityClue).join("")}
        </div>
        <footer class="identity-footer">
          <span>身份確認：${room.players.filter((player) => player.revealed).length} / ${room.players.length}</span>
          <button class="primary-button" data-action="confirmReveal" type="button" ${you.hasRevealed ? "disabled" : ""}>${you.hasRevealed ? "已確認，等待其他玩家" : "我已記住身份"}</button>
        </footer>
      </section>
    </div>
  `;
  els.mainPanel.querySelector("[data-action='confirmReveal']")?.addEventListener("click", () => sendAction("confirmReveal"));
}

function renderIdentityClue(clue) {
  return `
    <section class="identity-clue ${escapeHtml(clue.tone || "neutral")}">
      <div class="identity-clue-heading">
        <h3>${escapeHtml(clue.title)}</h3>
        <p>${escapeHtml(clue.note || "")}</p>
      </div>
      ${clue.players?.length ? `
        <div class="identity-player-grid">
          ${clue.players.map((player) => `
            <div class="identity-player">
              <span>${escapeHtml(player.avatarMark || Array.from(player.name)[0] || "?")}</span>
              <strong>${escapeHtml(player.name)}</strong>
            </div>
          `).join("")}
        </div>
      ` : `<div class="identity-empty">沒有可顯示的玩家</div>`}
    </section>
  `;
}

function renderTeam() {
  const { room, you } = snapshot;
  const teamSize = room.settings.teamSizes[room.round];
  const canSubmitTeam = you.isLeader
    && room.selectedTeam.length === teamSize
    && (!room.settings.expansions?.excalibur || room.selectedExcaliburHolderId);
  els.mainPanel.innerHTML = `
    ${phaseHeader(`第 ${room.round + 1} 次任務`, `${leaderName()} 持有領袖指示物，需要選出 ${teamSize} 位任務成員。`)}
    <div class="notice">${you.isLeader ? "你是領袖，請選擇隊伍。" : "等待領袖選擇隊伍。隊伍會即時更新。"}</div>
    <div class="choice-grid">
      ${room.players.map((player) => `
        <button class="choice-card ${player.onTeam ? "selected" : ""}" data-player="${player.id}" type="button" ${you.isLeader ? "" : "disabled"}>
          <strong>${escapeHtml(player.name)}</strong>
          <span>${player.onTeam ? "已入隊" : "未入隊"}</span>
        </button>
      `).join("")}
    </div>
    ${renderExcaliburPicker(room, you)}
    <button class="primary-button" data-action="submitTeam" type="button" ${canSubmitTeam ? "" : "disabled"}>送出隊伍</button>
  `;
  els.mainPanel.querySelectorAll("[data-player]").forEach((button) => {
    button.addEventListener("click", () => sendAction("toggleTeam", { playerId: button.dataset.player }));
  });
  els.mainPanel.querySelectorAll("[data-excalibur-holder]").forEach((button) => {
    button.addEventListener("click", () => sendAction("setExcaliburHolder", { playerId: button.dataset.excaliburHolder }));
  });
  els.mainPanel.querySelector("[data-action='submitTeam']")?.addEventListener("click", () => sendAction("submitTeam"));
}

function renderExcaliburPicker(room, you) {
  if (!room.settings.expansions?.excalibur) return "";
  const candidates = room.players.filter((player) => room.excaliburCandidateIds.includes(player.id));
  return `
    <section class="section-block compact-tool">
      <div class="section-heading">
        <h3>王者之劍</h3>
        <span class="help-dot" tabindex="0">?</span>
        <span class="help-popover">領袖必須交給一名參與任務的其他玩家，不能交給自己。任務牌提交完畢後，持劍者可選擇不發動，或公開選擇另一名任務成員翻轉任務牌再結算。</span>
      </div>
      <div class="choice-grid compact">
        ${candidates.map((player) => `
          <button class="choice-card ${room.selectedExcaliburHolderId === player.id ? "selected" : ""}" data-excalibur-holder="${player.id}" type="button" ${you.isLeader ? "" : "disabled"}>
            <strong>${escapeHtml(player.name)}</strong>
            <span>${room.selectedExcaliburHolderId === player.id ? "持有王者之劍" : "交給此玩家"}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderVote() {
  const { room, you } = snapshot;
  const excaliburHolder = room.players.find((player) => player.id === room.selectedExcaliburHolderId);
  const excaliburNotice = room.settings.expansions.excalibur && excaliburHolder
    ? `<div class="notice">本次任務的王者之劍持有者：<strong>${escapeHtml(excaliburHolder.name)}</strong></div>`
    : "";
  els.mainPanel.innerHTML = `
    ${phaseHeader("全員投票", `是否同意隊伍：${namesByIds(room.selectedTeam)}。`)}
    ${excaliburNotice}
    <div class="progress-panel">投票進度：${room.voteProgress.done} / ${room.voteProgress.total}</div>
    ${you.hasVoted ? `<div class="notice">你已投票，等待其他玩家。</div>` : `
      <div class="button-row">
        <button class="primary-button" data-vote="approve" type="button">同意</button>
        <button class="danger-button" data-vote="reject" type="button">不同意</button>
      </div>
    `}
  `;
  els.mainPanel.querySelectorAll("[data-vote]").forEach((button) => {
    button.addEventListener("click", () => sendAction("castVote", { vote: button.dataset.vote }));
  });
}

function renderVoteResult() {
  const result = snapshot.room.voteResult;
  const { you } = snapshot;
  const delay = resultDelayState();
  els.mainPanel.innerHTML = `
    ${phaseHeader(result.passed ? "投票通過" : "投票未通過", `同意 ${result.approve}，不同意 ${result.reject}。`)}
    <div class="vote-grid">
      ${result.votes.map((entry) => `<div class="vote-pill ${entry.vote}">${escapeHtml(entry.name)}：${entry.vote === "approve" ? "同意" : "不同意"}</div>`).join("")}
    </div>
    ${renderReactionPanel()}
    ${you.isLeader ? "" : `<div class="notice">等待當前領袖繼續。</div>`}
    <div class="continue-row">
      <button class="primary-button" data-action="continueVote" type="button" ${you.isLeader && delay.ready ? "" : "disabled"}>${result.passed ? "進入任務" : "下一位領袖提案"}</button>
      ${delay.ready ? "" : `<span class="result-countdown">${delay.seconds} 秒後可繼續</span>`}
    </div>
  `;
  els.mainPanel.querySelector("[data-action='continueVote']").addEventListener("click", () => sendAction("continueVote"));
  bindReactionButtons();
  scheduleResultCountdown(delay);
}

function renderMission() {
  const { room, you } = snapshot;
  const failNeed = snapshot.rules[room.settings.playerCount].fail[room.round];
  els.mainPanel.innerHTML = `
    ${phaseHeader("任務行動", `本次任務需要 ${failNeed} 張失敗牌才會失敗。`)}
    <div class="progress-panel">任務提交：${room.missionProgress.done} / ${room.missionProgress.total}</div>
    ${you.isOnTeam ? missionControls(you) : `<div class="notice">你不在任務隊伍中，等待任務成員匿名提交。</div>`}
  `;
  els.mainPanel.querySelectorAll("[data-card]").forEach((button) => {
    button.addEventListener("click", () => sendAction("submitMission", { card: button.dataset.card }));
  });
}

function missionControls(you) {
  if (you.hasSubmittedMission) return `<div class="notice">你已提交任務牌。</div>`;
  return `
    <div class="button-row">
      <button class="primary-button" data-card="success" type="button">任務成功</button>
      ${you.side === "evil" ? `<button class="danger-button" data-card="fail" type="button">任務失敗</button>` : ""}
    </div>
  `;
}

function renderExcalibur() {
  const { room, you } = snapshot;
  const holder = room.players.find((player) => player.id === room.activeExcaliburHolderId);
  els.mainPanel.innerHTML = `
    ${phaseHeader("王者之劍", `${holder?.name || "持劍者"} 可以選擇不發動，或公開選擇另一名任務成員翻轉任務牌後結算。`)}
    ${you.isExcaliburHolder ? `
      <div class="choice-grid">
        <button class="choice-card ${pendingExcaliburChoice === "skip" ? "selected" : ""}" data-excalibur-choice="skip" type="button">
          <strong>不發動</strong>
          <span>保留原本任務牌結果</span>
        </button>
        ${room.players.filter((player) => room.selectedTeam.includes(player.id) && player.id !== room.activeExcaliburHolderId).map((player) => `
          <button class="choice-card ${pendingExcaliburChoice === player.id ? "selected" : ""}" data-excalibur-choice="${player.id}" type="button">
            <strong>${escapeHtml(player.name)}</strong>
            <span>翻轉此人的任務牌</span>
          </button>
        `).join("")}
      </div>
      <button class="primary-button confirm-choice-button" data-confirm-excalibur type="button" ${pendingExcaliburChoice ? "" : "disabled"}>
        ${pendingExcaliburChoice === "skip" ? "確定不發動" : "確定對此玩家發動"}
      </button>
    ` : `<div class="notice">等待王者之劍持有者選擇目標。</div>`}
  `;
  els.mainPanel.querySelectorAll("[data-excalibur-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingExcaliburChoice = button.dataset.excaliburChoice;
      renderExcalibur();
    });
  });
  els.mainPanel.querySelector("[data-confirm-excalibur]")?.addEventListener("click", () => {
    if (!pendingExcaliburChoice) return;
    const choice = pendingExcaliburChoice;
    pendingExcaliburChoice = null;
    sendAction("useExcalibur", choice === "skip" ? { skip: true } : { playerId: choice });
  });
}

function renderExcaliburResult() {
  const result = snapshot.room.excaliburResult;
  const publicResult = snapshot.room.excaliburPublicResult;
  const resultKey = result ? `${result.targetId}:${result.originalCard}` : null;
  const isRevealed = resultKey && revealedExcaliburResultKey === resultKey;
  els.mainPanel.innerHTML = `
    ${result ? `
      <div class="identity-overlay">
        <section class="identity-lightbox lake-lightbox excalibur-lightbox" role="dialog" aria-modal="true" aria-label="王者之劍私密情報">
          ${isRevealed ? renderRevealedExcaliburResult(result) : `
            <div class="lake-privacy">
              ${token("excalibur", "王者之劍")}
              <p class="eyebrow">私密情報</p>
              <h2>請確認只有你能看到畫面</h2>
              <p>你已鎖定 ${escapeHtml(result.targetName)}，現在可查看對方原本提交的任務牌。</p>
              <button class="primary-button" data-reveal-excalibur type="button">顯示原始牌</button>
            </div>
          `}
        </section>
      </div>
    ` : `<div class="notice">${publicResult
      ? `${escapeHtml(publicResult.holderName)} 已對 ${escapeHtml(publicResult.targetName)} 發動王者之劍；等待持劍者確認原始牌。`
      : "等待王者之劍持有者確認原始牌。"}</div>`}
  `;
  els.mainPanel.querySelector("[data-reveal-excalibur]")?.addEventListener("click", () => {
    revealedExcaliburResultKey = resultKey;
    renderExcaliburResult();
  });
  els.mainPanel.querySelector("[data-confirm-excalibur-result]")?.addEventListener("click", () => {
    sendAction("confirmExcaliburResult");
  });
}

function renderRevealedExcaliburResult(result) {
  const isSuccess = result.originalCard === "success";
  return `
    <div class="lake-result-content">
      <p class="eyebrow">王者之劍</p>
      <div class="lake-player">
        <span>${escapeHtml(result.targetMark || Array.from(result.targetName)[0] || "?")}</span>
        <strong>${escapeHtml(result.targetName)}</strong>
      </div>
      <div class="mission-card-result ${isSuccess ? "success" : "fail"}">
        原始牌：${isSuccess ? "任務成功" : "任務失敗"}
      </div>
      <p>確認後，此任務牌將翻轉並公開結算任務結果。</p>
      <button class="primary-button" data-confirm-excalibur-result type="button">我已確認，結算任務</button>
    </div>
  `;
}

function renderMissionResult() {
  const last = snapshot.room.missionResults.at(-1);
  const { you } = snapshot;
  const delay = resultDelayState();
  els.mainPanel.innerHTML = `
    ${phaseHeader(last.result === "success" ? "任務成功" : "任務失敗", `失敗牌 ${last.fails} 張，需要 ${last.failNeed} 張。`)}
    <div class="result-card ${last.result}">
      <h3>第 ${last.round + 1} 次任務${last.result === "success" ? "成功" : "失敗"}</h3>
      <p>任務隊伍：${namesByIds(last.team)}</p>
      ${last.excalibur ? `<p>${excaliburResultText(last.excalibur)}</p>` : ""}
    </div>
    ${renderReactionPanel()}
    ${you.isLeader ? "" : `<div class="notice">等待當前領袖繼續。</div>`}
    <div class="continue-row">
      <button class="primary-button" data-action="continueMission" type="button" ${you.isLeader && delay.ready ? "" : "disabled"}>繼續</button>
      ${delay.ready ? "" : `<span class="result-countdown">${delay.seconds} 秒後可繼續</span>`}
    </div>
  `;
  els.mainPanel.querySelector("[data-action='continueMission']").addEventListener("click", () => sendAction("continueMission"));
  bindReactionButtons();
  scheduleResultCountdown(delay);
}

function resultDelayState() {
  const elapsedSinceSync = Math.max(0, Date.now() - lastStateAt);
  const remainingMs = Math.max(0, Number(snapshot.room.resultDelayRemainingMs || 0) - elapsedSinceSync);
  return {
    ready: remainingMs <= 0,
    seconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    remainingMs
  };
}

function scheduleResultCountdown(delay) {
  if (delay.ready) return;
  resultCountdownTimer = window.setTimeout(() => renderMain(), Math.min(1000, delay.remainingMs + 20));
}

function renderLake() {
  const { room, you } = snapshot;
  const holder = room.players.find((player) => player.id === room.ladyHolderId);
  els.mainPanel.innerHTML = `
    ${phaseHeader("湖中女神", `${holder?.name || "湖中女神"} 可以查驗一位從未持有過湖中女神的其他玩家；被查驗者將接過指示物。`)}
    ${you.isLadyHolder ? `
      <div class="choice-grid">
        ${room.players.filter((player) => room.lakeCandidateIds.includes(player.id)).map((player) => `
          <button class="choice-card ${pendingLakeTargetId === player.id ? "selected" : ""}" data-lake-target="${player.id}" type="button">
            <strong>${escapeHtml(player.name)}</strong>
            <span>查驗陣營</span>
          </button>
        `).join("")}
      </div>
      <button class="primary-button confirm-choice-button" data-confirm-lake type="button" ${pendingLakeTargetId ? "" : "disabled"}>確定查驗此玩家</button>
    ` : `<div class="notice">等待湖中女神進行查驗。</div>`}
  `;
  els.mainPanel.querySelectorAll("[data-lake-target]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingLakeTargetId = button.dataset.lakeTarget;
      renderLake();
    });
  });
  els.mainPanel.querySelector("[data-confirm-lake]")?.addEventListener("click", () => {
    if (!pendingLakeTargetId) return;
    const targetId = pendingLakeTargetId;
    pendingLakeTargetId = null;
    sendAction("inspectWithLady", { playerId: targetId });
  });
}

function renderLakeResult() {
  const { room } = snapshot;
  const result = room.lakeResult;
  const resultKey = result ? `${result.targetId}:${result.side}` : null;
  const isRevealed = resultKey && revealedLakeResultKey === resultKey;
  els.mainPanel.innerHTML = `
    ${result ? `
      <div class="identity-overlay lake-overlay">
        <section class="identity-lightbox lake-lightbox ${isRevealed ? result.side : "private"}" role="dialog" aria-modal="true" aria-label="湖中女神私密情報">
          ${isRevealed ? renderRevealedLakeResult(result) : `
            <div class="lake-privacy">
              ${token("lady", "湖中女神")}
              <p class="eyebrow">私密情報</p>
              <h2>請確認只有你能看到畫面</h2>
              <p>查驗結果只會顯示一次。</p>
              <button class="primary-button" data-action="revealLakeResult" type="button">顯示查驗結果</button>
            </div>
          `}
        </section>
      </div>
    ` : `<div class="notice">${room.lakePublicResult
      ? `湖中女神查驗了 ${escapeHtml(room.lakePublicResult.targetName)}。${escapeHtml(room.lakePublicResult.nextHolderName)} 現在持有湖中女神指示物。`
      : "等待湖中女神確認查驗結果。"}</div>`}
  `;
  els.mainPanel.querySelector("[data-action='revealLakeResult']")?.addEventListener("click", () => {
    revealedLakeResultKey = resultKey;
    renderLakeResult();
  });
  els.mainPanel.querySelector("[data-action='confirmLakeResult']")?.addEventListener("click", () => sendAction("confirmLakeResult"));
}

function renderRevealedLakeResult(result) {
  const sideName = result.side === "good" ? "正義方" : "邪惡方";
  return `
    <div class="lake-result-content">
      <p class="eyebrow">湖中女神查驗</p>
      <div class="lake-player">
        <span>${escapeHtml(result.targetMark || Array.from(result.targetName)[0] || "?")}</span>
        <strong>${escapeHtml(result.targetName)}</strong>
      </div>
      <div class="lake-side-result ${result.side}">${sideName}</div>
      <div class="lake-result-notes">
        <p>你可以選擇要不要公開此情報。</p>
      </div>
      <button class="primary-button" data-action="confirmLakeResult" type="button">我已記住</button>
    </div>
  `;
}

function renderAppointLeader() {
  const { room, you } = snapshot;
  els.mainPanel.innerHTML = `
    ${phaseHeader("指定下一位領袖", `${leaderName()} 持有領袖指示物，請從沒有退役領袖徽章的玩家中指定下一位。`)}
    <div class="choice-grid">
      ${room.players.map((player) => {
        const canPick = you.isLeader && room.appointableLeaderIds.includes(player.id);
        return `
          <button class="choice-card ${player.retiredLeader ? "retired-choice" : ""}" data-player="${player.id}" type="button" ${canPick ? "" : "disabled"}>
            <strong>${escapeHtml(player.name)}</strong>
            <span>${player.retiredLeader ? "已有退役領袖徽章" : canPick ? "指定為領袖" : player.isLeader ? "目前領袖" : "不可指定"}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
  els.mainPanel.querySelectorAll("[data-player]").forEach((button) => {
    button.addEventListener("click", () => sendAction("appointLeader", { playerId: button.dataset.player }));
  });
}

function renderAssassination() {
  const { room, you } = snapshot;
  els.mainPanel.innerHTML = `
    ${phaseHeader("刺客刺殺", "正義方完成三個任務，刺客可刺殺梅林反敗為勝。")}
    ${you.role === "assassin" ? `
      <div class="choice-grid">
        ${room.players.map((player) => `
          <button class="choice-card" data-player="${player.id}" type="button" ${player.id === you.id ? "disabled" : ""}>
            <strong>${escapeHtml(player.name)}</strong>
            <span>${player.id === you.id ? "刺客本人" : "刺殺此人"}</span>
          </button>
        `).join("")}
      </div>
    ` : `<div class="notice">等待刺客指定刺殺目標。</div>`}
  `;
  els.mainPanel.querySelectorAll("[data-player]").forEach((button) => {
    button.addEventListener("click", () => sendAction("assassinate", { playerId: button.dataset.player }));
  });
}

function renderGameOver() {
  const { room, you } = snapshot;
  els.mainPanel.innerHTML = `
    ${phaseHeader(room.winner.side === "good" ? "正義方勝利" : "邪惡方勝利", room.winner.reason)}
    <div class="reveal-grid">
      ${room.players.map((player) => `
        <article class="reveal-card ${player.side}">
          ${roleIcon(player.role, player.side, player.roleMark)}
          <div>
            <strong>${escapeHtml(player.name)}</strong>
            <p>${player.roleName}</p>
          </div>
        </article>
      `).join("")}
    </div>
    ${renderReactionPanel()}
    ${you.isHost ? `<button class="danger-button" data-action="resetRoom" type="button">重置房間</button>` : ""}
  `;
  els.mainPanel.querySelector("[data-action='resetRoom']")?.addEventListener("click", () => sendAction("resetRoom"));
  bindReactionButtons();
}

function renderReactionPanel() {
  const event = snapshot.room.reactionEvent;
  if (!event) return "";
  return `
    <section class="reaction-panel" aria-label="${escapeHtml(event.title)}反應">
      <div class="reaction-title">大家的反應</div>
      <div class="reaction-buttons">
        ${event.reactions.map((reaction) => {
          const names = reaction.names.length ? reaction.names.join("、") : reaction.label;
          return `
            <button class="reaction-button ${reaction.active ? "active" : ""}" data-reaction="${reaction.id}" data-event-key="${escapeHtml(event.key)}" type="button" title="${escapeHtml(names)}" aria-label="${escapeHtml(reaction.label)}">
              <span class="reaction-emoji">${reaction.emoji}</span>
              <span class="reaction-count">${reaction.count}</span>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function bindReactionButtons() {
  els.mainPanel.querySelectorAll("[data-reaction]").forEach((button) => {
    button.addEventListener("click", () => {
      sendAction("react", {
        eventKey: button.dataset.eventKey,
        reactionId: button.dataset.reaction
      });
    });
  });
}

function phaseHeader(title, subtitle) {
  return `
    <div class="phase-header">
      <div>
        <p class="eyebrow">${phaseLabel(snapshot.room.phase)}</p>
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
    </div>
  `;
}

function statusCard(label, value) {
  return `<div class="status-card"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function phaseProgressText() {
  const room = snapshot.room;
  if (room.phase === "vote") return `${room.voteProgress.done} / ${room.voteProgress.total} 投票`;
  if (room.phase === "mission") return `${room.missionProgress.done} / ${room.missionProgress.total} 任務`;
  if (room.phase === "excalibur" || room.phase === "excaliburResult") return "等待持劍者";
  if (room.phase === "lake" || room.phase === "lakeResult") return "湖中女神";
  if (room.phase === "reveal") return `${room.players.filter((player) => player.revealed).length} / ${room.players.length} 身份`;
  if (room.phase === "lobby") return `${room.players.filter((player) => player.ready).length} / ${room.settings.playerCount} 準備`;
  return `${room.rejectedVotes} / 5 反對`;
}

function phaseLabel(phase) {
  return {
    lobby: "大廳",
    reveal: "身份",
    team: "組隊",
    vote: "投票",
    voteResult: "投票結果",
    mission: "任務",
    excalibur: "王者之劍",
    excaliburResult: "王者之劍",
    missionResult: "任務結果",
    lake: "湖中女神",
    lakeResult: "湖中女神",
    appointLeader: "指定領袖",
    assassination: "刺殺",
    gameOver: "結束"
  }[phase] || "大廳";
}

function leaderName() {
  return snapshot.room.players.find((player) => player.id === snapshot.room.leaderId)?.name || "領袖";
}

function currentPlayer() {
  return snapshot.room.players.find((player) => player.id === snapshot.you.id);
}

function namesByIds(ids) {
  return ids.map((id) => snapshot.room.players.find((player) => player.id === id)?.name || id).join("、");
}

function nameById(id) {
  return snapshot.room.players.find((player) => player.id === id)?.name || id;
}

function excaliburResultText(excalibur) {
  const holderName = nameById(excalibur.holderId);
  if (!excalibur.used) return `${holderName} 持有王者之劍，但沒有發動。`;
  return `${holderName} 對 ${nameById(excalibur.targetId)} 發動王者之劍。`;
}

function token(kind, label) {
  return SharedRoomUI.token(kind, label);
}

function roleIcon(role, side, mark) {
  return `<span class="role-icon ${side || ""} role-${role}" title="${snapshot.roles?.[role]?.name || ""}">${escapeHtml(mark || snapshot.roles?.[role]?.mark || "?")}</span>`;
}

function roleNote(roleKey, role, settings) {
  if (roleKey === "merlin" && Number(settings?.playerCount) === 4) {
    return "只能看見一個隊友身份。若最後被刺客刺殺，邪惡方勝利。";
  }
  return role?.note || "";
}

function sendAction(action, payload = {}) {
  if (!hasControl) {
    SharedRoomUI.showControlLock(takeAvalonControl);
    return;
  }
  actionSequence += 1;
  send(AvalonClientState.createActionRequest({
    action,
    payload,
    roomVersion: snapshot?.room?.version || lastVersion,
    clientId: CLIENT_INSTANCE_ID,
    sequence: actionSequence
  }));
}

function takeAvalonControl() {
  const target = session || readSession();
  if (!target?.roomCode || !target?.playerId) return;
  send({
    type: "takeControl",
    roomCode: target.roomCode,
    playerId: target.playerId
  });
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("尚未連線，請稍等。");
    return;
  }
  sendRaw(payload);
}

function sendRaw(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function requestFullSync() {
  sendRaw({ type: "syncState", version: lastVersion });
}

function startStaleWatcher() {
  stopStaleWatcher();
  staleTimer = window.setInterval(() => {
    if (!snapshot) return;
    if (Date.now() - lastMessageAt <= STALE_STATE_MS) return;
    setConnection("同步中...");
    requestFullSync();
  }, 3000);
}

function stopStaleWatcher() {
  if (!staleTimer) return;
  window.clearInterval(staleTimer);
  staleTimer = null;
}

function setConnection(text) {
  if (document.body.classList.contains("wolf-mode")) return;
  els.connectionChip.textContent = text;
}

function syncStatusText() {
  return SharedRoomUI.connectionStatusText(lastVersion);
}

function showToast(message) {
  SharedRoomUI.showToast(message);
}

function readSession(selection = {}) {
  try {
    const store = sessionStore();
    const roomCode = selection.roomCode || new URLSearchParams(location.search).get("room") || "";
    const name = selection.name || "";
    const normalizedRoom = roomCode.toUpperCase();
    const normalizedName = name.trim().toLocaleLowerCase();
    const namedSession = normalizedName
      ? AvalonClientState.listSessions(store).find((item) => (
        item.roomCode.toUpperCase() === normalizedRoom
        && String(item.name || "").toLocaleLowerCase() === normalizedName
      ))
      : null;
    if (namedSession) return namedSession;
    return AvalonClientState.selectSession(store, {
      roomCode,
      playerId: selection.playerId || readTabPlayerId() || new URLSearchParams(location.search).get("player") || "",
      name
    });
  } catch {
    return null;
  }
}

function readTabPlayerId() {
  try {
    return sessionStorage.getItem(TAB_PLAYER_KEY) || "";
  } catch {
    return "";
  }
}

function writeTabPlayerId(playerId) {
  try {
    sessionStorage.setItem(TAB_PLAYER_KEY, playerId);
  } catch {
    // The page can still use localStorage-based recent sessions.
  }
}

function clearTabPlayerId() {
  try {
    sessionStorage.removeItem(TAB_PLAYER_KEY);
  } catch {
    // Ignore storage restrictions.
  }
}

function writeSession(nextSession) {
  const store = sessionStore();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(AvalonClientState.saveSession(store, nextSession)));
  renderRecentSessions();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.roomInput.addEventListener("input", updateJoinControls);
els.nameInput.addEventListener("input", updateJoinControls);
window.refreshAvalonLobby = () => {
  renderRecentSessions();
  updateJoinControls();
};
bindEvents();
connect();
