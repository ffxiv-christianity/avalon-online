"use strict";

const crypto = require("crypto");

function randomIntInclusive(min, max) {
  return crypto.randomInt(min, max + 1);
}

function randomTieBreak() {
  return crypto.randomInt(0, 0x100000000);
}

function shuffle(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(0, index + 1);
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

function roomCode(existingCodes = null) {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (existingCodes?.has(code));
  return code;
}

function playerId(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomDelay(minMs, maxMs) {
  return crypto.randomInt(minMs, maxMs + 1);
}

module.exports = {
  randomIntInclusive,
  randomTieBreak,
  shuffle,
  roomCode,
  playerId,
  randomDelay
};
