"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const catalogModulePath = require.resolve("../map-catalog");
delete require.cache[catalogModulePath];

const originalReadFileSync = fs.readFileSync;
let mapFileReads = 0;
fs.readFileSync = function trackedReadFileSync(filePath, ...args) {
  const resolved = path.resolve(String(filePath));
  if (resolved.startsWith(`${path.resolve(__dirname, "..", "maps")}${path.sep}`)) mapFileReads += 1;
  return originalReadFileSync.call(this, filePath, ...args);
};

let MapCatalog;
try {
  MapCatalog = require("../map-catalog");
  const firstCatalog = MapCatalog.loadBuiltInMaps();
  const readsAfterFirstLoad = mapFileReads;
  const secondCatalog = MapCatalog.loadBuiltInMaps();

  assert(readsAfterFirstLoad > 0, "first catalog load should read built-in map files");
  assert.strictEqual(mapFileReads, readsAfterFirstLoad, "cached catalog must not reread map files");
  assert.strictEqual(secondCatalog, firstCatalog, "all rooms should share one catalog cache");
  assert(Object.isFrozen(firstCatalog));
  assert(firstCatalog.length > 0);
  assert(firstCatalog.every((entry) => Object.isFrozen(entry)));
  assert(firstCatalog.every((entry) => Object.isFrozen(entry.map)));
  assert(firstCatalog.every((entry) => Object.isFrozen(entry.map.walls)));
  assert(firstCatalog.every((entry) => Object.isFrozen(entry.map.zones)));

  const mapId = firstCatalog[0].id;
  const firstRoomMap = MapCatalog.getBuiltInMap(mapId);
  const originalName = firstRoomMap.name;
  const originalWallCount = firstRoomMap.walls.length;
  firstRoomMap.name = "mutated room map";
  firstRoomMap.walls.push("1,1|1,2");

  const secondRoomMap = MapCatalog.getBuiltInMap(mapId);
  assert.notStrictEqual(secondRoomMap, firstRoomMap);
  assert.strictEqual(secondRoomMap.name, originalName);
  assert.strictEqual(secondRoomMap.walls.length, originalWallCount);
  assert.strictEqual(mapFileReads, readsAfterFirstLoad, "map lookup must only clone cached data");
} finally {
  fs.readFileSync = originalReadFileSync;
}

console.log("Gangsi map catalog cache tests passed");
