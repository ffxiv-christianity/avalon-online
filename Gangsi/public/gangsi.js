(function initializeGangsi(global) {
  "use strict";

  const STORAGE_KEY = "gangsi-sessions";
  const TAB_KEY = "gangsi-tab-player";
  const CLIENT_INSTANCE_ID = crypto.randomUUID();
  const ACTION_INFO_LIMIT = 7;
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
  let knightGuardOpen = false;
  let knightGuardSelectionKey = "";
  let mechanismSelectionOpen = false;
  let mechanismSelectionKey = "";
  let knifeDirectionOpen = false;
  let knifeSelectionKey = "";
  let compassDieId = "";
  let masonWallOpen = false;
  let archaeologistOpen = false;
  let phantomWallOpen = false;
  let composingTokenLabelInput = null;
  let committedTokenLabelInput = null;
  let committedTokenLabelValue = "";
  let mainPanelTemplate = "";
  let renderedBoardSignature = "";
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
    page.mainPanel.addEventListener("compositionstart", handleTokenLabelCompositionStart);
    page.mainPanel.addEventListener("compositionend", handleTokenLabelCompositionEnd);
    page.mainPanel.addEventListener("input", handleMainInput);
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
      ["模式", modeLabel(snapshot.room.settings.mode)],
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
          <div class="player-meta">${roleLabel(player.role)}${lobbySpecialization(player)} · 棋子 ${escapeHtml(pieceLabel(player))}${player.role === "adventurer" ? ` · d100: ${player.roll || "未擲"}` : ""}${player.ready ? " · 已準備" : ""} · ${player.online ? "在線" : "離線"}</div>
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

  function commitMainPanel(fragment, template) {
    if (mainPanelTemplate !== template || !page.mainPanel.childNodes.length) {
      page.mainPanel.replaceChildren(fragment);
      mainPanelTemplate = template;
      return;
    }
    reconcileChildren(page.mainPanel, fragment);
  }

  function reconcileChildren(currentParent, nextParent) {
    const nextChildren = Array.from(nextParent.childNodes);
    nextChildren.forEach((nextChild, index) => {
      const currentChild = currentParent.childNodes[index];
      if (!currentChild) {
        currentParent.appendChild(nextChild.cloneNode(true));
        return;
      }
      if (!canReconcileNode(currentChild, nextChild)) {
        currentChild.replaceWith(nextChild.cloneNode(true));
        return;
      }
      reconcileNode(currentChild, nextChild);
    });
    while (currentParent.childNodes.length > nextChildren.length) {
      currentParent.lastChild.remove();
    }
  }

  function canReconcileNode(currentNode, nextNode) {
    return currentNode.nodeType === nextNode.nodeType
      && (currentNode.nodeType !== 1 || currentNode.tagName === nextNode.tagName);
  }

  function reconcileNode(currentNode, nextNode) {
    if (currentNode.nodeType !== 1) {
      if (currentNode.nodeValue !== nextNode.nodeValue) currentNode.nodeValue = nextNode.nodeValue;
      return;
    }
    Array.from(currentNode.attributes).forEach((attribute) => {
      if (!nextNode.hasAttribute(attribute.name)) currentNode.removeAttribute(attribute.name);
    });
    Array.from(nextNode.attributes).forEach((attribute) => {
      if (currentNode.getAttribute(attribute.name) !== attribute.value) {
        currentNode.setAttribute(attribute.name, attribute.value);
      }
    });
    if (!nextNode.__gangsiPreserveChildren) reconcileChildren(currentNode, nextNode);
    if (currentNode instanceof HTMLInputElement) {
      if (currentNode.type === "checkbox" || currentNode.type === "radio") {
        currentNode.checked = nextNode.checked;
      } else if (
        currentNode !== document.activeElement
        && currentNode !== composingTokenLabelInput
        && currentNode.value !== nextNode.value
      ) {
        currentNode.value = nextNode.value;
      }
    } else if (currentNode instanceof HTMLSelectElement && currentNode.value !== nextNode.value) {
      currentNode.value = nextNode.value;
    } else if (currentNode instanceof HTMLTextAreaElement && currentNode !== document.activeElement) {
      if (currentNode.value !== nextNode.value) currentNode.value = nextNode.value;
    }
  }

  function renderLobby() {
    observedCaptureSerial = null;
    numericPath = [];
    numericSelectionKey = "";
    knightGuardOpen = false;
    knightGuardSelectionKey = "";
    knifeDirectionOpen = false;
    knifeSelectionKey = "";
    compassDieId = "";
    masonWallOpen = false;
    archaeologistOpen = false;
    phantomWallOpen = false;
    window.clearTimeout(captureTimer);
    page.captureLightbox.classList.add("hidden");
    observedGameOverKey = "";
    dismissedGameOverKey = "";
    hideGameOverLightbox();
    const fragment = page.lobbyTemplate.content.cloneNode(true);
    const isHunt = snapshot.room.settings.mode === "hunt";
    fragment.querySelector("[data-template-slot='phase-header']").innerHTML = phaseHeader(
      "準備大廳",
      isHunt ? "選擇陣營與專屬能力；冒險者合作逃離古墓。" : "自選角色；冒險者設定棋子並擲 d100 後準備。"
    );
    fragment.querySelector("[data-gangsi-lobby-player-name]").textContent = snapshot.you.name;
    const player = currentPlayer();
    const readyAlert = fragment.querySelector("[data-gangsi-lobby-ready-alert]");
    readyAlert.classList.toggle("ready", Boolean(player.ready));
    readyAlert.classList.toggle("not-ready", !player.ready);
    readyAlert.setAttribute("aria-label", player.ready ? "已準備" : "尚未準備");
    fragment.querySelector("[data-gangsi-lobby-ready-popover]").textContent = player.ready ? "已準備" : "尚未準備";
    fragment.querySelector("[data-gangsi-role-status]").textContent = `目前角色：${roleLabel(player.role)}${lobbySpecialization(player)} · 棋子「${pieceLabel(player)}」`;
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
    const professionField = fragment.querySelector(".gangsi-profession-field");
    const professionSelect = fragment.querySelector("[data-gangsi-profession]");
    professionField.classList.toggle("hidden", !isHunt || player.role !== "adventurer");
    professionSelect.value = player.profession || "";
    const takenProfessions = new Set(snapshot.room.players
      .filter((item) => item.id !== player.id && item.role === "adventurer")
      .map((item) => item.profession)
      .filter(Boolean));
    professionSelect.querySelectorAll("option[value]").forEach((option) => {
      option.disabled = Boolean(option.value && takenProfessions.has(option.value));
    });
    const mummyTypeField = fragment.querySelector(".gangsi-mummy-type-field");
    const mummyTypeSelect = fragment.querySelector("[data-gangsi-mummy-type]");
    mummyTypeField.classList.toggle("hidden", !isHunt || player.role !== "mummy");
    mummyTypeSelect.value = player.mummyType || "";
    const rollButton = fragment.querySelector("[data-gangsi-roll]");
    rollButton.classList.toggle("hidden", player.role === "mummy");
    rollButton.disabled = Boolean(player.roll);
    const readyButton = fragment.querySelector("[data-gangsi-ready]");
    readyButton.textContent = player.ready ? "取消準備" : "準備";
    readyButton.disabled = player.role === "adventurer" && (!player.tokenLabel || !player.roll || (isHunt && !player.profession))
      || player.role === "mummy" && isHunt && !player.mummyType;

    const modeSelect = fragment.querySelector("[data-gangsi-mode]");
    modeSelect.value = snapshot.room.settings.mode || "classic";
    modeSelect.disabled = !snapshot.you.isHost;
    const playerCount = fragment.querySelector("[data-gangsi-player-count]");
    playerCount.value = String(snapshot.room.settings.playerCount);
    playerCount.disabled = !snapshot.you.isHost;
    const mapSelect = fragment.querySelector("[data-gangsi-map-select]");
    playerCount.querySelector('option[value="2"]').disabled = isHunt;
    mapSelect.innerHTML = snapshot.room.maps.map((map) => {
      const unavailable = isHunt && !map.huntCompatible;
      return `<option value="${escapeHtml(map.id)}" ${unavailable ? "disabled" : ""}>${escapeHtml(map.name)}${unavailable ? "（缺少獵殺機關）" : ""}</option>`;
    }).join("");
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
        ["模式相容", isHunt ? (map.huntCompatible ? "可用於獵殺模式" : "缺少兩座獵殺機關") : "可用於經典模式"],
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
    commitMainPanel(fragment, "lobby");
  }

  function renderGameRoom() {
    const game = snapshot.room.game;
    if (!game) return;
    const nextNumericKey = (game.legal.actions || []).includes("moveNumeric")
      ? `${game.currentPieceId}:${game.legal.selectedFace}`
      : "";
    if (nextNumericKey !== numericSelectionKey) numericPath = [];
    numericSelectionKey = nextNumericKey;
    const nextKnightGuardKey = snapshot.you.role === "adventurer"
      && (game.legal.actions || []).includes("useKnightGuard")
      ? `${game.currentPieceId}:${(game.legal.guardTargets || []).join(",")}`
      : "";
    if (nextKnightGuardKey !== knightGuardSelectionKey) knightGuardOpen = false;
    knightGuardSelectionKey = nextKnightGuardKey;
    const nextMechanismKey = snapshot.you.role === "adventurer"
      && (game.legal.actions || []).includes("activateMechanism")
      ? `${game.currentPieceId}:${(game.legal.mechanisms || []).join(",")}`
      : "";
    if (nextMechanismKey !== mechanismSelectionKey) mechanismSelectionOpen = false;
    mechanismSelectionKey = nextMechanismKey;
    const nextKnifeKey = snapshot.you.role === "mummy"
      && (game.legal.actions || []).includes("throwKnife")
      ? `${game.currentPlayerId}:${game.mummy.abilityCooldown}`
      : "";
    if (nextKnifeKey !== knifeSelectionKey) knifeDirectionOpen = false;
    knifeSelectionKey = nextKnifeKey;
    if (!(game.legal.actions || []).includes("selectDie")) compassDieId = "";
    if (!(game.legal.actions || []).includes("useMasonWall")) masonWallOpen = false;
    if (!(game.legal.actions || []).includes("useArchaeologistTask")) archaeologistOpen = false;
    if (!(game.legal.actions || []).includes("placePhantomWall")) phantomWallOpen = false;
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
    const boardSize = fragment.querySelector("[data-gangsi-board-size]");
    boardSize.textContent = map ? `${map.width}x × ${map.height}y` : "";
    boardSize.title = map ? `X 軸 ${map.width} 格，Y 軸 ${map.height} 格` : "";
    const trackingBanner = fragment.querySelector("[data-gangsi-tracking-banner]");
    const trackingVisible = game.mode === "hunt"
      && (game.hunt.trackingReveal || Number.isInteger(game.hunt.trackingCountdown));
    trackingBanner.classList.toggle("hidden", !trackingVisible);
    if (trackingVisible) {
      trackingBanner.classList.toggle("is-revealing", game.hunt.trackingReveal);
      trackingBanner.innerHTML = game.hunt.trackingReveal
        ? "<span>霧氣消散</span><strong>冒險者行蹤已暴露</strong>"
        : `<span>古墓迷霧</span><strong>迷霧將於 ${game.hunt.trackingCountdown} 回合後消散</strong>`;
    }
    const board = fragment.querySelector("[data-gangsi-board]");
    if (map) {
      board.style.setProperty("--cols", map.width);
      board.style.setProperty("--rows", map.height);
      const nextBoardSignature = boardRenderSignature(map, game);
      const currentBoard = mainPanelTemplate === "game"
        ? page.mainPanel.querySelector("[data-gangsi-board]")
        : null;
      if (currentBoard && nextBoardSignature === renderedBoardSignature) {
        board.__gangsiPreserveChildren = true;
      } else {
        renderBoard(board, map, game);
        renderedBoardSignature = nextBoardSignature;
      }
    } else {
      renderedBoardSignature = "";
    }
    const diceRow = fragment.querySelector("[data-gangsi-dice-row]");
    diceRow.style.setProperty("--dice-count", displayedDiceCount(game));
    diceRow.innerHTML = renderGameDice(game);
    const stage = actionStage(game);
    const stageHeading = fragment.querySelector("[data-gangsi-stage-heading]");
    stageHeading.dataset.stage = stage.tone;
    fragment.querySelector("[data-gangsi-stage-title]").textContent = turnStageTitle(game);
    fragment.querySelector("[data-gangsi-stage-label]").textContent = stage.label;
    const ownProgress = game.progress.find((progress) => progress.playerId === snapshot.you.id);
    const ownPieces = game.pieces.filter((piece) => piece.controllerId === snapshot.you.id);
    const lifeLabel = fragment.querySelector("[data-gangsi-life-label]");
    const missionsLabel = fragment.querySelector("[data-gangsi-missions-label]");
    if (snapshot.you.role === "mummy") {
      lifeLabel.textContent = "生命標記";
      missionsLabel.textContent = game.mode === "hunt" ? "團隊寶藏" : "已揭露";
      fragment.querySelector("[data-gangsi-life]").textContent = game.mode === "hunt" ? String(game.mummy.score) : `${game.mummy.score} / ${game.mummy.target}`;
      fragment.querySelector("[data-gangsi-missions]").textContent = game.mode === "hunt"
        ? `${game.revealedTasks.length} / ${game.hunt.treasureGoal}`
        : String(game.revealedTasks.length);
    } else {
      lifeLabel.textContent = ownPieces.length > 1 ? "棋子生命" : "生命";
      missionsLabel.textContent = game.mode === "hunt" ? "團隊寶藏" : "任務";
      fragment.querySelector("[data-gangsi-life]").textContent = ownPieces.map((piece) => Math.max(0, piece.life)).join(" / ") || "0";
      fragment.querySelector("[data-gangsi-missions]").textContent = game.mode === "hunt"
        ? `${game.revealedTasks.length} / ${game.hunt.treasureGoal}`
        : `${ownProgress?.completed || 0} / ${ownProgress?.total || 0}`;
    }
    fragment.querySelector("[data-gangsi-locked-dice]").textContent = `${game.lockedDiceCount} / ${game.dicePoolSize || 5}`;
    const turnMessage = publicTurnMessage(game);
    const orderInfoMessages = (messages) => SharedRoomUI.orderedTurnMessages({
      messages,
      currentTurnMessage: turnMessage,
      limit: ACTION_INFO_LIMIT,
      isTurnMessage: (message) => message.trim().startsWith("輪到")
    });
    const infoMessages = orderInfoMessages(game.actionInfo || snapshot.room.log.slice(-ACTION_INFO_LIMIT));
    if (snapshot.room.phase === "adventurer_roll" && isYourTurn(game)) {
      const hasRolledFaces = game.dice?.some((die) => !die.locked && die.face);
      if (hasRolledFaces && game.legal.dieIds?.length) {
        infoMessages.push("請點選一顆亮起的骰子，決定本回合的移動方式；也可以重新擲所有未鎖定的骰子。");
      } else if (hasRolledFaces) {
        infoMessages.push("目前沒有能完成移動的骰面，請重擲所有未鎖定骰。");
      }
    }
    if ((game.legal.actions || []).includes("moveNumeric") && isYourTurn(game)) {
      const complete = isNumericPathComplete(game);
      const movementCost = numericPathMovementCost(game);
      const movementBudget = game.legal.movementBudget || game.legal.selectedFace;
      infoMessages.push(complete
        ? `路徑已使用 ${movementCost} 點移動力，請確認移動。`
        : `路徑預覽：${movementCost} / ${movementBudget} 點移動力`);
    }
    const visibleInfoMessages = orderInfoMessages(infoMessages);
    fragment.querySelector("[data-gangsi-action-info]").innerHTML = SharedRoomUI.actionInfoBlock({
      messages: visibleInfoMessages,
      emptyText: "目前沒有行動資訊。",
      className: "gangsi-action-info-block",
      bodyClassName: "gangsi-action-info-body"
    });
    const actionRow = fragment.querySelector("[data-gangsi-action-row]");
    actionRow.classList.toggle("is-two-column", snapshot.room.phase === "adventurer_prepare");
    actionRow.classList.toggle("is-submenu", knightGuardOpen || mechanismSelectionOpen || knifeDirectionOpen
      || compassDieId || masonWallOpen || archaeologistOpen || phantomWallOpen);
    actionRow.classList.toggle("is-end-action", snapshot.room.phase === "adventurer_end");
    actionRow.innerHTML = renderGameActions(game);
    const huntStatus = fragment.querySelector("[data-gangsi-hunt-status]");
    huntStatus.classList.toggle("hidden", game.mode !== "hunt");
    if (game.mode === "hunt") huntStatus.innerHTML = renderHuntStatus(game);
    fragment.querySelector("[data-gangsi-hand-panel]").innerHTML = renderGameHand(game);
    commitMainPanel(fragment, "game");
    syncCaptureEffect(game);
    syncGameOverLightbox(game);
  }

  function renderGameSeat(player, index, game) {
    const pieces = game.pieces.filter((piece) => piece.controllerId === player.id);
    const progress = game.progress.find((item) => item.playerId === player.id);
    const isCurrent = game.currentPlayerId === player.id;
    const seatTone = SharedRoomUI.seatToneClass(index);
    const remainingGroups = progress ? Object.entries(progress.remainingByGroup) : [];
    const visibleRemainingGroups = game.mode === "hunt" && snapshot.you.role === "mummy"
      ? remainingGroups
      : remainingGroups.filter(([, count]) => count > 0);
    const groupProgress = player.role === "adventurer" && progress
      ? `<span class="gangsi-progress-groups" aria-label="各類寶藏剩餘任務">
          ${visibleRemainingGroups.map(([group, count]) => `
            <span data-group="${group}" title="${escapeAttribute(`${Format.GROUPS[group]?.name || group}剩餘 ${count} 張`)}">${group}:${count}</span>`).join("")}
        </span>`
      : "";
    const tokens = player.role === "mummy"
      ? '<span class="gangsi-piece-token is-mummy">怪</span>'
      : pieces.map((piece) => `
          <span class="gangsi-piece-token ${seatTone} ${piece.eliminated ? "is-eliminated" : ""} ${piece.escaped ? "is-escaped" : ""}">
            ${escapeHtml(piece.tokenLabel)}${pieces.length > 1 ? `<small>${piece.ordinal}</small>` : ""}
          </span>`).join("");
    const huntPiece = pieces[0];
    const publicStatuses = game.mode === "hunt" && player.role === "adventurer"
      && huntPiece && !huntPiece.escaped && !huntPiece.eliminated
      ? renderPiecePublicStatuses(huntPiece, { includeCooldown: snapshot.you.role === "adventurer" })
      : "";
    const identity = game.mode === "hunt"
      ? player.role === "mummy"
        ? mummyTypeLabel(game.mummy.type)
        : professionLabel(huntPiece?.profession)
      : roleLabel(player.role);
    const detailParts = [];
    if (player.role === "mummy") {
      if (game.mode !== "hunt") detailParts.push(`生命標記 ${game.mummy.score}/${game.mummy.target}`);
    } else if (game.mode === "hunt") {
      detailParts.push(`生命 ${pieces.map((piece) => Math.max(0, piece.life)).join("/")}`);
      const huntState = huntPiece?.escaped
        ? "已逃脫"
        : huntPiece?.eliminated
          ? "已死亡"
          : "";
      if (huntState) detailParts.push(huntState);
    } else {
      detailParts.push(
        `生命 ${pieces.map((piece) => Math.max(0, piece.life)).join("/")}`,
        `任務 ${progress?.completed || 0}/${progress?.total || 0}`
      );
    }
    if (isCurrent && !game.winner) detailParts.push("行動中");
    detailParts.push(player.online ? "在線" : "離線");
    return `
      <article class="gangsi-player-seat ${player.id === snapshot.you.id ? "is-self" : ""} ${isCurrent ? "is-current" : ""} ${player.online ? "" : "is-offline"}">
        ${SharedRoomUI.seatNumber(index, "gangsi-seat-number")}
        <span class="gangsi-seat-pieces">${tokens}</span>
        <div class="gangsi-player-seat-body">
          <div class="gangsi-player-seat-title">
            <strong title="${escapeAttribute(player.name)}">${escapeHtml(player.name)}</strong>
            ${publicStatuses}
          </div>
          ${groupProgress}
          <small>${escapeHtml([identity, ...detailParts].join(" · "))}</small>
        </div>
      </article>`;
  }

  function renderGameDice(game) {
    const phase = snapshot.room.phase;
    const publicLockedDice = game.lockedDice?.length
      ? game.lockedDice
      : Array.from({ length: game.lockedDiceCount }, (_, index) => ({ id: `locked-${index}`, kind: "normal" }));
    const lockedDice = publicLockedDice.length
      ? `<span class="gangsi-die is-locked is-locked-summary" title="鎖定的怪物骰共 ${publicLockedDice.length} 顆" aria-label="鎖定的怪物骰 ${publicLockedDice.length} 顆">
          <small>怪物骰</small><strong>× ${publicLockedDice.length}</strong>
        </span>`
      : "";
    if (["monster_interrupt_prepare", "monster_interrupt_action", "monster_interrupt_end"].includes(phase)) return lockedDice;
    if (["monster_prepare", "monster_roll", "monster_action", "monster_end"].includes(phase)) {
      const face = Number.isInteger(game.mummy.roll) ? game.mummy.roll : "?";
      const title = Number.isInteger(game.mummy.roll) ? `提燈怪骰擲出 ${game.mummy.roll} 點` : "尚未擲提燈怪骰";
      return `${lockedDice}<span class="gangsi-die is-mummy-die" title="${title}">${face}</span>`;
    }
    const mummyDie = Number.isInteger(game.mummy.roll)
      ? `<span class="gangsi-die is-mummy-die" title="提燈怪骰擲出 ${game.mummy.roll} 點">${game.mummy.roll}</span>`
      : "";
    const mechanismResult = phase === "adventurer_end" && game.endState?.kind === "mechanism"
      ? `<span class="gangsi-die is-mechanism-die" title="機關骰擲出 ${escapeAttribute(game.endState.diceFace)}">${escapeHtml(game.endState.diceFace)}</span>`
      : "";
    if (!game.dice) {
      const lockedIds = new Set(publicLockedDice.map((die) => die.id));
      const poolSize = game.dicePoolSize || 5;
      const hiddenDice = Array.from({ length: poolSize }, (_, index) => {
        const id = index === 5 ? "forbidden-die" : `die-${index + 1}`;
        const forbidden = id === "forbidden-die";
        const locked = lockedIds.has(id);
        return `<span class="gangsi-die ${locked ? "is-locked" : "is-hidden-face"} ${forbidden ? "is-forbidden" : ""}">
          ${locked ? "怪" : "?"}
        </span>`;
      }).join("");
      return hiddenDice + mummyDie + mechanismResult;
    }
    const selectable = new Set(game.legal.dieIds || []);
    const adventurerDice = game.dice.map((die) => {
      const label = die.locked ? "怪" : die.disabled ? "停" : dieFaceLabel(die.face);
      const kindClass = die.kind === "forbidden" ? "is-forbidden" : "";
      if (selectable.has(die.id)) {
        return `<button class="gangsi-die is-selectable ${kindClass}" data-gangsi-die="${escapeAttribute(die.id)}" type="button" title="使用 ${escapeAttribute(label)}${die.kind === "forbidden" ? "禁忌" : ""}骰">${escapeHtml(label)}</button>`;
      }
      return `<span class="gangsi-die ${kindClass} ${die.locked ? "is-locked" : ""} ${die.disabled ? "is-disabled" : ""}" ${die.disabled ? 'title="受傷：本回合少用這顆骰子"' : ""}>${escapeHtml(label)}</span>`;
    }).join("");
    return adventurerDice + mummyDie + mechanismResult;
  }

  function displayedDiceCount(game) {
    const phase = snapshot.room.phase;
    if (["monster_interrupt_prepare", "monster_interrupt_action", "monster_interrupt_end"].includes(phase)) return game.dicePoolSize || 5;
    if (["monster_prepare", "monster_roll", "monster_action", "monster_end"].includes(phase)) return game.dicePoolSize || 5;
    const base = game.dice?.length || game.dicePoolSize || 5;
    return Math.min(7, base + (phase === "adventurer_end" && game.endState?.kind === "mechanism" ? 1 : 0));
  }

  function renderGameActions(game) {
    const actions = new Set(game.legal.actions || []);
    if (snapshot.room.phase === "adventurer_prepare") {
      const currentPiece = game.pieces.find((piece) => piece.id === game.currentPieceId);
      const isCurrentAdventurer = snapshot.you.role === "adventurer"
        && currentPiece?.controllerId === snapshot.you.id;
      const guardButtons = (game.legal.guardTargets || []).map((pieceId) => {
        const target = game.pieces.find((piece) => piece.id === pieceId);
        const player = playerById(target?.controllerId);
        return `<button class="secondary-button" data-gangsi-guard-target="${escapeAttribute(pieceId)}" type="button">守護 ${escapeHtml(player?.name || "隊友")}</button>`;
      }).join("");
      if (actions.has("useKnightGuard") && knightGuardOpen) return `
        <span class="gangsi-action-hint">選擇玩家</span>
        ${guardButtons}
        <button class="ghost-button gangsi-submenu-cancel" data-gangsi-close-guard type="button">取消守護</button>`;
      const mechanisms = game.legal.mechanisms || [];
      if (actions.has("activateMechanism") && mechanismSelectionOpen) return `
        <span class="gangsi-action-hint">選擇機關</span>
        ${mechanisms.map((id) => `<button class="primary-button" data-gangsi-mechanism="${id}" type="button">機關 ${id}</button>`).join("")}
        <button class="ghost-button gangsi-submenu-cancel" data-gangsi-close-mechanism type="button">取消操作</button>`;
      if (actions.has("useMasonWall") && masonWallOpen) return `
        <span class="gangsi-action-hint">選擇築牆方向</span>
        ${wallDirectionGrid(game.legal.masonWallEdges || [], currentPiece?.position, "data-gangsi-mason-wall", "選擇石匠築牆方向")}
        <button class="ghost-button gangsi-submenu-cancel" data-gangsi-close-mason type="button">取消築牆</button>`;
      if (actions.has("useArchaeologistTask") && archaeologistOpen) return `
        <span class="gangsi-action-hint">選擇未完成任務</span>
        ${(game.legal.archaeologistTasks || []).map((task) => `<button class="secondary-button" data-gangsi-archaeologist-task="${escapeAttribute(task.id)}" type="button">${escapeHtml(task.id)} · ${escapeHtml(Format.GROUPS[task.id[0]]?.name || "寶藏")}</button>`).join("")}
        <button class="ghost-button gangsi-submenu-cancel" data-gangsi-close-archaeologist type="button">取消鑑定</button>`;
      const professionControl = actions.has("useKnightGuard")
        ? '<button class="secondary-button" data-gangsi-open-guard type="button" aria-expanded="false">騎士守護</button>'
        : actions.has("useWizardUnlock")
          ? `<button class="secondary-button" data-gangsi-game-action="useWizardUnlock" type="button">解鎖術（剩餘 ${currentPiece?.wizardCharges || 0} 次）</button>`
          : actions.has("useMasonWall")
            ? '<button class="secondary-button" data-gangsi-open-mason type="button">築起臨時牆</button>'
            : isCurrentAdventurer && currentPiece?.profession === "mason"
              ? currentPiece.abilityCooldown > 0
                ? `<button class="secondary-button" type="button" disabled>築起臨時牆（冷卻 ${currentPiece.abilityCooldown}）</button>`
                : '<button class="secondary-button" type="button" disabled title="目前位置沒有合法的相鄰道路邊">築起臨時牆（目前無合法位置）</button>'
            : actions.has("useArchaeologistTask")
              ? `<button class="secondary-button" data-gangsi-open-archaeologist type="button">禁忌鑑定（剩餘 ${currentPiece?.archaeologistCharges || 0} 次）</button>`
          : "";
      const mechanismControl = actions.has("activateMechanism")
        ? mechanisms.length === 1
          ? `<button class="primary-button" data-gangsi-mechanism="${mechanisms[0]}" type="button">操作機關</button>`
          : '<button class="primary-button" data-gangsi-open-mechanism type="button" aria-expanded="false">操作機關</button>'
        : "";
      return `
        ${actions.has("rollAdventurerDice") ? '<button class="primary-button" data-gangsi-game-action="rollAdventurerDice" type="button">擲冒險者骰</button>' : ""}
        ${actions.has("unlockDice") ? '<button class="secondary-button" data-gangsi-game-action="unlockDice" type="button">解鎖全部骰子</button>' : ""}
        ${professionControl}
        ${mechanismControl}
        ${actions.has("stopBleeding") ? '<button class="danger-button" data-gangsi-game-action="stopBleeding" type="button">止血並放棄回合</button>' : ""}`;
    }
    if (actions.has("rollAdventurerDice")) {
      if (compassDieId) return `
        <span class="gangsi-action-hint">羅盤要移動幾步？</span>
        ${(game.legal.compassDistances || []).map((distance) => `<button class="secondary-button" data-gangsi-compass-distance="${distance}" type="button">${distance} 步</button>`).join("")}
        <button class="ghost-button gangsi-submenu-cancel" data-gangsi-close-compass type="button">取消選擇</button>`;
      const hasFaces = game.dice?.some((die) => !die.locked && die.face);
      return `<button class="primary-button" data-gangsi-game-action="rollAdventurerDice" type="button">${hasFaces ? "重擲未鎖定骰" : "擲冒險者骰"}</button>`;
    }
    if (actions.has("moveNumeric")) return isNumericPathComplete(game)
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
    if (actions.has("finishAdventurerTurn")) return '<button class="primary-button" data-gangsi-game-action="finishAdventurerTurn" type="button">結束回合</button>';
    if (actions.has("chooseGazeDirection")) {
      const directions = new Set(game.legal.gazeDirections || []);
      return `<div class="gangsi-direction-grid" role="group" aria-label="選擇凝視方向">
        ${[["up", "↑"], ["left", "←"], ["down", "↓"], ["right", "→"]]
          .map(([direction, label]) => `<button class="ghost-button" data-gangsi-gaze="${direction}" type="button" title="${directionLabel(direction)}凝視" ${directions.has(direction) ? "" : "disabled"}>${label}</button>`).join("")}
      </div>`;
    }
    if (actions.has("infectTreasure")) {
      return '<span class="gangsi-action-hint is-required">必須先點選地圖上亮起的寶藏進行感染</span>';
    }
    if ((snapshot.room.phase === "monster_prepare" && actions.has("rollMummyDie")) || actions.has("hideMummy") || actions.has("revealMummy") || actions.has("throwKnife") || actions.has("placeTrap") || actions.has("recoverTrap")
      || actions.has("setGrave") || actions.has("burrowToGrave") || actions.has("placePhantomWall")) {
      if (actions.has("throwKnife") && knifeDirectionOpen) return `
        <span class="gangsi-action-hint">選擇方向</span>
        <div class="gangsi-direction-grid" role="group" aria-label="選擇飛刀方向">
          ${[["up", "↑"], ["left", "←"], ["down", "↓"], ["right", "→"]]
            .map(([direction, label]) => `<button class="ghost-button" data-gangsi-knife="${direction}" type="button" title="向${directionLabel(direction)}投擲飛刀">${label}</button>`).join("")}
        </div>
        <button class="ghost-button gangsi-submenu-cancel" data-gangsi-close-knife type="button">取消投擲</button>`;
      if (actions.has("placePhantomWall") && phantomWallOpen) return `
        <span class="gangsi-action-hint">選擇築牆方向</span>
        ${wallDirectionGrid(game.legal.phantomWallEdges || [], game.mummy.position, "data-gangsi-phantom-wall", "選擇幻影牆方向")}
        <button class="ghost-button gangsi-submenu-cancel" data-gangsi-close-phantom type="button">取消放牆</button>`;
      return `
        ${actions.has("hideMummy") ? '<button class="primary-button" data-gangsi-game-action="hideMummy" type="button">進入隱形</button>' : ""}
        ${actions.has("revealMummy") ? '<button class="secondary-button" data-gangsi-game-action="revealMummy" type="button">現形並結束回合</button>' : ""}
        ${actions.has("throwKnife") ? '<button class="primary-button" data-gangsi-open-knife type="button" aria-expanded="false">投擲飛刀</button>' : ""}
        ${actions.has("setGrave") ? `<button class="secondary-button" data-gangsi-game-action="setGrave" type="button">${game.hunt.grave ? "搬移墓穴至目前位置" : "在目前位置設置墓穴"}</button>` : ""}
        ${actions.has("burrowToGrave") ? '<button class="primary-button" data-gangsi-game-action="burrowToGrave" type="button">遁地至墓穴</button>' : ""}
        ${actions.has("placePhantomWall") ? '<button class="secondary-button" data-gangsi-open-phantom type="button">建立幻影牆</button>' : ""}
        ${actions.has("placeTrap") ? '<span class="gangsi-action-hint">點選沿道路 1～2 步內的亮起格放置陷阱</span>' : ""}
        ${actions.has("recoverTrap") ? '<span class="gangsi-action-hint">可點選沿道路 1～2 步內的陷阱回收</span>' : ""}
        ${actions.has("rollMummyDie") ? `<button class="${actions.has("hideMummy") || actions.has("throwKnife") ? "secondary-button" : "primary-button"}" data-gangsi-game-action="rollMummyDie" type="button">擲提燈怪骰</button>` : ""}`;
    }
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

  function boardRenderSignature(map, game) {
    return JSON.stringify({
      map,
      playerOrder: snapshot.room.players.map((player) => player.id),
      mode: game.mode,
      revealedTasks: game.revealedTasks.map((task) => task.id),
      currentPieceId: game.currentPieceId,
      currentPlayerId: game.currentPlayerId,
      pieces: game.pieces.map((piece) => ({
        id: piece.id,
        controllerId: piece.controllerId,
        tokenLabel: piece.tokenLabel,
        ordinal: piece.ordinal,
        position: piece.position,
        eliminated: piece.eliminated
      })),
      mummy: {
        playerId: game.mummy.playerId,
        position: game.mummy.position
      },
      legalTargets: boardLegalTargets(game),
      actionableMechanisms: game.legal.mechanisms || [],
      numericPath,
      hunt: game.mode === "hunt" ? {
        treasureGoal: game.hunt.treasureGoal,
        exits: game.hunt.exits,
        mechanisms: game.hunt.mechanisms,
        mechanismSeals: game.hunt.mechanismSeals,
        traps: game.hunt.traps,
        hatch: game.hunt.hatch,
        knifeTrackedPositions: game.hunt.knifeTrackedPositions,
        gazeTrackedPositions: game.hunt.gazeTrackedPositions,
        gazeLine: game.hunt.gazeLine,
        purificationPools: game.hunt.purificationPools,
        infectedTreasures: game.hunt.infectedTreasures,
        temporaryWall: game.hunt.temporaryWall,
        phantomWall: game.hunt.phantomWall,
        grave: game.hunt.grave
      } : null
    });
  }

  function renderBoard(container, map, game) {
    container.style.setProperty("--cols", map.width);
    container.style.setProperty("--rows", map.height);
    const walls = new Set(map.walls);
    const teamTasksComplete = game.mode === "hunt" && game.revealedTasks.length >= game.hunt.treasureGoal;
    const visibleMapTreasures = teamTasksComplete ? [] : map.treasures;
    const originalTreasureByCell = new Map(map.treasures.map((treasure) => [treasure.position, treasure]));
    const revealedTreasureIds = new Set(game.revealedTasks.map((task) => task.id));
    const treasureByCell = new Map(visibleMapTreasures
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
    const actionableMechanisms = new Set(game.legal.mechanisms || []);
    const selectedPath = new Set(numericPath);
    const huntMarkers = new Map();
    if (game.mode === "hunt") {
      for (const id of Format.HUNT_MECHANISM_IDS) {
        const position = map.hunt?.mechanisms?.[id];
        const status = game.hunt.exits[id];
        const actionable = actionableMechanisms.has(id);
        const sealed = Boolean(game.hunt.mechanismSeals?.[id]);
        if (position) huntMarkers.set(position, {
          type: status === "open" ? "exit" : "mechanism",
          id,
          progress: game.hunt.mechanisms[id],
          status: status === "open" ? "open" : sealed ? "sealed" : teamTasksComplete ? "ready" : "closed",
          sealed,
          actionable
        });
      }
    }
    const traps = new Set(game.mode === "hunt" ? game.hunt.traps : []);
    const hatchCell = game.mode === "hunt" && game.hunt.hatch.status === "open" ? game.hunt.hatch.position : null;
    const knifeTrackedCells = new Set((game.mode === "hunt" ? game.hunt.knifeTrackedPositions || [] : []).map((position) => (
      position === "entrance" ? map.zones.entrance.anchor : position === "dungeon" ? map.zones.dungeon.anchor : position
    )));
    const gazeTrackedCells = new Set((game.mode === "hunt" ? game.hunt.gazeTrackedPositions || [] : []).map((position) => (
      position === "entrance" ? map.zones.entrance.anchor : position === "dungeon" ? map.zones.dungeon.anchor : position
    )));
    const gazeCells = new Set(game.mode === "hunt" ? game.hunt.gazeLine?.cells || [] : []);
    const purificationPools = new Set(game.mode === "hunt" ? game.hunt.purificationPools || [] : []);
    const infectionByCell = new Map(game.mode === "hunt"
      ? (game.hunt.infectedTreasures || []).map((infection) => [infection.position, infection])
      : []);
    const infectedCells = new Set(infectionByCell.keys());
    const temporaryWall = game.mode === "hunt" ? game.hunt.temporaryWall?.edge : null;
    const phantomWall = game.mode === "hunt" ? game.hunt.phantomWall?.edge : null;
    const graveCell = game.mode === "hunt" ? game.hunt.grave : null;
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
        const huntMarker = huntMarkers.get(cell);
        const infection = infectionByCell.get(cell);
        const pieceMarkup = cellPieces.map((piece) => `
          <span class="gangsi-board-piece ${seatToneByPlayerId.get(piece.controllerId) || ""} ${piece.id === game.currentPieceId ? "is-current" : ""}">
            ${escapeHtml(piece.tokenLabel)}${cellPieces.length > 1 || piece.ordinal > 1 ? `<small>${piece.ordinal}</small>` : ""}
          </span>`).join("");
        const mummyMarkup = mummyCell === cell
          ? `<span class="gangsi-board-piece is-mummy ${game.currentPlayerId === game.mummy.playerId ? "is-current" : ""}">怪</span>`
          : "";
        cells.push(`
          <button type="button" data-gangsi-board-cell="${cell}" ${originalTreasure ? `data-gangsi-treasure-origin="${originalTreasure.id}"` : ""} class="gangsi-board-cell is-${cellClass} ${huntMarker ? `is-hunt-${huntMarker.type} is-${huntMarker.status || "active"} ${huntMarker.actionable ? "is-mechanism-actionable" : ""}` : ""} ${hatchCell === cell ? "is-hatch" : ""} ${graveCell === cell ? "has-grave" : ""} ${knifeTrackedCells.has(cell) ? "is-knife-tracked" : ""} ${gazeTrackedCells.has(cell) ? "is-gaze-tracked" : ""} ${gazeCells.has(cell) ? "is-gaze-line" : ""} ${purificationPools.has(cell) ? "has-purification-pool" : ""} ${infectedCells.has(cell) ? "has-infection" : ""} ${traps.has(cell) ? "has-trap" : ""} ${walls.has(rightEdge) ? "wall-right" : ""} ${walls.has(bottomEdge) ? "wall-bottom" : ""} ${temporaryWall && temporaryWall === rightEdge ? "wall-right is-temporary-wall-right" : ""} ${temporaryWall && temporaryWall === bottomEdge ? "wall-bottom is-temporary-wall-bottom" : ""} ${phantomWall && phantomWall === rightEdge ? "wall-right is-phantom-wall-right" : ""} ${phantomWall && phantomWall === bottomEdge ? "wall-bottom is-phantom-wall-bottom" : ""} ${legalTargets.has(cell) ? "is-legal-target" : ""} ${selectedPath.has(cell) ? "is-path-cell" : ""}"
            aria-label="${escapeAttribute(`${cell} ${labels[cellClass] || "道路"}${treasure ? ` ${treasure.id} ${treasureGroup?.name || "寶藏"}` : ""}${huntMarker ? ` ${huntMarker.type === "mechanism" ? "機關" : "逃生出口"} ${huntMarker.id}${huntMarker.type === "mechanism" ? ` 進度 ${huntMarker.progress}/${Format.HUNT_MECHANISM_TARGET}${huntMarker.sealed ? " 封印中" : ""}` : ""}${huntMarker.actionable ? " 目前可操作" : ""}` : ""}${hatchCell === cell ? " 密道" : ""}${graveCell === cell ? " 墓穴" : ""}${knifeTrackedCells.has(cell) ? " 飛刀追蹤座標" : ""}${gazeTrackedCells.has(cell) ? " 凝視追蹤座標" : ""}${gazeCells.has(cell) ? " 凝視線" : ""}${purificationPools.has(cell) ? " 淨化池" : ""}${infection ? ` 感染寶藏，傳染倒數 ${infection.remaining} 回合` : ""}`)}">
            <span class="cell-coordinate">${cell}</span>
            ${labels[cellClass] ? `<span class="gangsi-zone-label">${labels[cellClass]}</span>` : ""}
            ${huntMarker ? `<span class="gangsi-hunt-marker">${huntMarker.sealed ? "封" : huntMarker.type === "mechanism" ? `機${huntMarker.id}<small>${huntMarker.actionable ? "可操作" : `${huntMarker.progress}/${Format.HUNT_MECHANISM_TARGET}`}</small>` : `出${huntMarker.id}<small>${huntMarker.status === "open" ? "開" : "關"}</small>`}</span>` : ""}
            ${hatchCell === cell ? '<span class="gangsi-hatch-marker">密</span>' : ""}
            ${graveCell === cell ? '<span class="gangsi-grave-marker" title="遁地鬼墓穴">墓</span>' : ""}
            ${knifeTrackedCells.has(cell) ? '<span class="gangsi-knife-tracked-marker" title="飛刀追蹤中的匿名座標">追</span>' : ""}
            ${gazeTrackedCells.has(cell) ? '<span class="gangsi-gaze-tracked-marker" title="凝視追蹤中的匿名座標">視</span>' : ""}
            ${purificationPools.has(cell) ? '<span class="gangsi-purification-marker" title="淨化池">淨</span>' : ""}
            ${infection ? `<span class="gangsi-infection-marker" title="受感染的寶藏，傳染倒數 ${infection.remaining} 回合">染<small>${infection.remaining}</small></span>` : ""}
            ${traps.has(cell) ? '<span class="gangsi-trap-marker" title="你放置的陷阱">陷</span>' : ""}
            ${treasure ? `<span class="gangsi-treasure-token" data-gangsi-treasure-id="${treasure.id}" data-group="${treasure.id[0]}" title="${escapeAttribute(`${treasure.id} ${treasureGroup?.name || "寶藏"}`)}">${treasure.id}</span>` : ""}
            <span class="gangsi-board-piece-stack">${pieceMarkup}${mummyMarkup}</span>
          </button>`);
      }
    }
    container.innerHTML = cells.join("");
  }

  function boardLegalTargets(game) {
    if ((game.legal.actions || []).includes("moveNumeric") && game.legal.paths) {
      return game.legal.paths
        .filter((path) => numericPath.every((cell, index) => path[index] === cell))
        .map((path) => path[numericPath.length])
        .filter(Boolean);
    }
    if ((game.legal.actions || []).includes("moveMummy")) return game.legal.moves || [];
    if (snapshot.room.phase === "monster_prepare") return [
      ...(game.legal.trapPlacements || []),
      ...(game.legal.trapRecoveries || []),
      ...(game.legal.infectionTreasures || []).map((treasure) => treasure.position)
    ];
    return [];
  }

  function handleMainClick(event) {
    const roleButton = event.target.closest("[data-gangsi-role]");
    if (roleButton) return sendAction("chooseRole", { role: roleButton.dataset.gangsiRole });
    if (event.target.closest("[data-gangsi-roll]")) return sendAction("roll");
    if (event.target.closest("[data-gangsi-ready]")) return sendAction("toggleReady");
    if (event.target.closest("[data-gangsi-start]")) return sendAction("startGame");
    if (event.target.closest("[data-gangsi-return-lobby]")) return sendAction("returnLobby");
    if (event.target.closest("[data-gangsi-open-guard]")) {
      knightGuardOpen = true;
      mechanismSelectionOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-close-guard]")) {
      knightGuardOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-open-mechanism]")) {
      mechanismSelectionOpen = true;
      knightGuardOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-close-mechanism]")) {
      mechanismSelectionOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-open-knife]")) {
      knifeDirectionOpen = true;
      knightGuardOpen = false;
      mechanismSelectionOpen = false;
      phantomWallOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-close-knife]")) {
      knifeDirectionOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-open-mason]")) {
      masonWallOpen = true;
      knightGuardOpen = false;
      mechanismSelectionOpen = false;
      archaeologistOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-close-mason]")) {
      masonWallOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-open-archaeologist]")) {
      archaeologistOpen = true;
      knightGuardOpen = false;
      mechanismSelectionOpen = false;
      masonWallOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-close-archaeologist]")) {
      archaeologistOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-open-phantom]")) {
      phantomWallOpen = true;
      knifeDirectionOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-close-phantom]")) {
      phantomWallOpen = false;
      renderMain();
      return;
    }
    if (event.target.closest("[data-gangsi-close-compass]")) {
      compassDieId = "";
      renderMain();
      return;
    }
    const gameAction = event.target.closest("[data-gangsi-game-action]");
    if (gameAction) return sendAction(gameAction.dataset.gangsiGameAction);
    const die = event.target.closest("[data-gangsi-die]");
    if (die) {
      const selected = snapshot.room.game.dice?.find((candidate) => candidate.id === die.dataset.gangsiDie);
      if (selected?.face === "compass") {
        compassDieId = selected.id;
        renderMain();
        return;
      }
      return sendAction("selectDie", { dieId: die.dataset.gangsiDie });
    }
    const compass = event.target.closest("[data-gangsi-compass-distance]");
    if (compass) {
      const dieId = compassDieId;
      compassDieId = "";
      return sendAction("selectDie", { dieId, distance: Number(compass.dataset.gangsiCompassDistance) });
    }
    const arrow = event.target.closest("[data-gangsi-arrow]");
    if (arrow) return sendAction("moveArrow", { direction: arrow.dataset.gangsiArrow });
    const gaze = event.target.closest("[data-gangsi-gaze]");
    if (gaze) return sendAction("chooseGazeDirection", { direction: gaze.dataset.gangsiGaze });
    const guard = event.target.closest("[data-gangsi-guard-target]");
    if (guard) {
      knightGuardOpen = false;
      return sendAction("useKnightGuard", { pieceId: guard.dataset.gangsiGuardTarget });
    }
    const mechanism = event.target.closest("[data-gangsi-mechanism]");
    if (mechanism) {
      mechanismSelectionOpen = false;
      return sendAction("activateMechanism", { gateId: mechanism.dataset.gangsiMechanism });
    }
    const masonWall = event.target.closest("[data-gangsi-mason-wall]");
    if (masonWall) {
      masonWallOpen = false;
      return sendAction("useMasonWall", { edge: masonWall.dataset.gangsiMasonWall });
    }
    const archaeologistTask = event.target.closest("[data-gangsi-archaeologist-task]");
    if (archaeologistTask) {
      archaeologistOpen = false;
      return sendAction("useArchaeologistTask", { taskId: archaeologistTask.dataset.gangsiArchaeologistTask });
    }
    const knife = event.target.closest("[data-gangsi-knife]");
    if (knife) {
      knifeDirectionOpen = false;
      return sendAction("throwKnife", { direction: knife.dataset.gangsiKnife });
    }
    const phantomWall = event.target.closest("[data-gangsi-phantom-wall]");
    if (phantomWall) {
      phantomWallOpen = false;
      return sendAction("placePhantomWall", { edge: phantomWall.dataset.gangsiPhantomWall });
    }
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
    if ((game.legal.actions || []).includes("moveNumeric")) {
      numericPath.push(cell);
      renderMain();
      return;
    }
    if ((game.legal.actions || []).includes("moveMummy")) {
      sendAction("moveMummy", { cell });
      return;
    }
    if (snapshot.room.phase === "monster_prepare") {
      const infection = (game.legal.infectionTreasures || []).find((treasure) => treasure.position === cell);
      if (infection) sendAction("infectTreasure", { treasureId: infection.id });
      else if ((game.legal.trapRecoveries || []).includes(cell)) sendAction("recoverTrap", { cell });
      else if ((game.legal.trapPlacements || []).includes(cell)) sendAction("placeTrap", { cell });
    }
  }

  function handleTokenLabelCompositionStart(event) {
    if (!event.target.matches("[data-gangsi-token-label]")) return;
    composingTokenLabelInput = event.target;
    committedTokenLabelInput = null;
    committedTokenLabelValue = "";
  }

  function handleTokenLabelCompositionEnd(event) {
    if (!event.target.matches("[data-gangsi-token-label]")) return;
    composingTokenLabelInput = null;
    committedTokenLabelInput = event.target;
    committedTokenLabelValue = event.target.value;
    if (snapshot.room.phase !== "lobby") {
      renderMain();
      return;
    }
    sendAction("updateTokenLabel", { tokenLabel: event.target.value });
  }

  function handleMainInput(event) {
    if (!event.target.matches("[data-gangsi-token-label]")) return;
    if (event.isComposing || event.target === composingTokenLabelInput) return;
    if (event.target === committedTokenLabelInput && event.target.value === committedTokenLabelValue) {
      committedTokenLabelInput = null;
      committedTokenLabelValue = "";
      return;
    }
    committedTokenLabelInput = null;
    committedTokenLabelValue = "";
    sendAction("updateTokenLabel", { tokenLabel: event.target.value });
  }

  function handleMainChange(event) {
    if (event.target.matches("[data-gangsi-profession]")) return sendAction("chooseProfession", { profession: event.target.value });
    if (event.target.matches("[data-gangsi-mummy-type]")) return sendAction("chooseMummyType", { mummyType: event.target.value });
    if (!event.target.matches("[data-gangsi-mode], [data-gangsi-player-count], [data-gangsi-map-select], [data-gangsi-random-map]")) return;
    const mode = page.mainPanel.querySelector("[data-gangsi-mode]");
    const playerCount = page.mainPanel.querySelector("[data-gangsi-player-count]");
    const mapSelect = page.mainPanel.querySelector("[data-gangsi-map-select]");
    const randomMap = page.mainPanel.querySelector("[data-gangsi-random-map]");
    const requestedCount = mode.value === "hunt" ? Math.max(3, Number(playerCount.value)) : Number(playerCount.value);
    sendAction("updateSettings", {
      mode: mode.value,
      playerCount: requestedCount,
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
    const isHunt = snapshot.room.settings.mode === "hunt";
    if (snapshot.room.players.length !== snapshot.room.settings.playerCount) {
      messages.push(`需要 ${snapshot.room.settings.playerCount} 位玩家，目前 ${snapshot.room.players.length} 位。`);
    }
    if (!snapshot.room.settings.randomMap && !selectedMapOption()) messages.push("請選擇有效地圖。");
    if (!snapshot.room.settings.randomMap && isHunt && !selectedMapOption()?.huntCompatible) messages.push("這張地圖尚未設定兩座獵殺機關。");
    if (snapshot.room.settings.randomMap && isHunt && !snapshot.room.maps.some((map) => map.huntCompatible)) messages.push("目前沒有支援獵殺模式的地圖。");
    if (snapshot.room.players.filter((player) => player.role === "mummy").length !== 1) {
      messages.push("需要正好一位玩家選擇擔任提燈怪。");
    }
    if (snapshot.room.players.some((player) => player.role === "adventurer" && !player.tokenLabel)) {
      messages.push("所有冒險者都需要填寫一字棋子文字。");
    }
    if (snapshot.room.players.some((player) => player.role === "adventurer" && !player.roll)) {
      messages.push("所有冒險者都需要先擲 d100。");
    }
    if (isHunt) {
      const professions = snapshot.room.players.filter((player) => player.role === "adventurer").map((player) => player.profession);
      if (professions.some((profession) => !profession)) messages.push("所有冒險者都需要選擇職業。");
      if (new Set(professions.filter(Boolean)).size !== professions.filter(Boolean).length) messages.push("獵殺模式的冒險者職業不能重複。");
      const mummy = snapshot.room.players.find((player) => player.role === "mummy");
      if (!mummy?.mummyTypeSelected) messages.push("提燈怪需要選擇類型。");
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

  function modeLabel(mode) {
    return mode === "hunt" ? "獵殺模式" : "經典模式";
  }

  function professionLabel(profession) {
    return {
      knight: "騎士",
      archaeologist: "遺跡學家",
      doctor: "醫生",
      wizard: "魔法師",
      scout: "斥候",
      tombRaider: "盜墓者",
      mason: "石匠",
      cultist: "邪教徒"
    }[profession] || "未選職業";
  }

  function mummyTypeLabel(type) {
    return {
      trap: "陷阱鬼",
      invisible: "隱形鬼",
      knife: "飛刀手",
      burrow: "遁地鬼",
      phantom: "幻影鬼",
      gazer: "凝視者",
      corrupt: "腐化鬼"
    }[type] || "未選類型";
  }

  function piecePublicStatuses(piece, { includeCooldown = false } = {}) {
    const statuses = [];
    if (!piece) return statuses;
    if (piece.guard) {
      const turns = Number.isInteger(piece.guardTurns) && piece.guardTurns > 0 ? piece.guardTurns : null;
      statuses.push({
        label: turns ? `守護 ${turns}` : "守護",
        description: turns ? `守護剩餘 ${turns} 個提燈怪正常回合` : "受守護",
        tone: "buff"
      });
    }
    if (piece.injured) statuses.push({ label: "受傷", description: "受傷", tone: "debuff" });
    if (piece.bleeding) statuses.push({ label: "流血", description: "流血", tone: "debuff" });
    if (piece.trackedByKnife) statuses.push({ label: "追蹤", description: "被飛刀追蹤", tone: "debuff" });
    if (piece.gazeStacks > 0) {
      statuses.push({
        label: `凝視 ${piece.gazeStacks}`,
        description: `凝視 ${piece.gazeStacks} 層`,
        tone: "debuff"
      });
    }
    if (piece.corrupted) {
      statuses.push({
        label: `腐化 ${piece.corruptionTurns}`,
        description: `腐化 ${piece.corruptionTurns} 回合`,
        tone: "debuff"
      });
    }
    if (includeCooldown && ["knight", "tombRaider", "mason"].includes(piece.profession)
      && piece.abilityCooldown > 0) {
      statuses.push({
        label: `冷卻 ${piece.abilityCooldown}`,
        description: `職業能力冷卻 ${piece.abilityCooldown} 回合`,
        tone: "debuff"
      });
    }
    return statuses;
  }

  function renderPiecePublicStatuses(piece, options) {
    const statuses = piecePublicStatuses(piece, options);
    if (!statuses.length) return "";
    return `<span class="gangsi-player-status-list" aria-label="公開狀態">
      ${statuses.map((status) => `<span class="gangsi-player-status is-${status.tone}" title="${escapeAttribute(status.description)}">${escapeHtml(status.label)}</span>`).join("")}
    </span>`;
  }

  function lobbySpecialization(player) {
    if (snapshot.room.settings.mode !== "hunt") return "";
    if (player.role === "adventurer") return ` · ${professionLabel(player.profession)}`;
    return ` · ${player.mummyType ? mummyTypeLabel(player.mummyType) : player.mummyTypeSelected ? "已選擇類型" : "未選類型"}`;
  }

  function pieceLabel(player) {
    return player.role === "mummy" ? "怪" : (player.tokenLabel || "未設定");
  }

  function phaseLabel(phase) {
    return {
      lobby: "準備大廳",
      adventurer_prepare: "冒險者準備",
      adventurer_action: "冒險者行動",
      monster_prepare: "提燈怪準備",
      monster_roll: "提燈怪擲骰",
      monster_action: "提燈怪行動",
      monster_end: "提燈怪結束",
      monster_interrupt_prepare: "插入回合準備",
      monster_interrupt_action: "插入回合行動",
      monster_interrupt_end: "插入回合結束",
      adventurer_roll: "冒險者擲骰",
      adventurer_end: "結束階段",
      game_over: "遊戲結束"
    }[phase] || phase;
  }

  function actionStage(game) {
    const phase = snapshot.room.phase;
    if (phase === "adventurer_prepare") return { label: "準備行動", tone: "prepare" };
    if (["adventurer_roll", "monster_roll"].includes(phase)) return { label: "擲骰", tone: "roll" };
    if (["adventurer_action", "monster_action"].includes(phase)) return { label: "移動", tone: "move" };
    if (["monster_interrupt_prepare", "monster_interrupt_action", "monster_interrupt_end"].includes(phase)) return { label: "插入移動", tone: "mummy" };
    if (phase === "monster_prepare") return { label: "能力選擇", tone: "mummy" };
    if (phase === "monster_end") return { label: "回合結算", tone: "mummy" };
    if (phase === "adventurer_end") {
      if (game.endState?.kind === "mechanism") return { label: "機關結果", tone: "mechanism" };
      if (game.endState?.kind === "no_movement") return { label: "無路可走", tone: "skip" };
      return { label: "任務判定", tone: "task" };
    }
    if (phase === "game_over") return { label: "遊戲結束", tone: "complete" };
    return { label: phaseLabel(phase), tone: "prepare" };
  }

  function turnStageTitle(game) {
    if (game.turnStage === "prepare") return "準備階段";
    if (game.turnStage === "roll") return "擲骰階段";
    if (game.turnStage === "action") return "行動階段";
    if (game.turnStage === "end") return "結束階段";
    return ["monster_interrupt_prepare", "monster_interrupt_action", "monster_interrupt_end"].includes(snapshot.room.phase) ? "插入回合" : "提燈怪回合";
  }

  function gamePhaseDescription(game) {
    const current = playerById(game.currentPlayerId);
    if (game.winner) {
      if (game.mode === "hunt") return game.winner.role === "mummy"
        ? "所有冒險者都已死亡，提燈怪完成獵殺。"
        : "至少一名冒險者成功逃出古墓。";
      const winner = playerById(game.winner.playerId);
      return game.winner.role === "mummy"
        ? `提燈怪 ${winner?.name || ""} 獲勝。`
        : `冒險者 ${winner?.name || ""} 完成全部任務。`;
    }
    if (snapshot.room.phase === "adventurer_prepare") return game.mode === "hunt"
      ? `${current?.name || "冒險者"} 正在選擇能力、機關、止血、解鎖或直接擲骰。`
      : `${current?.name || "冒險者"} 可直接擲骰，或先解鎖全部怪物骰。`;
    if (snapshot.room.phase === "monster_prepare") {
      if (game.mode !== "hunt") return "請提燈怪擲一次提燈怪骰，決定本回合的最大移動步數。";
      if (game.mummy.type === "corrupt") {
        return game.hunt.infectionRequired
          ? "腐化鬼必須先感染一個寶藏，完成後才能擲骰。"
          : "腐化鬼本回合沒有可感染的寶藏，可直接擲骰。";
      }
      return game.mummy.type === "invisible" && game.mummy.invisible
        ? "隱形鬼可維持隱形並擲骰，或現形後立即結束回合。"
        : `提燈怪可先使用${mummyTypeLabel(game.mummy.type)}能力，或直接擲骰。`;
    }
    if (snapshot.room.phase === "adventurer_roll") return `${current?.name || "冒險者"} 正在擲骰並選擇本回合的移動方式。`;
    if (snapshot.room.phase === "adventurer_action") return game.legal.selectedFace === "arrow"
      ? `${current?.name || "冒險者"} 已選擇箭頭骰，正在決定移動方向。`
      : `${current?.name || "冒險者"} 已選擇${game.legal.selectedFace === "compass" ? `羅盤 ${game.legal.movementBudget} 步` : `移動 ${game.legal.movementBudget || game.legal.selectedFace || game.lastPublicDie} 步`}。`;
    if (["monster_interrupt_prepare", "monster_interrupt_action", "monster_interrupt_end"].includes(snapshot.room.phase)) return `提燈怪正在進行插入回合，還可移動 ${game.mummy.remaining} 步，也可以立即結束。`;
    if (snapshot.room.phase === "monster_action") return `提燈怪骰擲出 ${game.mummy.roll} 點；還可移動 ${game.mummy.remaining} 步，也可以立即結束。`;
    if (snapshot.room.phase === "monster_end" && (game.legal.actions || []).includes("chooseGazeDirection")) {
      return "凝視者正在選擇凝視方向。";
    }
    if (snapshot.room.phase === "adventurer_end") {
      if (game.endState?.kind === "mechanism") {
        const result = game.endState;
        return `機關 ${result.mechanismId} 擲出 ${result.diceFace}，進度成為 ${result.finalProgress} / ${Format.HUNT_MECHANISM_TARGET}${result.sealed ? "，並封印 1 個冒險者回合" : ""}。`;
      }
      if (game.endState?.kind === "no_movement") {
        return game.endState.reason === "all_dice_locked"
          ? `${current?.name || "冒險者"} 沒有可用骰子，已進入結束階段。`
          : `${current?.name || "冒險者"} 沒有可移動的道路，已略過擲骰與行動階段。`;
      }
      return `${current?.name || "冒險者"} 正在決定是否揭露這項寶藏。`;
    }
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
    return { arrow: "箭", compass: "羅", mummy: "怪", null: "--" }[face] || face || "--";
  }

  function directionLabel(direction) {
    return { up: "向上", right: "向右", down: "向下", left: "向左" }[direction] || direction;
  }

  function isNumericPathComplete(game) {
    return (game.legal.paths || []).some((path) => path.length === numericPath.length
      && path.every((cell, index) => cell === numericPath[index]));
  }

  function numericPathMovementCost(game) {
    const current = game.pieces.find((piece) => piece.id === game.currentPieceId);
    if (!current?.position || !numericPath.length) return 0;
    const walls = new Set([
      ...(snapshot.room.selectedMap?.walls || []),
      game.hunt?.temporaryWall?.edge,
      game.hunt?.phantomWall?.edge
    ].filter(Boolean));
    let position = current.position;
    let cost = 0;
    for (const cell of numericPath) {
      const edge = Format.canonicalEdge(position, cell);
      cost += walls.has(edge) ? 2 : 1;
      position = cell;
    }
    return cost;
  }

  function wallDirectionGrid(edges, origin, actionAttribute, ariaLabel) {
    const edgesByDirection = new Map();
    for (const edge of edges) {
      const direction = edgeDirection(edge, origin);
      if (direction) edgesByDirection.set(direction, edge);
    }
    return `<div class="gangsi-direction-grid" role="group" aria-label="${escapeAttribute(ariaLabel)}">
      ${[["up", "↑"], ["left", "←"], ["down", "↓"], ["right", "→"]].map(([direction, label]) => {
        const edge = edgesByDirection.get(direction);
        const action = edge ? `${actionAttribute}="${escapeAttribute(edge)}"` : "";
        return `<button class="ghost-button" data-gangsi-wall-direction="${direction}" ${action} type="button" title="向${directionLabel(direction)}築牆" ${edge ? "" : "disabled"}>${label}</button>`;
      }).join("")}
    </div>`;
  }

  function edgeDirection(edge, origin) {
    const cells = String(edge || "").split("|");
    const target = cells.find((cell) => cell !== origin);
    if (!target || !origin) return "";
    const [originX, originY] = Format.parseCell(origin);
    const [targetX, targetY] = Format.parseCell(target);
    if (targetY < originY) return "up";
    if (targetX > originX) return "right";
    if (targetY > originY) return "down";
    if (targetX < originX) return "left";
    return "";
  }

  function renderHuntStatus(game) {
    const currentPiece = game.pieces.find((piece) => piece.controllerId === snapshot.you.id);
    const ability = snapshot.you.role === "mummy"
      ? `${mummyTypeLabel(game.mummy.type)}${game.mummy.invisible ? " · 隱形中" : ""} · 冷卻 ${game.mummy.abilityCooldown}`
      : currentPiece
        ? [
            professionLabel(currentPiece.profession),
            currentPiece.profession === "wizard"
              ? `解鎖術 ${currentPiece.wizardCharges}`
              : currentPiece.profession === "mason"
                ? `冷卻 ${currentPiece.abilityCooldown}`
                : currentPiece.profession === "archaeologist"
                  ? `鑑定 ${currentPiece.archaeologistCharges}`
                  : ["knight", "tombRaider"].includes(currentPiece.profession)
                    ? `冷卻 ${currentPiece.abilityCooldown}`
                    : ""
          ].filter(Boolean).join(" · ")
        : "";
    return `
      <div><span>團隊寶藏</span><strong>${game.revealedTasks.length} / ${game.hunt.treasureGoal}</strong></div>
      ${Format.HUNT_MECHANISM_IDS.map((id) => `<div><span>機關 ${id}</span><strong>${game.hunt.mechanisms[id]} / ${Format.HUNT_MECHANISM_TARGET} · ${game.hunt.exits[id] === "open" ? "已轉為出口" : game.hunt.mechanismSeals?.[id] ? "封印中" : "尚未完成"}</strong></div>`).join("")}
      <div><span>你的能力</span><strong>${escapeHtml(ability)}</strong></div>
      ${game.mummy.type === "corrupt" && game.hunt.purificationFallback ? `<div class="is-alert"><span>淨化池</span><strong>${game.hunt.purificationPools.length === 2 ? "本局採用備援配置" : "本地圖無法生成淨化池"}</strong></div>` : ""}
      ${game.hunt.hatch.status === "open" ? `<div><span>密道</span><strong>已在 (${escapeHtml(game.hunt.hatch.position)}) 開啟</strong></div>` : ""}`;
  }

  function publicTurnMessage(game) {
    if (snapshot.room.phase === "game_over" || !game.currentPlayerId) return "";
    const player = playerById(game.currentPlayerId);
    const name = player?.name || (snapshot.room.phase.startsWith("monster") ? "提燈怪" : "冒險者");
    return snapshot.room.phase.startsWith("monster_interrupt")
      ? `輪到 ${name} 進行插入回合。`
      : `輪到 ${name}。`;
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
      if (capture.guarded) return `${player?.name || "冒險者"}被抓捕並送回地牢，騎士守護抵銷生命損失`;
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
    if (game.mode === "hunt") {
      const escaped = winner.results?.filter((result) => result.outcome === "escaped").length || 0;
      const dead = winner.results?.filter((result) => result.outcome === "dead").length || 0;
      page.gameOverDialog.classList.toggle("evil", mummyWon);
      page.gameOverDialog.classList.toggle("good", !mummyWon);
      page.gameOverIcon.classList.toggle("evil", mummyWon);
      page.gameOverIcon.classList.toggle("good", !mummyWon);
      page.gameOverIcon.textContent = mummyWon ? "怪" : "逃";
      page.gameOverEyebrow.textContent = mummyWon ? "提燈怪完全勝利" : "冒險者成功逃生";
      page.gameOverTitle.textContent = mummyWon ? "所有冒險者都已死亡" : `${escaped} 名冒險者逃出古墓`;
      page.gameOverDescription.textContent = mummyWon
        ? "提燈怪殺死所有冒險者，獵殺宣告結束。"
        : "只要至少一名冒險者逃脫，團隊便達成逃生目標。";
      page.gameOverResult.classList.toggle("evil", mummyWon);
      page.gameOverResult.classList.toggle("good", !mummyWon);
      const adventurerResults = winner.results?.map((result) => {
        const resultPlayer = playerById(result.playerId);
        return `<article class="gangsi-game-over-result-row" role="listitem">
          <strong>${escapeHtml(resultPlayer?.name || "冒險者")}</strong>
          <span>${escapeHtml(professionLabel(result.profession))}</span>
          <span>完成任務 ${Number(result.completedTasks) || 0}</span>
          <span>機關貢獻 ${Number(result.mechanismContribution) || 0} 點</span>
          <span class="${result.outcome === "escaped" ? "is-escaped" : "is-dead"}">${result.outcome === "escaped" ? "逃生" : "死亡"}</span>
        </article>`;
      }).join("") || "";
      const mummyResult = winner.mummyResult || {};
      const mummyPlayer = playerById(mummyResult.playerId || game.mummy.playerId);
      const mummyRow = `<article class="gangsi-game-over-result-row is-mummy" role="listitem">
        <strong>${escapeHtml(mummyPlayer?.name || "提燈怪")}</strong>
        <span>${escapeHtml(mummyTypeLabel(mummyResult.type || game.mummy.type))}</span>
        <span>能力觸發 ${Number(mummyResult.abilityTriggers) || 0} 次</span>
      </article>`;
      page.gameOverSummary.innerHTML = `<div class="gangsi-game-over-totals">逃生 ${escaped} 人 · 死亡 ${dead} 人</div>
        <div class="gangsi-game-over-results" role="list">${adventurerResults}${mummyRow}</div>`;
      page.gameOverFooter.textContent = snapshot.you.isHost
        ? "關閉後可查看最終盤面，並決定何時返回準備大廳。"
        : "關閉後可查看最終盤面；等待房主返回準備大廳。";
      if (dismissedGameOverKey !== key) {
        page.gameOverLightbox.classList.remove("hidden");
        document.body.classList.add("modal-open");
      }
      return;
    }
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
