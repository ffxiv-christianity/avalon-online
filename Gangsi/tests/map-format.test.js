"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const MapClasses = require("../map-classes");
const MapFormat = require("../map-format");
const MapCatalog = require("../map-catalog");
const Rules = require("../public/rules");

const classic = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "maps", "classic.json"), "utf8"));
const testMap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "maps", "test-map.json"), "utf8"));
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
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(MapFormat.GROUPS).map(([id, group]) => [id, [group.label, group.color]])),
  {
    A: ["黃", "yellow"],
    B: ["紅", "red"],
    C: ["藍", "blue"],
    D: ["粉", "pink"],
    E: ["綠", "green"]
  }
);
assert.strictEqual(MapClasses.OBJECT_CLASSES.treasure.onAdventurerStop, "offer-reveal");
assert.strictEqual(MapClasses.OBJECT_CLASSES.mechanism.obstacle, true);
assert.strictEqual(MapClasses.OBJECT_CLASSES.escapeExit.classicIgnored, true);
assert.strictEqual(MapClasses.OBJECT_CLASSES.escapeExit.runtimeOnly, true);
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

const huntMap = MapFormat.normalizeMap(classic);
huntMap.hunt.mechanisms = { A: "4,1", B: "5,2" };
const huntValidation = MapFormat.validateHuntMap(huntMap);
assert.strictEqual(huntValidation.valid, true, huntValidation.errors.join("; "));
const classicDerivedVoids = MapFormat.deriveHuntVoidCells(classic);
assert(classicDerivedVoids.includes("4,1"), "a road sealed only after placing a mechanism must become a derived Hunt void");
assert(!classic.voidCells.includes("4,1"), "derived Hunt voids must not mutate the map file");
const appliedDerivedMap = MapFormat.applyHuntDerivedVoidCells(classic);
assert(appliedDerivedMap.voidCells.includes("4,1"));
assert.strictEqual(MapFormat.buildMovementGraph(classic, { hunt: true }).passages["4,1"], undefined);
assert(MapFormat.buildMovementGraph(classic).passages["4,1"], "the same cell remains a road in Classic mode");
const treasureOnDerivedVoid = MapFormat.clone(classic);
treasureOnDerivedVoid.treasures[0].position = "4,1";
assert(MapFormat.validateHuntMap(treasureOnDerivedVoid).errors
  .some((error) => error.includes("獵殺模式衍生封閉格")));
const mechanismCutsOffRoadSegment = MapFormat.clone(testMap);
mechanismCutsOffRoadSegment.hunt.mechanisms.A = "4,1";
assert.deepStrictEqual(
  MapFormat.deriveHuntVoidCells(mechanismCutsOffRoadSegment),
  ["2,1", "3,1"],
  "hunt mechanisms should derive every road cell in a disconnected component"
);
const cutOffTreasureValidation = MapFormat.validateHuntMap(mechanismCutsOffRoadSegment);
assert.strictEqual(
  cutOffTreasureValidation.valid,
  false,
  "hunt validation should reject a treasure in a road segment disconnected by a mechanism"
);
assert(
  cutOffTreasureValidation.errors.some((error) =>
    error.includes("寶藏 C3") &&
    error.includes("獵殺模式衍生封閉格 2,1")
  ),
  "hunt validation should identify the treasure and derived void cell"
);
const cutOffRoadGraph = MapFormat.buildMovementGraph(mechanismCutsOffRoadSegment, { hunt: true });
assert.strictEqual(
  cutOffRoadGraph.passages["2,1"],
  undefined,
  "hunt movement graph should exclude the full disconnected road segment"
);
assert.strictEqual(
  cutOffRoadGraph.passages["3,1"],
  undefined,
  "hunt movement graph should exclude every cell in the disconnected road segment"
);
const wallEnclosedCellMap = MapFormat.clone(classic);
const wallEnclosedCell = "10,1";
for (const adjacent of MapFormat.neighbors(wallEnclosedCell, wallEnclosedCellMap.width, wallEnclosedCellMap.height)) {
  wallEnclosedCellMap.walls.push(MapFormat.canonicalEdge(wallEnclosedCell, adjacent));
}
assert(
  !MapFormat.deriveHuntVoidCells(wallEnclosedCellMap).includes(wallEnclosedCell),
  "a cell enclosed by walls alone must not become a derived Hunt void"
);
const purification = MapFormat.analyzePurificationPools(huntMap);
assert.strictEqual(purification.available, true);
assert.strictEqual(purification.fallback, false);
assert.strictEqual(purification.bestPairs.length > 0, true);
assert(purification.bestPairs.every((pair) => pair.poolDistance >= 6 && pair.maxTreasureDistance <= 9));
const forbiddenPoolCells = new Set(Object.values(huntMap.hunt.mechanisms));
assert(purification.candidates.every((cell) => !forbiddenPoolCells.has(cell)));
const huntGraph = MapFormat.buildMovementGraph(huntMap, { hunt: true });
assert.strictEqual(huntGraph.passages["9,2"].length, 1, "classic 9,2 must remain a terminal road cell");
assert(
  purification.candidates.includes("9,2"),
  "passable terminal road cells must remain eligible purification-pool candidates"
);
const treasureCells = new Set(huntMap.treasures.map((treasure) => treasure.position));
assert(
  purification.candidates.some((cell) => treasureCells.has(cell)),
  "passable treasure cells must remain eligible purification-pool candidates"
);
const treasureOnlyPoolMap = MapFormat.clone(huntMap);
const treasureOnlyPoolGraph = MapFormat.buildMovementGraph(treasureOnlyPoolMap, { hunt: true });
treasureOnlyPoolMap.treasures = Object.keys(treasureOnlyPoolGraph.passages).map((position, index) => ({
  id: MapFormat.TREASURE_IDS[index % MapFormat.TREASURE_IDS.length],
  position
}));
const treasureOnlyPools = MapFormat.analyzePurificationPools(treasureOnlyPoolMap);
const treasureOnlyCells = new Set(treasureOnlyPoolMap.treasures.map((treasure) => treasure.position));
assert.strictEqual(treasureOnlyPools.available, true);
assert(
  treasureOnlyPools.bestPairs.every((pair) => pair.cells.every((cell) => treasureOnlyCells.has(cell))),
  "purification-pool generation must be able to select treasure cells"
);
const noPoolMap = MapFormat.createBlankMap(6, 5);
noPoolMap.zones.entrance.anchor = "1,1";
noPoolMap.zones.dungeon.anchor = "6,5";
noPoolMap.hunt.mechanisms = { A: "3,3", B: "4,3" };
const noPoolRoads = new Set(["1,2", "6,4"]);
noPoolMap.voidCells = Array.from({ length: noPoolMap.height }, (_, row) => (
  Array.from({ length: noPoolMap.width }, (_, column) => `${column + 1},${row + 1}`)
)).flat().filter((cell) => (
  cell !== noPoolMap.zones.entrance.anchor
  && cell !== noPoolMap.zones.dungeon.anchor
  && !noPoolRoads.has(cell)
));
const noPoolFloors = Object.keys(MapFormat.buildMovementGraph(noPoolMap, { hunt: true }).passages);
noPoolMap.treasures = noPoolFloors.map((position, index) => ({
  id: MapFormat.TREASURE_IDS[index % MapFormat.TREASURE_IDS.length],
  position
}));
const unavailablePools = MapFormat.analyzePurificationPools(noPoolMap);
assert.strictEqual(unavailablePools.available, false);
assert.strictEqual(unavailablePools.fallback, true);
assert(MapFormat.buildMovementGraph(huntMap).passages["4,1"]);
assert.strictEqual(MapFormat.buildMovementGraph(huntMap, { hunt: true }).passages["4,1"], undefined);
const mapRating = MapFormat.analyzeMapRating(huntMap);
assert.strictEqual(mapRating.available, true);
assert(Number.isInteger(mapRating.stars) && mapRating.stars >= 1 && mapRating.stars <= 5);
assert.strictEqual(mapRating.indicators.length, 5);
assert.deepStrictEqual(
  mapRating.indicators.map((indicator) => indicator.id),
  ["topology", "objectives", "treasures", "routes", "roles"]
);
assert(mapRating.indicators.every((indicator) => indicator.stars >= 1 && indicator.stars <= 5));
if (mapRating.stars === 5) {
  assert(
    mapRating.indicators.every((indicator) => indicator.stars === 5),
    "a five-star overall rating requires five stars in every visible indicator"
  );
}
assert.deepStrictEqual(
  mapRating.traits.map((trait) => trait.id),
  ["sightlines", "turns", "branches", "bottlenecks", "span", "deadEnds"]
);
assert(mapRating.traits.every((trait) => ["low", "medium", "high"].includes(trait.level)));
const duplicateMechanism = MapFormat.clone(huntMap);
duplicateMechanism.hunt.mechanisms.B = duplicateMechanism.hunt.mechanisms.A;
assert(MapFormat.validateHuntMap(duplicateMechanism).errors.some((error) => error.includes("重疊")));
assert.strictEqual(MapFormat.analyzeMapRating(duplicateMechanism).available, false);
const overlappingTreasure = MapFormat.clone(huntMap);
overlappingTreasure.hunt.mechanisms.A = overlappingTreasure.treasures[0].position;
assert(MapFormat.validateHuntMap(overlappingTreasure).errors.some((error) => error.includes("寶藏重疊")));
const legacyHuntMap = MapFormat.normalizeMap({
  ...classic,
  hunt: { gates: { A: { mechanism: "4,1", exit: "4,2" }, B: { mechanism: "5,2", exit: "6,2" } } }
});
assert.deepStrictEqual(legacyHuntMap.hunt.mechanisms, { A: "4,1", B: "5,2" });
assert.strictEqual(legacyHuntMap.hunt.gates, undefined);

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
  assert.strictEqual(typeof builtInMaps.find((candidate) => candidate.id === entry.id).huntCompatible, "boolean");
}
const customMapEntry = catalogIndex.maps.find((entry) => entry.id === "test-map");
assert(customMapEntry);
assert.strictEqual(customMapEntry.name, "蟹制地圖1");
assert.strictEqual(MapCatalog.getBuiltInMap("test-map").name, "蟹制地圖1");
const crabMapTwoEntry = catalogIndex.maps.find((entry) => entry.id === "2");
assert(crabMapTwoEntry);
assert.strictEqual(crabMapTwoEntry.file, "crab2.json");
assert.strictEqual(MapCatalog.getBuiltInMap("2").name, "蟹制地圖2");
const classicRating = MapFormat.analyzeMapRating(classic);
assert.strictEqual(classicRating.stars, 4);
assert.deepStrictEqual(
  Object.fromEntries(classicRating.indicators.map((indicator) => [indicator.id, indicator.stars])),
  { topology: 4, objectives: 4, treasures: 4, routes: 4, roles: 5 }
);
const crabMapTwoRating = MapFormat.analyzeMapRating(MapCatalog.getBuiltInMap("2"));
assert.strictEqual(crabMapTwoRating.available, true);
assert.strictEqual(crabMapTwoRating.stars, 4);
assert(crabMapTwoRating.roleAdvantages.some((role) => role.id === "gazer"));
assert(crabMapTwoRating.roleAdvantages.some((role) => role.id === "knife"));
const randomMap = MapCatalog.randomBuiltInMap();
assert(catalogIndex.maps.some((entry) => entry.id === randomMap.id));
assert.strictEqual(MapCatalog.getBuiltInMap("missing"), null);

console.log("Gangsi map format tests passed");
