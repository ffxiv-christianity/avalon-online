(function exposeSharedRoomUi(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SharedRoomUI = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createSharedRoomUi() {
  let toastTimer = null;

  function token(kind, label) {
    return `<span class="token template-player-token ${kind}" title="${escapeAttribute(label)}" aria-label="${escapeAttribute(label)}"></span>`;
  }

  function logEntries(entries = [], escape = escapeHtml) {
    return entries.slice().reverse().map((entry) => `<li>${escape(entry)}</li>`).join("");
  }

  function playerCardClasses({ playerId, viewerId, online = true, retired = false } = {}) {
    return [
      playerId && playerId === viewerId ? "is-self" : "",
      online ? "" : "offline",
      retired ? "retired" : ""
    ].filter(Boolean).join(" ");
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

  function showControlLock(onTakeover) {
    clearControlLock();
    document.body.classList.add("shared-readonly");
    const overlay = document.createElement("div");
    overlay.className = "shared-control-lock";
    overlay.dataset.sharedControlLock = "";
    overlay.innerHTML = `
      <section class="shared-control-lock-card" role="status">
        <strong>此分頁目前為唯讀</strong>
        <p>同一位玩家已在另一個分頁接管。你仍可查看房間狀態，或在這個分頁取回控制權。</p>
        <button class="primary-button" data-shared-take-control type="button">在此分頁接管</button>
      </section>`;
    const takeoverButton = overlay.querySelector("[data-shared-take-control]");
    takeoverButton.addEventListener("click", () => {
      if (takeoverButton.disabled) return;
      takeoverButton.disabled = true;
      takeoverButton.textContent = "接管中…";
      onTakeover?.();
      window.setTimeout(() => {
        if (!takeoverButton.isConnected) return;
        takeoverButton.disabled = false;
        takeoverButton.textContent = "在此分頁接管";
      }, 3000);
    });
    document.body.appendChild(overlay);
  }

  function clearControlLock() {
    document.querySelector("[data-shared-control-lock]")?.remove();
    document.body.classList.remove("shared-readonly");
  }

  function showToast(message, duration = 2800) {
    let toast = document.querySelector("[data-shared-toast]");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "shared-toast hidden";
      toast.dataset.sharedToast = "";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = String(message || "");
    toast.classList.remove("hidden");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), duration);
  }

  function captureScroll(element, bottomThreshold = 48) {
    if (!element) return { atBottom: true, scrollTop: 0 };
    const distanceFromBottom = element.scrollHeight - element.clientHeight - element.scrollTop;
    return {
      atBottom: distanceFromBottom <= bottomThreshold,
      scrollTop: element.scrollTop
    };
  }

  function restoreScroll(element, state) {
    if (!element) return;
    if (!state || state.atBottom) {
      element.scrollTop = element.scrollHeight;
      return;
    }
    element.scrollTop = Math.min(state.scrollTop, Math.max(0, element.scrollHeight - element.clientHeight));
  }

  function updateChatUnread({
    entries = [],
    lastObservedId = null,
    viewerId = "",
    chatActive = false,
    chatAtBottom = true,
    currentCount = 0
  } = {}) {
    const newestId = entries.at(-1)?.id || null;
    if (!newestId) {
      return {
        count: chatActive && chatAtBottom ? 0 : currentCount,
        lastObservedId: null
      };
    }
    if (newestId === lastObservedId) {
      return {
        count: chatActive && chatAtBottom ? 0 : currentCount,
        lastObservedId
      };
    }
    const previousIndex = entries.findIndex((entry) => entry.id === lastObservedId);
    const incoming = previousIndex >= 0 ? entries.slice(previousIndex + 1) : entries.slice(-1);
    const unreadIncoming = incoming.filter((entry) => entry.playerId !== viewerId && entry.playerId !== "system").length;
    return {
      count: chatActive && chatAtBottom ? 0 : currentCount + unreadIncoming,
      lastObservedId: newestId
    };
  }

  function bindChatReadState(element, onReadLatest) {
    if (!element) return;
    element.addEventListener("scroll", () => {
      if (captureScroll(element).atBottom) onReadLatest();
    }, { passive: true });
  }

  function readLatestChat(element, onReadLatest) {
    restoreScroll(element, { atBottom: true, scrollTop: 0 });
    onReadLatest?.();
  }

  function mobileStatusSummary(items = []) {
    return items.filter((item) => item?.value !== undefined && item?.value !== null).map((item) => `
      <span class="mobile-status-summary-item">
        ${item.label ? `<small>${escapeHtml(item.label)}</small>` : ""}
        <strong>${escapeHtml(item.value)}</strong>
      </span>`).join("");
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  return {
    token,
    logEntries,
    playerCardClasses,
    hostControls,
    bindHostControls,
    connectionStatusText,
    formatCountUnit,
    showControlLock,
    clearControlLock,
    showToast,
    captureScroll,
    restoreScroll,
    updateChatUnread,
    bindChatReadState,
    readLatestChat,
    mobileStatusSummary
  };
}));
