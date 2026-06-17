const STORAGE_KEY = "avalon-online-session";
const WAKING_TEXT = "伺服器喚醒中...\n預計需要30~60秒\n請稍候";
const STALE_STATE_MS = 12000;

let socket = null;
let snapshot = null;
let session = readSession();
let lastStateAt = 0;
let lastVersion = 0;
let staleTimer = null;

const els = {
  connectionChip: document.getElementById("connectionChip"),
  joinView: document.getElementById("joinView"),
  roomView: document.getElementById("roomView"),
  joinForm: document.getElementById("joinForm"),
  nameInput: document.getElementById("nameInput"),
  roomInput: document.getElementById("roomInput"),
  createRoomButton: document.getElementById("createRoomButton"),
  rejoinRoomButton: document.getElementById("rejoinRoomButton"),
  statusStrip: document.getElementById("statusStrip"),
  roomCode: document.getElementById("roomCode"),
  copyLinkButton: document.getElementById("copyLinkButton"),
  roster: document.getElementById("roster"),
  scoreboard: document.getElementById("scoreboard"),
  missionTable: document.getElementById("missionTable"),
  logList: document.getElementById("logList"),
  chatList: document.getElementById("chatList"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  mainPanel: document.getElementById("mainPanel")
};

function connect() {
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.addEventListener("open", () => {
    setConnection("已連線");
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
    const message = JSON.parse(event.data);
    if (message.type === "joined") {
      session = {
        roomCode: message.roomCode,
        playerId: message.playerId,
        name: els.nameInput.value.trim() || session?.name || ""
      };
      writeSession(session);
      history.replaceState(null, "", `?room=${message.roomCode}`);
      updateJoinControls();
      requestFullSync();
      return;
    }
    if (message.type === "ping") {
      sendRaw({ type: "pong", at: message.at });
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
    if (message.type === "error") showToast(message.message);
  });
}

function bindEvents() {
  const queryRoom = new URLSearchParams(location.search).get("room");
  if (queryRoom) els.roomInput.value = queryRoom;
  if (session?.name) els.nameInput.value = session.name;
  updateJoinControls();

  els.createRoomButton.addEventListener("click", () => {
    const name = els.nameInput.value.trim();
    if (!name) return showToast("請先輸入名字。");
    send({ type: "createRoom", name });
  });
  els.joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = els.nameInput.value.trim();
    const roomCode = els.roomInput.value.trim();
    if (!name) return showToast("請先輸入名字。");
    if (!roomCode) return showToast("請輸入房間代碼。");
    send({ type: "joinRoom", roomCode, name });
  });
  els.rejoinRoomButton.addEventListener("click", () => {
    if (!session?.roomCode || !session?.playerId) return;
    send({ type: "joinRoom", roomCode: session.roomCode, playerId: session.playerId, name: session.name || "" });
  });
  els.copyLinkButton.addEventListener("click", async () => {
    if (!snapshot) return;
    const url = `${location.origin}${location.pathname}?room=${snapshot.room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("邀請連結已複製。");
    } catch {
      prompt("複製邀請連結", url);
    }
  });
  els.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    sendAction("sendChat", { text });
    els.chatInput.value = "";
  });
}

function updateJoinControls() {
  const roomCode = els.roomInput.value.trim() || new URLSearchParams(location.search).get("room") || "";
  const canRejoin = Boolean(session?.roomCode && session?.playerId && session.roomCode.toUpperCase() === roomCode.toUpperCase());
  els.rejoinRoomButton.classList.toggle("hidden", !canRejoin);
  if (canRejoin) els.rejoinRoomButton.textContent = `以 ${session.name || "原玩家"} 重新連線`;
}

function render() {
  if (!snapshot) return;
  els.joinView.classList.add("hidden");
  els.roomView.classList.remove("hidden");
  els.roomView.classList.toggle("lobby-mode", snapshot.room.phase === "lobby");
  els.roomCode.textContent = snapshot.room.code;
  renderStatus();
  renderRoster();
  renderScoreboard();
  renderMissionTable();
  renderLog();
  renderChat();
  renderMain();
}

function renderStatus() {
  const room = snapshot.room;
  const leader = room.players.find((player) => player.id === room.leaderId);
  els.statusStrip.innerHTML = [
    statusCard("階段", phaseLabel(room.phase)),
    statusCard("任務", room.phase === "lobby" ? "設定中" : `${room.round + 1} / 5`),
    statusCard("領袖", leader ? leader.name : "未開始"),
    statusCard("進度", phaseProgressText())
  ].join("");
}

function renderRoster() {
  const room = snapshot.room;
  els.roster.innerHTML = room.players.map((player) => {
    const role = player.role ? snapshot.roles[player.role] : null;
    const canTransferHost = snapshot.you.isHost && player.id !== snapshot.room.hostId;
    return `
      <article class="player-card ${player.isLeader ? "leader" : ""} ${player.retiredLeader ? "retired" : ""} ${player.online ? "" : "offline"}">
        <div class="seat">${player.index + 1}</div>
        <div>
          <div class="player-name-line">
            <strong>${escapeHtml(player.name)}</strong>
            ${renderAchievementBadge(player.achievements || [])}
          </div>
          <div class="player-meta">
            ${player.roll ? `d100: ${player.roll}` : "未擲骰"}${player.ready ? " · 已準備" : ""} · ${player.online ? "在線" : "離線"}
          </div>
          ${canTransferHost ? `<button class="mini-action" data-transfer-host="${player.id}" type="button">轉房主</button>` : ""}
        </div>
        <div class="token-stack">
          ${player.isHost ? token("host", "房主") : ""}
          ${player.isLeader ? token("leader", "領袖") : player.retiredLeader ? token("retired", "退役領袖") : ""}
          ${player.excaliburHolder ? token("excalibur", "王者之劍") : ""}
          ${player.ladyHolder ? token("lady", "湖中女神") : player.usedLady ? token("lady-used", "曾持有湖中女神") : ""}
          ${role ? roleIcon(player.role, player.side, role.mark) : ""}
        </div>
      </article>
    `;
  }).join("");
  els.roster.querySelectorAll("[data-transfer-host]").forEach((button) => {
    button.addEventListener("click", () => sendAction("transferHost", { playerId: button.dataset.transferHost }));
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
      <span>第 ${index + 1}</span>
      <div class="mission-bar"><span style="width:${(size / settings.playerCount) * 100}%"></span></div>
      <strong>${size} 人${failRules[index] > 1 ? ` / ${failRules[index]} 失敗` : ""}</strong>
    </div>
  `).join("");
}

function renderLog() {
  els.logList.innerHTML = snapshot.room.log.slice().reverse().map((entry) => `<li>${escapeHtml(entry)}</li>`).join("");
}

function renderChat() {
  const chat = snapshot.room.chat || [];
  els.chatList.innerHTML = chat.length ? chat.map((entry) => `
    <div class="chat-message ${entry.playerId === snapshot.you.id ? "mine" : ""}">
      <span class="chat-line"><strong>${escapeHtml(entry.name)}:</strong> ${escapeHtml(entry.text)}</span>
    </div>
  `).join("") : `<div class="chat-empty">尚無聊天訊息</div>`;
  els.chatList.scrollTop = els.chatList.scrollHeight;
}

function renderMain() {
  const phase = snapshot.room.phase;
  if (phase === "lobby") return renderLobby();
  if (phase === "reveal") return renderReveal();
  if (phase === "team") return renderTeam();
  if (phase === "vote") return renderVote();
  if (phase === "voteResult") return renderVoteResult();
  if (phase === "mission") return renderMission();
  if (phase === "excalibur") return renderExcalibur();
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
  els.mainPanel.innerHTML = `
    ${phaseHeader("準備房間", "房主設定人數、牌庫與任務人數；每位玩家擲 d100 後按準備。")}
    <div class="lobby-grid">
      <section class="section-block">
        <h3>你的狀態</h3>
        <div class="action-card">
          <div>
            <strong>${escapeHtml(you.name)}</strong>
            <p>${current.roll ? `你的骰點是 ${current.roll}` : "尚未擲骰"}</p>
          </div>
          <div class="button-row">
            <button class="secondary-button" data-action="roll" type="button" ${current.roll ? "disabled" : ""}>擲 d100</button>
            <button class="primary-button" data-action="ready" type="button" ${current.roll ? "" : "disabled"}>${current.ready ? "取消準備" : "準備"}</button>
          </div>
        </div>
        <div class="validation-list">
          ${room.validation.errors.map((message) => `<div class="validation error">${escapeHtml(message)}</div>`).join("")}
          ${room.validation.warnings.map((message) => `<div class="validation warn">${escapeHtml(message)}</div>`).join("")}
          ${room.canStart ? `<div class="validation ok">所有條件完成，可以開始遊戲。</div>` : ""}
        </div>
        ${you.isHost ? `<button class="start-button" data-action="start" type="button" ${canStart ? "" : "disabled"}>開始遊戲</button>` : `<div class="notice">等待房主開始遊戲。</div>`}
      </section>

      <section class="section-block ${you.isHost ? "" : "locked"}">
        <div class="section-heading">
          <h3>房主設定</h3>
          ${you.isHost ? `<button class="ghost-button" data-action="recommend" type="button">${settings.playerCount} 人推薦牌庫</button>` : ""}
        </div>
        <div class="settings-grid">
          <label class="field">
            <span>遊戲人數</span>
            <select id="playerCountSelect" ${you.isHost ? "" : "disabled"}>
              ${Object.keys(snapshot.rules).map((count) => `<option value="${count}" ${Number(count) === settings.playerCount ? "selected" : ""}>${count} 人</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>領袖規則</span>
            <select id="leaderModeSelect" ${you.isHost ? "" : "disabled"}>
              <option value="appoint" ${settings.leaderMode === "appoint" ? "selected" : ""}>領袖指定下一位</option>
              <option value="standard" ${settings.leaderMode === "standard" ? "selected" : ""}>標準順時針</option>
            </select>
          </label>
        </div>
        <h3>擴充規則</h3>
        <div class="settings-grid">
          ${settingToggle("excaliburToggle", "啟用王者之劍", settings.expansions?.excalibur, "投票通過後，若領袖把王者之劍交給任務成員，任務牌提交完畢後由持劍者選擇是否發動；若發動，系統會翻轉一名任務成員的任務牌再結算。", you.isHost)}
          ${settingToggle("excaliburUniqueToggle", "王者之劍不可重複持有", settings.expansions?.excaliburUnique, "啟用後，每位玩家每局最多持有一次王者之劍；投票未通過不會消耗持有次數。", you.isHost && settings.expansions?.excalibur)}
          ${settingToggle("ladyToggle", "啟用湖中女神", settings.expansions?.ladyOfLake, "建議大於七人遊戲使用。開局由擲骰第二大的玩家持有；第 2、3、4 次任務結束後，湖中女神可以私下查驗一名玩家陣營。若被查驗者已持有過湖中女神，指示物會依擲骰順序交給下一位未持有者。", you.isHost)}
        </div>
        <h3>每輪任務人數</h3>
        <div class="mission-inputs">
          ${settings.teamSizes.map((size, index) => `
            <label class="field compact">
              <span>第 ${index + 1} 次</span>
              <input class="team-size-input" data-index="${index}" min="1" max="${settings.playerCount}" type="number" value="${size}" ${you.isHost ? "" : "disabled"}>
            </label>
          `).join("")}
        </div>
        <h3>牌庫</h3>
        <div class="role-builder" id="roleBuilder"></div>
      </section>
    </div>
  `;
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
  bindExpansionToggle("excaliburToggle", settings, (checked) => ({
    ...settings.expansions,
    excalibur: checked,
    excaliburUnique: checked ? settings.expansions?.excaliburUnique : false
  }));
  bindExpansionToggle("excaliburUniqueToggle", settings, (checked) => ({ ...settings.expansions, excaliburUnique: checked }));
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
    ${phaseHeader("身份確認", "每位玩家只會在自己的裝置看到自己的身份與可得資訊。")}
    <div class="role-reveal ${you.side}">
      ${roleIcon(you.role, you.side, you.roleMark)}
      <div>
        <p class="eyebrow">${you.side === "good" ? "正義方" : "邪惡方"}</p>
        <h2>${you.roleName}</h2>
        <p>${roleNote(you.role, snapshot.roles[you.role], room.settings)}</p>
      </div>
    </div>
    <ul class="info-list">${you.privateInfo.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <div class="progress-panel">身份確認：${room.players.filter((player) => player.revealed).length} / ${room.players.length}</div>
    <button class="primary-button" data-action="confirmReveal" type="button" ${you.hasRevealed ? "disabled" : ""}>${you.hasRevealed ? "已確認，等待其他玩家" : "我已記住身份"}</button>
  `;
  els.mainPanel.querySelector("[data-action='confirmReveal']")?.addEventListener("click", () => sendAction("confirmReveal"));
}

function renderTeam() {
  const { room, you } = snapshot;
  const teamSize = room.settings.teamSizes[room.round];
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
    <button class="primary-button" data-action="submitTeam" type="button" ${you.isLeader && room.selectedTeam.length === teamSize ? "" : "disabled"}>送出隊伍</button>
  `;
  els.mainPanel.querySelectorAll("[data-player]").forEach((button) => {
    button.addEventListener("click", () => sendAction("toggleTeam", { playerId: button.dataset.player }));
  });
  els.mainPanel.querySelectorAll("[data-excalibur-holder]").forEach((button) => {
    button.addEventListener("click", () => sendAction("setExcaliburHolder", { playerId: button.dataset.excaliburHolder || null }));
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
        <span class="help-popover">可由領袖交給一名任務成員。任務牌提交完畢後，持劍者可選擇不發動，或公開選擇一名任務成員翻轉任務牌再結算。</span>
      </div>
      <div class="choice-grid compact">
        <button class="choice-card ${room.selectedExcaliburHolderId ? "" : "selected"}" data-excalibur-holder="" type="button" ${you.isLeader ? "" : "disabled"}>
          <strong>不給</strong>
          <span>本次不使用王者之劍</span>
        </button>
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
  els.mainPanel.innerHTML = `
    ${phaseHeader("全員投票", `是否同意隊伍：${namesByIds(room.selectedTeam)}。`)}
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
  els.mainPanel.innerHTML = `
    ${phaseHeader(result.passed ? "投票通過" : "投票未通過", `同意 ${result.approve}，不同意 ${result.reject}。`)}
    <div class="vote-grid">
      ${result.votes.map((entry) => `<div class="vote-pill ${entry.vote}">${escapeHtml(entry.name)}：${entry.vote === "approve" ? "同意" : "不同意"}</div>`).join("")}
    </div>
    ${renderReactionPanel()}
    ${you.isLeader ? "" : `<div class="notice">等待當前領袖繼續。</div>`}
    <button class="primary-button" data-action="continueVote" type="button" ${you.isLeader ? "" : "disabled"}>${result.passed ? "進入任務" : "下一位領袖提案"}</button>
  `;
  els.mainPanel.querySelector("[data-action='continueVote']").addEventListener("click", () => sendAction("continueVote"));
  bindReactionButtons();
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
    ${phaseHeader("王者之劍", `${holder?.name || "持劍者"} 可以選擇不發動，或公開選擇一名任務成員翻轉任務牌後結算。`)}
    ${you.isExcaliburHolder ? `
      <div class="choice-grid">
        <button class="choice-card" data-excalibur-skip type="button">
          <strong>不發動</strong>
          <span>保留原本任務牌結果</span>
        </button>
        ${room.players.filter((player) => room.selectedTeam.includes(player.id)).map((player) => `
          <button class="choice-card" data-excalibur-target="${player.id}" type="button">
            <strong>${escapeHtml(player.name)}</strong>
            <span>翻轉此人的任務牌</span>
          </button>
        `).join("")}
      </div>
    ` : `<div class="notice">等待王者之劍持有者選擇目標。</div>`}
  `;
  els.mainPanel.querySelectorAll("[data-excalibur-target]").forEach((button) => {
    button.addEventListener("click", () => sendAction("useExcalibur", { playerId: button.dataset.excaliburTarget }));
  });
  els.mainPanel.querySelector("[data-excalibur-skip]")?.addEventListener("click", () => sendAction("useExcalibur", { skip: true }));
}

function renderMissionResult() {
  const last = snapshot.room.missionResults.at(-1);
  const { you } = snapshot;
  els.mainPanel.innerHTML = `
    ${phaseHeader(last.result === "success" ? "任務成功" : "任務失敗", `失敗牌 ${last.fails} 張，需要 ${last.failNeed} 張。`)}
    <div class="result-card ${last.result}">
      <h3>第 ${last.round + 1} 次任務${last.result === "success" ? "成功" : "失敗"}</h3>
      <p>任務隊伍：${namesByIds(last.team)}</p>
      ${last.excalibur ? `<p>${excaliburResultText(last.excalibur)}</p>` : ""}
    </div>
    ${renderReactionPanel()}
    ${you.isLeader ? "" : `<div class="notice">等待當前領袖繼續。</div>`}
    <button class="primary-button" data-action="continueMission" type="button" ${you.isLeader ? "" : "disabled"}>繼續</button>
  `;
  els.mainPanel.querySelector("[data-action='continueMission']").addEventListener("click", () => sendAction("continueMission"));
  bindReactionButtons();
}

function renderLake() {
  const { room, you } = snapshot;
  const holder = room.players.find((player) => player.id === room.ladyHolderId);
  els.mainPanel.innerHTML = `
    ${phaseHeader("湖中女神", `${holder?.name || "湖中女神"} 可以查驗一位玩家。若對方已持有過湖中女神，指示物會交給下一位未持有者。`)}
    ${you.isLadyHolder ? `
      <div class="choice-grid">
        ${room.players.filter((player) => room.lakeCandidateIds.includes(player.id)).map((player) => `
          <button class="choice-card" data-lake-target="${player.id}" type="button">
            <strong>${escapeHtml(player.name)}</strong>
            <span>查驗陣營</span>
          </button>
        `).join("")}
      </div>
    ` : `<div class="notice">等待湖中女神進行查驗。</div>`}
  `;
  els.mainPanel.querySelectorAll("[data-lake-target]").forEach((button) => {
    button.addEventListener("click", () => sendAction("inspectWithLady", { playerId: button.dataset.lakeTarget }));
  });
}

function renderLakeResult() {
  const { room } = snapshot;
  const lakeSide = room.lakeResultText?.includes("邪惡方") ? "evil" : "good";
  els.mainPanel.innerHTML = `
    ${phaseHeader("湖中女神查驗", "查驗結果只會顯示給使用湖中女神的玩家。")}
    ${room.lakeResultText ? `
      <div class="role-reveal ${lakeSide}">
        ${token("lady", "湖中女神")}
        <div>
          <p class="eyebrow">查驗結果</p>
          <h2>${renderLakeResultText(room.lakeResultText)}</h2>
          <p>您可以自由選擇要不要公開給其他玩家。</p>
        </div>
      </div>
      <button class="primary-button" data-action="confirmLakeResult" type="button">繼續</button>
    ` : `<div class="notice">等待湖中女神確認查驗結果。</div>`}
  `;
  els.mainPanel.querySelector("[data-action='confirmLakeResult']")?.addEventListener("click", () => sendAction("confirmLakeResult"));
}

function renderLakeResultText(text) {
  return escapeHtml(text)
    .replace("正義方", `<span class="lake-side good">正義方</span>`)
    .replace("邪惡方", `<span class="lake-side evil">邪惡方</span>`);
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
  if (room.phase === "excalibur") return "等待持劍者";
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
  return `<span class="token ${kind}" title="${label}" aria-label="${label}"></span>`;
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
  send({ type: "action", action, payload });
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
    if (Date.now() - lastStateAt <= STALE_STATE_MS) return;
    setConnection("同步中...\n正在重新取得完整狀態");
    requestFullSync();
  }, 3000);
}

function stopStaleWatcher() {
  if (!staleTimer) return;
  window.clearInterval(staleTimer);
  staleTimer = null;
}

function setConnection(text) {
  els.connectionChip.textContent = text;
}

function syncStatusText() {
  return lastVersion ? `已同步 ${formatCountUnit(lastVersion)}` : "已連線";
}

function formatCountUnit(value) {
  const count = Number(value || 0);
  if (count >= 1000000000) return `${trimUnit(count / 1000000000)}B 次`;
  if (count >= 1000000) return `${trimUnit(count / 1000000)}M 次`;
  if (count >= 1000) return `${trimUnit(count / 1000)}K 次`;
  return `${count} 次`;
}

function trimUnit(value) {
  return Number(value.toFixed(value >= 10 ? 0 : 1)).toString();
}

function showToast(message) {
  els.connectionChip.textContent = message;
  window.setTimeout(() => {
    if (socket?.readyState === WebSocket.OPEN) setConnection(syncStatusText());
  }, 2200);
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function writeSession(nextSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
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
bindEvents();
connect();
