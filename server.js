const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 8000;
const CLIENT_STALE_MS = 20000;

const ROLE_DEFS = {
  merlin: { name: "梅林", side: "good", max: 1, mark: "梅", note: "知道邪惡方，但看不到莫德雷德。若最後被刺客刺殺，邪惡方勝利。" },
  percival: { name: "派西維爾", side: "good", max: 1, mark: "派", note: "看見梅林；若莫甘娜在場，會同時看見梅林與莫甘娜。" },
  servant: { name: "亞瑟的忠臣", side: "good", max: 5, mark: "忠", note: "沒有特殊能力的正義方角色。" },
  mordred: { name: "莫德雷德", side: "evil", max: 1, mark: "莫", note: "邪惡方角色，不會被梅林看見。" },
  morgana: { name: "莫甘娜", side: "evil", max: 1, mark: "娜", note: "會在派西維爾眼中假扮成梅林。" },
  assassin: { name: "刺客", side: "evil", max: 1, mark: "刺", note: "正義方完成三個任務後，可刺殺梅林反敗為勝。" },
  oberon: { name: "奧伯倫", side: "evil", max: 1, mark: "奧", note: "邪惡方，但不認識其他邪惡方，也不被其他邪惡方認出。" },
  minion: { name: "莫德雷德的爪牙", side: "evil", max: 3, mark: "爪", note: "沒有特殊能力的邪惡方角色。" }
};

const PLAYER_RULES = {
  4: { evil: 1, team: [2, 2, 2, 3, 3], fail: [1, 1, 1, 1, 1] },
  5: { evil: 2, team: [2, 3, 2, 3, 3], fail: [1, 1, 1, 1, 1] },
  6: { evil: 2, team: [2, 3, 4, 3, 4], fail: [1, 1, 1, 1, 1] },
  7: { evil: 3, team: [2, 3, 3, 4, 4], fail: [1, 1, 1, 2, 1] },
  8: { evil: 3, team: [3, 4, 4, 5, 5], fail: [1, 1, 1, 2, 1] },
  9: { evil: 3, team: [3, 4, 4, 5, 5], fail: [1, 1, 1, 2, 1] },
  10: { evil: 4, team: [3, 4, 4, 5, 5], fail: [1, 1, 1, 2, 1] }
};

const DEFAULT_DECK = {
  merlin: 1,
  percival: 1,
  servant: 1,
  mordred: 0,
  morgana: 1,
  assassin: 1,
  oberon: 0,
  minion: 0
};

const RECOMMENDED_DECKS = {
  4: { merlin: 1, percival: 0, servant: 2, mordred: 0, morgana: 0, assassin: 1, oberon: 0, minion: 0 },
  5: { ...DEFAULT_DECK },
  6: { merlin: 1, percival: 1, servant: 2, mordred: 0, morgana: 1, assassin: 1, oberon: 0, minion: 0 },
  7: { merlin: 1, percival: 1, servant: 2, mordred: 0, morgana: 1, assassin: 1, oberon: 0, minion: 1 },
  8: { merlin: 1, percival: 1, servant: 3, mordred: 0, morgana: 1, assassin: 1, oberon: 0, minion: 1 },
  9: { merlin: 1, percival: 1, servant: 4, mordred: 0, morgana: 1, assassin: 1, oberon: 0, minion: 1 },
  10: { merlin: 1, percival: 1, servant: 4, mordred: 1, morgana: 1, assassin: 1, oberon: 0, minion: 1 }
};

const rooms = new Map();
const clients = new Set();
const REACTIONS = [
  { id: "like", emoji: "👍", label: "讚" },
  { id: "cry", emoji: "😭", label: "哭哭" },
  { id: "angry", emoji: "😡", label: "生氣" },
  { id: "suspect", emoji: "🤔", label: "懷疑" },
  { id: "shock", emoji: "😲", label: "震驚" },
  { id: "laugh", emoji: "😂", label: "笑死" }
];
const ACHIEVEMENT_THRESHOLDS = {
  goodWins: 2,
  evilWins: 2,
  merlinGoodWins: 2,
  assassinHits: 2,
  assassinMisses: 2,
  servantBestStreak: 3,
  percivalAssassinated: 1,
  morganaEvilWins: 2,
  oberonEvilWins: 3,
  mordredThreeMissionGames: 1,
  leaderGoodTeams: 3
};
const ACHIEVEMENT_PRIORITIES = {
  "dice-god": 1,
  "fate-joke": 1,
  "good-light": 0,
  "evil-king": 0,
  "hidden-mirror": 3,
  "top-assassin": 3,
  "slipped-hand": 3,
  "village-chief": 2,
  "top-staff": 3,
  "puppet-regime": 3,
  "what-am-i-doing": 3,
  "sorry-spy": 3,
  "clear-eyed-leader": 3
};

function makeRoom(hostName) {
  const room = {
    code: makeRoomCode(),
    createdAt: Date.now(),
    expiresAt: Date.now() + ROOM_TTL_MS,
    version: 1,
    phase: "lobby",
    hostId: null,
    settings: {
      playerCount: 5,
      roles: { ...DEFAULT_DECK },
      teamSizes: [...PLAYER_RULES[5].team],
      leaderMode: "appoint"
    },
    players: [],
    round: 0,
    leaderIndex: 0,
    rejectedVotes: 0,
    retiredLeaderIds: [],
    selectedTeam: [],
    votes: {},
    missionCards: {},
    missionResults: [],
    revealed: {},
    winner: null,
    gameStatsRecorded: false,
    lastAssassination: null,
    currentGame: null,
    playerStats: {},
    chat: [],
    reactions: {},
    log: []
  };
  const player = makePlayer(hostName);
  room.hostId = player.id;
  room.players.push(player);
  ensurePlayerStats(room, player);
  rooms.set(room.code, room);
  addLog(room, `${player.name} 建立房間。`);
  return { room, player };
}

function joinRoom(roomCode, name, requestedPlayerId = null) {
  const code = normalizeRoomCode(roomCode);
  const room = rooms.get(code);
  if (!room) return { error: "找不到這個房間。" };
  if (isRoomExpired(room)) {
    rooms.delete(code);
    detachRoomClients(code, "房間已超過 6 小時並自動清除。");
    return { error: "房間已超過 6 小時並自動清除。" };
  }
  if (room.phase !== "lobby" && !requestedPlayerId) return { error: "遊戲已開始，不能加入新玩家。" };
  if (requestedPlayerId) {
    const existing = room.players.find((player) => player.id === requestedPlayerId);
    if (existing) return { room, player: existing };
    if (room.phase !== "lobby") return { error: "找不到你的玩家 ID，請等這局結束後再重新加入。" };
  }
  if (room.players.length >= room.settings.playerCount) return { error: "房間人數已滿。" };
  const trimmed = cleanName(name);
  if (!trimmed) return { error: "請輸入名字。" };
  if (room.players.some((player) => player.name.toLowerCase() === trimmed.toLowerCase())) return { error: "這個名字已經有人使用。" };
  const player = makePlayer(trimmed);
  room.players.push(player);
  ensurePlayerStats(room, player);
  addLog(room, `${player.name} 加入房間。`);
  markEveryoneUnready(room);
  touchRoom(room);
  return { room, player };
}

function makePlayer(name) {
  return {
    id: crypto.randomUUID(),
    name: cleanName(name),
    ready: false,
    roll: null,
    tieBreak: Math.random(),
    role: null,
    side: null,
    online: false,
    lastSeen: null
  };
}

function applyAction(client, message) {
  client.alive = true;
  client.lastSeen = Date.now();
  if (message.type === "createRoom") {
    const { room, player } = makeRoom(message.name || "玩家");
    attachClient(client, room.code, player.id);
    send(client, { type: "joined", roomCode: room.code, playerId: player.id });
    broadcast(room);
    return;
  }
  if (message.type === "joinRoom") {
    const result = joinRoom(message.roomCode, message.name || "玩家", message.playerId);
    if (result.error) {
      send(client, { type: "error", message: result.error });
      return;
    }
    attachClient(client, result.room.code, result.player.id);
    send(client, { type: "joined", roomCode: result.room.code, playerId: result.player.id });
    broadcast(result.room);
    return;
  }
  if (message.type === "pong" || message.type === "heartbeat") {
    markClientSeen(client);
    return;
  }
  if (message.type === "syncState") {
    markClientSeen(client);
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (room && client.playerId) send(client, makeView(room, client.playerId));
    return;
  }
  if (!client.roomCode || !client.playerId) {
    send(client, { type: "error", message: "尚未加入房間。" });
    return;
  }
  const room = rooms.get(client.roomCode);
  const actor = room?.players.find((player) => player.id === client.playerId);
  if (!room || !actor) {
    send(client, { type: "error", message: "房間狀態已失效。" });
    return;
  }
  if (isRoomExpired(room)) {
    rooms.delete(room.code);
    detachRoomClients(room.code, "房間已超過 6 小時並自動清除。");
    return;
  }
  markClientSeen(client);
  const payload = message.payload || {};
  const error = applyRoomAction(room, actor, message.action, payload);
  if (error) send(client, { type: "error", message: error });
  if (!error) touchRoom(room);
  broadcast(room);
}

function applyRoomAction(room, actor, action, payload) {
  if (action === "setSettings") {
    if (!isHost(room, actor)) return "只有房主可以更改設定。";
    if (room.phase !== "lobby") return "遊戲開始後不能更改設定。";
    const nextCount = clamp(Number(payload.playerCount || room.settings.playerCount), 4, 10);
    room.settings.playerCount = nextCount;
    room.settings.roles = sanitizeRoles(payload.roles || room.settings.roles);
    room.settings.teamSizes = sanitizeTeamSizes(payload.teamSizes || room.settings.teamSizes, nextCount);
    room.settings.leaderMode = payload.leaderMode === "standard" ? "standard" : "appoint";
    if (room.players.length > nextCount) room.players = room.players.slice(0, nextCount);
    markEveryoneUnready(room);
    addLog(room, "房主更新遊戲設定。");
    return null;
  }
  if (action === "roll") {
    if (room.phase !== "lobby") return "遊戲開始後不能重新擲骰。";
    if (actor.roll) return "你已經擲過 d100，不能重新擲骰。";
    actor.roll = randomInt(1, 100);
    actor.tieBreak = Math.random();
    actor.ready = false;
    addLog(room, `${actor.name} 擲出 ${actor.roll}。`);
    return null;
  }
  if (action === "setReady") {
    if (room.phase !== "lobby") return "遊戲已開始。";
    if (!actor.roll) return "請先擲 d100 決定順序。";
    actor.ready = Boolean(payload.ready);
    return null;
  }
  if (action === "sendChat") {
    const text = cleanMessage(payload.text || "", 240);
    if (!text) return "聊天訊息不能是空的。";
    room.chat.push({
      id: crypto.randomUUID(),
      playerId: actor.id,
      name: actor.name,
      text,
      at: Date.now()
    });
    room.chat = room.chat.slice(-80);
    return null;
  }
  if (action === "react") {
    const event = currentReactionEvent(room);
    if (!event) return "現在沒有可回應的結果。";
    if (payload.eventKey !== event.key) return "這個結果已經更新，請重新選擇表情。";
    const reactionId = payload.reactionId === null ? null : String(payload.reactionId || "");
    if (reactionId && !REACTIONS.some((reaction) => reaction.id === reactionId)) return "找不到這個表情。";
    room.reactions[event.key] ||= {};
    if (!reactionId || room.reactions[event.key][actor.id] === reactionId) {
      delete room.reactions[event.key][actor.id];
    } else {
      room.reactions[event.key][actor.id] = reactionId;
    }
    return null;
  }
  if (action === "startGame") {
    if (!isHost(room, actor)) return "只有房主可以開始遊戲。";
    const validation = validateLobby(room);
    if (validation.errors.length) return validation.errors[0];
    startGame(room);
    return null;
  }
  if (action === "confirmReveal") {
    if (room.phase !== "reveal") return "現在不是身份確認階段。";
    room.revealed[actor.id] = true;
    if (room.players.every((player) => room.revealed[player.id])) {
      room.phase = "team";
      addLog(room, "所有玩家完成身份確認。");
    }
    return null;
  }
  if (action === "toggleTeam") {
    if (room.phase !== "team") return "現在不是組隊階段。";
    if (!isCurrentLeader(room, actor)) return "只有目前領袖可以選擇任務隊伍。";
    const targetId = String(payload.playerId || "");
    if (!room.players.some((player) => player.id === targetId)) return "找不到這位玩家。";
    const teamSize = room.settings.teamSizes[room.round];
    if (room.selectedTeam.includes(targetId)) {
      room.selectedTeam = room.selectedTeam.filter((id) => id !== targetId);
    } else if (room.selectedTeam.length < teamSize) {
      room.selectedTeam.push(targetId);
    }
    return null;
  }
  if (action === "submitTeam") {
    if (room.phase !== "team") return "現在不是組隊階段。";
    if (!isCurrentLeader(room, actor)) return "只有目前領袖可以送出隊伍。";
    if (room.selectedTeam.length !== room.settings.teamSizes[room.round]) return "任務隊伍人數不正確。";
    room.phase = "vote";
    room.votes = {};
    addLog(room, `${actor.name} 提名隊伍：${namesByIds(room, room.selectedTeam)}。`);
    return null;
  }
  if (action === "castVote") {
    if (room.phase !== "vote") return "現在不是投票階段。";
    const vote = payload.vote === "approve" ? "approve" : "reject";
    room.votes[actor.id] = vote;
    if (Object.keys(room.votes).length === room.players.length) finishVote(room);
    return null;
  }
  if (action === "continueVote") {
    if (room.phase !== "voteResult") return "現在沒有投票結果需要繼續。";
    if (!isCurrentLeader(room, actor)) return "只有當前領袖可以繼續。";
    continueAfterVote(room);
    return null;
  }
  if (action === "submitMission") {
    if (room.phase !== "mission") return "現在不是任務階段。";
    if (!room.selectedTeam.includes(actor.id)) return "只有任務成員可以提交任務牌。";
    const card = payload.card === "fail" && actor.side === "evil" ? "fail" : "success";
    room.missionCards[actor.id] = card;
    if (Object.keys(room.missionCards).length === room.selectedTeam.length) finishMission(room);
    return null;
  }
  if (action === "continueMission") {
    if (room.phase !== "missionResult") return "現在沒有任務結果需要繼續。";
    if (!isCurrentLeader(room, actor)) return "只有當前領袖可以繼續。";
    continueAfterMission(room);
    return null;
  }
  if (action === "appointLeader") {
    if (room.phase !== "appointLeader") return "現在不是指定領袖階段。";
    if (!isCurrentLeader(room, actor)) return "只有剛完成任務輪的領袖可以指定下一位領袖。";
    const target = room.players.find((player) => player.id === payload.playerId);
    if (!target) return "找不到這位玩家。";
    if (!appointableLeaders(room).some((player) => player.id === target.id)) return "這位玩家已有退役領袖指示物，不能被指定。";
    changeLeaderTo(room, target.id, "appoint");
    room.phase = "team";
    room.selectedTeam = [];
    addLog(room, `${actor.name} 指定 ${target.name} 成為下一位領袖。`);
    return null;
  }
  if (action === "assassinate") {
    if (room.phase !== "assassination") return "現在不是刺殺階段。";
    if (actor.role !== "assassin") return "只有刺客可以指定刺殺目標。";
    const target = room.players.find((player) => player.id === payload.playerId);
    if (!target || target.id === actor.id) return "刺殺目標不正確。";
    room.lastAssassination = { assassinId: actor.id, targetId: target.id, hit: target.role === "merlin" };
    if (target.role === "merlin") {
      setWinner(room, "evil", `刺客刺中梅林：${target.name}。邪惡方勝利。`);
    } else {
      setWinner(room, "good", `刺客刺殺 ${target.name}，但他不是梅林。正義方勝利。`);
    }
    return null;
  }
  if (action === "resetRoom") {
    if (!isHost(room, actor)) return "只有房主可以重置房間。";
    resetRoom(room);
    return null;
  }
  return "未知的動作。";
}

function startGame(room) {
  const deck = expandDeck(room.settings.roles);
  shuffle(deck);
  room.players.sort((a, b) => b.roll - a.roll || b.tieBreak - a.tieBreak);
  room.players.forEach((player, index) => {
    player.role = deck[index];
    player.side = ROLE_DEFS[player.role].side;
    player.ready = false;
    ensurePlayerStats(room, player);
  });
  room.phase = "reveal";
  room.round = 0;
  room.leaderIndex = 0;
  room.rejectedVotes = 0;
  room.retiredLeaderIds = [];
  room.selectedTeam = [];
  room.votes = {};
  room.missionCards = {};
  room.missionResults = [];
  room.revealed = {};
  room.winner = null;
  room.gameStatsRecorded = false;
  room.lastAssassination = null;
  room.currentGame = { missionCounts: {}, mordredThreeAwarded: {} };
  room.reactions = {};
  room.log = [];
  addLog(room, `遊戲開始。${room.players[0].name} 骰點最高，成為首位領袖。`);
}

function finishVote(room) {
  const approve = Object.values(room.votes).filter((vote) => vote === "approve").length;
  const reject = room.players.length - approve;
  room.voteResult = { approve, reject, passed: approve > reject, votes: { ...room.votes } };
  room.phase = "voteResult";
  addLog(room, `投票${room.voteResult.passed ? "通過" : "未通過"}：${approve} 同意、${reject} 不同意。`);
}

function continueAfterVote(room) {
  if (room.voteResult?.passed) {
    room.rejectedVotes = 0;
    room.phase = "mission";
    room.missionCards = {};
    return;
  }
  room.rejectedVotes += 1;
  if (room.rejectedVotes >= 5) {
    setWinner(room, "evil", "五次提案未通過，邪惡方勝利。");
    return;
  }
  changeLeaderClockwise(room, false);
  room.selectedTeam = [];
  room.votes = {};
  room.phase = "team";
}

function finishMission(room) {
  const fails = Object.values(room.missionCards).filter((card) => card === "fail").length;
  const failNeed = PLAYER_RULES[room.settings.playerCount].fail[room.round];
  const result = fails >= failNeed ? "fail" : "success";
  room.missionResults.push({
    round: room.round,
    team: [...room.selectedTeam],
    fails,
    failNeed,
    result
  });
  recordApprovedTeam(room);
  room.phase = "missionResult";
  addLog(room, `第 ${room.round + 1} 次任務${result === "success" ? "成功" : "失敗"}，失敗牌 ${fails} 張。`);
}

function continueAfterMission(room) {
  const successCount = room.missionResults.filter((entry) => entry.result === "success").length;
  const failCount = room.missionResults.filter((entry) => entry.result === "fail").length;
  if (failCount >= 3) {
    setWinner(room, "evil", "三個任務失敗，邪惡方勝利。");
    return;
  }
  if (successCount >= 3) {
    if (room.players.some((player) => player.role === "merlin") && room.players.some((player) => player.role === "assassin")) {
      room.phase = "assassination";
    } else {
      setWinner(room, "good", "三個任務成功，正義方勝利。");
    }
    return;
  }
  room.round += 1;
  room.selectedTeam = [];
  room.missionCards = {};
  room.voteResult = null;
  if (room.settings.leaderMode === "appoint") {
    retireLeader(room, currentLeader(room).id);
    room.phase = "appointLeader";
  } else {
    changeLeaderClockwise(room, true);
    room.phase = "team";
  }
}

function changeLeaderClockwise(room, shouldRetire = true) {
  const oldLeader = currentLeader(room);
  if (shouldRetire) retireLeader(room, oldLeader.id);
  room.leaderIndex = (room.leaderIndex + 1) % room.players.length;
}

function changeLeaderTo(room, targetId) {
  retireLeader(room, currentLeader(room).id);
  room.leaderIndex = room.players.findIndex((player) => player.id === targetId);
}

function retireLeader(room, playerId) {
  if (!room.retiredLeaderIds.includes(playerId)) room.retiredLeaderIds.push(playerId);
  const available = room.players.filter((player) => !room.retiredLeaderIds.includes(player.id));
  if (available.length === 0) {
    room.retiredLeaderIds = [playerId];
    addLog(room, "所有人都曾擔任領袖，退役領袖指示物重置。");
  }
}

function appointableLeaders(room) {
  let candidates = room.players.filter((player) => player.id !== currentLeader(room).id && !room.retiredLeaderIds.includes(player.id));
  if (candidates.length === 0) {
    room.retiredLeaderIds = [currentLeader(room).id];
    candidates = room.players.filter((player) => player.id !== currentLeader(room).id);
  }
  return candidates;
}

function setWinner(room, side, reason) {
  room.winner = { side, reason };
  recordGameOutcome(room, side);
  room.phase = "gameOver";
  addLog(room, reason);
}

function resetRoom(room) {
  room.phase = "lobby";
  room.players.forEach((player) => {
    player.ready = false;
    player.roll = null;
    player.tieBreak = Math.random();
    player.role = null;
    player.side = null;
  });
  room.round = 0;
  room.leaderIndex = 0;
  room.rejectedVotes = 0;
  room.retiredLeaderIds = [];
  room.selectedTeam = [];
  room.votes = {};
  room.missionCards = {};
  room.missionResults = [];
  room.revealed = {};
  room.winner = null;
  room.gameStatsRecorded = false;
  room.lastAssassination = null;
  room.currentGame = null;
  room.chat = [];
  room.reactions = {};
  room.log = [];
  addLog(room, "房間已重置。");
}

function makeView(room, playerId) {
  const viewer = room.players.find((player) => player.id === playerId);
  const validation = validateLobby(room);
  const publicPlayers = room.players.map((player, index) => {
    const showRole = room.phase === "gameOver" || player.id === playerId;
    const achievements = publicAchievements(room, player);
    return {
      id: player.id,
      name: player.name,
      index,
      ready: player.ready,
      roll: player.roll,
      online: player.online,
      lastSeen: player.lastSeen,
      isHost: player.id === room.hostId,
      isLeader: index === room.leaderIndex && room.phase !== "lobby",
      retiredLeader: room.retiredLeaderIds.includes(player.id),
      onTeam: room.selectedTeam.includes(player.id),
      revealed: Boolean(room.revealed[player.id]),
      role: showRole ? player.role : null,
      roleName: showRole && player.role ? ROLE_DEFS[player.role].name : null,
      roleMark: showRole && player.role ? ROLE_DEFS[player.role].mark : null,
      side: showRole ? player.side : null,
      achievements
    };
  });
  return {
    type: "state",
    room: {
      code: room.code,
      expiresAt: room.expiresAt,
      version: room.version,
      phase: room.phase,
      settings: room.settings,
      players: publicPlayers,
      hostId: room.hostId,
      round: room.round,
      leaderId: currentLeader(room)?.id || null,
      rejectedVotes: room.rejectedVotes,
      retiredLeaderIds: room.retiredLeaderIds,
      selectedTeam: room.selectedTeam,
      voteProgress: { done: Object.keys(room.votes).length, total: room.players.length },
      missionProgress: { done: Object.keys(room.missionCards).length, total: room.selectedTeam.length },
      voteResult: publicVoteResult(room),
      missionResults: room.missionResults,
      winner: room.winner,
      chat: room.chat.slice(-80),
      reactionEvent: publicReactionEvent(room, playerId),
      validation,
      canStart: validation.errors.length === 0,
      appointableLeaderIds: room.phase === "appointLeader" ? appointableLeaders(room).map((player) => player.id) : [],
      log: room.log.slice(-12)
    },
    you: viewer ? {
      id: viewer.id,
      name: viewer.name,
      isHost: viewer.id === room.hostId,
      isLeader: viewer.id === currentLeader(room)?.id,
      isOnTeam: room.selectedTeam.includes(viewer.id),
      hasVoted: Boolean(room.votes[viewer.id]),
      hasSubmittedMission: Boolean(room.missionCards[viewer.id]),
      hasRevealed: Boolean(room.revealed[viewer.id]),
      role: viewer.role,
      roleName: viewer.role ? ROLE_DEFS[viewer.role].name : null,
      roleMark: viewer.role ? ROLE_DEFS[viewer.role].mark : null,
      side: viewer.side,
      privateInfo: viewer.role ? identityInfo(room, viewer) : []
    } : null,
    roles: ROLE_DEFS,
    recommendedDecks: RECOMMENDED_DECKS,
    rules: PLAYER_RULES
  };
}

function currentReactionEvent(room) {
  if (room.phase === "voteResult" && room.voteResult) {
    return {
      key: `vote:${room.round}:${room.voteResult.passed ? "passed" : "failed"}:${room.voteResult.approve}:${room.voteResult.reject}`,
      title: "投票結果"
    };
  }
  if (room.phase === "missionResult") {
    const last = room.missionResults.at(-1);
    if (!last) return null;
    return {
      key: `mission:${last.round}:${last.result}:${last.fails}:${last.failNeed}`,
      title: "任務結果"
    };
  }
  if (room.phase === "gameOver" && room.winner) {
    return {
      key: `game:${room.winner.side}:${room.winner.reason}`,
      title: "遊戲結果"
    };
  }
  return null;
}

function ensurePlayerStats(room, player) {
  room.playerStats ||= {};
  const key = playerStatsKey(player.name);
  room.playerStats[key] ||= {
    name: player.name,
    goodWins: 0,
    evilWins: 0,
    merlinGoodWins: 0,
    assassinHits: 0,
    assassinMisses: 0,
    servantStreak: 0,
    servantBestStreak: 0,
    percivalAssassinated: 0,
    morganaEvilWins: 0,
    oberonEvilWins: 0,
    mordredThreeMissionGames: 0,
    leaderGoodTeams: 0
  };
  room.playerStats[key].name = player.name;
  return room.playerStats[key];
}

function recordApprovedTeam(room) {
  if (!room.currentGame) return;
  const leader = currentLeader(room);
  if (leader && room.selectedTeam.length && room.selectedTeam.every((id) => room.players.find((player) => player.id === id)?.side === "good")) {
    ensurePlayerStats(room, leader).leaderGoodTeams += 1;
  }
  room.selectedTeam.forEach((playerId) => {
    const player = room.players.find((item) => item.id === playerId);
    if (!player) return;
    room.currentGame.missionCounts[player.id] = (room.currentGame.missionCounts[player.id] || 0) + 1;
    if (player.role !== "mordred") return;
    if (room.currentGame.missionCounts[player.id] < 3) return;
    if (room.currentGame.mordredThreeAwarded[player.id]) return;
    room.currentGame.mordredThreeAwarded[player.id] = true;
    ensurePlayerStats(room, player).mordredThreeMissionGames += 1;
  });
}

function recordGameOutcome(room, winningSide) {
  if (room.gameStatsRecorded) return;
  room.gameStatsRecorded = true;
  room.players.forEach((player) => {
    const stats = ensurePlayerStats(room, player);
    if (player.side === "good" && winningSide === "good") stats.goodWins += 1;
    if (player.side === "evil" && winningSide === "evil") stats.evilWins += 1;
    if (player.role === "merlin" && winningSide === "good") stats.merlinGoodWins += 1;
    if (player.role === "morgana" && winningSide === "evil") stats.morganaEvilWins += 1;
    if (player.role === "oberon" && winningSide === "evil") stats.oberonEvilWins += 1;
    if (player.role === "servant") {
      stats.servantStreak += 1;
      stats.servantBestStreak = Math.max(stats.servantBestStreak, stats.servantStreak);
    } else {
      stats.servantStreak = 0;
    }
  });

  const assassination = room.lastAssassination;
  if (!assassination) return;
  const assassin = room.players.find((player) => player.id === assassination.assassinId);
  const target = room.players.find((player) => player.id === assassination.targetId);
  if (assassin?.role === "assassin") {
    const stats = ensurePlayerStats(room, assassin);
    if (assassination.hit) stats.assassinHits += 1;
    else stats.assassinMisses += 1;
  }
  if (target?.role === "percival") ensurePlayerStats(room, target).percivalAssassinated += 1;
}

function publicAchievements(room, player) {
  const stats = ensurePlayerStats(room, player);
  const achievements = [];
  if (player.roll >= 95) achievements.push(achievement("dice-god", "骰子之神", `d100 擲出 ${player.roll}，達成 95 以上。`, 1));
  if (player.roll && player.roll <= 5) achievements.push(achievement("fate-joke", "命運開玩笑", `d100 擲出 ${player.roll}，達成 5 以下。`, 1));
  if (stats.goodWins >= ACHIEVEMENT_THRESHOLDS.goodWins) achievements.push(achievement("good-light", "正義之光", `正義方獲勝 ${stats.goodWins} 次。`, stats.goodWins));
  if (stats.evilWins >= ACHIEVEMENT_THRESHOLDS.evilWins) achievements.push(achievement("evil-king", "暗影王者", `邪惡方獲勝 ${stats.evilWins} 次。`, stats.evilWins));
  if (stats.merlinGoodWins >= ACHIEVEMENT_THRESHOLDS.merlinGoodWins) achievements.push(achievement("hidden-mirror", "藏鏡人", `擔任梅林且正義方勝利 ${stats.merlinGoodWins} 次。`, stats.merlinGoodWins));
  if (stats.assassinHits >= ACHIEVEMENT_THRESHOLDS.assassinHits) achievements.push(achievement("top-assassin", "頂尖殺手", `擔任刺客且刺中梅林 ${stats.assassinHits} 次。`, stats.assassinHits));
  if (stats.assassinMisses >= ACHIEVEMENT_THRESHOLDS.assassinMisses) achievements.push(achievement("slipped-hand", "手滑", `擔任刺客但沒有刺中梅林 ${stats.assassinMisses} 次。`, stats.assassinMisses));
  if (stats.servantBestStreak >= ACHIEVEMENT_THRESHOLDS.servantBestStreak) achievements.push(achievement("village-chief", "村長", `連續擔任忠臣最高 ${stats.servantBestStreak} 次。`, stats.servantBestStreak));
  if (stats.percivalAssassinated >= ACHIEVEMENT_THRESHOLDS.percivalAssassinated) achievements.push(achievement("top-staff", "頂級幕僚", `擔任派西維爾且最後被刺客刺殺 ${stats.percivalAssassinated} 次。`, stats.percivalAssassinated));
  if (stats.morganaEvilWins >= ACHIEVEMENT_THRESHOLDS.morganaEvilWins) achievements.push(achievement("puppet-regime", "魁儡政權", `擔任莫甘娜且邪惡方勝利 ${stats.morganaEvilWins} 次。`, stats.morganaEvilWins));
  if (stats.oberonEvilWins >= ACHIEVEMENT_THRESHOLDS.oberonEvilWins) achievements.push(achievement("what-am-i-doing", "我在幹嘛", `擔任奧伯倫且邪惡方勝利 ${stats.oberonEvilWins} 次。`, stats.oberonEvilWins));
  if (stats.mordredThreeMissionGames >= ACHIEVEMENT_THRESHOLDS.mordredThreeMissionGames) achievements.push(achievement("sorry-spy", "對不起我是臥底", `擔任莫德雷德且單場被派出任務 3 次，共 ${stats.mordredThreeMissionGames} 場。`, stats.mordredThreeMissionGames));
  if (stats.leaderGoodTeams >= ACHIEVEMENT_THRESHOLDS.leaderGoodTeams) achievements.push(achievement("clear-eyed-leader", "慧眼領袖", `身為領袖僅指派正義方出任務 ${stats.leaderGoodTeams} 次。`, stats.leaderGoodTeams));
  return achievements;
}

function achievement(id, name, detail, count) {
  return { id, name, detail, count, priority: ACHIEVEMENT_PRIORITIES[id] || 0 };
}

function publicReactionEvent(room, playerId) {
  const event = currentReactionEvent(room);
  if (!event) return null;
  const votes = room.reactions[event.key] || {};
  return {
    ...event,
    reactions: REACTIONS.map((reaction) => {
      const namesForReaction = room.players
        .filter((player) => votes[player.id] === reaction.id)
        .map((player) => player.name);
      return {
        ...reaction,
        count: namesForReaction.length,
        names: namesForReaction,
        active: votes[playerId] === reaction.id
      };
    })
  };
}

function publicVoteResult(room) {
  if (room.phase !== "voteResult" || !room.voteResult) return null;
  return {
    approve: room.voteResult.approve,
    reject: room.voteResult.reject,
    passed: room.voteResult.passed,
    votes: room.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      vote: room.voteResult.votes[player.id] || "reject"
    }))
  };
}

function identityInfo(room, player) {
  if (player.role === "merlin") {
    if (room.settings.playerCount === 4) {
      const visibleAlly = room.players.find((p) => p.id !== player.id && p.side === "good");
      return [`四人局特殊規則：你只看見一位正義隊友：${visibleAlly ? visibleAlly.name : "沒有任何人"}。你看不見對手。`];
    }
    return [`你看見的邪惡方：${names(room.players.filter((p) => p.side === "evil" && p.role !== "mordred"))}。`];
  }
  if (player.role === "percival") {
    return [`你看見的梅林候選人：${names(room.players.filter((p) => p.role === "merlin" || p.role === "morgana"))}。`];
  }
  if (player.side === "evil" && player.role !== "oberon") {
    return [`你認得的邪惡同伴：${names(room.players.filter((p) => p.side === "evil" && p.id !== player.id && p.role !== "oberon"))}。`];
  }
  if (player.role === "oberon") return ["你是邪惡方，但你不知道其他邪惡方是誰，他們也不知道你。"];
  return ["你沒有額外資訊。"];
}

function validateLobby(room) {
  const errors = [];
  const warnings = [];
  const count = room.settings.playerCount;
  const rules = PLAYER_RULES[count];
  const roleTotal = Object.values(room.settings.roles).reduce((sum, value) => sum + value, 0);
  const good = countRolesBySide(room.settings.roles, "good");
  const evil = countRolesBySide(room.settings.roles, "evil");
  if (room.players.length !== count) errors.push(`需要 ${count} 位玩家，目前 ${room.players.length} 位。`);
  if (room.players.some((player) => !player.roll)) errors.push("每位玩家都需要先擲 d100。");
  if (room.players.some((player) => !player.ready)) errors.push("每位玩家都需要按準備。");
  if (roleTotal !== count) errors.push(`牌庫需要剛好 ${count} 張牌。`);
  if (good !== count - rules.evil) errors.push(`正義方需要 ${count - rules.evil} 張。`);
  if (evil !== rules.evil) errors.push(`邪惡方需要 ${rules.evil} 張。`);
  if (room.settings.roles.merlin > 0 && room.settings.roles.assassin === 0) errors.push("使用梅林時需要加入刺客。");
  if (room.settings.roles.percival > 0 && room.settings.roles.merlin === 0) errors.push("使用派西維爾時需要加入梅林。");
  if (count === 5 && room.settings.roles.percival > 0 && room.settings.roles.mordred + room.settings.roles.morgana === 0) {
    errors.push("五人局使用派西維爾時，邪惡方需要使用莫德雷德或莫甘娜。");
  }
  if (room.settings.teamSizes.some((size) => size < 1 || size > count)) errors.push("任務人數必須介於 1 與玩家人數之間。");
  if (room.settings.roles.oberon > 0 && count === 5) warnings.push("五人局加入奧伯倫通常較有利於正義方。");
  return { errors, warnings };
}

function sanitizeRoles(roles) {
  const next = {};
  Object.entries(ROLE_DEFS).forEach(([key, role]) => {
    next[key] = clamp(Number(roles[key] || 0), 0, role.max);
  });
  return next;
}

function sanitizeTeamSizes(teamSizes, playerCount) {
  const fallback = PLAYER_RULES[playerCount].team;
  return Array.from({ length: 5 }, (_, index) => clamp(Number(teamSizes[index] || fallback[index]), 1, playerCount));
}

function markEveryoneUnready(room) {
  room.players.forEach((player) => {
    player.ready = false;
  });
}

function expandDeck(roles) {
  const deck = [];
  Object.entries(roles).forEach(([role, count]) => {
    for (let index = 0; index < count; index += 1) deck.push(role);
  });
  return deck;
}

function countRolesBySide(roles, side) {
  return Object.entries(roles).reduce((sum, [role, count]) => sum + (ROLE_DEFS[role].side === side ? count : 0), 0);
}

function isHost(room, player) {
  return room.hostId === player.id;
}

function isCurrentLeader(room, player) {
  return currentLeader(room)?.id === player.id;
}

function currentLeader(room) {
  return room.players[room.leaderIndex] || null;
}

function names(players) {
  return players.length ? players.map((player) => player.name).join("、") : "沒有任何人";
}

function namesByIds(room, ids) {
  return ids.map((id) => room.players.find((player) => player.id === id)?.name || id).join("、");
}

function addLog(room, message) {
  room.log.push(message);
}

function isRoomExpired(room) {
  return Date.now() >= room.expiresAt;
}

function cleanupRooms() {
  rooms.forEach((room, code) => {
    if (!isRoomExpired(room)) return;
    rooms.delete(code);
    detachRoomClients(code, "房間已超過 6 小時並自動清除。");
  });
}

function heartbeatClients() {
  const changedRooms = new Set();
  clients.forEach((client) => {
    if (client.socket.destroyed) {
      removeClient(client);
      return;
    }
    if (Date.now() - (client.lastSeen || 0) > CLIENT_STALE_MS) {
      client.socket.end();
      removeClient(client);
      return;
    }
    send(client, { type: "ping", at: Date.now() });
  });
  rooms.forEach((room) => {
    if (refreshOnlineStatus(room)) changedRooms.add(room);
  });
  changedRooms.forEach((room) => broadcast(room));
}

function detachRoomClients(roomCode, message) {
  clients.forEach((client) => {
    if (client.roomCode !== roomCode) return;
    send(client, { type: "error", message });
    client.roomCode = null;
    client.playerId = null;
  });
}

function touchRoom(room) {
  room.version += 1;
}

function markClientSeen(client) {
  client.alive = true;
  client.lastSeen = Date.now();
  if (!client.roomCode || !client.playerId) return;
  const room = rooms.get(client.roomCode);
  const player = room?.players.find((item) => item.id === client.playerId);
  if (!player) return;
  player.online = true;
  player.lastSeen = client.lastSeen;
}

function refreshOnlineStatus(room) {
  const now = Date.now();
  let changed = false;
  room.players.forEach((player) => {
    const online = [...clients].some((client) => {
      return client.roomCode === room.code && client.playerId === player.id && client.lastSeen && now - client.lastSeen <= CLIENT_STALE_MS;
    });
    if (player.online !== online) {
      player.online = online;
      changed = true;
    }
  });
  if (changed) touchRoom(room);
  return changed;
}

function cleanName(name) {
  return String(name || "").trim().slice(0, 16);
}

function playerStatsKey(name) {
  return cleanName(name).toLocaleLowerCase();
}

function cleanMessage(message, maxLength) {
  return String(message || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase();
}

function makeRoomCode() {
  let code = "";
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function shuffle(array) {
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }
  return array;
}

function attachClient(client, roomCode, playerId) {
  client.roomCode = roomCode;
  client.playerId = playerId;
  markClientSeen(client);
}

function broadcast(room) {
  refreshOnlineStatus(room);
  clients.forEach((client) => {
    if (client.roomCode === room.code) send(client, makeView(room, client.playerId));
  });
}

function send(client, payload) {
  if (client.socket.destroyed) return;
  client.socket.write(encodeFrame(JSON.stringify(payload)));
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const safePath = urlPath === "/" ? "index.html" : path.normalize(urlPath).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const publicRoot = path.resolve(PUBLIC_DIR);
  const filePath = path.resolve(PUBLIC_DIR, safePath);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function handleUpgrade(req, socket) {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));
  const client = { socket, buffer: Buffer.alloc(0), roomCode: null, playerId: null, alive: true, lastSeen: Date.now() };
  clients.add(client);
  socket.on("data", (chunk) => readFrames(client, chunk));
  socket.on("close", () => removeClient(client));
  socket.on("error", () => removeClient(client));
}

function removeClient(client) {
  clients.delete(client);
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  if (!room) return;
  refreshOnlineStatus(room);
  broadcast(room);
}

function readFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const parsed = decodeFrame(client.buffer);
    if (!parsed) return;
    client.buffer = client.buffer.slice(parsed.bytes);
    if (parsed.opcode === 8) {
      client.socket.end();
      return;
    }
    if (parsed.opcode !== 1) continue;
    try {
      applyAction(client, JSON.parse(parsed.payload));
    } catch (error) {
      send(client, { type: "error", message: "訊息格式錯誤。" });
    }
  }
}

function decodeFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = Boolean(second & 0x80);
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  if (masked) {
    const mask = buffer.slice(maskOffset, maskOffset + 4);
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { opcode, payload: payload.toString("utf8"), bytes: offset + length };
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function createServer() {
  const server = http.createServer(serveStatic);
  server.on("upgrade", handleUpgrade);
  const cleanupTimer = setInterval(cleanupRooms, CLEANUP_INTERVAL_MS);
  const heartbeatTimer = setInterval(heartbeatClients, HEARTBEAT_INTERVAL_MS);
  cleanupTimer.unref?.();
  heartbeatTimer.unref?.();
  server.on("close", () => {
    clearInterval(cleanupTimer);
    clearInterval(heartbeatTimer);
  });
  return server;
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Avalon online host running at http://localhost:${PORT}`);
  });
}

module.exports = {
  ROLE_DEFS,
  PLAYER_RULES,
  DEFAULT_DECK,
  RECOMMENDED_DECKS,
  ACHIEVEMENT_THRESHOLDS,
  rooms,
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView,
  validateLobby,
  cleanupRooms,
  createServer
};
