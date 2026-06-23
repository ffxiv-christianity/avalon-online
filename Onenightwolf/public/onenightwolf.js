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
  let hasControl = true;
  let actionSequence = 0;
  let selectedSession = readSelectedSession();
  let reconnectTimer = null;
  let discussionTimer = null;
  let activeInfoTab = "chat";
  let infoRoomCode = null;
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

  function openWolfRules() {
    ensureRulesOverlay();
    page.wolfRules.classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function closeWolfRules() {
    page.wolfRules?.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  function ensureRulesOverlay() {
    if (!page.wolfRules) {
      page.wolfRules = document.createElement("div");
      page.wolfRules.id = "wolfRulesOverlay";
      page.wolfRules.className = "rules-overlay hidden";
      page.wolfRules.innerHTML = `
        <article class="rules-dialog">
          <header class="rules-header">
            <div><p class="eyebrow">One Night Ultimate Werewolf</p><h2>一夜終極狼人規則</h2></div>
            <button class="ghost-button" data-close-wolf-rules type="button">關閉</button>
          </header>
          <div class="rules-content" data-wolf-rules-content></div>
        </article>`;
      document.body.appendChild(page.wolfRules);
      page.wolfRules.querySelector("[data-close-wolf-rules]").addEventListener("click", closeWolfRules);
      page.wolfRules.addEventListener("click", (event) => {
        if (event.target === page.wolfRules) closeWolfRules();
      });
    }
    const content = page.wolfRules.querySelector("#wolfRulesContent, [data-wolf-rules-content]");
    if (content && !content.childElementCount) {
      content.innerHTML = `
        <section>
          <h3>遊戲流程</h3>
          <ol>
            <li>每名玩家取得一張角色牌，另有三張牌留在中央。</li>
            <li>依角色順序完成夜間能力；部分能力會交換角色牌。</li>
            <li>天亮後在房主設定的時間內自由討論並投票；所有人提早投完會立即結算。</li>
            <li>討論時間結束後直接結算，尚未投票的玩家視為廢票。</li>
            <li>最高票且至少兩票者遭到處決；平票可能同時處決多人。結算時會公開所有玩家的投票。</li>
            <li>處決至少一名狼人，好人陣營獲勝；否則狼人陣營獲勝。</li>
          </ol>
        </section>
        <section>
          <h3>角色能力</h3>
          <div class="wolf-rules-role-grid">
            ${Object.values(roleCatalog()).map((role) => `<div class="${role.team}"><strong>${role.name}</strong><span>${teamLabel(role.team)}</span><p>${role.description}</p></div>`).join("")}
          </div>
        </section>
        <section>
          <h3>遊戲設置</h3>
          <ul>
            <li>支援 3～10 人；牌庫固定為玩家人數加三張角色牌。</li>
            <li>第一次遊玩建議先不使用化身幽靈、皮匠與獵人。</li>
            <li>守夜人必須同時放入兩張；其他角色可由房主自由調整。</li>
            <li>每局所有玩家先擲 d100 決定順時鐘座位與玩家列表順序；夜間仍依固定角色順序進行。</li>
            <li>夜晚行動順序：化身幽靈➜狼人➜爪牙➜守夜人➜預言家➜強盜➜搗蛋鬼➜酒鬼➜失眠者。</li>
            <li>村民、皮匠與獵人沒有夜間操作。</li>
            <li><strong>化身幽靈複製預言家、強盜、搗蛋鬼或酒鬼：</strong>在化身幽靈階段立即執行能力，之後不會在正牌角色階段再次行動。</li>
            <li><strong>化身幽靈複製狼人或守夜人：</strong>等到該角色階段，與其他狼人或守夜人一同行動。</li>
            <li><strong>化身幽靈複製爪牙：</strong>在化身幽靈階段立即確認狼人；複製失眠者則在正版失眠者結束後查看自己目前的牌。</li>
            <li>若化身幽靈牌在夜間被換給其他玩家，該玩家的最終角色是化身幽靈最初複製的角色，但不會補發該角色的夜間能力。</li>
          </ul>
        </section>
        <section>
          <h3>勝利條件</h3>
          <ol>
            <li><strong class="team-werewolf">場上有狼人：</strong>至少一名狼人死亡，好人陣營獲勝；否則狼人陣營獲勝。</li>
            <li><strong class="team-village">沒有狼人或爪牙：</strong>無人遭處決時所有玩家獲勝；若有人遭處決則無人獲勝。</li>
            <li><strong class="team-werewolf">沒有狼人但有爪牙：</strong>爪牙死亡時好人陣營獲勝；其他玩家死亡時狼人陣營獲勝。</li>
            <li><strong class="team-tanner">皮匠：</strong>皮匠死亡即可獲勝；若同時有狼人死亡，好人陣營也獲勝。</li>
            <li><strong class="team-village">獵人：</strong>獵人死亡後選擇一名反擊目標，該玩家也會死亡。多名獵人需要反擊時依 d100 座位順序行動，不分正牌或化身幽靈；被獵人射殺的獵人也會繼續觸發反擊。</li>
          </ol>
        </section>`;
    }
  }

  function connect() {
    if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;
    clearTimeout(reconnectTimer);
    const connection = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/onenightwolf`);
    socket = connection;
    connection.addEventListener("open", () => {
      if (socket !== connection) return;
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
        send({ type: "sync" });
        return;
      }
      if (message.type === "controlGranted") {
        hasControl = true;
        SharedRoomUI.clearControlLock();
        hadRoomConnection = true;
        send({ type: "sync" });
        return;
      }
      if (message.type === "state") {
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
        ].includes(message.code)) send({ type: "sync" });
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
    if (snapshot.room.phase === "lobby" && activeInfoTab === "log") activeInfoTab = "chat";
    syncInfoUnread(chatScrollState);
    document.title = WOLF_PAGE_TITLE;
    document.body.classList.add("room-active", "wolf-mode");
    page.joinView.classList.add("hidden");
    page.avalonRoomView?.classList.add("hidden");
    page.roomView.classList.remove("hidden");
    page.roomView.classList.toggle("lobby-mode", snapshot.room.phase === "lobby");
    if (page.siteEyebrow) page.siteEyebrow.textContent = "One Night Ultimate Werewolf";
    if (page.siteTitle) page.siteTitle.textContent = "一夜終極狼人";

    page.roomView.innerHTML = `
      <section class="status-strip">${statusCards()}</section>
      <section class="mobile-status-summary" aria-label="遊戲狀態摘要">${mobileStatusSummary()}</section>
      <div class="game-layout">
        <aside class="side-panel">
          <nav class="info-tabs" data-wolf-tabs aria-label="房間資訊">
            <button class="info-tab ${activeInfoTab === "chat" ? "active" : ""}" data-wolf-tab="chat" type="button">聊天 <span class="tab-badge ${unreadChatCount ? "" : "hidden"}" data-wolf-chat-badge>${unreadChatCount}</span></button>
            <button class="info-tab ${activeInfoTab === "roster" ? "active" : ""}" data-wolf-tab="roster" type="button">玩家 <span class="tab-badge ${unreadRosterCount ? "" : "hidden"}" data-wolf-roster-badge>${unreadRosterCount}</span></button>
            <button class="info-tab ${activeInfoTab === "cards" ? "active" : ""}" data-wolf-tab="cards" type="button">角色卡</button>
            <button class="info-tab game-only-tab ${activeInfoTab === "log" ? "active" : ""} ${snapshot.room.phase === "lobby" ? "hidden" : ""}" data-wolf-tab="log" type="button">記錄</button>
          </nav>
          <section class="panel info-panel chat-panel ${activeInfoTab === "chat" ? "active" : ""}" data-wolf-panel="chat">
            <h2>聊天</h2>
            <div class="chat-list" data-wolf-chat-list>${chatMessages()}</div>
            <form class="chat-form" data-wolf-chat-form autocomplete="off">
              <input data-wolf-chat-input maxlength="240" autocomplete="off" placeholder="輸入訊息">
              <button class="primary-button" type="submit">送出</button>
            </form>
          </section>
          <section class="panel info-panel roster-panel ${activeInfoTab === "roster" ? "active" : ""}" data-wolf-panel="roster">
            <h2>玩家順序</h2>
            <div class="roster">${rosterCards()}</div>
          </section>
          <section class="panel info-panel ${activeInfoTab === "cards" ? "active" : ""}" data-wolf-panel="cards">
            <h2>角色卡</h2>
            <div class="wolf-role-list">${enabledRoleCards()}</div>
          </section>
          <section class="panel info-panel log-panel ${activeInfoTab === "log" ? "active" : ""}" data-wolf-panel="log">
            <h2>記錄</h2>
            <ol class="log-list">${snapshot.room.log.slice().reverse().map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>
          </section>
          ${roomPanel("desktop-room-panel")}
        </aside>
        <section class="main-panel" data-wolf-main>${mainPhase()}</section>
        ${roomPanel("mobile-room-panel")}
      </div>`;

    bindRoomEvents();
    const chatList = page.roomView.querySelector("[data-wolf-chat-list]");
    SharedRoomUI.restoreScroll(chatList, chatScrollState);
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

    const unseenJoins = (room.playerJoinEvents || []).filter((event) => Number(event.serial) > Number(lastPlayerJoinSerial));
    if (activeInfoTab !== "roster") {
      unreadRosterCount += unseenJoins.filter((event) => event.playerId !== snapshot.you.id).length;
    }
    lastPlayerJoinSerial = Math.max(Number(lastPlayerJoinSerial), SharedRoomClient.latestJoinSerial(room.playerJoinEvents || []));
    if (activeInfoTab === "roster") unreadRosterCount = 0;
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

  function roomPanel(extraClass) {
    return `<section class="panel room-panel ${extraClass}">
      <div class="room-code-block"><span>房間代碼</span><strong>${snapshot.room.code}</strong></div>
      <button class="ghost-button" data-wolf-copy type="button">複製邀請連結</button>
    </section>`;
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

  function lobbyPhase() {
    const room = snapshot.room;
    const me = room.players.find((player) => player.id === snapshot.you.id);
    const canStart = room.canStart && snapshot.you.isHost;
    return `
      ${phaseHeader("準備房間", "房主設定人數、牌庫與討論時間；每位玩家擲 d100 後按準備。")}
      <div class="lobby-grid">
        <section class="section-block">
          <h3>你的狀態</h3>
          <div class="action-card">
            <span class="ready-alert ${me.ready ? "ready" : "not-ready"}" tabindex="0" aria-label="${me.ready ? "已準備" : "尚未準備"}"></span>
            <span class="ready-alert-popover" role="tooltip">${me.ready ? "已準備" : "尚未準備"}</span>
            <div class="action-card-status">
              <strong>${escapeHtml(snapshot.you.name)}</strong>
              <p>${me.roll ? `你的骰點是 ${me.roll}` : "尚未擲骰"}</p>
            </div>
            <div class="button-row">
              <button class="secondary-button" data-wolf-roll type="button" ${me.roll ? "disabled" : ""}>擲 d100</button>
              <button class="primary-button" data-wolf-ready type="button" ${me.roll ? "" : "disabled"}>${me.ready ? "取消準備" : "準備"}</button>
            </div>
          </div>
          <div class="validation-list">
            ${room.validation.errors.map((message) => `<div class="validation error">${escapeHtml(message)}</div>`).join("")}
            ${room.validation.warnings.map((message) => `<div class="validation warn">${escapeHtml(message)}</div>`).join("")}
            ${room.canStart ? `<div class="validation ok">所有條件完成，可以開始遊戲。</div>` : ""}
          </div>
          ${snapshot.you.isHost
            ? `<button class="start-button" data-wolf-start type="button" ${canStart ? "" : "disabled"}>開始遊戲</button>`
            : `<div class="notice">等待房主開始遊戲。</div>`}
        </section>

        <section class="section-block ${snapshot.you.isHost ? "" : "locked"}">
          <div class="section-heading">
            <h3>房主設定</h3>
            ${snapshot.you.isHost ? `<button class="ghost-button" data-wolf-recommend type="button">${room.settings.playerCount} 人推薦牌庫</button>` : ""}
          </div>
          <div class="settings-grid">
            <label class="field">
              <span>遊戲人數</span>
              <select class="wolf-select" data-wolf-player-count ${snapshot.you.isHost ? "" : "disabled"}>
                ${Array.from({ length: 8 }, (_, index) => index + 3).map((count) => `<option value="${count}" ${count === room.settings.playerCount ? "selected" : ""}>${count} 人</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>討論時間</span>
              <select class="wolf-select" data-wolf-discussion ${snapshot.you.isHost ? "" : "disabled"}>
                ${[180, 300, 420, 600].map((seconds) => `<option value="${seconds}" ${seconds === room.settings.discussionSeconds ? "selected" : ""}>${seconds / 60} 分鐘</option>`).join("")}
              </select>
            </label>
          </div>
          <h3>牌庫</h3>
          <div class="role-builder" data-wolf-role-builder>${roleBuilder()}</div>
        </section>
      </div>`;
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

  function nightPhase() {
    const room = snapshot.room;
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
              <h3>${room.night.yourTurn ? "輪到你行動" : `等待${escapeHtml(room.night.roleName)}`}</h3>
            </div>
            <span class="wolf-night-pulse" aria-hidden="true"></span>
          </header>
          <div class="wolf-night-action-body">
            ${room.night.yourTurn
              ? nightControls(room.night.actionRole)
              : `<div class="progress-panel wolf-night-waiting"><strong>${escapeHtml(room.night.roleName)}正在行動</strong><p>請等待${escapeHtml(room.night.roleName)}完成行動。</p></div>`}
          </div>
        </section>
      </div>`;
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
          const state = ["done", "active", "upcoming", "disabled"].includes(step.state) ? step.state : "upcoming";
          const label = state === "done" ? "已完成" : state === "active" ? "行動中" : state === "disabled" ? "本局未啟用" : "尚未行動";
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

  function nightControls(role) {
    const others = snapshot.room.players.filter((player) => player.id !== snapshot.you.id);
    if (role === "doppelganger") {
      return `<p>選擇一名其他玩家，查看並複製他的初始角色與陣營。</p>
        <div class="wolf-choice-grid">${others.map((player) => playerChoice(player, 1)).join("")}</div>
        <button class="primary-button" data-night-action="doppelganger" data-requires-selection type="button" disabled>確認行動</button>`;
    }
    if (role === "werewolf") {
      const context = snapshot.you.nightContext || {};
      if (!context.loneWerewolf) {
        return `<p>其他狼人：<strong>${(context.teammates || []).map((player) => escapeHtml(player.name)).join("、")}</strong></p>
          <p>場上有多名狼人，因此不能查看中央牌。</p>
          <button class="primary-button" data-night-action="werewolf" type="button">確認相認</button>`;
      }
      return `<p>你是場上唯一的狼人，可以查看一張中央牌。</p>
        <div class="wolf-choice-grid">${centerChoices(1)}</div>
        <button class="primary-button" data-night-action="werewolf" data-requires-selection type="button" disabled>確認查看</button>`;
    }
    if (role === "minion") {
      const werewolves = snapshot.you.nightContext?.werewolves || [];
      return `<p>${werewolves.length ? `狼人是：<strong>${werewolves.map((player) => escapeHtml(player.name)).join("、")}</strong>` : "場上玩家之中沒有狼人。"}</p>
        <button class="primary-button" data-night-action="ack" type="button">確認情報</button>`;
    }
    if (role === "mason") {
      const masons = snapshot.you.nightContext?.masons || [];
      return `<p>${masons.length ? `另一名守夜人是：<strong>${masons.map((player) => escapeHtml(player.name)).join("、")}</strong>` : "場上玩家之中沒有另一名守夜人。"}</p>
        <button class="primary-button" data-night-action="ack" type="button">確認情報</button>`;
    }
    if (role === "insomniac") {
      return `<p>確認後，私人情報會顯示在你的角色卡。</p><button class="primary-button" data-night-action="ack" type="button">確認行動</button>`;
    }
    if (role === "seer") {
      return `<p>選擇一名玩家，或選擇兩張中央牌。</p>
        <div class="wolf-choice-grid">${others.map((player) => playerChoice(player, 1)).join("")}</div>
        <div class="wolf-choice-grid">${centerChoices(2)}</div>
        <button class="primary-button" data-night-action="seer" data-requires-selection type="button" disabled>確認行動</button>`;
    }
    if (role === "robber") {
      return `<p>選擇另一名玩家交換角色牌，或不使用能力。</p>
        <div class="wolf-choice-grid">${others.map((player) => playerChoice(player, 1)).join("")}</div>
        <div class="button-row"><button class="primary-button" data-night-action="robber" data-requires-selection type="button" disabled>確認交換</button><button class="ghost-button" data-night-skip type="button">不交換</button></div>`;
    }
    if (role === "troublemaker") {
      return `<p>選擇另外兩名玩家交換角色牌，或不使用能力。</p>
        <div class="wolf-choice-grid">${others.map((player) => playerChoice(player, 2)).join("")}</div>
        <div class="button-row"><button class="primary-button" data-night-action="troublemaker" data-requires-selection type="button" disabled>確認交換</button><button class="ghost-button" data-night-skip type="button">不交換</button></div>`;
    }
    if (role === "drunk") {
      return `<p>選擇一張中央牌交換；你不會知道換到了什麼。</p>
        <div class="wolf-choice-grid">${centerChoices(1)}</div>
        <button class="primary-button" data-night-action="drunk" data-requires-selection type="button" disabled>確認交換</button>`;
    }
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
      seer: "預言家請選擇查看一位玩家的牌，或查看兩張中央牌。",
      robber: "強盜可以與另一位玩家交換牌並查看新牌，也可以選擇不交換。",
      troublemaker: "搗蛋鬼可以交換另外兩位玩家的牌，但不能查看，也可以選擇不交換。",
      drunk: "酒鬼必須將自己的牌與一張中央牌交換，且不能查看新牌。",
      insomniac: "失眠者請查看自己現在持有的角色牌。",
      doppelInsomniac: "複製失眠者的化身幽靈，請在正版失眠者結束後查看自己現在的角色。"
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
    page.roomView.querySelectorAll("[data-wolf-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        activeInfoTab = button.dataset.wolfTab;
        if (activeInfoTab === "chat") unreadChatCount = 0;
        if (activeInfoTab === "roster") unreadRosterCount = 0;
        page.roomView.querySelectorAll("[data-wolf-tab]").forEach((item) => item.classList.toggle("active", item === button));
        page.roomView.querySelectorAll("[data-wolf-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.wolfPanel === activeInfoTab));
        const chatBadge = page.roomView.querySelector("[data-wolf-chat-badge]");
        const rosterBadge = page.roomView.querySelector("[data-wolf-roster-badge]");
        if (chatBadge) {
          chatBadge.textContent = String(unreadChatCount);
          chatBadge.classList.toggle("hidden", unreadChatCount === 0);
        }
        if (rosterBadge) {
          rosterBadge.textContent = String(unreadRosterCount);
          rosterBadge.classList.toggle("hidden", unreadRosterCount === 0);
        }
        if (activeInfoTab === "chat") {
          const chatList = page.roomView.querySelector("[data-wolf-chat-list]");
          SharedRoomUI.readLatestChat(chatList, () => {
            unreadChatCount = 0;
            const badge = page.roomView.querySelector("[data-wolf-chat-badge]");
            if (badge) {
              badge.textContent = "0";
              badge.classList.add("hidden");
            }
          });
        }
      });
    });
    SharedRoomUI.bindChatReadState(
      page.roomView.querySelector("[data-wolf-chat-list]"),
      () => {
        if (!unreadChatCount) return;
        unreadChatCount = 0;
        const badge = page.roomView.querySelector("[data-wolf-chat-badge]");
        if (badge) {
          badge.textContent = "0";
          badge.classList.add("hidden");
        }
      }
    );
    page.roomView.querySelectorAll("[data-wolf-copy]").forEach((button) => button.addEventListener("click", copyInvite));
    SharedRoomUI.bindHostControls(page.roomView, sendAction);
    page.roomView.querySelector("[data-wolf-chat-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = event.currentTarget.querySelector("[data-wolf-chat-input]");
      const message = input.value.trim();
      if (!message) return;
      sendAction("chat", { message });
      input.value = "";
    });
    page.roomView.querySelector("[data-wolf-ready]")?.addEventListener("click", () => sendAction("toggleReady"));
    page.roomView.querySelector("[data-wolf-roll]")?.addEventListener("click", () => sendAction("roll"));
    page.roomView.querySelector("[data-wolf-start]")?.addEventListener("click", () => sendAction("startGame"));
    page.roomView.querySelector("[data-wolf-confirm-reveal]")?.addEventListener("click", () => sendAction("confirmReveal"));
    page.roomView.querySelector("[data-wolf-recommend]")?.addEventListener("click", () => {
      sendAction("updateSettings", {
        playerCount: snapshot.room.settings.playerCount,
        discussionSeconds: snapshot.room.settings.discussionSeconds,
        useRecommended: true
      });
    });
    page.roomView.querySelector("[data-wolf-player-count]")?.addEventListener("change", (event) => {
      sendAction("updateSettings", {
        playerCount: Number(event.currentTarget.value),
        discussionSeconds: snapshot.room.settings.discussionSeconds,
        deck: snapshot.room.settings.deck
      });
    });
    page.roomView.querySelector("[data-wolf-discussion]")?.addEventListener("change", (event) => {
      sendAction("updateSettings", {
        playerCount: snapshot.room.settings.playerCount,
        discussionSeconds: Number(event.currentTarget.value),
        deck: snapshot.room.settings.deck
      });
    });
    page.roomView.querySelectorAll("[data-wolf-role]").forEach((button) => {
      button.addEventListener("click", () => {
        const role = button.dataset.wolfRole;
        const counts = deckCounts(snapshot.room.settings.deck);
        const nextCount = Math.max(0, Math.min(snapshot.roles[role].max, (counts[role] || 0) + Number(button.dataset.delta)));
        counts[role] = nextCount;
        sendAction("updateSettings", {
          playerCount: snapshot.room.settings.playerCount,
          discussionSeconds: snapshot.room.settings.discussionSeconds,
          deck: deckFromCounts(counts)
        });
      });
    });
    page.roomView.querySelectorAll(".wolf-choice[data-group]").forEach((button) => {
      button.addEventListener("click", () => toggleChoice(button));
    });
    page.roomView.querySelector("[data-night-skip]")?.addEventListener("click", () => {
      if (!window.confirm("確定不使用角色能力嗎？")) return;
      sendAction("nightAction", { skip: true });
    });
    page.roomView.querySelector("[data-night-action]")?.addEventListener("click", handleNightAction);
    page.roomView.querySelectorAll("[data-wolf-vote]").forEach((button) => {
      button.addEventListener("click", () => {
        pendingVoteTargetId = button.dataset.wolfVote;
        page.roomView.querySelectorAll("[data-wolf-vote]").forEach((item) => item.classList.toggle("selected", item === button));
        page.roomView.querySelector("[data-wolf-confirm-vote]").disabled = false;
      });
    });
    page.roomView.querySelector("[data-wolf-confirm-vote]")?.addEventListener("click", () => {
      if (!pendingVoteTargetId) return;
      page.roomView.querySelector("[data-wolf-confirm-vote]").disabled = true;
      page.roomView.querySelectorAll("[data-wolf-vote]").forEach((button) => { button.disabled = true; });
      sendAction("vote", { targetId: pendingVoteTargetId });
      pendingVoteTargetId = null;
    });
    page.roomView.querySelectorAll("[data-wolf-hunter-target]").forEach((button) => {
      button.addEventListener("click", () => {
        pendingHunterTargetId = button.dataset.wolfHunterTarget;
        page.roomView.querySelectorAll("[data-wolf-hunter-target]").forEach((item) => item.classList.toggle("selected", item === button));
        page.roomView.querySelector("[data-wolf-confirm-hunter]").disabled = false;
      });
    });
    page.roomView.querySelector("[data-wolf-confirm-hunter]")?.addEventListener("click", () => {
      if (!pendingHunterTargetId) return;
      sendAction("hunterShot", { targetId: pendingHunterTargetId });
      pendingHunterTargetId = null;
    });
    page.roomView.querySelector("[data-wolf-return]")?.addEventListener("click", () => sendAction("returnLobby"));
  }

  function toggleChoice(button) {
    const group = button.dataset.group;
    const maximum = Number(button.dataset.max);
    const choices = [...page.roomView.querySelectorAll(`.wolf-choice[data-group="${group}"]`)];
    if (maximum === 1) choices.forEach((choice) => choice.classList.remove("selected"));
    button.classList.toggle("selected");
    const selected = choices.filter((choice) => choice.classList.contains("selected"));
    if (selected.length > maximum) selected[0].classList.remove("selected");
    const otherGroup = group === "player" ? "center" : "player";
    if (button.classList.contains("selected")) {
      page.roomView.querySelectorAll(`.wolf-choice[data-group="${otherGroup}"]`).forEach((choice) => choice.classList.remove("selected"));
    }
    const confirmButton = page.roomView.querySelector("[data-night-action][data-requires-selection]");
    if (confirmButton) {
      const action = confirmButton.dataset.nightAction;
      const playerCount = selectedChoices("player").length;
      const centerCount = selectedChoices("center").length;
      confirmButton.disabled = action === "troublemaker"
        ? playerCount !== 2
        : action === "seer"
          ? !(playerCount === 1 || centerCount === 2)
          : !(playerCount === 1 || centerCount === 1);
    }
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
