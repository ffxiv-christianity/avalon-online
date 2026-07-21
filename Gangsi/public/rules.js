(function initializeGangsiRules(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GangsiRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGangsiRules() {
  "use strict";

  async function hydrateFromGameIndex(content) {
    if (content.childElementCount) return;
    content.innerHTML = '<p class="notice">規則載入中……</p>';
    try {
      const response = await fetch("/Gangsi/", { cache: "no-store" });
      if (!response.ok) throw new Error("rules unavailable");
      const sourceDocument = new DOMParser().parseFromString(await response.text(), "text/html");
      const source = sourceDocument.querySelector("#gangsiRulesContent");
      if (!source?.childElementCount) throw new Error("rules content missing");
      content.replaceChildren(...Array.from(source.childNodes, (node) => node.cloneNode(true)));
    } catch {
      content.innerHTML = '<p class="notice">目前無法載入規則，請稍後再試。</p>';
    }
  }

  function preferredMode(scope) {
    const modeSelect = scope.querySelector("[data-gangsi-mode]") || scope.querySelector("#gameModeSelect");
    return modeSelect?.value === "hunt" ? "hunt" : "classic";
  }

  function mount(scope = document) {
    const overlay = scope.querySelector("#rulesOverlay");
    const openButton = scope.querySelector("#openRulesButton");
    const closeButton = scope.querySelector("#closeRulesButton");
    const content = scope.querySelector("#gangsiRulesContent");
    if (!overlay || !openButton || !closeButton || !content) return null;

    const tabs = Array.from(scope.querySelectorAll("[data-gangsi-rules-tab]"));
    let activeMode = null;

    function activateTab(mode, { focus = false, resetScroll = true } = {}) {
      const selectedMode = mode === "hunt" ? "hunt" : "classic";
      activeMode = selectedMode;

      tabs.forEach((tab) => {
        const selected = tab.dataset.gangsiRulesTab === selectedMode;
        tab.classList.toggle("is-active", selected);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && focus) tab.focus();
      });

      content.querySelectorAll("[data-gangsi-rules-panel]").forEach((panel) => {
        const selected = panel.dataset.gangsiRulesPanel === selectedMode;
        panel.classList.toggle("is-active", selected);
        panel.hidden = !selected;
      });

      if (resetScroll) content.scrollTop = 0;
      return selectedMode;
    }

    async function open() {
      overlay.classList.remove("hidden");
      document.body.classList.add("modal-open");
      closeButton.focus();
      if (!activeMode) activeMode = preferredMode(scope);
      await hydrateFromGameIndex(content);
      activateTab(activeMode);
    }

    function close() {
      overlay.classList.add("hidden");
      document.body.classList.remove("modal-open");
      openButton.focus();
    }

    openButton.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateTab(tab.dataset.gangsiRulesTab, { focus: true }));
      tab.addEventListener("keydown", (event) => {
        let nextIndex = null;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        activateTab(tabs[nextIndex].dataset.gangsiRulesTab, { focus: true });
      });
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !overlay.classList.contains("hidden")) close();
    });
    return Object.freeze({ open, close, activateTab });
  }

  return Object.freeze({ hydrateFromGameIndex, mount });
});
