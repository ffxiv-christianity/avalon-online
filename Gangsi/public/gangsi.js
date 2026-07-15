(function initializeGangsi(global) {
  "use strict";

  const STORAGE_KEY = "gangsi-sessions";
  const TAB_KEY = "gangsi-tab-player";
  const CLIENT_INSTANCE_ID = crypto.randomUUID();
  const Format = global.GangsiMapFormat;
  const Classes = global.GangsiMapClasses;
  const page = {};

  let socket = null;
  let snapshot = null;
  let lastVersion = 0;
  let hasControl = true;
  let hadRoomConnection = false;
  let actionSequence = 0;
  let selectedSession = readSelectedSession();
  let activeInfoTab = "chat";
  let unreadChatCount = 0;
  let unreadRosterCount = 0;
  let lastObservedChatId = null;
  let lastPlayerJoinSerial = 0;
  let numericPath = [];
  let numericSelectionKey = "";
  let observedCaptureSerial = null;
  let captureTimer = null;
  let observedGameOverKey = "";
  let dismissedGameOverKey = "";

  initialize();

  function initialize() {
    page.mode = document.getElementById("gameModeSelect");
    page.joinView = document.getElementById("joinView");
    page.roomView = document.getElementById("gangsiRoomView");
    page.lobbyTemplate = document.getElementById("gangsiLobbyTemplate");
    page.gameTemplate = document.getElementById("gangsiGameTemplate");
    page.joinForm = document.getElementById("joinForm");
    page.nameInput = document.getElementById("nameInput");
    page.roomInput = document.getElementById("roomInput");
    page.createButton = document.getElementById("createRoomButton");
    page.rejoinButton = document.getElementById("rejoinRoomButton");
    page.recentSessions = document.getElementById("recentSessions");
    page.recentSessionList = document.getElementById("recentSessionList");
    page.connection = document.getElementById("connectionChip");
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
    page.mainPanel = document.getElementById("mainPanel");
    page.captureLightbox = document.getElementById("gangsiCaptureLightbox");
    page.captureText = document.getElementById("gangsiCaptureText");
    page.gameOverLightbox = document.getElementById("gangsiGameOverLightbox");
    page.gameOverDialog = page.gameOverLightbox.querySelector(".gangsi-game-over-lightbox");
    page.gameOverIcon = document.getElementById("gangsiGameOverIcon");
    page.gameOverEyebrow = document.getElementById("gangsiGameOverEyebrow");
    page.gameOverTitle = document.getElementById("gangsiGameOverTitle");
    page.gameOverDescription = document.getElementById("gangsiGameOverDescription");
    page.gameOverResult = document.getElementById("gangsiGameOverResult");
    page.gameOverSummary = document.getElementById("gangsiGameOverSummary");
    page.gameOverFooter = document.getElementById("gangsiGameOverFooter");
    page.gameOverClose = document.getElementById("gangsiGameOverClose");

    if (!Format || !Classes) throw new Error("Gangsi map modules are unavailable");
    SharedPlayerName.bindPlayerNameInput(page.nameInput);
    GangsiRules.mount();
    bindEvents();
    const queryRoom = roomFromUrl();
    if (queryRoom) page.roomInput.value = queryRoom;
    if (selectedSession?.name) page.nameInput.value = SharedPlayerName.cleanPlayerName(selectedSession.name);
    renderRecentSessions();
    syncRejoin();
    connect();
  }

  function connect() {
    socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/gangsi`);
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
    socket.addEventListener("message", (event) => handleMessage(JSON.parse(event.data)));
  }

  function handleMessage(message) {
    if (message.type === "joined") {
      hasControl = true;
      hadRoomConnection = true;
      SharedRoomUI.clearControlLock();
      selectedSession = {
        roomCode: message.roomCode,
        playerId: message.playerId,
        name: page.nameInput.value.trim() || selectedSession?.name || "",
        game: "gangsi",
        lastUsedAt: Date.now()
      };
      saveSession(selectedSession);
      sessionStorage.setItem(TAB_KEY, message.playerId);
      history.replaceState({ game: "gangsi" }, "", SharedRoomClient.roomUrlPath("/Gangsi/", message.roomCode));
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
  }

  function bindEvents() {
    page.mode.addEventListener("change", () => {
      const paths = {
        avalon: "/",
        onenightwolf: "/Onenightwolf/",
        criminaldance: "/CriminalDance/",
        loveletter: "/LoveLetter/",
        gangsi: "/Gangsi/"
      };
      if (paths[page.mode.value]) location.href = paths[page.mode.value];
    });
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
      const button = event.target.closest("[data-gangsi-recent-player]");
      if (!button) return;
      const saved = sessionStore().sessions[button.dataset.gangsiRecentPlayer];
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
    page.mainPanel.addEventListener("click", handleMainClick);
    page.mainPanel.addEventListener("change", handleMainChange);
    page.mainPanel.addEventListener("mouseover", handleTaskHintEnter);
    page.mainPanel.addEventListener("mouseout", handleTaskHintLeave);
    page.mainPanel.addEventListener("focusin", handleTaskHintEnter);
    page.mainPanel.addEventListener("focusout", handleTaskHintLeave);
    page.gameOverClose.addEventListener("click", dismissGameOverLightbox);
  }

  function render() {
    if (!snapshot?.you) return;
    document.body.classList.add("room-active");
    page.joinView.classList.add("hidden");
    page.roomView.classList.remove("hidden");
    page.roomView.classList.toggle("lobby-mode", snapshot.room.phase === "lobby");
    page.roomCodes.forEach((element) => { element.textContent = snapshot.room.code; });
    const chatScrollState = SharedRoomUI.captureScroll(page.chatList);
    syncInfoUnread(chatScrollState);
    renderInfoTabs();
    renderMobileSummary();
    renderRoster();
    renderChat(chatScrollState);
    renderMain();
  }

  function renderMobileSummary() {
    const map = selectedMapOption();
    const mapLabel = snapshot.room.phase === "lobby" && snapshot.room.settings.randomMap
      ? "隨機（開始後揭露）"
      : (map?.name || "未選擇");
    const items = [
      ["階段", phaseLabel(snapshot.room.phase)],
      ["玩家", `${snapshot.room.players.length}/${snapshot.room.settings.playerCount}`],
      ["地圖", mapLabel]
    ];
    page.mobileStatusSummary.innerHTML = SharedRoomUI.mobileStatusSummary(items.map(([label, value]) => ({ label, value })));
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
          <div class="player-meta">${roleLabel(player.role)} · 棋子 ${escapeHtml(pieceLabel(player))}${player.role === "adventurer" ? ` · d100: ${player.roll || "未擲"}` : ""}${player.ready ? " · 已準備" : ""} · ${player.online ? "在線" : "離線"}</div>
          ${SharedRoomUI.hostControls({
            viewerIsHost: snapshot.you.isHost,
            player,
            hostId: snapshot.room.hostId,
            phase: snapshot.room.phase
          })}
        </div>
        <div class="token-stack">${SharedRoomUI.rosterTokens({
          player,
          hostId: snapshot.room.hostId,
          phase: snapshot.room.phase
        })}</div>
      </article>
    `).join("");
    SharedRoomUI.bindHostControls(page.roster, sendAction);
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
    if (snapshot.room.phase === "lobby") renderLobby();
    else renderGameRoom();
  }

  function renderLobby() {
    observedCaptureSerial = null;
    numericPath = [];
    numericSelectionKey = "";
    window.clearTimeout(captureTimer);
    page.captureLightbox.classList.add("hidden");
    observedGameOverKey = "";
    dismissedGameOverKey = "";
    hideGameOverLightbox();
    const fragment = page.lobbyTemplate.content.cloneNode(true);
    fragment.querySelector("[data-template-slot='phase-header']").innerHTML = phaseHeader(
      "準備大廳",
      "自選角色；冒險者設定棋子並擲 d100 後準備。"
    );
    fragment.querySelector("[data-gangsi-lobby-player-name]").textContent = snapshot.you.name;
    const player = currentPlayer();
    const readyAlert = fragment.querySelector("[data-gangsi-lobby-ready-alert]");
    readyAlert.classList.toggle("ready", Boolean(player.ready));
    readyAlert.classList.toggle("not-ready", !player.ready);
    readyAlert.setAttribute("aria-label", player.ready ? "已準備" : "尚未準備");
    fragment.querySelector("[data-gangsi-lobby-ready-popover]").textContent = player.ready ? "已準備" : "尚未準備";
    fragment.querySelector("[data-gangsi-role-status]").textContent = `目前角色：${roleLabel(player.role)} · 棋子「${pieceLabel(player)}」`;
    const tokenInput = fragment.querySelector("[data-gangsi-token-label]");
    tokenInput.value = player.tokenLabel || "";
    tokenInput.closest(".gangsi-token-field").classList.toggle("hidden", player.role === "mummy");
    fragment.querySelector("[data-gangsi-lobby-roll-status]").textContent = player.role === "mummy"
      ? "提燈怪不需擲順序骰"
      : (player.roll ? `d100: ${player.roll}` : "尚未擲骰");
    const currentMummy = snapshot.room.players.find((item) => item.role === "mummy");
    fragment.querySelectorAll("[data-gangsi-role]").forEach((button) => {
      const role = button.dataset.gangsiRole;
      button.classList.toggle("is-active", role === player.role);
      button.setAttribute("aria-pressed", String(role === player.role));
      button.disabled = role === "mummy" && Boolean(currentMummy && currentMummy.id !== player.id);
    });
    const rollButton = fragment.querySelector("[data-gangsi-roll]");
    rollButton.classList.toggle("hidden", player.role === "mummy");
    rollButton.disabled = Boolean(player.roll);
    const readyButton = fragment.querySelector("[data-gangsi-ready]");
    readyButton.textContent = player.ready ? "取消準備" : "準備";
    readyButton.disabled = player.role === "adventurer" && (!player.tokenLabel || !player.roll);

    const playerCount = fragment.querySelector("[data-gangsi-player-count]");
    playerCount.value = String(snapshot.room.settings.playerCount);
    playerCount.disabled = !snapshot.you.isHost;
    const mapSelect = fragment.querySelector("[data-gangsi-map-select]");
    mapSelect.innerHTML = snapshot.room.maps.map((map) => `<option value="${escapeHtml(map.id)}">${escapeHtml(map.name)}</option>`).join("");
    mapSelect.value = snapshot.room.settings.mapId || snapshot.room.maps[0]?.id || "";
    mapSelect.disabled = !snapshot.you.isHost || snapshot.room.settings.randomMap;
    const randomMap = fragment.querySelector("[data-gangsi-random-map]");
    randomMap.checked = Boolean(snapshot.room.settings.randomMap);
    randomMap.disabled = !snapshot.you.isHost;
    fragment.querySelector('[data-shell-panel="host-settings"]').classList.toggle("locked", !snapshot.you.isHost);

    const map = selectedMapOption();
    fragment.querySelector("[data-gangsi-map-summary]").innerHTML = snapshot.room.settings.randomMap
      ? '<div><span>選圖方式</span><strong>開始遊戲時隨機抽選</strong></div>'
      : (map ? [
        ["作者", map.author || "未署名"],
        ["日期", map.date],
        ["尺寸", `${map.width} × ${map.height}`]
      ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("") : "");

    const validation = validateLobbyClient();
    fragment.querySelector("[data-gangsi-lobby-validation]").innerHTML = validation.length
      ? validation.map((message) => `<div class="validation error">${escapeHtml(message)}</div>`).join("")
      : '<div class="validation ok">設定完成，可以進入遊戲房間。</div>';
    const startControl = fragment.querySelector("[data-gangsi-lobby-start-control]");
    startControl.innerHTML = snapshot.you.isHost
      ? `<button class="start-button" data-gangsi-start type="button" ${validation.length ? "disabled" : ""}>進入遊戲房間</button>`
      : '<p class="notice">等待房主進入遊戲房間。</p>';
    page.mainPanel.replaceChildren(fragment);
  }

  function renderGameRoom() {
    const game = snapshot.room.game;
    if (!game) return;
    const nextNumericKey = snapshot.room.phase === "adventurer_numeric_move"
      ? `${game.currentPieceId}:${game.legal.selectedFace}`
      : "";
    if (nextNumericKey !== numericSelectionKey) numericPath = [];
    numericSelectionKey = nextNumericKey;
    const fragment = page.gameTemplate.content.cloneNode(true);
    fragment.querySelector("[data-template-slot='phase-header']").innerHTML = phaseHeader(
      game.winner ? "遊戲結束" : "古墓迷蹤",
      gamePhaseDescription(game)
    );
    fragment.querySelector("[data-gangsi-turn-badge]").innerHTML = isYourTurn(game) ? renderTurnBadge() : "";
    fragment.querySelector("[data-gangsi-player-matrix]").innerHTML = SharedRoomUI.playerMatrix({
      players: snapshot.room.players,
      className: "gangsi-player-matrix",
      renderSeat: (player, index) => renderGameSeat(player, index, game)
    });
    const map = snapshot.room.selectedMap;
    fragment.querySelector("[data-gangsi-board-name]").textContent = map?.name || "未選擇地圖";
    fragment.querySelector("[data-gangsi-board-size]").textContent = map ? `${map.width} × ${map.height}` : "";
    if (map) renderBoard(fragment.querySelector("[data-gangsi-board]"), map, game);
    const diceRow = fragment.querySelector("[data-gangsi-dice-row]");
    diceRow.classList.toggle("has-mummy-die", Number.isInteger(game.mummy.roll));
    diceRow.innerHTML = renderGameDice(game);
    const ownProgress = game.progress.find((progress) => progress.playerId === snapshot.you.id);
    const ownPieces = game.pieces.filter((piece) => piece.controllerId === snapshot.you.id);
    const lifeLabel = fragment.querySelector("[data-gangsi-life-label]");
    const missionsLabel = fragment.querySelector("[data-gangsi-missions-label]");
    if (snapshot.you.role === "mummy") {
      lifeLabel.textContent = "生命標記";
      missionsLabel.textContent = "已揭露";
      fragment.querySelector("[data-gangsi-life]").textContent = `${game.mummy.score} / ${game.mummy.target}`;
      fragment.querySelector("[data-gangsi-missions]").textContent = String(game.revealedTasks.length);
    } else {
      lifeLabel.textContent = ownPieces.length > 1 ? "棋子生命" : "生命";
      missionsLabel.textContent = "任務";
      fragment.querySelector("[data-gangsi-life]").textContent = ownPieces.map((piece) => Math.max(0, piece.life)).join(" / ") || "0";
      fragment.querySelector("[data-gangsi-missions]").textContent = `${ownProgress?.completed || 0} / ${ownProgress?.total || 0}`;
    }
    fragment.querySelector("[data-gangsi-locked-dice]").textContent = `${game.lockedDiceCount} / 5`;
    const infoMessages = snapshot.room.log.slice(-5);
    if (snapshot.room.phase === "adventurer_roll" && isYourTurn(game)) {
      const hasRolledFaces = game.dice?.some((die) => !die.locked && die.face);
      if (hasRolledFaces && game.legal.dieIds?.length) {
        infoMessages.push("請點選一顆亮起的骰子，決定本回合的移動方式；也可以重新擲所有未鎖定的骰子。");
      } else if (hasRolledFaces) {
        infoMessages.push("目前沒有能完成移動的骰面，請重擲所有未鎖定骰。");
      }
    }
    if (snapshot.room.phase === "adventurer_numeric_move" && isYourTurn(game)) {
      const complete = numericPath.length === Number(game.legal.selectedFace);
      infoMessages.push(complete
        ? `路徑已選滿 ${game.legal.selectedFace} 步，請確認移動。`
        : `路徑預覽：${numericPath.length} / ${game.legal.selectedFace} 步`);
    }
    fragment.querySelector("[data-gangsi-action-info]").innerHTML = SharedRoomUI.actionInfoBlock({
      messages: infoMessages,
      emptyText: "目前沒有行動資訊。",
      className: "gangsi-action-info-block",
      bodyClassName: "gangsi-action-info-body"
    });
    fragment.querySelector("[data-gangsi-action-row]").innerHTML = renderGameActions(game);
    fragment.querySelector("[data-gangsi-hand-panel]").innerHTML = renderGameHand(game);
    page.mainPanel.replaceChildren(fragment);
    syncCaptureEffect(game);
    syncGameOverLightbox(game);
  }

  function renderGameSeat(player, index, game) {
    const pieces = game.pieces.filter((piece) => piece.controllerId === player.id);
    const progress = game.progress.find((item) => item.playerId === player.id);
    const isCurrent = game.currentPlayerId === player.id;
    const seatTone = SharedRoomUI.seatToneClass(index);
    const groupProgress = player.role === "adventurer" && progress
      ? `<span class="gangsi-progress-groups" aria-label="各類寶藏剩餘任務">
          ${Object.entries(progress.remainingByGroup).filter(([, count]) => count > 0).map(([group, count]) => `
            <span data-group="${group}" title="${escapeAttribute(`${Format.GROUPS[group]?.name || group}剩餘 ${count} 張`)}">${group}:${count}</span>`).join("")}
        </span>`
      : "";
    const tokens = player.role === "mummy"
      ? '<span class="gangsi-piece-token is-mummy">怪</span>'
      : pieces.map((piece) => `
          <span class="gangsi-piece-token ${seatTone} ${piece.eliminated ? "is-eliminated" : ""}">
            ${escapeHtml(piece.tokenLabel)}${pieces.length > 1 ? `<small>${piece.ordinal}</small>` : ""}
          </span>`).join("");
    const detail = player.role === "mummy"
      ? `生命標記 ${game.mummy.score}/${game.mummy.target}`
      : `生命 ${pieces.map((piece) => Math.max(0, piece.life)).join("/")} · 任務 ${progress?.completed || 0}/${progress?.total || 0}`;
    return `
      <article class="gangsi-player-seat ${player.id === snapshot.you.id ? "is-self" : ""} ${isCurrent ? "is-current" : ""} ${player.online ? "" : "is-offline"}">
        ${SharedRoomUI.seatNumber(index, "gangsi-seat-number")}
        <span class="gangsi-seat-pieces">${tokens}</span>
        <div class="gangsi-player-seat-body">
          <strong title="${escapeAttribute(player.name)}">${escapeHtml(player.name)}</strong>
          ${groupProgress}
          <small>${roleLabel(player.role)} · ${escapeHtml(detail)} · ${player.online ? "在線" : "離線"}</small>
        </div>
      </article>`;
  }

  function renderGameDice(game) {
    const mummyDie = Number.isInteger(game.mummy.roll)
      ? `<span class="gangsi-die is-mummy-die" title="提燈怪骰擲出 ${game.mummy.roll} 點">${game.mummy.roll}</span>`
      : "";
    if (!game.dice) {
      return Array.from({ length: 5 }, (_, index) => `
        <span class="gangsi-die ${index < game.lockedDiceCount ? "is-locked" : "is-hidden-face"}">
          ${index < game.lockedDiceCount ? "怪" : "?"}
        </span>`).join("") + mummyDie;
    }
    const selectable = new Set(game.legal.dieIds || []);
    return game.dice.map((die) => {
      const label = die.locked ? "怪" : dieFaceLabel(die.face);
      if (selectable.has(die.id)) {
        return `<button class="gangsi-die is-selectable" data-gangsi-die="${escapeAttribute(die.id)}" type="button" title="使用 ${escapeAttribute(label)} 骰">${escapeHtml(label)}</button>`;
      }
      return `<span class="gangsi-die ${die.locked ? "is-locked" : ""}">${escapeHtml(label)}</span>`;
    }).join("") + mummyDie;
  }

  function renderGameActions(game) {
    const actions = new Set(game.legal.actions || []);
    if (actions.has("keepLockedDice")) return `
      <button class="secondary-button" data-gangsi-game-action="keepLockedDice" type="button">繼續回合</button>
      <button class="primary-button" data-gangsi-game-action="unlockDice" type="button">解鎖全部骰子</button>`;
    if (actions.has("rollAdventurerDice")) {
      const hasFaces = game.dice?.some((die) => !die.locked && die.face);
      return `<button class="primary-button" data-gangsi-game-action="rollAdventurerDice" type="button">${hasFaces ? "重擲未鎖定骰" : "擲冒險者骰"}</button>`;
    }
    if (actions.has("moveNumeric")) return numericPath.length === Number(game.legal.selectedFace)
      ? `<button class="primary-button" data-gangsi-confirm-path type="button">確認移動</button>
         <button class="secondary-button" data-gangsi-reset-path type="button">重新選擇路徑</button>`
      : "";
    if (actions.has("moveArrow")) {
      const directions = game.legal.directions || {};
      return `<div class="gangsi-direction-grid" role="group" aria-label="箭頭方向">
        ${directionButton("up", "↑", directions)}
        ${directionButton("left", "←", directions)}
        ${directionButton("down", "↓", directions)}
        ${directionButton("right", "→", directions)}
      </div>`;
    }
    if (actions.has("revealTreasure")) return `
      <button class="primary-button" data-gangsi-game-action="revealTreasure" type="button">揭露寶藏</button>
      <button class="secondary-button" data-gangsi-game-action="declineTreasure" type="button">暫不揭露</button>`;
    if (actions.has("rollMummyDie")) return '<button class="primary-button" data-gangsi-game-action="rollMummyDie" type="button">擲提燈怪骰</button>';
    if (actions.has("stopMummy")) return '<button class="secondary-button" data-gangsi-game-action="stopMummy" type="button">結束移動</button>';
    if (game.winner && snapshot.you.isHost) return '<button class="primary-button" data-gangsi-return-lobby type="button">返回準備大廳</button>';
    return "";
  }

  function directionButton(direction, label, directions) {
    const enabled = Boolean(directions[direction]);
    return `<button class="ghost-button" data-gangsi-arrow="${direction}" type="button" title="${directionLabel(direction)}" ${enabled ? "" : "disabled"}>${label}</button>`;
  }

  function renderGameHand(game) {
    const isMummy = snapshot.you.role === "mummy";
    const items = isMummy ? game.revealedTasks : game.hand;
    const revealedFooter = !isMummy && game.revealedTasks.length
      ? `<div class="gangsi-revealed-strip">
          <strong>全隊已揭露</strong>
          ${game.revealedTasks.map((task) => `<span data-group="${task.id[0]}" title="${escapeAttribute(Format.GROUPS[task.id[0]]?.name || task.id)}">${escapeHtml(task.id)}</span>`).join("")}
        </div>`
      : "";
    return SharedRoomUI.handPanel({
      title: isMummy ? "已揭露寶藏" : "你的任務卡",
      className: "gangsi-hand-panel",
      gridClassName: "gangsi-hand-grid",
      items,
      footer: revealedFooter,
      renderItem: (task) => renderTaskCard(task, isMummy),
      emptyText: isMummy ? "尚未揭露寶藏。" : "目前沒有任務卡。"
    });
  }

  function renderTaskCard(task, isMummy) {
    const group = Format.GROUPS[task.id[0]];
    const revealed = isMummy || task.revealed;
    const hintAttributes = `data-gangsi-task-id="${escapeAttribute(task.id)}" tabindex="0" title="在地圖上提示寶藏的原始位置"`;
    return `<article class="gangsi-task-card ${revealed ? "is-revealed" : ""}" data-group="${task.id[0]}" ${hintAttributes}>
      <span>${escapeHtml(task.id)}</span>
      <strong>${escapeHtml(group?.name || "寶藏")}</strong>
      <small>${revealed ? "已揭露" : `${group?.label || ""}色任務`}</small>
    </article>`;
  }

  function renderBoard(container, map, game) {
    container.style.setProperty("--cols", map.width);
    container.style.setProperty("--rows", map.height);
    const walls = new Set(map.walls);
    const originalTreasureByCell = new Map(map.treasures.map((treasure) => [treasure.position, treasure]));
    const revealedTreasureIds = new Set(game.revealedTasks.map((task) => task.id));
    const treasureByCell = new Map(map.treasures
      .filter((treasure) => !revealedTreasureIds.has(treasure.id))
      .map((treasure) => [treasure.position, treasure]));
    const piecesByCell = new Map();
    const seatToneByPlayerId = new Map(snapshot.room.players.map((player, index) => [
      player.id,
      SharedRoomUI.seatToneClass(index)
    ]));
    for (const piece of game.pieces) {
      if (!Object.hasOwn(piece, "position") || !piece.position || piece.eliminated) continue;
      const cell = piece.position === "entrance"
        ? map.zones.entrance.anchor
        : piece.position === "dungeon" ? map.zones.dungeon.anchor : piece.position;
      if (!piecesByCell.has(cell)) piecesByCell.set(cell, []);
      piecesByCell.get(cell).push(piece);
    }
    const mummyCell = game.mummy.position === "dungeon" ? map.zones.dungeon.anchor : game.mummy.position;
    const legalTargets = new Set(boardLegalTargets(game));
    const selectedPath = new Set(numericPath);
    const cells = [];
    for (let y = 1; y <= map.height; y += 1) {
      for (let x = 1; x <= map.width; x += 1) {
        const cell = Format.cellKey(x, y);
        const cellClass = Classes.cellClassAt(map, cell);
        const rightEdge = x < map.width ? Format.canonicalEdge(cell, Format.cellKey(x + 1, y)) : null;
        const bottomEdge = y < map.height ? Format.canonicalEdge(cell, Format.cellKey(x, y + 1)) : null;
        const originalTreasure = originalTreasureByCell.get(cell);
        const treasure = treasureByCell.get(cell);
        const cellPieces = piecesByCell.get(cell) || [];
        const labels = { entrance: "入口", dungeon: "地牢" };
        const treasureGroup = treasure ? Format.GROUPS[treasure.id[0]] : null;
        const pieceMarkup = cellPieces.map((piece) => `
          <span class="gangsi-board-piece ${seatToneByPlayerId.get(piece.controllerId) || ""} ${piece.id === game.currentPieceId ? "is-current" : ""}">
            ${escapeHtml(piece.tokenLabel)}${cellPieces.length > 1 || piece.ordinal > 1 ? `<small>${piece.ordinal}</small>` : ""}
          </span>`).join("");
        const mummyMarkup = mummyCell === cell
          ? `<span class="gangsi-board-piece is-mummy ${game.currentPlayerId === game.mummy.playerId ? "is-current" : ""}">怪</span>`
          : "";
        cells.push(`
          <button type="button" data-gangsi-board-cell="${cell}" ${originalTreasure ? `data-gangsi-treasure-origin="${originalTreasure.id}"` : ""} class="gangsi-board-cell is-${cellClass} ${walls.has(rightEdge) ? "wall-right" : ""} ${walls.has(bottomEdge) ? "wall-bottom" : ""} ${legalTargets.has(cell) ? "is-legal-target" : ""} ${selectedPath.has(cell) ? "is-path-cell" : ""}"
            aria-label="${escapeAttribute(`${cell} ${labels[cellClass] || "道路"}${treasure ? ` ${treasure.id} ${treasureGroup?.name || "寶藏"}` : ""}`)}">
            ${labels[cellClass] ? `<span class="gangsi-zone-label">${labels[cellClass]}</span>` : ""}
            ${treasure ? `<span class="gangsi-treasure-token" data-gangsi-treasure-id="${treasure.id}" data-group="${treasure.id[0]}" title="${escapeAttribute(`${treasure.id} ${treasureGroup?.name || "寶藏"}`)}">${treasure.id}</span>` : ""}
            <span class="gangsi-board-piece-stack">${pieceMarkup}${mummyMarkup}</span>
          </button>`);
      }
    }
    container.innerHTML = cells.join("");
  }

  function boardLegalTargets(game) {
    if (snapshot.room.phase === "adventurer_numeric_move" && game.legal.paths) {
      return game.legal.paths
        .filter((path) => numericPath.every((cell, index) => path[index] === cell))
        .map((path) => path[numericPath.length])
        .filter(Boolean);
    }
    if (["mummy_interlude_move", "mummy_normal_move"].includes(snapshot.room.phase)) return game.legal.moves || [];
    return [];
  }

  function handleMainClick(event) {
    const roleButton = event.target.closest("[data-gangsi-role]");
    if (roleButton) return sendAction("chooseRole", { role: roleButton.dataset.gangsiRole });
    if (event.target.closest("[data-gangsi-roll]")) return sendAction("roll");
    if (event.target.closest("[data-gangsi-ready]")) return sendAction("toggleReady");
    if (event.target.closest("[data-gangsi-start]")) return sendAction("startGame");
    if (event.target.closest("[data-gangsi-return-lobby]")) return sendAction("returnLobby");
    const gameAction = event.target.closest("[data-gangsi-game-action]");
    if (gameAction) return sendAction(gameAction.dataset.gangsiGameAction);
    const die = event.target.closest("[data-gangsi-die]");
    if (die) return sendAction("selectDie", { dieId: die.dataset.gangsiDie });
    const arrow = event.target.closest("[data-gangsi-arrow]");
    if (arrow) return sendAction("moveArrow", { direction: arrow.dataset.gangsiArrow });
    if (event.target.closest("[data-gangsi-confirm-path]")) {
      const path = numericPath.slice();
      numericPath = [];
      return sendAction("moveNumeric", { path });
    }
    if (event.target.closest("[data-gangsi-reset-path]")) {
      numericPath = [];
      renderMain();
      return;
    }
    const cell = event.target.closest("[data-gangsi-board-cell]");
    if (cell) handleBoardCell(cell.dataset.gangsiBoardCell);
  }

  function handleBoardCell(cell) {
    const game = snapshot.room.game;
    if (!game || !boardLegalTargets(game).includes(cell)) return;
    if (snapshot.room.phase === "adventurer_numeric_move") {
      numericPath.push(cell);
      renderMain();
      return;
    }
    if (["mummy_interlude_move", "mummy_normal_move"].includes(snapshot.room.phase)) {
      sendAction("moveMummy", { cell });
    }
  }

  function handleMainChange(event) {
    if (event.target.matches("[data-gangsi-token-label]")) {
      return sendAction("updateTokenLabel", { tokenLabel: event.target.value });
    }
    if (!event.target.matches("[data-gangsi-player-count], [data-gangsi-map-select], [data-gangsi-random-map]")) return;
    const playerCount = page.mainPanel.querySelector("[data-gangsi-player-count]");
    const mapSelect = page.mainPanel.querySelector("[data-gangsi-map-select]");
    const randomMap = page.mainPanel.querySelector("[data-gangsi-random-map]");
    sendAction("updateSettings", {
      playerCount: Number(playerCount.value),
      mapId: mapSelect.value,
      randomMap: randomMap.checked
    });
  }

  function handleTaskHintEnter(event) {
    const card = event.target.closest?.("[data-gangsi-task-id]");
    if (!card || card.contains(event.relatedTarget)) return;
    setTreasureHint(card.dataset.gangsiTaskId);
  }

  function handleTaskHintLeave(event) {
    const card = event.target.closest?.("[data-gangsi-task-id]");
    if (!card || card.contains(event.relatedTarget)) return;
    clearTreasureHint();
  }

  function setTreasureHint(taskId) {
    clearTreasureHint();
    page.mainPanel.querySelector(`[data-gangsi-treasure-origin="${taskId}"]`)?.classList.add("is-treasure-hint");
  }

  function clearTreasureHint() {
    page.mainPanel.querySelectorAll(".is-treasure-hint").forEach((cell) => cell.classList.remove("is-treasure-hint"));
  }

  function syncInfoUnread(chatScrollState) {
    const chatUpdate = SharedRoomUI.updateChatUnread({
      entries: snapshot.room.chat,
      lastObservedId: lastObservedChatId,
      viewerId: snapshot.you.id,
      chatActive: activeInfoTab === "chat",
      chatAtBottom: chatScrollState.atBottom,
      currentCount: unreadChatCount
    });
    unreadChatCount = chatUpdate.count;
    lastObservedChatId = chatUpdate.lastObservedId;
    const rosterUpdate = SharedRoomClient.unreadPlayerJoins(
      snapshot.room.playerJoinEvents || [],
      lastPlayerJoinSerial,
      snapshot.you.id,
      activeInfoTab === "roster"
    );
    unreadRosterCount += rosterUpdate.count;
    lastPlayerJoinSerial = rosterUpdate.lastSerial;
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
    if (!snapshot.room.settings.randomMap && !selectedMapOption()) messages.push("請選擇有效地圖。");
    if (snapshot.room.players.filter((player) => player.role === "mummy").length !== 1) {
      messages.push("需要正好一位玩家選擇擔任提燈怪。");
    }
    if (snapshot.room.players.some((player) => player.role === "adventurer" && !player.tokenLabel)) {
      messages.push("所有冒險者都需要填寫一字棋子文字。");
    }
    if (snapshot.room.players.some((player) => player.role === "adventurer" && !player.roll)) {
      messages.push("所有冒險者都需要先擲 d100。");
    }
    if (snapshot.room.players.some((player) => !player.ready)) messages.push("所有玩家都需要準備。");
    return messages;
  }

  function selectedMapOption() {
    return snapshot.room.maps.find((map) => map.id === snapshot.room.settings.mapId) || null;
  }

  function currentPlayer() {
    return snapshot.room.players.find((player) => player.id === snapshot.you.id);
  }

  function roleLabel(role) {
    return role === "mummy" ? "提燈怪" : "冒險者";
  }

  function pieceLabel(player) {
    return player.role === "mummy" ? "怪" : (player.tokenLabel || "未設定");
  }

  function phaseLabel(phase) {
    return {
      lobby: "準備大廳",
      adventurer_turn_start: "回合開始",
      mummy_interlude_move: "插入回合",
      adventurer_roll: "冒險者擲骰",
      adventurer_numeric_move: "數字移動",
      adventurer_arrow_move: "箭頭移動",
      treasure_decision: "寶藏揭露",
      mummy_normal_roll: "提燈怪擲骰",
      mummy_normal_move: "提燈怪移動",
      game_over: "遊戲結束"
    }[phase] || phase;
  }

  function gamePhaseDescription(game) {
    const current = playerById(game.currentPlayerId);
    if (game.winner) {
      const winner = playerById(game.winner.playerId);
      return game.winner.role === "mummy"
        ? `提燈怪 ${winner?.name || ""} 獲勝。`
        : `冒險者 ${winner?.name || ""} 完成全部任務。`;
    }
    if (snapshot.room.phase === "adventurer_turn_start") return `${current?.name || "冒險者"} 正在決定是否解鎖冒險者骰。`;
    if (snapshot.room.phase === "adventurer_roll") return `${current?.name || "冒險者"} 正在擲骰並選擇本回合的移動方式。`;
    if (snapshot.room.phase === "adventurer_numeric_move") return `${current?.name || "冒險者"} 已選擇移動 ${game.legal.selectedFace || game.lastPublicDie} 步。`;
    if (snapshot.room.phase === "adventurer_arrow_move") return `${current?.name || "冒險者"} 已選擇箭頭骰，正在決定移動方向。`;
    if (snapshot.room.phase === "mummy_interlude_move") return `提燈怪正在進行插入回合，還可移動 ${game.mummy.remaining} 步，也可以立即結束。`;
    if (snapshot.room.phase === "mummy_normal_roll") return "請提燈怪擲一次提燈怪骰，決定本回合的最大移動步數。";
    if (snapshot.room.phase === "mummy_normal_move") return `提燈怪骰擲出 ${game.mummy.roll} 點；還可移動 ${game.mummy.remaining} 步，也可以立即結束。`;
    if (snapshot.room.phase === "treasure_decision") return `${current?.name || "冒險者"} 正在決定是否揭露這項寶藏。`;
    return current ? `現在輪到 ${current.name}。` : "正在準備下一個回合。";
  }

  function isYourTurn(game) {
    return game.currentPlayerId === snapshot.you.id && (game.legal.actions || []).length > 0;
  }

  function renderTurnBadge() {
    return `
      <div class="gangsi-turn-badge template-game-turn-badge" role="status" aria-live="polite">
        <span class="template-game-turn-pulse" aria-hidden="true"></span>
        <strong>現在換你</strong>
      </div>`;
  }

  function dieFaceLabel(face) {
    return { arrow: "箭", mummy: "怪", null: "--" }[face] || face || "--";
  }

  function directionLabel(direction) {
    return { up: "向上", right: "向右", down: "向下", left: "向左" }[direction] || direction;
  }

  function playerById(playerId) {
    return snapshot.room.players.find((player) => player.id === playerId) || null;
  }

  function syncCaptureEffect(game) {
    const event = game.captureEvent;
    if (observedCaptureSerial === null) {
      observedCaptureSerial = event?.serial || 0;
      return;
    }
    if (!event || event.serial <= observedCaptureSerial) return;
    observedCaptureSerial = event.serial;
    const captures = event.captures?.length ? event.captures : [event];
    const descriptions = captures.map((capture) => {
      const player = playerById(capture.playerId);
      return `${player?.name || "冒險者"}${capture.eliminated ? "已出局" : `剩餘 ${Math.max(0, capture.life)} 點生命`}`;
    });
    page.captureText.textContent = `${captures.length > 1 ? `${captures.length} 名冒險者` : "冒險者"}被提燈怪抓到了！${descriptions.join("、")}`;
    page.captureLightbox.classList.remove("hidden");
    window.clearTimeout(captureTimer);
    captureTimer = window.setTimeout(() => page.captureLightbox.classList.add("hidden"), 1200);
  }

  function syncGameOverLightbox(game) {
    const winner = game.winner;
    if (!winner) {
      hideGameOverLightbox();
      return;
    }
    const key = `${snapshot.room.code}:${winner.role}:${winner.playerId}:${game.round}`;
    if (observedGameOverKey !== key) {
      observedGameOverKey = key;
      dismissedGameOverKey = "";
    }
    const player = playerById(winner.playerId);
    const mummyWon = winner.role === "mummy";
    const progress = game.progress.find((item) => item.playerId === winner.playerId);
    page.gameOverDialog.classList.toggle("evil", mummyWon);
    page.gameOverDialog.classList.toggle("good", !mummyWon);
    page.gameOverIcon.classList.toggle("evil", mummyWon);
    page.gameOverIcon.classList.toggle("good", !mummyWon);
    page.gameOverIcon.textContent = mummyWon ? "怪" : (player?.tokenLabel || "勝");
    page.gameOverEyebrow.textContent = mummyWon ? "提燈怪勝利" : "冒險者勝利";
    page.gameOverTitle.textContent = `${player?.name || roleLabel(winner.role)} 獲勝`;
    page.gameOverDescription.textContent = mummyWon
      ? "提燈怪取得足夠的生命標記，古墓探索宣告結束。"
      : "冒險者完成全部寶藏任務，立即贏得本局。";
    page.gameOverResult.classList.toggle("evil", mummyWon);
    page.gameOverResult.classList.toggle("good", !mummyWon);
    page.gameOverSummary.textContent = mummyWon
      ? `生命標記 ${game.mummy.score} / ${game.mummy.target}`
      : `完成任務 ${progress?.completed || 0} / ${progress?.total || 0}`;
    page.gameOverFooter.textContent = snapshot.you.isHost
      ? "關閉後可查看最終盤面，並決定何時返回準備大廳。"
      : "關閉後可查看最終盤面；等待房主返回準備大廳。";
    if (dismissedGameOverKey === key) return;
    page.gameOverLightbox.classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function dismissGameOverLightbox() {
    dismissedGameOverKey = observedGameOverKey;
    hideGameOverLightbox();
  }

  function hideGameOverLightbox() {
    page.gameOverLightbox.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  function phaseHeader(title, subtitle) {
    return `<div class="phase-header"><div><p class="eyebrow">${escapeHtml(phaseLabel(snapshot.room.phase))}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div></div>`;
  }

  async function copyInvite() {
    const url = `${location.origin}/Gangsi/?room=${snapshot.room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("邀請連結已複製。");
    } catch {
      prompt("複製邀請連結", url);
    }
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
    return SharedRoomClient.selectSession(store, {
      roomCode: roomFromUrl(),
      playerId: sessionStorage.getItem(TAB_KEY)
    });
  }

  function findRoomSession(roomCode) {
    if (!roomCode) return null;
    const tabPlayerId = sessionStorage.getItem(TAB_KEY);
    const name = page.nameInput?.value.trim() || "";
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
      <button class="recent-session-button" data-gangsi-recent-player="${escapeAttribute(item.playerId)}" type="button">
        <span class="recent-session-game">${escapeHtml(SharedRoomClient.gameLabel(item.game || "gangsi"))}</span>
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

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  global.Gangsi = { parseRoomCode };
}(window));
