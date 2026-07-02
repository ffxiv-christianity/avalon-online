(function initializeOneNightWolf(global) {
  "use strict";

  const STORAGE_KEY = "onenightwolf-sessions";
  const TAB_KEY = "onenightwolf-tab-player";
  const AVALON_PAGE_TITLE = "阿瓦隆線上版";
  const WOLF_PAGE_TITLE = "一夜終極狼人";
  const CLIENT_INSTANCE_ID = crypto.randomUUID();
  const isDirectPage = location.pathname.toLowerCase().startsWith("/onenightwolf");

  let socket = null;
  let snapshot = null;
  let lastVersion = 0;
  let lastMessageAt = 0;
  let hasControl = true;
  let actionSequence = 0;
  let selectedSession = readSelectedSession();
  let reconnectTimer = null;
  let discussionTimer = null;
  let activeInfoTab = "chat";
  let infoRoomCode = null;
  let lastRoomPhase = null;
  let lastObservedChatId = null;
  let unreadChatCount = 0;
  let lastPlayerJoinSerial = 0;
  let unreadRosterCount = 0;
  let pendingVoteTargetId = null;
  let pendingHunterTargetId = null;
  let avalonRejoinState = null;
  let hadRoomConnection = false;

  const page = {};

  window.addEventListener("DOMContentLoaded", initialize);
  window.addEventListener("popstate", () => {
    if (!snapshot || location.pathname.toLowerCase().startsWith("/onenightwolf")) return;
    snapshot = null;
    document.body.classList.remove("room-active", "wolf-mode");
    page.roomView?.classList.add("hidden");
    page.joinView?.classList.remove("hidden");
    if (page.mode) {
      page.mode.value = "avalon";
      applyModePresentation("avalon");
    }
  });

  function initialize() {
    page.mode = document.getElementById("gameModeSelect");
    page.joinView = document.getElementById("joinView");
    page.avalonRoomView = document.getElementById("roomView");
    page.roomView = document.getElementById("wolfRoomView");
    page.lobbyTemplate = document.getElementById("wolfLobbyTemplate");
    page.joinForm = document.getElementById("joinForm");
    page.nameInput = document.getElementById("nameInput");
    page.roomInput = document.getElementById("roomInput");
    page.createButton = document.getElementById("createRoomButton");
    page.rejoinButton = document.getElementById("rejoinRoomButton");
    page.recentSessions = document.getElementById("recentSessions");
    page.recentSessionList = document.getElementById("recentSessionList");
    page.connection = document.getElementById("connectionChip");
    page.rulesButton = document.getElementById("openRulesButton");
    page.avalonRules = document.getElementById("rulesOverlay");
    page.wolfRules = document.getElementById("wolfRulesOverlay");
    page.siteEyebrow = document.getElementById("siteEyebrow") || document.querySelector(".topbar .eyebrow");
    page.siteTitle = document.getElementById("siteTitle") || document.querySelector(".topbar h1");
    page.heroEyebrow = document.getElementById("heroEyebrow") || document.querySelector(".hero-copy .eyebrow");
    page.heroTitle = document.getElementById("heroTitle") || document.querySelector(".hero-copy h2");
    page.heroFeatures = document.getElementById("heroFeatures") || document.querySelector(".hero-features");
    page.changelog = document.getElementById("changelog");

    if (!page.mode || !page.joinForm || !page.roomView) return;

    rememberAvalonPresentation();
    bindModeSelector();
    bindLoginCapture();
    bindRules();
    bindCoreRoomEvents();

    if (isDirectPage) {
      page.mode.value = "onenightwolf";
      const queryRoom = roomFromUrl();
      if (queryRoom) page.roomInput.value = queryRoom;
      applyModePresentation("onenightwolf");
      connect();
    }
  }

  function rememberAvalonPresentation() {
    avalonRejoinState = {
      hidden: page.rejoinButton.classList.contains("hidden"),
      text: page.rejoinButton.textContent
    };
    page.mode.dataset.avalonTitle = page.siteTitle?.textContent || "阿瓦隆線上版";
    page.mode.dataset.avalonEyebrow = page.siteEyebrow?.textContent || "Avalon Online Host";
    page.mode.dataset.avalonHero = page.heroTitle?.textContent || "阿瓦隆 The Resistance: Avalon";
    page.mode.dataset.avalonHeroEyebrow = page.heroEyebrow?.textContent || "多人即時房間";
    page.mode.dataset.avalonFeatures = page.heroFeatures?.innerHTML || "";
    page.mode.dataset.avalonChangelog = page.changelog?.innerHTML || "";
  }

  function bindModeSelector() {
    page.mode.addEventListener("change", () => {
      const mode = page.mode.value;
      if (mode === "avalon" && isDirectPage) {
        location.href = "/";
        return;
      }
      applyModePresentation(mode);
      if (mode === "onenightwolf") connect();
    });
  }

  function applyModePresentation(mode) {
    const wolf = mode === "onenightwolf";
    document.body.classList.toggle("wolf-mode", wolf);
    document.title = wolf ? WOLF_PAGE_TITLE : AVALON_PAGE_TITLE;
    if (wolf) {
      if (page.siteEyebrow) page.siteEyebrow.textContent = "One Night Ultimate Werewolf";
      if (page.siteTitle) page.siteTitle.textContent = "一夜終極狼人";
      if (page.heroEyebrow) page.heroEyebrow.textContent = "3～10 人即時房間";
      if (page.heroTitle) page.heroTitle.textContent = "一夜終極狼人";
      if (page.heroFeatures) {
        page.heroFeatures.innerHTML = `
          <li>輸入名字即可建立或加入房間</li>
          <li>每位玩家使用自己的裝置查看身分</li>
          <li>一個夜晚、一次討論、一次表決</li>`;
      }
      if (page.changelog && !isDirectPage) loadWolfChangelog();
      syncWolfRejoin();
      renderWolfRecentSessions();
      return;
    }
    if (page.siteEyebrow) page.siteEyebrow.textContent = page.mode.dataset.avalonEyebrow;
    if (page.siteTitle) page.siteTitle.textContent = page.mode.dataset.avalonTitle;
    if (page.heroEyebrow) page.heroEyebrow.textContent = page.mode.dataset.avalonHeroEyebrow;
    if (page.heroTitle) page.heroTitle.textContent = page.mode.dataset.avalonHero;
    if (page.heroFeatures) page.heroFeatures.innerHTML = page.mode.dataset.avalonFeatures;
    if (page.changelog) page.changelog.innerHTML = page.mode.dataset.avalonChangelog;
    page.rejoinButton.textContent = avalonRejoinState.text;
    page.rejoinButton.classList.toggle("hidden", avalonRejoinState.hidden);
    global.refreshAvalonLobby?.();
    global.requestFullSync?.();
  }

  async function loadWolfChangelog() {
    if (page.mode.dataset.wolfChangelog) {
      if (page.mode.value === "onenightwolf") page.changelog.innerHTML = page.mode.dataset.wolfChangelog;
      return;
    }
    try {
      const response = await fetch("/Onenightwolf/", { cache: "no-store" });
      if (!response.ok) return;
      const html = await response.text();
      const documentCopy = new DOMParser().parseFromString(html, "text/html");
      const changelog = documentCopy.getElementById("changelog");
      if (!changelog) return;
      page.mode.dataset.wolfChangelog = changelog.innerHTML;
      if (page.mode.value === "onenightwolf") page.changelog.innerHTML = changelog.innerHTML;
    } catch {
      // Keep the existing changelog if the fragment cannot be loaded.
    }
  }

  function bindLoginCapture() {
    page.roomInput.addEventListener("input", () => {
      const inviteMode = SharedRoomClient.inviteGame(page.roomInput.value, location.href);
      if (!inviteMode || inviteMode === page.mode.value || isDirectPage) {
        if (page.mode.value === "onenightwolf") syncWolfRejoin();
        return;
      }
      page.mode.value = inviteMode;
      applyModePresentation(inviteMode);
    });

    document.addEventListener("click", (event) => {
      if (page.mode.value !== "onenightwolf") return;
      const recentButton = event.target.closest("[data-wolf-recent-player]");
      if (recentButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const saved = sessionStore().sessions[recentButton.dataset.wolfRecentPlayer];
        if (!saved) return;
        page.nameInput.value = saved.name || "";
        page.roomInput.value = saved.roomCode;
        selectedSession = saved;
        sessionStorage.setItem(TAB_KEY, saved.playerId);
        connectAndSend({
          type: "joinRoom",
          roomCode: saved.roomCode,
          playerId: saved.playerId,
          name: saved.name || ""
        });
        return;
      }
      if (event.target.closest("#createRoomButton")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const name = page.nameInput.value.trim();
        if (!name) return showToast("請輸入名字");
        connectAndSend({ type: "createRoom", name });
      }
      if (event.target.closest("#rejoinRoomButton")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const roomCode = parseRoomCode(page.roomInput.value) || roomFromUrl();
        const saved = findRoomSession(roomCode);
        if (!saved) return showToast("找不到可重新連線的玩家身分");
        connectAndSend({ type: "joinRoom", roomCode: saved.roomCode, playerId: saved.playerId, name: saved.name });
      }
    }, true);

    page.joinForm.addEventListener("submit", (event) => {
      const inviteMode = SharedRoomClient.inviteGame(page.roomInput.value, location.href);
      if (inviteMode === "avalon") {
        page.mode.value = "avalon";
        if (isDirectPage) {
          const roomCode = parseRoomCode(page.roomInput.value);
          sessionStorage.setItem("shared-entry-name", page.nameInput.value.trim());
          location.href = `/?room=${encodeURIComponent(roomCode)}`;
          event.preventDefault();
          event.stopImmediatePropagation();
        } else {
          applyModePresentation("avalon");
        }
        return;
      }
      if (inviteMode === "onenightwolf" && page.mode.value !== "onenightwolf") {
        page.mode.value = "onenightwolf";
        applyModePresentation("onenightwolf");
      }
      if (page.mode.value !== "onenightwolf") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const name = page.nameInput.value.trim();
      const roomCode = parseRoomCode(page.roomInput.value);
      if (!name) return showToast("請輸入名字");
      if (!roomCode) return showToast("請輸入房間代碼或邀請網址");
      connectAndSend({ type: "joinRoom", roomCode, name });
    }, true);
  }

  function bindRules() {
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#openRulesButton") || !wolfModeActive()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openWolfRules();
    }, true);
    document.getElementById("closeWolfRulesButton")?.addEventListener("click", closeWolfRules);
    page.wolfRules?.addEventListener("click", (event) => {
      if (event.target === page.wolfRules) closeWolfRules();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && page.wolfRules && !page.wolfRules.classList.contains("hidden")) closeWolfRules();
    });
  }

  function bindCoreRoomEvents() {
    if (!page.roomView || page.coreRoomEventsBound) return;
    page.coreRoomEventsBound = true;
    page.roomView.addEventListener("click", handleCoreRoomClick, true);
    page.roomView.addEventListener("submit", handleCoreRoomSubmit, true);
    page.roomView.addEventListener("change", handleCoreRoomChange, true);
  }

  function handleCoreRoomClick(event) {
    const tab = event.target.closest("[data-wolf-tab]");
    if (tab && page.roomView.contains(tab)) {
      event.preventDefault();
      event.stopPropagation();
      activeInfoTab = tab.dataset.wolfTab;
      if (activeInfoTab === "chat") unreadChatCount = 0;
      if (activeInfoTab === "roster") unreadRosterCount = 0;
      renderRoom();
      if (activeInfoTab === "chat") {
        SharedRoomUI.readLatestChat(page.roomView.querySelector("[data-wolf-chat-list]"));
      }
      return;
    }

    const rollButton = event.target.closest("[data-wolf-roll]");
    if (rollButton && page.roomView.contains(rollButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (!rollButton.disabled) sendAction("roll");
      return;
    }

    const readyButton = event.target.closest("[data-wolf-ready]");
    if (readyButton && page.roomView.contains(readyButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (!readyButton.disabled) sendAction("toggleReady");
      return;
    }

    const startButton = event.target.closest("[data-wolf-start]");
    if (startButton && page.roomView.contains(startButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (!startButton.disabled) sendAction("startGame");
      return;
    }

    const choiceButton = event.target.closest(".wolf-choice[data-group]");
    if (choiceButton && page.roomView.contains(choiceButton)) {
      event.preventDefault();
      event.stopPropagation();
      toggleWolfChoice(choiceButton);
      refreshNightActionButtons();
      return;
    }

    const nightSkipButton = event.target.closest("[data-night-skip]");
    if (nightSkipButton && page.roomView.contains(nightSkipButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (!nightSkipButton.disabled && window.confirm("確定不使用角色能力嗎？")) {
        sendAction("nightAction", { skip: true });
      }
      return;
    }

    const nightButton = event.target.closest("[data-night-action]");
    if (nightButton && page.roomView.contains(nightButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (!nightButton.disabled) handleNightAction({ currentTarget: nightButton });
      return;
    }

    const voteButton = event.target.closest("[data-wolf-vote]");
    if (voteButton && page.roomView.contains(voteButton)) {
      event.preventDefault();
      event.stopPropagation();
      pendingVoteTargetId = voteButton.dataset.wolfVote;
      page.roomView.querySelectorAll("[data-wolf-vote]").forEach((button) => {
        button.classList.toggle("selected", button === voteButton);
      });
      const confirmButton = page.roomView.querySelector("[data-wolf-confirm-vote]");
      if (confirmButton) confirmButton.disabled = false;
      return;
    }

    const hunterTargetButton = event.target.closest("[data-wolf-hunter-target]");
    if (hunterTargetButton && page.roomView.contains(hunterTargetButton)) {
      event.preventDefault();
      event.stopPropagation();
      pendingHunterTargetId = hunterTargetButton.dataset.wolfHunterTarget;
      page.roomView.querySelectorAll("[data-wolf-hunter-target]").forEach((button) => {
        button.classList.toggle("selected", button === hunterTargetButton);
      });
      const confirmButton = page.roomView.querySelector("[data-wolf-confirm-hunter]");
      if (confirmButton) confirmButton.disabled = false;
      return;
    }

    const confirmHunterButton = event.target.closest("[data-wolf-confirm-hunter]");
    if (confirmHunterButton && page.roomView.contains(confirmHunterButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (!confirmHunterButton.disabled && pendingHunterTargetId) {
        sendAction("hunterShot", { targetId: pendingHunterTargetId });
        pendingHunterTargetId = null;
      }
      return;
    }

    const confirmRevealButton = event.target.closest("[data-wolf-confirm-reveal]");
    if (confirmRevealButton && page.roomView.contains(confirmRevealButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (!confirmRevealButton.disabled) sendAction("confirmReveal");
      return;
    }

    const confirmVoteButton = event.target.closest("[data-wolf-confirm-vote]");
    if (confirmVoteButton && page.roomView.contains(confirmVoteButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (!confirmVoteButton.disabled && pendingVoteTargetId) {
        sendAction("vote", { targetId: pendingVoteTargetId });
      }
      return;
    }

    const returnButton = event.target.closest("[data-wolf-return]");
    if (returnButton && page.roomView.contains(returnButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (!returnButton.disabled) sendAction("returnLobby");
      return;
    }

    const recommendButton = event.target.closest("[data-wolf-recommend]");
    if (recommendButton && page.roomView.contains(recommendButton)) {
      event.preventDefault();
      event.stopPropagation();
      const deck = recommendedDeck(snapshot.room.settings.playerCount);
      if (deck.length) sendAction("updateSettings", settingsPayload({ deck }));
      return;
    }

    const copyButton = event.target.closest("[data-copy-link]");
    if (copyButton && page.roomView.contains(copyButton)) {
      event.preventDefault();
      event.stopPropagation();
      copyInvite();
      return;
    }

    const roleButton = event.target.closest("[data-wolf-role]");
    if (roleButton && page.roomView.contains(roleButton)) {
      event.preventDefault();
      event.stopPropagation();
      const role = roleButton.dataset.wolfRole;
      const delta = Number(roleButton.dataset.delta);
      if (!role || !Number.isFinite(delta)) return;
      const counts = deckCounts(snapshot.room.settings.deck);
      const max = snapshot.roles[role]?.max ?? 10;
      counts[role] = Math.max(0, Math.min(max, (counts[role] || 0) + delta));
      sendAction("updateSettings", settingsPayload({ deck: deckFromCounts(counts) }));
    }
  }

  function toggleWolfChoice(button) {
    const group = button.dataset.group;
    if (!group) return;
    const isSelected = button.classList.contains("selected");
    const max = Number(button.dataset.max || button.closest("[data-choice-max]")?.dataset.choiceMax || 1);
    if (isSelected) {
      button.classList.remove("selected");
      return;
    }
    const selected = selectedChoices(group);
    if (max <= 1) {
      page.roomView.querySelectorAll(`.wolf-choice.selected[data-group="${cssEscape(group)}"]`).forEach((choice) => {
        choice.classList.remove("selected");
      });
    } else if (selected.length >= max) {
      selected[0]?.classList.remove("selected");
    }
    clearOpposingNightChoiceGroup(group);
    button.classList.add("selected");
  }

  function clearOpposingNightChoiceGroup(group) {
    if (!["player", "center"].includes(group)) return;
    const opposingGroup = group === "player" ? "center" : "player";
    page.roomView.querySelectorAll(`.wolf-choice.selected[data-group="${opposingGroup}"]`).forEach((choice) => {
      choice.classList.remove("selected");
    });
  }

  function refreshNightActionButtons() {
    const playerChoices = selectedChoices("player").length;
    const centerChoices = selectedChoices("center").length;
    page.roomView.querySelectorAll("[data-night-action]").forEach((button) => {
      const action = button.dataset.nightAction;
      const requires = button.dataset.requiresSelection;
      if (button.dataset.nightSkip !== undefined) return;
      if (requires === "player") button.disabled = playerChoices < 1;
      if (requires === "two-players") button.disabled = playerChoices < 2;
      if (requires === "center") button.disabled = centerChoices < 1;
      if (requires === "two-centers") button.disabled = centerChoices < 2;
      if (requires === "seer") button.disabled = !(playerChoices === 1 || centerChoices === 2);
      if (!requires && ["doppelganger", "robber"].includes(action)) button.disabled = playerChoices < 1;
      if (!requires && action === "werewolf") button.disabled = centerChoices < 1;
      if (!requires && action === "troublemaker") button.disabled = playerChoices < 2;
      if (!requires && action === "seer") button.disabled = !(playerChoices === 1 || centerChoices === 2);
      if (!requires && action === "drunk") button.disabled = centerChoices < 1;
    });
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function handleCoreRoomSubmit(event) {
    const form = event.target.closest("[data-wolf-chat-form]");
    if (!form || !page.roomView.contains(form)) return;
    event.preventDefault();
    event.stopPropagation();
    const input = form.querySelector("[data-wolf-chat-input]");
    const message = input?.value.trim();
    if (!message) return;
    input.value = "";
    sendAction("chat", { message });
  }

  function handleCoreRoomChange(event) {
    const playerCountSelect = event.target.closest("[data-wolf-player-count]");
    if (playerCountSelect && page.roomView.contains(playerCountSelect)) {
      event.preventDefault();
      event.stopPropagation();
      sendAction("updateSettings", settingsPayload({ playerCount: Number(playerCountSelect.value) }));
      return;
    }

    const discussionSelect = event.target.closest("[data-wolf-discussion]");
    if (discussionSelect && page.roomView.contains(discussionSelect)) {
      event.preventDefault();
      event.stopPropagation();
      sendAction("updateSettings", settingsPayload({ discussionSeconds: Number(discussionSelect.value) }));
    }
  }

  function openWolfRules() {
    page.wolfRules.classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function closeWolfRules() {
    page.wolfRules?.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  function connect() {
    if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;
    clearTimeout(reconnectTimer);
    const connection = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/onenightwolf`);
    socket = connection;
    connection.addEventListener("open", () => {
      if (socket !== connection) return;
      lastMessageAt = Date.now();
      if (wolfModeActive()) setConnection("已連線");
      if (hadRoomConnection && selectedSession?.roomCode && selectedSession?.playerId) {
        send({
          type: "joinRoom",
          roomCode: selectedSession.roomCode,
          playerId: selectedSession.playerId,
          name: selectedSession.name
        });
      }
    });
    connection.addEventListener("close", () => {
      if (socket !== connection) return;
      if (wolfModeActive()) setConnection("重新連線中");
      reconnectTimer = window.setTimeout(connect, 1200);
    });
    connection.addEventListener("message", (event) => {
      if (socket !== connection) return;
      const message = JSON.parse(event.data);
      lastMessageAt = Date.now();
      if (message.type === "joined") {
        hasControl = true;
        SharedRoomUI.clearControlLock();
        hadRoomConnection = true;
        selectedSession = {
          roomCode: message.roomCode,
          playerId: message.playerId,
          name: page.nameInput.value.trim() || selectedSession?.name || "",
          game: "onenightwolf",
          lastUsedAt: Date.now()
        };
        saveSession(selectedSession);
        sessionStorage.setItem(TAB_KEY, selectedSession.playerId);
        const nextUrl = `/Onenightwolf/?room=${encodeURIComponent(message.roomCode)}`;
        if (isDirectPage) history.replaceState({ game: "onenightwolf" }, "", nextUrl);
        else history.pushState({ game: "onenightwolf" }, "", nextUrl);
        requestSync();
        return;
      }
      if (message.type === "controlGranted") {
        hasControl = true;
        SharedRoomUI.clearControlLock();
        hadRoomConnection = true;
        requestSync();
        return;
      }
      if (message.type === "ping") {
        lastMessageAt = Date.now();
        send({ type: "pong", at: message.at });
        return;
      }
      if (message.type === "syncOk") {
        lastMessageAt = Date.now();
        lastVersion = message.version || lastVersion;
        setConnection(syncStatusText());
        return;
      }
      if (message.type === "state") {
        lastMessageAt = Date.now();
        lastVersion = message.room.version || lastVersion;
        snapshot = message;
        setConnection(syncStatusText());
        renderRoom();
        return;
      }
      if (message.type === "error") {
        if (message.code === SharedRoomClient.SESSION_ERROR_CODES.sessionReplaced) {
          hasControl = false;
          hadRoomConnection = false;
          SharedRoomUI.showControlLock(takeWolfControl);
          showToast(message.message);
          return;
        }
        if ([
          SharedRoomClient.SESSION_ERROR_CODES.staleRoomVersion,
          SharedRoomClient.SESSION_ERROR_CODES.actionAlreadyConfirmed
        ].includes(message.code)) requestSync();
        clearInvalidWolfSession(message);
        showToast(message.message);
      }
    });
  }

  function connectAndSend(payload) {
    connect();
    if (socket.readyState === WebSocket.OPEN) {
      send(payload);
      return;
    }
    socket.addEventListener("open", () => send(payload), { once: true });
  }

  function renderRoom() {
    window.clearInterval(discussionTimer);
    const chatScrollState = SharedRoomUI.captureScroll(
      page.roomView.querySelector("[data-wolf-chat-list]")
    );
    const isLobbyPhase = snapshot.room.phase === "lobby";
    if (isLobbyPhase && activeInfoTab === "log") activeInfoTab = "chat";
    syncInfoUnread(chatScrollState);
    document.title = WOLF_PAGE_TITLE;
    document.body.classList.add("room-active", "wolf-mode");
    page.joinView.classList.add("hidden");
    page.avalonRoomView?.classList.add("hidden");
    page.roomView.classList.remove("hidden");
    page.roomView.classList.toggle("lobby-mode", snapshot.room.phase === "lobby");
    if (page.siteEyebrow) page.siteEyebrow.textContent = "One Night Ultimate Werewolf";
    if (page.siteTitle) page.siteTitle.textContent = "一夜終極狼人";

    page.roomView.querySelector("[data-wolf-status]").innerHTML = statusCards();
    page.roomView.querySelector("[data-wolf-mobile-status]").innerHTML = mobileStatusSummary();
    page.roomView.querySelectorAll(".room-code-value").forEach((element) => {
      element.textContent = snapshot.room.code;
    });
    page.roomView.querySelectorAll("[data-wolf-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.wolfTab === activeInfoTab);
    });
    page.roomView.querySelectorAll("[data-wolf-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.wolfPanel === activeInfoTab);
    });
    page.roomView.querySelectorAll(".game-only-tab, .game-only-panel").forEach((element) => {
      element.classList.toggle("hidden", isLobbyPhase);
    });
    page.roomView.querySelector("[data-wolf-chat-unread]").textContent = String(unreadChatCount);
    page.roomView.querySelector("[data-wolf-chat-unread]").classList.toggle("hidden", unreadChatCount === 0);
    page.roomView.querySelector("[data-wolf-roster-unread]").textContent = String(unreadRosterCount);
    page.roomView.querySelector("[data-wolf-roster-unread]").classList.toggle("hidden", unreadRosterCount === 0);
    renderMainPanel();
    renderRoomSlot("[data-wolf-chat-list]", chatMessages);
    renderRoomSlot("[data-wolf-roster]", rosterCards);
    renderRoomSlot("[data-wolf-cards]", enabledRoleCards);
    renderRoomSlot("[data-wolf-log]", logEntries);
    const chatList = page.roomView.querySelector("[data-wolf-chat-list]");
    SharedRoomUI.restoreScroll(chatList, chatScrollState);
    bindRoomEvents();
    if (snapshot.room.phase === "discussion") {
      updateDiscussionTimer();
      discussionTimer = window.setInterval(updateDiscussionTimer, 1000);
    }
  }

  function syncInfoUnread(chatScrollState) {
    const room = snapshot.room;
    const chat = room.chat || [];
    if (infoRoomCode !== room.code) {
      infoRoomCode = room.code;
      lastRoomPhase = room.phase;
      lastObservedChatId = chat.at(-1)?.id || null;
      unreadChatCount = 0;
      lastPlayerJoinSerial = SharedRoomClient.latestJoinSerial(room.playerJoinEvents || []);
      unreadRosterCount = 0;
      activeInfoTab = "chat";
      return;
    }
    if (lastRoomPhase && lastRoomPhase !== "lobby" && room.phase === "lobby") {
      lastPlayerJoinSerial = SharedRoomClient.latestJoinSerial(room.playerJoinEvents || []);
      unreadRosterCount = 0;
    }
    lastRoomPhase = room.phase;
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

    const unseenJoins = (room.playerJoinEvents || []).filter((event) => Number(event.serial) > Number(lastPlayerJoinSerial));
    if (activeInfoTab !== "roster") {
      unreadRosterCount += unseenJoins.filter((event) => event.playerId !== snapshot.you.id).length;
    }
    lastPlayerJoinSerial = Math.max(Number(lastPlayerJoinSerial), SharedRoomClient.latestJoinSerial(room.playerJoinEvents || []));
    if (activeInfoTab === "roster") unreadRosterCount = 0;
  }

  function renderMainPanel() {
    const mainPanel = page.roomView.querySelector("[data-wolf-main]");
    if (!mainPanel) return;
    try {
      if (snapshot.room.phase === "lobby") {
        mainPanel.replaceChildren(lobbyFragment());
      } else {
        mainPanel.innerHTML = mainPhase();
      }
    } catch (error) {
      console.error("Failed to render One Night Wolf main panel", error);
      mainPanel.innerHTML = `
        <section class="section-block">
          <h3>畫面載入失敗</h3>
          <p>主畫面渲染時發生錯誤，請重新整理或查看 Console。</p>
          <pre>${escapeHtml(error?.message || String(error))}</pre>
        </section>`;
    }
  }

  function renderRoomSlot(selector, renderContent) {
    const slot = page.roomView.querySelector(selector);
    if (!slot) return;
    try {
      slot.innerHTML = renderContent();
    } catch (error) {
      console.error(`Failed to render ${selector}`, error);
      slot.innerHTML = `<div class="notice">此區塊載入失敗：${escapeHtml(error?.message || String(error))}</div>`;
    }
  }

  function statusCards() {
    const room = snapshot.room;
    const host = room.players.find((player) => player.id === room.hostId);
    const phaseLabels = {
      lobby: "準備房間",
      reveal: "查看角色",
      night: "夜間行動",
      discussion: "討論與投票",
      hunter: "獵人反擊",
      result: "遊戲結果"
    };
    const progress = room.phase === "lobby"
      ? `${room.players.filter((player) => player.ready).length} / ${room.settings.playerCount} 準備`
      : room.phase === "reveal"
        ? `${room.revealedCount} / ${room.players.length} 確認`
      : room.phase === "night"
        ? `${room.night.completedCount} / ${Math.max(1, room.night.actorCount)} 行動`
        : room.phase === "discussion"
          ? `${room.votesCast} / ${room.players.length} 投票`
          : room.phase === "hunter"
            ? `${room.hunter.pending} 名獵人待選擇`
          : "已結算";
    return `
      <div class="status-card"><span>階段</span><strong>${phaseLabels[room.phase]}</strong></div>
      <div class="status-card"><span>牌庫</span><strong>${room.phase === "lobby" ? "設定中" : `${room.settings.deck.length} 張`}</strong></div>
      <div class="status-card"><span>房主</span><strong>${escapeHtml(host?.name || "未設定")}</strong></div>
      <div class="status-card"><span>進度</span><strong>${progress}</strong></div>`;
  }

  function mobileStatusSummary() {
    const room = snapshot.room;
    const phaseLabels = {
      lobby: "準備房間",
      reveal: "查看角色",
      night: "夜間行動",
      discussion: "討論投票",
      hunter: "獵人反擊",
      result: "遊戲結果"
    };
    const context = room.phase === "night"
      ? room.night.roleName
      : room.phase === "result"
        ? "已結算"
        : `${room.settings.deck.length} 張牌`;
    const progress = room.phase === "reveal"
      ? `${room.revealedCount}/${room.players.length} 確認`
      : room.phase === "night"
        ? `${room.night.completedCount}/${Math.max(1, room.night.actorCount)} 行動`
        : room.phase === "discussion"
          ? `${room.votesCast}/${room.players.length} 投票`
          : room.phase === "hunter"
            ? `${room.hunter.pending} 名待行動`
            : room.phase === "result"
              ? "完成"
              : "";
    return SharedRoomUI.mobileStatusSummary([
      { label: "階段", value: phaseLabels[room.phase] },
      { label: room.phase === "night" ? "目前" : "資訊", value: context },
      { label: "進度", value: progress }
    ]);
  }

  function rosterCards() {
    return snapshot.room.players.map((player, index) => `
      <div class="player-card ${SharedRoomUI.playerCardClasses({
        playerId: player.id,
        viewerId: snapshot.you.id,
        online: player.online
      })}" ${player.id === snapshot.you.id ? 'aria-current="true"' : ""}>
        <span class="seat">${index + 1}</span>
        <div>
          <div class="player-name-line"><strong>${escapeHtml(player.name)}</strong></div>
          <div class="player-meta">${player.roll ? `d100: ${player.roll}` : "未擲骰"}${player.ready ? " · 已準備" : ""} · ${player.online ? "在線" : "離線"}</div>
          ${SharedRoomUI.hostControls({
            viewerIsHost: snapshot.you.isHost,
            player,
            hostId: snapshot.room.hostId,
            phase: snapshot.room.phase
          })}
        </div>
        <div class="token-stack">${snapshot.room.phase === "lobby" && player.id === snapshot.room.hostId ? SharedRoomUI.token("host", "房主") : ""}</div>
      </div>`).join("");
  }

  function chatMessages() {
    if (!snapshot.room.chat.length) return `<div class="chat-empty">尚無聊天訊息</div>`;
    return snapshot.room.chat.map((entry) => entry.playerId === "system"
      ? `<div class="chat-message system">${escapeHtml(entry.message)}</div>`
      : `<div class="chat-message ${entry.playerId === snapshot.you.id ? "mine" : ""}"><span class="chat-line"><strong>${escapeHtml(entry.name)}:</strong> ${escapeHtml(entry.message)}</span></div>`).join("");
  }

  function logEntries() {
    return snapshot.room.log.slice().reverse()
      .map((entry) => `<li>${escapeHtml(entry)}</li>`)
      .join("");
  }

  function enabledRoleCards() {
    const counts = deckCounts(snapshot.room.settings.deck);
    return Object.entries(counts).map(([roleKey, count]) => {
      const role = snapshot.roles[roleKey];
      const tone = role.team === "werewolf" ? "werewolf" : role.team === "village" ? "village" : role.team;
      return `<div class="wolf-enabled-card ${tone}">
        <div><strong>${escapeHtml(role.name)}</strong><span>${teamLabel(role.team)}</span></div>
        <output>× ${count}</output>
      </div>`;
    }).join("");
  }

  function cloneTemplate(template, fallbackId) {
    const source = template || (fallbackId ? document.getElementById(fallbackId) : null);
    if (!source?.content) {
      const fragment = document.createDocumentFragment();
      const warning = document.createElement("section");
      warning.className = "section-block";
      warning.innerHTML = "<h3>Template 載入失敗</h3><p>找不到準備大廳 HTML template。</p>";
      fragment.append(warning);
      return fragment;
    }
    return source.content.cloneNode(true);
  }

  function fragmentToHtml(fragment) {
    const wrapper = document.createElement("div");
    wrapper.append(fragment);
    return wrapper.innerHTML;
  }

  function mainPhase() {
    switch (snapshot.room.phase) {
      case "lobby": return lobbyPhase();
      case "reveal": return revealPhase();
      case "night": return nightPhase();
      case "discussion": return discussionPhase();
      case "hunter": return hunterPhase();
      case "result": return resultPhase();
      default: return "";
    }
  }

  function revealPhase() {
    const role = snapshot.you.role;
    const side = role.team === "werewolf" ? "evil" : role.team === "village" ? "good" : "neutral";
    return `
      <div class="phase-card">
        ${phaseHeader("查看初始角色", "請確認自己的角色與能力；所有玩家確認後，系統會開始夜晚流程。")}
      </div>
      <div class="identity-overlay">
        <section class="identity-lightbox ${side}">
          <header class="identity-header">
            <span class="role-icon ${side}">${escapeHtml(role.name.slice(0, 1))}</span>
            <div>
              <p class="eyebrow team-${role.team}">${teamLabel(role.team)}</p>
              <h2>${escapeHtml(role.name)}</h2>
              <p>${escapeHtml(role.description)}</p>
            </div>
          </header>
          <div class="identity-clues">
            <section class="identity-clue ${side}">
              <div class="identity-clue-heading">
                <h3>請記住你的初始角色</h3>
                <p>夜間角色牌可能被交換。天亮後不會再顯示初始角色卡。</p>
              </div>
            </section>
          </div>
          <footer class="identity-footer">
            <span>角色確認：${snapshot.room.revealedCount} / ${snapshot.room.players.length}</span>
            <button class="primary-button" data-wolf-confirm-reveal type="button" ${snapshot.you.hasRevealed ? "disabled" : ""}>${snapshot.you.hasRevealed ? "已確認，等待其他玩家" : "我已記住角色"}</button>
          </footer>
        </section>
      </div>`;
  }

  function lobbyFragment() {
    const room = snapshot.room;
    const me = room.players.find((player) => player.id === snapshot.you.id);
    const canStart = room.canStart && snapshot.you.isHost;
    const fragment = cloneTemplate(page.lobbyTemplate, "wolfLobbyTemplate");

    const phaseHeaderSlot = fragment.querySelector("[data-template-slot='phase-header']");
    if (phaseHeaderSlot) {
      phaseHeaderSlot.innerHTML = phaseHeader("準備房間", "房主設定人數、牌庫與討論時間；每位玩家擲 d100 後按準備。");
    }

    const readyAlert = fragment.querySelector("[data-wolf-lobby-ready-alert]");
    if (readyAlert) {
      readyAlert.classList.toggle("ready", Boolean(me.ready));
      readyAlert.classList.toggle("not-ready", !me.ready);
      readyAlert.setAttribute("aria-label", me.ready ? "已準備" : "尚未準備");
    }

    const readyPopover = fragment.querySelector("[data-wolf-lobby-ready-popover]");
    if (readyPopover) {
      readyPopover.textContent = me.ready ? "已準備" : "尚未準備";
    }

    const nameSlot = fragment.querySelector("[data-wolf-lobby-player-name]");
    if (nameSlot) {
      nameSlot.textContent = snapshot.you.name;
    }

    const rollStatus = fragment.querySelector("[data-wolf-lobby-roll-status]");
    if (rollStatus) {
      rollStatus.textContent = me.roll ? "你的骰點： " + me.roll : "尚未擲骰";
    }

    const rollButton = fragment.querySelector("[data-wolf-roll]");
    if (rollButton) {
      rollButton.disabled = Boolean(me.roll);
    }

    const readyButton = fragment.querySelector("[data-wolf-ready]");
    if (readyButton) {
      readyButton.disabled = !me.roll;
      readyButton.textContent = me.ready ? "取消準備" : "準備";
    }

    const validationList = fragment.querySelector("[data-wolf-lobby-validation]");
    if (validationList) {
      validationList.innerHTML = [
        ...room.validation.errors.map((message) => '<div class="validation error">' + escapeHtml(message) + "</div>"),
        ...room.validation.warnings.map((message) => '<div class="validation warn">' + escapeHtml(message) + "</div>"),
        room.canStart ? '<div class="validation ok">所有條件完成，可以開始遊戲。</div>' : ""
      ].join("");
    }

    const startControl = fragment.querySelector("[data-wolf-lobby-start-control]");
    if (startControl) {
      startControl.innerHTML = snapshot.you.isHost
        ? '<button class="start-button" data-wolf-start type="button" ' + (canStart ? "" : "disabled") + ">開始遊戲</button>"
        : '<div class="notice">等待房主開始遊戲。</div>';
    }

    const hostSettings = fragment.querySelector('[data-shell-panel="host-settings"]');
    if (hostSettings) {
      hostSettings.classList.toggle("locked", !snapshot.you.isHost);
    }

    const hostActions = fragment.querySelector("[data-wolf-lobby-host-actions]");
    if (hostActions && snapshot.you.isHost) {
      hostActions.innerHTML = '<button class="ghost-button" data-wolf-recommend type="button">' + room.settings.playerCount + " 人推薦牌庫</button>";
    }

    const playerCountSelect = fragment.querySelector("[data-wolf-player-count]");
    if (playerCountSelect) {
      playerCountSelect.disabled = !snapshot.you.isHost;
      playerCountSelect.innerHTML = Array.from({ length: 8 }, (_, index) => index + 3)
        .map((count) => '<option value="' + count + '" ' + (count === room.settings.playerCount ? "selected" : "") + ">" + count + " 人</option>")
        .join("");
    }

    const discussionSelect = fragment.querySelector("[data-wolf-discussion]");
    if (discussionSelect) {
      discussionSelect.disabled = !snapshot.you.isHost;
      discussionSelect.value = String(room.settings.discussionSeconds);
    }

    const roleBuilderSlot = fragment.querySelector("[data-wolf-role-builder]");
    if (roleBuilderSlot) {
      roleBuilderSlot.innerHTML = roleBuilder();
    }

    return fragment;
  }

  function lobbyPhase() {
    return fragmentToHtml(lobbyFragment());
  }

  function phaseHeader(title, subtitle) {
    const phaseLabel = {
      lobby: "大廳",
      reveal: "角色",
      night: "夜晚",
      discussion: "討論",
      hunter: "獵人",
      result: "結果"
    }[snapshot.room.phase] || "";
    return `<div class="phase-header"><div><p class="eyebrow">${phaseLabel}</p><h2>${title}</h2><p>${subtitle}</p></div></div>`;
  }

  function roleBuilder() {
    const counts = deckCounts(snapshot.room.settings.deck);
    return Object.entries(snapshot.roles).map(([key, role]) => {
      const side = role.team === "werewolf"
        ? "evil"
        : ["tanner", "neutral"].includes(role.team)
          ? "neutral"
          : "good";
      return `<article class="role-row ${side}">
        <span class="role-icon ${side}" title="${escapeHtml(role.name)}">${escapeHtml(role.name.slice(0, 1))}</span>
        <div><strong>${escapeHtml(role.name)}</strong><p>${escapeHtml(role.description)}</p></div>
        <div class="counter">
          <button data-wolf-role="${key}" data-delta="-1" type="button" ${snapshot.you.isHost ? "" : "disabled"}>-</button>
          <output>${counts[key] || 0}</output>
          <button data-wolf-role="${key}" data-delta="1" type="button" ${snapshot.you.isHost ? "" : "disabled"}>+</button>
        </div>
      </article>`;
    }).join("");
  }

  function deckCounts(deck) {
    return deck.reduce((counts, role) => {
      counts[role] = (counts[role] || 0) + 1;
      return counts;
    }, {});
  }

  function deckFromCounts(counts) {
    return Object.entries(counts).flatMap(([role, count]) => Array(Math.max(0, Number(count) || 0)).fill(role));
  }

  function settingsPayload(overrides = {}) {
    const settings = snapshot.room.settings;
    return {
      playerCount: settings.playerCount,
      discussionSeconds: settings.discussionSeconds,
      deck: settings.deck.slice(),
      ...overrides
    };
  }

  function recommendedDeck(playerCount) {
    return (snapshot.recommendedDecks?.[playerCount] || snapshot.recommendedDecks?.[4] || []).slice();
  }

  function nightPhase() {
    const room = snapshot.room;
    const actionRoleName = roleDisplayName(room.night.actionRole);
    const actionTitle = room.night.yourTurn
      ? `輪到你行動${actionRoleName ? ` - 你是${actionRoleName}` : ""}`
      : `等待${room.night.roleName}`;
    return `
      <div class="phase-card">
        <div class="wolf-phase-heading">
          <div><p class="eyebrow">Night</p><h2>${escapeHtml(room.night.roleName)}階段</h2></div>
          <strong>${room.night.completedCount} / ${Math.max(1, room.night.actorCount)}</strong>
        </div>
        <div class="notice">${escapeHtml(nightNarration(room.night.role))}</div>
        ${nightOrderTrack()}
        ${identityCard()}
        <section class="wolf-night-action ${room.night.yourTurn ? "is-your-turn" : "is-waiting"}">
          <header class="wolf-night-action-heading">
            <div>
              <p class="eyebrow">目前行動</p>
              <h3>${escapeHtml(actionTitle)}</h3>
            </div>
            <span class="wolf-night-pulse" aria-hidden="true"></span>
          </header>
          <div class="wolf-night-action-body">
            ${room.night.yourTurn
              ? nightControls(room.night.actionRole)
              : nightWaitingPanel(room.night)}
          </div>
        </section>
      </div>`;
  }

  function nightWaitingPanel(night) {
    if (night.role === "privateNightAction") {
      return `<div class="progress-panel wolf-night-waiting"><strong>夜晚流程正在收尾</strong><p>請稍候，系統即將進入討論。</p></div>`;
    }
    return `<div class="progress-panel wolf-night-waiting"><strong>${escapeHtml(night.roleName)}正在行動</strong><p>請等待${escapeHtml(night.roleName)}完成行動。</p></div>`;
  }

  function nightOrderTrack() {
    const order = snapshot.room.night.order || [];
    const active = order.find((step) => step.state === "active");
    return `<section class="wolf-night-order" aria-label="夜晚行動順序">
      <div class="wolf-night-order-title">
        <strong>夜晚行動順序</strong>
        <span>${active ? `目前：${escapeHtml(active.name)}` : "準備進入討論"}</span>
      </div>
      <ol class="wolf-night-order-list" data-wolf-night-order>
        ${order.map((step) => {
          const state = ["done", "active", "upcoming"].includes(step.state) ? step.state : "upcoming";
          const label = state === "done" ? "已完成" : state === "active" ? "行動中" : "尚未行動";
          return `<li class="wolf-night-step ${state}" title="${escapeHtml(label)}" ${state === "active" ? 'aria-current="step"' : ""}>
            <strong>${escapeHtml(step.name)}</strong>
          </li>`;
        }).join("")}
      </ol>
    </section>`;
  }

  function identityCard() {
    const role = snapshot.you.role;
    return `<section class="status-card wolf-identity">
        <span class="team-${role.team}">${teamLabel(role.team)} · 初始角色</span>
      <h3 class="wolf-role-name">${escapeHtml(role.name)}</h3>
      <p>${escapeHtml(role.description)}</p>
      ${snapshot.you.privateInfo.length ? `<div class="wolf-private-info">${snapshot.you.privateInfo.map((message) => `<p>${escapeHtml(message)}</p>`).join("")}</div>` : ""}
    </section>`;
  }

  function roleDisplayName(roleKey) {
    return snapshot.roles?.[roleKey]?.name || "";
  }

  function nightControls(role) {
    const renderers = {
      doppelganger: doppelgangerNightControls,
      werewolf: werewolfNightControls,
      minion: minionNightControls,
      mason: masonNightControls,
      insomniac: insomniacNightControls,
      seer: seerNightControls,
      robber: robberNightControls,
      troublemaker: troublemakerNightControls,
      drunk: drunkNightControls
    };
    return (renderers[role] || ackNightControls)();
  }

  function doppelgangerNightControls() {
    const others = snapshot.room.players.filter((player) => player.id !== snapshot.you.id);
    return `<p>選擇一名其他玩家，查看並複製他的初始角色與陣營。</p>
      <div class="wolf-choice-grid">${others.map((player) => playerChoice(player, 1)).join("")}</div>
      <button class="primary-button" data-night-action="doppelganger" data-requires-selection="player" type="button" disabled>確認行動</button>`;
  }

  function werewolfNightControls() {
    const context = snapshot.you.nightContext || {};
    if (!context.loneWerewolf) {
      return `<p>其他狼人：<strong>${(context.teammates || []).map((player) => escapeHtml(player.name)).join("、")}</strong></p>
        <p>場上有多名狼人，因此不能查看中央牌。</p>
        <button class="primary-button" data-night-action="werewolf" type="button">確認相認</button>`;
    }
    return `<p>你是場上唯一的狼人，可以查看一張中央牌。</p>
      <div class="wolf-choice-grid">${centerChoices(1)}</div>
      <button class="primary-button" data-night-action="werewolf" data-requires-selection="center" type="button" disabled>確認查看</button>`;
  }

  function minionNightControls() {
    const werewolves = snapshot.you.nightContext?.werewolves || [];
    return `<p>${werewolves.length ? `狼人是：<strong>${werewolves.map((player) => escapeHtml(player.name)).join("、")}</strong>` : "場上玩家之中沒有狼人。"}</p>
      <button class="primary-button" data-night-action="ack" type="button">確認情報</button>`;
  }

  function masonNightControls() {
    const masons = snapshot.you.nightContext?.masons || [];
    return `<p>${masons.length ? `另一名守夜人是：<strong>${masons.map((player) => escapeHtml(player.name)).join("、")}</strong>` : "場上玩家之中沒有另一名守夜人。"}</p>
      <button class="primary-button" data-night-action="ack" type="button">確認情報</button>`;
  }

  function insomniacNightControls() {
    return `<p>確認後，私人情報會顯示在你的角色卡。</p><button class="primary-button" data-night-action="ack" type="button">確認行動</button>`;
  }

  function seerNightControls() {
    const others = snapshot.room.players.filter((player) => player.id !== snapshot.you.id);
    return `<p>選擇一名其他玩家，或選擇兩張中央牌。</p>
      <div class="wolf-choice-grid">${others.map((player) => playerChoice(player, 1)).join("")}</div>
      <div class="wolf-choice-grid">${centerChoices(2)}</div>
      <button class="primary-button" data-night-action="seer" data-requires-selection="seer" type="button" disabled>確認行動</button>`;
  }

  function robberNightControls() {
    const others = snapshot.room.players.filter((player) => player.id !== snapshot.you.id);
    return `<p>選擇另一名玩家交換角色牌，或不使用能力。</p>
      <div class="wolf-choice-grid">${others.map((player) => playerChoice(player, 1)).join("")}</div>
      <div class="button-row"><button class="primary-button" data-night-action="robber" data-requires-selection="player" type="button" disabled>確認交換</button><button class="ghost-button" data-night-skip type="button">不交換</button></div>`;
  }

  function troublemakerNightControls() {
    const others = snapshot.room.players.filter((player) => player.id !== snapshot.you.id);
    return `<p>選擇另外兩名玩家交換角色牌，或不使用能力。</p>
      <div class="wolf-choice-grid">${others.map((player) => playerChoice(player, 2)).join("")}</div>
      <div class="button-row"><button class="primary-button" data-night-action="troublemaker" data-requires-selection="two-players" type="button" disabled>確認交換</button><button class="ghost-button" data-night-skip type="button">不交換</button></div>`;
  }

  function drunkNightControls() {
    return `<p>選擇一張中央牌交換；你不會知道換到了什麼。</p>
      <div class="wolf-choice-grid">${centerChoices(1)}</div>
      <button class="primary-button" data-night-action="drunk" data-requires-selection="center" type="button" disabled>確認交換</button>`;
  }

  function ackNightControls() {
    return `<button class="primary-button" data-night-action="ack" type="button">確認行動</button>`;
  }

  function discussionPhase() {
    const hasVoted = Boolean(snapshot.you.voteTargetId);
    const votedPlayer = snapshot.room.players.find((player) => player.id === snapshot.you.voteTargetId);
    return `
      <div class="phase-card">
        <div class="wolf-phase-heading">
          <div><p class="eyebrow">Dawn</p><h2>天亮了，開始討論與投票</h2></div>
          <strong class="wolf-timer" data-wolf-timer></strong>
        </div>
        <div class="notice">所有玩家禁止再查看初始角色牌。<br>請根據夜間情報進行討論。</div>
        <div class="wolf-vote-guide">
          <strong>投票規則</strong>
          <span>所有玩家完成投票，或討論時間結束時立即結算。</span>
          <span>未投票視為廢票；若最高票只有一票，則無人被處決。</span>
        </div>
        ${hasVoted ? `
          <div class="notice wolf-vote-locked">
            <strong>你已投給 ${escapeHtml(votedPlayer?.name || "該玩家")}</strong>
            <span>投票已鎖定，等待其他玩家完成投票或討論時間結束。</span>
          </div>` : `
          <div class="wolf-choice-grid">
            ${snapshot.room.players.filter((player) => player.id !== snapshot.you.id).map((player) => `
              <button class="wolf-choice ${pendingVoteTargetId === player.id ? "selected" : ""}" data-wolf-vote="${player.id}" type="button">
                ${escapeHtml(player.name)}${player.hasVoted ? " · 已投票" : ""}
              </button>`).join("")}
          </div>
          <button class="primary-button" data-wolf-confirm-vote type="button" ${pendingVoteTargetId ? "" : "disabled"}>確認投票</button>
        `}
      </div>`;
  }

  function nightNarration(role) {
    return {
      doppelganger: "化身幽靈請查看一位玩家的初始角色並成為該角色。若複製到預言家、強盜、搗蛋鬼或酒鬼，請立即執行能力。",
      werewolf: "狼人請確認彼此身分。若場上只有一名狼人，該狼人可以查看一張中央牌。",
      minion: "爪牙請確認場上的狼人身分；狼人不會得知爪牙是誰。",
      mason: "守夜人請確認另一名守夜人。",
      seer: "預言家請選擇查看一位其他玩家的牌，或查看兩張中央牌。",
      robber: "強盜可以與另一位玩家交換牌並查看新牌，也可以選擇不交換。",
      troublemaker: "搗蛋鬼可以交換另外兩位玩家的牌，但不能查看，也可以選擇不交換。",
      drunk: "酒鬼必須將自己的牌與一張中央牌交換，且不能查看新牌。",
      insomniac: "失眠者請查看自己現在持有的角色牌。",
      privateNightAction: "夜晚即將結束，請等待系統進入討論。"
    }[role] || "請完成目前角色的夜間行動。";
  }

  function resultPhase() {
    const result = snapshot.room.result;
    const cards = Object.fromEntries(result.finalCards.map((entry) => [entry.playerId, entry.role]));
    return `
      <div class="phase-card">
        <p class="eyebrow">Result</p>
        <h2 class="wolf-result-title ${result.winner}">${escapeHtml(resultHeading(result.winnerTeams))}</h2>
        <p>${escapeHtml(result.reason)}</p>
          ${snapshot.room.players.map((player) => `
            <div class="wolf-result-row ${result.eliminatedIds.includes(player.id) ? "eliminated" : ""}">
              <span>${escapeHtml(player.name)}${result.eliminatedIds.includes(player.id) ? " · 遭到處決" : ""}${result.winningPlayerIds.includes(player.id) ? " · 獲勝" : ""}</span>
              <strong class="team-${snapshot.roles[cards[player.id]].team}">${escapeHtml(snapshot.roles[cards[player.id]].name)}</strong>
            </div>`).join("")}
        <section class="wolf-vote-result">
          <h3>投票結果</h3>
          ${voteSummary(result)}
          <div class="wolf-vote-result-list">
            ${result.votes.map((vote) => {
              const voter = snapshot.room.players.find((player) => player.id === vote.voterId);
              const target = snapshot.room.players.find((player) => player.id === vote.targetId);
              return `<div class="wolf-vote-result-row ${vote.targetId ? "" : "abstained"}">
                <span>${escapeHtml(voter?.name || "未知玩家")}</span>
                <strong>${target ? `投給 ${escapeHtml(target.name)}` : "未投票／廢票"}</strong>
              </div>`;
            }).join("")}
          </div>
        </section>
        <p class="wolf-center-result">中央牌：${result.centerCards.map((role) => escapeHtml(snapshot.roles[role].name)).join("、")}</p>
        ${snapshot.you.isHost ? `<button class="primary-button" data-wolf-return type="button">返回準備房</button>` : `<p>等待房主開啟下一局。</p>`}
      </div>`;
  }

  function voteSummary(result) {
    const totalVotes = result.votes.filter((vote) => vote.targetId).length;
    const maxVotes = Math.max(1, ...snapshot.room.players.map((player) => Number(result.counts[player.id] || 0)));
    return `<div class="wolf-vote-summary" aria-label="得票統計">
      ${snapshot.room.players.map((player) => {
        const voteCount = Number(result.counts[player.id] || 0);
        const voters = result.votes
          .filter((vote) => vote.targetId === player.id)
          .map((vote) => snapshot.room.players.find((voter) => voter.id === vote.voterId)?.name || "未知玩家");
        const percent = Math.round((voteCount / maxVotes) * 100);
        const badges = [
          result.votedOutIds.includes(player.id) ? "最高票" : "",
          result.eliminatedIds.includes(player.id) && !result.votedOutIds.includes(player.id) ? "連帶出局" : ""
        ].filter(Boolean);
        return `<article class="wolf-vote-total ${result.eliminatedIds.includes(player.id) ? "eliminated" : ""}">
          <div class="wolf-vote-total-head">
            <strong>${escapeHtml(player.name)}</strong>
            <span>${voteCount} / ${totalVotes} 票</span>
          </div>
          <div class="wolf-vote-meter" style="--vote-fill: ${percent}%" aria-hidden="true"><span></span></div>
          <p>${voters.length ? `投給他：${voters.map(escapeHtml).join("、")}` : "沒有得票"}${badges.length ? ` · ${badges.join("、")}` : ""}</p>
        </article>`;
      }).join("")}
    </div>`;
  }

  function hunterPhase() {
    return `<div class="phase-card">
      <p class="eyebrow">Hunter</p>
      <h2>獵人反擊</h2>
      ${identityCard()}
      ${snapshot.room.hunter.yourTurn ? `
        <p>你已遭到處決。選擇一名其他玩家開槍，該玩家也會死亡。</p>
        <div class="wolf-choice-grid">
          ${snapshot.room.players.filter((player) => player.id !== snapshot.you.id).map((player) => `
            <button class="wolf-choice" data-wolf-hunter-target="${player.id}" type="button">${escapeHtml(player.name)}</button>`).join("")}
        </div>` : `<div class="notice">等待遭到處決的獵人選擇反擊目標。</div>`}
        ${snapshot.room.hunter.yourTurn ? `<button class="primary-button" data-wolf-confirm-hunter type="button" ${pendingHunterTargetId ? "" : "disabled"}>確認開槍</button>` : ""}
    </div>`;
  }

  function bindRoomEvents() {
    const chatList = page.roomView.querySelector("[data-wolf-chat-list]");
    if (chatList && !chatList.dataset.wolfReadStateBound) {
      chatList.dataset.wolfReadStateBound = "true";
      SharedRoomUI.bindChatReadState(chatList, () => {
        if (!unreadChatCount) return;
        unreadChatCount = 0;
        const badge = page.roomView.querySelector("[data-wolf-chat-unread]");
        if (badge) {
          badge.textContent = "0";
          badge.classList.add("hidden");
        }
      });
    }
    SharedRoomUI.bindHostControls(page.roomView, sendAction);
  }

  function handleNightAction(event) {
    const action = event.currentTarget.dataset.nightAction;
    const players = selectedChoices("player");
    const centers = selectedChoices("center").map(Number);
    if (action === "doppelganger") sendAction("nightAction", { targetId: players[0] });
    if (action === "ack") sendAction("nightAction");
    if (action === "werewolf") sendAction("nightAction", { centerIndex: centers[0] });
    if (action === "seer") {
      if (players.length) sendAction("nightAction", { mode: "player", targetId: players[0] });
      else sendAction("nightAction", { mode: "center", centerIndexes: centers });
    }
    if (action === "robber") sendAction("nightAction", { targetId: players[0] });
    if (action === "troublemaker") sendAction("nightAction", { targetIds: players });
    if (action === "drunk") sendAction("nightAction", { centerIndex: centers[0] });
  }

  function selectedChoices(group) {
    return [...page.roomView.querySelectorAll(`.wolf-choice[data-group="${group}"].selected`)].map((button) => button.dataset.value);
  }

  function playerChoice(player, maximum) {
    return `<button class="wolf-choice" data-group="player" data-max="${maximum}" data-value="${player.id}" type="button">${escapeHtml(player.name)}</button>`;
  }

  function centerChoices(maximum) {
    return [0, 1, 2].map((index) => `<button class="wolf-choice" data-group="center" data-max="${maximum}" data-value="${index}" type="button">中央 ${index + 1}</button>`).join("");
  }

  function updateDiscussionTimer() {
    const timer = page.roomView.querySelector("[data-wolf-timer]");
    if (!timer) return;
    const seconds = Math.max(0, Math.ceil((snapshot.room.discussionEndsAt - Date.now()) / 1000));
    timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(`${location.origin}/Onenightwolf/?room=${snapshot.room.code}`);
    showToast("邀請連結已複製");
  }

  function syncWolfRejoin() {
    const roomCode = parseRoomCode(page.roomInput.value) || roomFromUrl();
    const saved = findRoomSession(roomCode);
    page.rejoinButton.classList.toggle("hidden", !saved);
    if (saved) page.rejoinButton.textContent = `以 ${saved.name} 重新連線`;
  }

  function renderWolfRecentSessions() {
    if (!page.recentSessions || !page.recentSessionList || page.mode?.value !== "onenightwolf") return;
    const recent = SharedRoomClient.listSessions(sessionStore()).slice(0, 4);
    page.recentSessions.classList.toggle("hidden", recent.length === 0);
    page.recentSessionList.innerHTML = recent.map((item) => `
      <button class="recent-session-button" data-wolf-recent-player="${escapeHtml(item.playerId)}" type="button">
        <span class="recent-session-game">${escapeHtml(SharedRoomClient.gameLabel(item.game || "onenightwolf"))}</span>
        <span class="recent-session-details">
          <strong>${escapeHtml(item.name || "原玩家")}</strong>
          <small>房間 ${escapeHtml(item.roomCode)}</small>
        </span>
        <span>重新連線</span>
      </button>`).join("");
  }

  function wolfModeActive() {
    return page.mode?.value === "onenightwolf" || (!page.roomView?.classList.contains("hidden") && snapshot);
  }

  function setConnection(text) {
    if (page.connection && wolfModeActive()) page.connection.textContent = text;
  }

  function syncStatusText() {
    return SharedRoomUI.connectionStatusText(lastVersion);
  }

  function sendAction(action, payload = {}) {
    if (!hasControl) {
      SharedRoomUI.showControlLock(takeWolfControl);
      return;
    }
    actionSequence += 1;
    send(SharedRoomClient.createActionRequest({
      action,
      payload,
      roomVersion: snapshot?.room?.version || lastVersion,
      clientId: CLIENT_INSTANCE_ID,
      sequence: actionSequence
    }));
  }

  function takeWolfControl() {
    const target = selectedSession || findRoomSession(roomFromUrl());
    if (!target?.roomCode || !target?.playerId) return;
    connectAndSend({
      type: "takeControl",
      roomCode: target.roomCode,
      playerId: target.playerId
    });
  }

  function requestSync() {
    send({ type: "sync", version: lastVersion });
  }

  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return showToast("仍在連線，請稍候");
    socket.send(JSON.stringify(payload));
  }

  function roomFromUrl() {
    return parseRoomCode(new URLSearchParams(location.search).get("room"));
  }

  function parseRoomCode(value) {
    return SharedRoomClient.parseRoomCode(value, location.href);
  }

  function sessionStore() {
    return SharedRoomClient.normalizeSessionStore(localStorage.getItem(STORAGE_KEY));
  }

  function saveSession(session) {
    const store = SharedRoomClient.saveSession(sessionStore(), session);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    renderWolfRecentSessions();
  }

  function clearInvalidWolfSession(message) {
    const errorCode = message.code || "";
    if (![
      SharedRoomClient.SESSION_ERROR_CODES.roomNotFound,
      SharedRoomClient.SESSION_ERROR_CODES.playerNotFound
    ].includes(errorCode)) return;

    const roomCode = parseRoomCode(page.roomInput.value) || selectedSession?.roomCode || roomFromUrl();
    const playerId = selectedSession?.playerId || sessionStorage.getItem(TAB_KEY) || "";
    const nextStore = SharedRoomClient.clearInvalidSession(sessionStore(), {
      errorCode,
      roomCode,
      playerId
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore));

    if (errorCode === SharedRoomClient.SESSION_ERROR_CODES.roomNotFound) {
      page.roomInput.value = "";
      const lobbyPath = isDirectPage ? "/Onenightwolf/" : location.pathname;
      history.replaceState({ game: "onenightwolf" }, "", lobbyPath);
    }
    selectedSession = null;
    hadRoomConnection = false;
    sessionStorage.removeItem(TAB_KEY);
    renderWolfRecentSessions();
    syncWolfRejoin();
  }

  function findRoomSession(roomCode) {
    if (!roomCode) return null;
    const tabPlayerId = sessionStorage.getItem(TAB_KEY);
    const store = sessionStore();
    return SharedRoomClient.selectSession(store, { roomCode, playerId: tabPlayerId })
      || SharedRoomClient.listSessions(store).find((session) => session.roomCode === roomCode)
      || null;
  }

  function readSelectedSession() {
    const store = sessionStore();
    const tabPlayerId = sessionStorage.getItem(TAB_KEY);
    if (tabPlayerId && store.sessions[tabPlayerId]) return store.sessions[tabPlayerId];
    return SharedRoomClient.listSessions(store)[0] || null;
  }

  function showToast(message) {
    SharedRoomUI.showToast(message);
  }

  function roleCatalog() {
    return {
      doppelganger: { name: "化身幽靈", team: "neutral", description: "最早行動並複製一名玩家的初始角色。預言家、強盜、搗蛋鬼、酒鬼與爪牙立即行動；狼人、守夜人於其階段同行；失眠者最後複查。" },
      werewolf: { name: "狼人", team: "werewolf", description: "查看其他狼人；如果是唯一狼人，可以查看一張中央牌。" },
      minion: { name: "爪牙", team: "werewolf", description: "查看所有狼人。狼人不會知道誰是爪牙；場上沒有狼人時，爪牙要設法讓其他玩家出局。" },
      mason: { name: "守夜人", team: "village", description: "查看另一名守夜人。牌庫必須同時放入兩張守夜人。" },
      seer: { name: "預言家", team: "village", description: "查看一名玩家的牌，或查看兩張中央牌。" },
      robber: { name: "強盜", team: "village", description: "可以和一名玩家交換牌，並查看自己換到的牌；不會發動新角色的能力，也可以選擇不交換。" },
      troublemaker: { name: "搗蛋鬼", team: "village", description: "可以交換另外兩名玩家的牌，但不能查看牌面；也可以選擇不交換。" },
      drunk: { name: "酒鬼", team: "village", description: "必須將自己的牌與一張中央牌交換，但不能查看新牌。" },
      insomniac: { name: "失眠者", team: "village", description: "夜晚最後查看自己目前的角色；建議與交換牌角色一起使用。" },
      villager: { name: "村民", team: "village", description: "沒有夜間能力。" },
      tanner: { name: "皮匠", team: "tanner", description: "沒有夜間能力。只要自己遭到處決便獲勝。" },
      hunter: { name: "獵人", team: "village", description: "沒有夜間能力。若遭到處決，獵人可選擇一名其他玩家開槍，使其一同出局。" }
    };
  }

  function teamLabel(team) {
    return ({ werewolf: "狼人陣營", village: "好人陣營", tanner: "皮匠陣營", neutral: "依複製角色決定" })[team] || "特殊陣營";
  }

  function resultHeading(winnerTeams = []) {
    return winnerTeams.map((team) => ({
      werewolf: "狼人陣營",
      village: "好人陣營",
      tanner: "皮匠",
      everyone: "所有玩家",
      none: "無人"
    })[team] || team).join("與") + "獲勝";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  global.OneNightWolf = { parseRoomCode };
}(window));
