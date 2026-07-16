"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const MapClasses = require("../map-classes");
const MapFormat = require("../map-format");
const MapCatalog = require("../map-catalog");
const Rules = require("../public/rules");

const classic = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "maps", "classic.json"), "utf8"));
const result = MapFormat.validateMap(classic);

assert.strictEqual(result.valid, true, result.errors.join("; "));
assert.strictEqual(result.map.width, 10);
assert.strictEqual(result.map.height, 7);
assert.strictEqual(result.map.date, "2026-07-15");
assert.strictEqual(MapFormat.LIMITS.maxWidth, 14);
assert.deepStrictEqual(result.map.zones.entrance, { anchor: "4,7", exits: ["3,7"] });
assert.deepStrictEqual(result.map.zones.dungeon, { anchor: "6,7", exits: ["6,6", "7,7"] });
assert.strictEqual(result.map.treasures.length, 23);
assert.deepStrictEqual([...new Set(result.map.treasures.map((treasure) => treasure.id))], MapFormat.TREASURE_IDS);
assert.strictEqual(MapFormat.mapStats(result.map).floorCells, 67);

assert.strictEqual(MapClasses.cellClassAt(result.map, "4,7"), "entrance");
assert.strictEqual(MapClasses.cellClassAt(result.map, "5,7"), "void");
assert.strictEqual(MapClasses.cellClassAt(result.map, "6,7"), "dungeon");
assert.strictEqual(MapClasses.movementInteraction("adventurerNumeric", "piece", "adventurer"), "pass-only");
assert.strictEqual(MapClasses.movementInteraction("adventurerArrow", "piece", "adventurer"), "block");
assert.strictEqual(MapClasses.movementInteraction("adventurerNumeric", "piece", "mummy"), "block");
assert.strictEqual(MapClasses.movementInteraction("mummy", "piece", "adventurer"), "capture-and-stop");
assert.strictEqual(MapClasses.PIECE_CLASSES.mummy.label, "提燈怪");
assert.strictEqual(MapClasses.PIECE_CLASSES.mummy.tokenLabel, "怪");
assert.deepStrictEqual(
  Object.values(MapFormat.GROUPS).map((group) => group.name),
  ["黃金渡渡鳥聖像", "龍眼", "釣場之皇", "幻想藥", "L房地契"]
);
assert.strictEqual(MapClasses.OBJECT_CLASSES.treasure.onAdventurerStop, "offer-reveal");
assert(/^\d{4}-\d{2}-\d{2}$/.test(MapFormat.createBlankMap().date));
assert.notStrictEqual(MapFormat.slug("朋友的古墓"), "custom-map");
assert.strictEqual(typeof Rules.mount, "function");
assert.strictEqual(typeof Rules.hydrateFromGameIndex, "function");

const missingTreasure = MapFormat.clone(classic);
missingTreasure.treasures.pop();
assert.strictEqual(MapFormat.validateMap(missingTreasure).valid, false);
assert(MapFormat.validateMap(missingTreasure).errors.some((error) => error.includes("缺少寶藏")));

const duplicateTreasure = MapFormat.clone(classic);
duplicateTreasure.treasures[1].position = duplicateTreasure.treasures[0].position;
assert(MapFormat.validateMap(duplicateTreasure).errors.some((error) => error.includes("同一格不能放兩個寶藏")));

const sealedEntrance = MapFormat.clone(classic);
sealedEntrance.walls.push("3,7|4,7");
assert(MapFormat.validateMap(sealedEntrance).errors.some((error) => error.includes("入口至少需要")));

const multipleEntranceExits = MapFormat.createBlankMap(6, 5);
multipleEntranceExits.zones.entrance.anchor = "3,3";
multipleEntranceExits.zones.dungeon.anchor = "6,5";
assert.deepStrictEqual(
  MapFormat.refreshZoneExits(multipleEntranceExits).zones.entrance.exits,
  ["3,2", "2,3", "4,3", "3,4"]
);

const behaviorOverride = { ...MapFormat.clone(classic), rules: { mummyCanEnterWalls: true } };
assert(MapFormat.validateMap(behaviorOverride).errors.some((error) => error.includes("不得覆寫固定遊戲屬性")));

const invalidDate = { ...MapFormat.clone(classic), date: "2026/07/15" };
assert(MapFormat.validateMap(invalidDate).errors.some((error) => error.includes("YYYY-MM-DD")));

const tooWide = { ...MapFormat.clone(classic), width: 15 };
assert(MapFormat.validateMap(tooWide).errors.some((error) => error.includes("地圖寬度")));

const maximumBoard = { ...MapFormat.clone(classic), width: 14, height: 12 };
assert.strictEqual(MapFormat.validateMap(maximumBoard).valid, true);

const catalogIndex = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "maps", "index.json"), "utf8"));
const builtInMaps = MapCatalog.loadBuiltInMaps();
assert.strictEqual(builtInMaps.length, catalogIndex.maps.length);
assert.deepStrictEqual(builtInMaps.map((entry) => entry.id), catalogIndex.maps.map((entry) => entry.id));
for (const entry of catalogIndex.maps) {
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "maps", entry.file), "utf8"));
  const validation = MapFormat.validateMap(payload);
  assert.strictEqual(validation.valid, true, `${entry.file}: ${validation.errors.join("; ")}`);
  assert.strictEqual(MapCatalog.getBuiltInMap(entry.id).id, entry.id);
  assert.strictEqual(MapCatalog.getBuiltInMap(entry.id).name, entry.name || validation.map.name);
}
const customMapEntry = catalogIndex.maps.find((entry) => entry.id === "test-map");
assert(customMapEntry);
assert.strictEqual(customMapEntry.name, "蟹制地圖1");
assert.strictEqual(MapCatalog.getBuiltInMap("test-map").name, "蟹制地圖1");
const randomMap = MapCatalog.randomBuiltInMap();
assert(catalogIndex.maps.some((entry) => entry.id === randomMap.id));
assert.strictEqual(MapCatalog.getBuiltInMap("missing"), null);

console.log("Gangsi map format tests passed");
