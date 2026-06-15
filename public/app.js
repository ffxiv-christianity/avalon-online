const STORAGE_KEY = "avalon-online-session";

let socket = null;
let snapshot = null;
let session = readSession();

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
    updateJoinControls();
  });
  socket.addEventListener("close", () => {
    setConnection("已斷線，重連中");
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
      return;
    }
    if (message.type === "state") {
      snapshot = message;
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
    return `
      <article class="player-card ${player.isLeader ? "leader" : ""} ${player.retiredLeader ? "retired" : ""}">
        <div class="seat">${player.index + 1}</div>
        <div>
          <strong>${escapeHtml(player.name)}</strong>
          <div class="player-meta">
            ${player.roll ? `d100: ${player.roll}` : "未擲骰"}${player.ready ? " · 已準備" : ""}
          </div>
        </div>
        <div class="token-stack">
          ${player.isLeader ? token("sword", "聖劍") : ""}
          ${player.retiredLeader ? token("retired", "退役領袖") : ""}
          ${role ? roleIcon(player.role, player.side, role.mark) : ""}
        </div>
      </article>
    `;
  }).join("");
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
  if (phase === "missionResult") return renderMissionResult();
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
        <h3>房主指示</h3>
        ${you.isHost ? `
          <textarea class="host-instruction-input" id="hostInstructionInput" maxlength="180">${escapeHtml(room.hostInstruction)}</textarea>
          <button class="ghost-button" data-action="saveInstruction" type="button">更新指示</button>
        ` : `<div class="host-instruction">${escapeHtml(room.hostInstruction)}</div>`}

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
  els.mainPanel.querySelector('[data-action="saveInstruction"]')?.addEventListener("click", () => {
    sendAction("setHostInstruction", { text: document.getElementById("hostInstructionInput").value });
  });
  els.mainPanel.querySelector('[data-action="recommend"]')?.addEventListener("click", () => {
    const count = settings.playerCount;
    sendAction("setSettings", {
      playerCount: count,
      roles: snapshot.recommendedDecks[count],
      teamSizes: snapshot.rules[count].team,
      leaderMode: settings.leaderMode
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
  els.mainPanel.querySelectorAll(".team-size-input").forEach((input) => {
    input.addEventListener("change", () => {
      const teamSizes = [...settings.teamSizes];
      teamSizes[Number(input.dataset.index)] = Number(input.value);
      sendAction("setSettings", { ...settings, teamSizes });
    });
  });
  renderRoleBuilder(settings);
}

function renderRoleBuilder(settings) {
  const root = document.getElementById("roleBuilder");
  if (!root) return;
  root.innerHTML = Object.entries(snapshot.roles).map(([key, role]) => `
    <article class="role-row ${role.side}">
      ${roleIcon(key, role.side, role.mark)}
      <div>
        <strong>${role.name}</strong>
        <p>${role.note}</p>
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
        <p>${snapshot.roles[you.role].note}</p>
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
    ${phaseHeader(`第 ${room.round + 1} 次任務`, `${leaderName()} 持有聖劍，需要選出 ${teamSize} 位任務成員。`)}
    <div class="notice">${you.isLeader ? "你是領袖，請選擇隊伍。" : "等待領袖選擇隊伍。隊伍會即時更新。"}</div>
    <div class="choice-grid">
      ${room.players.map((player) => `
        <button class="choice-card ${player.onTeam ? "selected" : ""}" data-player="${player.id}" type="button" ${you.isLeader ? "" : "disabled"}>
          <strong>${escapeHtml(player.name)}</strong>
          <span>${player.onTeam ? "已入隊" : "未入隊"}</span>
        </button>
      `).join("")}
    </div>
    <button class="primary-button" data-action="submitTeam" type="button" ${you.isLeader && room.selectedTeam.length === teamSize ? "" : "disabled"}>送出隊伍</button>
  `;
  els.mainPanel.querySelectorAll("[data-player]").forEach((button) => {
    button.addEventListener("click", () => sendAction("toggleTeam", { playerId: button.dataset.player }));
  });
  els.mainPanel.querySelector("[data-action='submitTeam']")?.addEventListener("click", () => sendAction("submitTeam"));
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
  els.mainPanel.innerHTML = `
    ${phaseHeader(result.passed ? "投票通過" : "投票未通過", `同意 ${result.approve}，不同意 ${result.reject}。`)}
    <div class="vote-grid">
      ${result.votes.map((entry) => `<div class="vote-pill ${entry.vote}">${escapeHtml(entry.name)}：${entry.vote === "approve" ? "同意" : "不同意"}</div>`).join("")}
    </div>
    <button class="primary-button" data-action="continueVote" type="button">${result.passed ? "進入任務" : "下一位領袖提案"}</button>
  `;
  els.mainPanel.querySelector("[data-action='continueVote']").addEventListener("click", () => sendAction("continueVote"));
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

function renderMissionResult() {
  const last = snapshot.room.missionResults.at(-1);
  els.mainPanel.innerHTML = `
    ${phaseHeader(last.result === "success" ? "任務成功" : "任務失敗", `失敗牌 ${last.fails} 張，需要 ${last.failNeed} 張。`)}
    <div class="result-card ${last.result}">
      <h3>第 ${last.round + 1} 次任務${last.result === "success" ? "成功" : "失敗"}</h3>
      <p>任務隊伍：${namesByIds(last.team)}</p>
    </div>
    <button class="primary-button" data-action="continueMission" type="button">繼續</button>
  `;
  els.mainPanel.querySelector("[data-action='continueMission']").addEventListener("click", () => sendAction("continueMission"));
}

function renderAppointLeader() {
  const { room, you } = snapshot;
  els.mainPanel.innerHTML = `
    ${phaseHeader("指定下一位領袖", `${leaderName()} 持有聖劍，請從沒有退役領袖徽章的玩家中指定下一位。`)}
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
    ${you.isHost ? `<button class="danger-button" data-action="resetRoom" type="button">重置房間</button>` : ""}
  `;
  els.mainPanel.querySelector("[data-action='resetRoom']")?.addEventListener("click", () => sendAction("resetRoom"));
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
    missionResult: "任務結果",
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

function token(kind, label) {
  return `<span class="token ${kind}" title="${label}" aria-label="${label}"></span>`;
}

function roleIcon(role, side, mark) {
  return `<span class="role-icon ${side || ""} role-${role}" title="${snapshot.roles?.[role]?.name || ""}">${escapeHtml(mark || snapshot.roles?.[role]?.mark || "?")}</span>`;
}

function sendAction(action, payload = {}) {
  send({ type: "action", action, payload });
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("尚未連線，請稍等。");
    return;
  }
  socket.send(JSON.stringify(payload));
}

function setConnection(text) {
  els.connectionChip.textContent = text;
}

function showToast(message) {
  els.connectionChip.textContent = message;
  window.setTimeout(() => {
    if (socket?.readyState === WebSocket.OPEN) setConnection("已連線");
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
