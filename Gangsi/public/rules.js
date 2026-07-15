(function initializeGangsiRules(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GangsiRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGangsiRules() {
  "use strict";

  async function hydrateFromGameIndex(content) {
    if (content.childElementCount) return;
    content.innerHTML = '<p class="notice">規則載入中…</p>';
    try {
      const response = await fetch("/Gangsi/", { cache: "no-store" });
      if (!response.ok) throw new Error("rules unavailable");
      const sourceDocument = new DOMParser().parseFromString(await response.text(), "text/html");
      const source = sourceDocument.querySelector("#gangsiRulesContent");
      if (!source?.childElementCount) throw new Error("rules content missing");
      content.replaceChildren(...Array.from(source.childNodes, (node) => node.cloneNode(true)));
    } catch {
      content.innerHTML = '<p class="notice">目前無法載入規則。</p>';
    }
  }

  function mount(scope = document) {
    const overlay = scope.querySelector("#rulesOverlay");
    const openButton = scope.querySelector("#openRulesButton");
    const closeButton = scope.querySelector("#closeRulesButton");
    const content = scope.querySelector("#gangsiRulesContent");
    if (!overlay || !openButton || !closeButton || !content) return null;

    async function open() {
      overlay.classList.remove("hidden");
      document.body.classList.add("modal-open");
      closeButton.focus();
      await hydrateFromGameIndex(content);
    }

    function close() {
      overlay.classList.add("hidden");
      document.body.classList.remove("modal-open");
      openButton.focus();
    }

    openButton.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !overlay.classList.contains("hidden")) close();
    });
    return Object.freeze({ open, close });
  }

  return Object.freeze({ hydrateFromGameIndex, mount });
});
