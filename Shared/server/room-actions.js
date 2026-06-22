"use strict";

function transferHost({
  room,
  actor,
  playerId,
  addLog = () => {},
  addSystemMessage = () => {},
  afterTransfer = () => {}
}) {
  if (actor.id !== room.hostId) return "只有房主可以轉移房主";
  const target = room.players.find((player) => player.id === playerId);
  if (!target) return "找不到這位玩家";
  if (target.id === actor.id) return "你已經是房主";
  room.hostId = target.id;
  room.hostOfflineSince = null;
  addLog(`${actor.name} 將房主轉移給 ${target.name}。`);
  addSystemMessage(`${target.name} 現在是房主。`);
  afterTransfer(target);
  return null;
}

function kickOfflinePlayer({
  room,
  actor,
  playerId,
  refreshOnline = () => {},
  removePlayer = (target) => {
    room.players = room.players.filter((player) => player.id !== target.id);
  },
  markEveryoneUnready = () => {},
  addLog = () => {},
  addSystemMessage = () => {},
  afterKick = () => {}
}) {
  if (actor.id !== room.hostId) return "只有房主可以踢出玩家";
  if (room.phase !== "lobby") return "只能在準備房間踢出玩家";
  const target = room.players.find((player) => player.id === playerId);
  if (!target) return "找不到這位玩家";
  if (target.id === actor.id) return "房主不能踢出自己";
  refreshOnline();
  if (target.online) return "只能踢出離線玩家";
  removePlayer(target);
  markEveryoneUnready();
  addLog(`${actor.name} 將離線玩家 ${target.name} 移出房間。`);
  addSystemMessage(`${target.name} 已被移出房間。`);
  afterKick(target);
  return null;
}

module.exports = { transferHost, kickOfflinePlayer };
