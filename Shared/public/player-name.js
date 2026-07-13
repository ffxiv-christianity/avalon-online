(function initializePlayerNameContract(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.SharedPlayerName = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlayerNameContract() {
  "use strict";

  const MAX_PLAYER_NAME_WIDTH = 12;

  function normalizePlayerName(value) {
    return String(value || "").replace(/\s+/gu, " ").trim();
  }

  function isZeroWidthCodePoint(codePoint, character) {
    return codePoint === 0x200d
      || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
      || (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
      || /^\p{Mark}$/u.test(character);
  }

  function isFullWidthCodePoint(codePoint) {
    if (!Number.isFinite(codePoint)) return false;
    return codePoint >= 0x1100 && (
      codePoint <= 0x115f
      || codePoint === 0x2329
      || codePoint === 0x232a
      || (codePoint >= 0x2e80 && codePoint <= 0x303e)
      || (codePoint >= 0x3040 && codePoint <= 0xa4cf && codePoint !== 0x303f)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
      || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
      || (codePoint >= 0xff01 && codePoint <= 0xff60)
      || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
      || (codePoint >= 0x1b000 && codePoint <= 0x1b2ff)
      || (codePoint >= 0x1f000 && codePoint <= 0x1faff)
      || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    );
  }

  function graphemes(value) {
    const text = String(value || "");
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      return Array.from(segmenter.segment(text), (entry) => entry.segment);
    }
    return Array.from(text);
  }

  function playerNameCharacterWidth(grapheme) {
    let hasVisibleCharacter = false;
    for (const character of Array.from(String(grapheme || ""))) {
      const codePoint = character.codePointAt(0);
      if (isZeroWidthCodePoint(codePoint, character)) continue;
      hasVisibleCharacter = true;
      if (isFullWidthCodePoint(codePoint) || /^\p{Extended_Pictographic}$/u.test(character)) return 2;
    }
    return hasVisibleCharacter ? 1 : 0;
  }

  function playerNameWidth(value) {
    return graphemes(value).reduce((total, character) => total + playerNameCharacterWidth(character), 0);
  }

  function limitPlayerName(value, maxWidth = MAX_PLAYER_NAME_WIDTH) {
    let result = "";
    let width = 0;
    for (const character of graphemes(value)) {
      const characterWidth = playerNameCharacterWidth(character);
      if (width + characterWidth > maxWidth) break;
      result += character;
      width += characterWidth;
    }
    return result;
  }

  function cleanPlayerName(value) {
    return limitPlayerName(normalizePlayerName(value));
  }

  function bindPlayerNameInput(input) {
    if (!input || input.dataset.playerNameContract === "bound") return;
    input.dataset.playerNameContract = "bound";
    input.maxLength = MAX_PLAYER_NAME_WIDTH;
    input.title = "最多 12 個半形字元；中文、全形字元與表情符號算 2 個。";
    input.addEventListener("input", () => {
      const limited = limitPlayerName(input.value);
      if (limited !== input.value) input.value = limited;
    });
    input.addEventListener("blur", () => {
      input.value = cleanPlayerName(input.value);
    });
  }

  return Object.freeze({
    MAX_PLAYER_NAME_WIDTH,
    normalizePlayerName,
    playerNameCharacterWidth,
    playerNameWidth,
    limitPlayerName,
    cleanPlayerName,
    bindPlayerNameInput
  });
});
