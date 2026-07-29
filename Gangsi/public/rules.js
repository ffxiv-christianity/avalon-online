(function initializeGangsiRules(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GangsiRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGangsiRules() {
  "use strict";

  function syncCardDetailControls(content) {
    content.querySelectorAll(".gangsi-hunt-card-grid article").forEach((card) => {
      let button = card.querySelector("[data-gangsi-card-detail]");
      const detailSource = card.querySelector("template[data-gangsi-card-detail-source]");
      if (!detailSource) {
        button?.remove();
        card.classList.remove("has-detail-control");
        return;
      }
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "gangsi-hunt-card-detail-button";
        button.dataset.gangsiCardDetail = "";
        button.textContent = "查看";
        card.querySelector("h4")?.insertAdjacentElement("afterend", button);
      }
      card.classList.add("has-detail-control");
    });
  }

  function scheduleCardDetailControls(content) {
    window.requestAnimationFrame(() => syncCardDetailControls(content));
  }

  function createCardDetailLayer(overlay) {
    const layer = document.createElement("div");
    layer.className = "gangsi-rule-card-detail-layer hidden";
    layer.dataset.gangsiRuleCardDetailLayer = "";
    layer.innerHTML = `
      <section class="gangsi-rule-card-detail-panel" role="dialog" aria-modal="true" aria-labelledby="gangsiRuleCardDetailTitle">
        <header>
          <span class="gangsi-hunt-card-icon" data-gangsi-rule-card-detail-icon></span>
          <div class="gangsi-rule-card-detail-heading">
            <p data-gangsi-rule-card-detail-kind></p>
            <h3 id="gangsiRuleCardDetailTitle" data-gangsi-rule-card-detail-title></h3>
          </div>
          <button class="ghost-button" type="button" data-gangsi-rule-card-detail-close aria-label="關閉角色說明">關閉</button>
        </header>
        <div class="gangsi-rule-card-detail-body">
          <strong class="gangsi-rule-card-detail-kicker">能力說明</strong>
          <div data-gangsi-rule-card-detail-body></div>
        </div>
      </section>`;
    overlay.querySelector(".rules-dialog")?.appendChild(layer);
    return layer;
  }

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
    const detailLayer = createCardDetailLayer(overlay);
    const detailCloseButton = detailLayer.querySelector("[data-gangsi-rule-card-detail-close]");
    let activeMode = null;
    let detailReturnFocus = null;

    function closeCardDetail({ restoreFocus = true } = {}) {
      if (detailLayer.classList.contains("hidden")) return;
      detailLayer.classList.add("hidden");
      detailLayer.classList.remove("is-monster");
      if (restoreFocus) detailReturnFocus?.focus();
      detailReturnFocus = null;
    }

    function openCardDetail(card, trigger) {
      const icon = card.querySelector(".gangsi-hunt-card-icon")?.textContent || "";
      const title = card.querySelector("h4")?.textContent || "";
      const detailSource = card.querySelector("template[data-gangsi-card-detail-source]");
      const isMonster = Boolean(card.closest(".gangsi-hunt-card-grid.monsters"));
      detailLayer.querySelector("[data-gangsi-rule-card-detail-icon]").textContent = icon;
      detailLayer.querySelector("[data-gangsi-rule-card-detail-kind]").textContent = isMonster ? "提燈怪類型" : "冒險者職業";
      detailLayer.querySelector("[data-gangsi-rule-card-detail-title]").textContent = title;
      const body = detailLayer.querySelector("[data-gangsi-rule-card-detail-body]");
      body.replaceChildren(...(detailSource ? [detailSource.content.cloneNode(true)] : []));
      detailLayer.classList.toggle("is-monster", isMonster);
      detailLayer.classList.remove("hidden");
      detailReturnFocus = trigger;
      detailCloseButton.focus();
    }

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
      closeCardDetail({ restoreFocus: false });
      scheduleCardDetailControls(content);
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
      closeCardDetail({ restoreFocus: false });
      overlay.classList.add("hidden");
      document.body.classList.remove("modal-open");
      openButton.focus();
    }

    openButton.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    content.addEventListener("click", (event) => {
      const button = event.target.closest("[data-gangsi-card-detail]");
      if (!button) return;
      const card = button.closest(".gangsi-hunt-card-grid article");
      if (!card) return;
      openCardDetail(card, button);
    });
    detailCloseButton.addEventListener("click", () => closeCardDetail());
    detailLayer.addEventListener("click", (event) => {
      if (event.target === detailLayer) closeCardDetail();
    });
    window.addEventListener("resize", () => scheduleCardDetailControls(content));
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
      if (event.key !== "Escape" || overlay.classList.contains("hidden")) return;
      if (!detailLayer.classList.contains("hidden")) closeCardDetail();
      else close();
    });
    return Object.freeze({ open, close, activateTab });
  }

  return Object.freeze({ hydrateFromGameIndex, mount });
});
