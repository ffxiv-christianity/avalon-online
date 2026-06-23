(function exposeSharedRoomUi(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SharedRoomUI = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createSharedRoomUi() {
  function token(kind, label) {
    return `<span class="token ${kind}" title="${escapeAttribute(label)}" aria-label="${escapeAttribute(label)}"></span>`;
  }

  function hostControls({ viewerIsHost, player, hostId, phase }) {
    if (!viewerIsHost || player.id === hostId) return "";
    const transfer = `<button class="mini-action" data-shared-transfer-host="${player.id}" type="button">轉房主</button>`;
    const kick = phase === "lobby" && !player.online
      ? `<button class="mini-action danger-mini-action" data-shared-kick-player="${player.id}" data-player-name="${escapeAttribute(player.name)}" type="button">踢出玩家</button>`
      : "";
    return transfer + kick;
  }

  function bindHostControls(container, sendAction) {
    container.querySelectorAll("[data-shared-transfer-host]").forEach((button) => {
      button.addEventListener("click", () => sendAction("transferHost", { playerId: button.dataset.sharedTransferHost }));
    });
    container.querySelectorAll("[data-shared-kick-player]").forEach((button) => {
      button.addEventListener("click", () => {
        const playerName = button.dataset.playerName || "這位玩家";
        if (!window.confirm(`確定要將離線玩家「${playerName}」移出房間嗎？`)) return;
        sendAction("kickOfflinePlayer", { playerId: button.dataset.sharedKickPlayer });
      });
    });
  }

  function connectionStatusText(version, connectedText = "已連線") {
    const normalizedVersion = Math.max(0, Number(version) || 0);
    return normalizedVersion ? `已同步 ${formatCountUnit(normalizedVersion)}` : connectedText;
  }

  function formatCountUnit(value) {
    const count = Math.max(0, Number(value) || 0);
    if (count >= 1000000000) return `${trimUnit(count / 1000000000)}B 次`;
    if (count >= 1000000) return `${trimUnit(count / 1000000)}M 次`;
    if (count >= 1000) return `${trimUnit(count / 1000)}K 次`;
    return `${count} 次`;
  }

  function trimUnit(value) {
    return Number(value.toFixed(value >= 10 ? 0 : 1)).toString();
  }

  function escapeAttribute(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  return {
    token,
    hostControls,
    bindHostControls,
    connectionStatusText,
    formatCountUnit
  };
}));
