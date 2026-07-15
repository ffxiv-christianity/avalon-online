(function initializeGangsiMapFormat(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GangsiMapFormat = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGangsiMapFormat() {
  "use strict";

  const KIND = "gangsi-map";
  const SCHEMA_VERSION = 1;
  const LIMITS = Object.freeze({ minWidth: 6, maxWidth: 14, minHeight: 5, maxHeight: 12 });
  const GROUPS = Object.freeze({
    A: Object.freeze({ label: "藍", name: "黃金渡渡鳥聖像", size: 5, color: "blue" }),
    B: Object.freeze({ label: "綠", name: "龍眼", size: 4, color: "green" }),
    C: Object.freeze({ label: "黃", name: "釣場之皇", size: 4, color: "yellow" }),
    D: Object.freeze({ label: "粉", name: "幻想藥", size: 5, color: "pink" }),
    E: Object.freeze({ label: "紅", name: "L房地契", size: 5, color: "red" })
  });
  const TREASURE_IDS = Object.freeze(Object.entries(GROUPS).flatMap(([group, definition]) => (
    Array.from({ length: definition.size }, (_, index) => `${group}${index + 1}`)
  )));
  const TREASURE_ID_SET = new Set(TREASURE_IDS);
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseCell(value) {
    if (Array.isArray(value) && value.length === 2) return [Number(value[0]), Number(value[1])];
    if (value && typeof value === "object") return [Number(value.x), Number(value.y)];
    if (typeof value !== "string") return [NaN, NaN];
    const parts = value.split(",");
    return parts.length === 2 ? parts.map(Number) : [NaN, NaN];
  }

  function cellKey(valueOrX, y) {
    const [xValue, yValue] = y === undefined ? parseCell(valueOrX) : [Number(valueOrX), Number(y)];
    if (!Number.isInteger(xValue) || !Number.isInteger(yValue)) return null;
    return `${xValue},${yValue}`;
  }

  function compareCells(left, right) {
    const [leftX, leftY] = parseCell(left);
    const [rightX, rightY] = parseCell(right);
    return leftY - rightY || leftX - rightX;
  }

  function inBounds(cell, width, height) {
    const [x, y] = parseCell(cell);
    return Number.isInteger(x) && Number.isInteger(y) && x >= 1 && x <= width && y >= 1 && y <= height;
  }

  function areAdjacent(left, right) {
    const [leftX, leftY] = parseCell(left);
    const [rightX, rightY] = parseCell(right);
    return Math.abs(leftX - rightX) + Math.abs(leftY - rightY) === 1;
  }

  function canonicalEdge(leftOrEdge, right) {
    let left = leftOrEdge;
    let next = right;
    if (right === undefined) {
      if (Array.isArray(leftOrEdge) && leftOrEdge.length === 2) [left, next] = leftOrEdge;
      else if (typeof leftOrEdge === "string") [left, next] = leftOrEdge.split("|");
    }
    const leftKey = cellKey(left);
    const rightKey = cellKey(next);
    if (!leftKey || !rightKey || !areAdjacent(leftKey, rightKey)) return null;
    return [leftKey, rightKey].sort(compareCells).join("|");
  }

  function slug(value) {
    const source = String(value || "").trim();
    const normalized = source
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    if (normalized) return normalized;
    if (!source) return "custom-map";
    let hash = 2166136261;
    for (const character of source) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `map-${(hash >>> 0).toString(36)}`;
  }

  function todayIso() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function createBlankMap(width = 10, height = 7) {
    return {
      kind: KIND,
      schemaVersion: SCHEMA_VERSION,
      id: "custom-map",
      name: "未命名地圖",
      author: "",
      date: todayIso(),
      width,
      height,
      walls: [],
      voidCells: [],
      zones: {
        entrance: { anchor: null, exits: [] },
        dungeon: { anchor: null, exits: [] }
      },
      treasures: []
    };
  }

  function normalizeMap(input) {
    const source = input && typeof input === "object" ? input : {};
    const width = Number(source.width ?? source.dimensions?.width ?? 10);
    const height = Number(source.height ?? source.dimensions?.height ?? 7);
    const map = createBlankMap(width, height);
    map.id = slug(source.id || source.name);
    map.name = String(source.name || "未命名地圖").trim().slice(0, 60) || "未命名地圖";
    map.author = String(source.author || "").trim().slice(0, 40);
    map.date = DATE_PATTERN.test(String(source.date || "")) ? source.date : todayIso();
    map.walls = [...new Set((Array.isArray(source.walls) ? source.walls : [])
      .map((edge) => canonicalEdge(edge))
      .filter(Boolean))].sort();
    map.voidCells = [...new Set((Array.isArray(source.voidCells) ? source.voidCells : [])
      .map((cell) => cellKey(cell))
      .filter(Boolean))].sort(compareCells);

    for (const type of ["entrance", "dungeon"]) {
      const zone = source.zones?.[type] || {};
      map.zones[type] = {
        anchor: cellKey(zone.anchor),
        exits: [...new Set((Array.isArray(zone.exits) ? zone.exits : [])
          .map((cell) => cellKey(cell))
          .filter(Boolean))].sort(compareCells)
      };
    }

    const treasures = Array.isArray(source.treasures)
      ? source.treasures
      : Object.entries(source.treasurePositions || {}).map(([id, position]) => ({ id, position }));
    map.treasures = treasures
      .map((treasure) => ({
        id: String(treasure?.id || "").toUpperCase(),
        position: cellKey(treasure?.position)
      }))
      .filter((treasure) => treasure.id && treasure.position)
      .sort((left, right) => TREASURE_IDS.indexOf(left.id) - TREASURE_IDS.indexOf(right.id));
    return map;
  }

  function neighbors(cell, width, height) {
    const [x, y] = parseCell(cell);
    return [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]
      .map(([nextX, nextY]) => cellKey(nextX, nextY))
      .filter((next) => inBounds(next, width, height));
  }

  function deriveZoneExits(mapInput, type) {
    const map = normalizeMap(mapInput);
    const anchor = map.zones[type]?.anchor;
    if (!anchor || !inBounds(anchor, map.width, map.height)) return [];
    const blocked = new Set(map.voidCells);
    const walls = new Set(map.walls);
    const otherType = type === "entrance" ? "dungeon" : "entrance";
    const otherAnchor = map.zones[otherType]?.anchor;
    return neighbors(anchor, map.width, map.height)
      .filter((cell) => !blocked.has(cell) && cell !== otherAnchor)
      .filter((cell) => !walls.has(canonicalEdge(anchor, cell)))
      .sort(compareCells);
  }

  function refreshZoneExits(mapInput) {
    const map = normalizeMap(mapInput);
    for (const type of ["entrance", "dungeon"]) map.zones[type].exits = deriveZoneExits(map, type);
    return map;
  }

  function floorCells(map) {
    const blocked = new Set(map.voidCells);
    blocked.add(map.zones.entrance.anchor);
    blocked.add(map.zones.dungeon.anchor);
    const result = [];
    for (let y = 1; y <= map.height; y += 1) {
      for (let x = 1; x <= map.width; x += 1) {
        const cell = cellKey(x, y);
        if (!blocked.has(cell)) result.push(cell);
      }
    }
    return result;
  }

  function buildMovementGraph(mapInput) {
    const map = refreshZoneExits(mapInput);
    const floors = new Set(floorCells(map));
    const walls = new Set(map.walls);
    const passages = {};
    for (const cell of floors) {
      passages[cell] = neighbors(cell, map.width, map.height)
        .filter((next) => floors.has(next))
        .filter((next) => !walls.has(canonicalEdge(cell, next)));
    }
    return {
      passages,
      zones: clone(map.zones)
    };
  }

  function validateMap(input, options = {}) {
    const requireComplete = options.requireComplete !== false;
    const errors = [];
    const warnings = [];
    const source = input && typeof input === "object" ? input : {};
    const map = refreshZoneExits(source);

    for (const forbiddenField of ["classes", "classDefinitions", "interactions", "rules"]) {
      if (Object.prototype.hasOwnProperty.call(source, forbiddenField)) {
        errors.push(`地圖不得覆寫固定遊戲屬性：${forbiddenField}`);
      }
    }

    if (source.kind !== KIND) errors.push(`kind 必須是 ${KIND}`);
    if (Number(source.schemaVersion) !== SCHEMA_VERSION) errors.push(`schemaVersion 必須是 ${SCHEMA_VERSION}`);
    if (!Number.isInteger(map.width) || map.width < LIMITS.minWidth || map.width > LIMITS.maxWidth) {
      errors.push(`地圖寬度必須介於 ${LIMITS.minWidth} 到 ${LIMITS.maxWidth}`);
    }
    if (!Number.isInteger(map.height) || map.height < LIMITS.minHeight || map.height > LIMITS.maxHeight) {
      errors.push(`地圖高度必須介於 ${LIMITS.minHeight} 到 ${LIMITS.maxHeight}`);
    }
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(String(source.id || ""))) errors.push("地圖 ID 只能使用小寫英數與連字號");
    if (!String(source.name || "").trim()) errors.push("地圖名稱不能空白");
    if (!DATE_PATTERN.test(String(source.date || ""))) errors.push("地圖日期必須使用 YYYY-MM-DD 格式");

    const rawWalls = Array.isArray(source.walls) ? source.walls : [];
    const seenWalls = new Set();
    for (const rawEdge of rawWalls) {
      const edge = canonicalEdge(rawEdge);
      if (!edge) {
        errors.push(`無效牆壁：${JSON.stringify(rawEdge)}`);
        continue;
      }
      const [left, right] = edge.split("|");
      if (!inBounds(left, map.width, map.height) || !inBounds(right, map.width, map.height)) errors.push(`牆壁超出地圖：${edge}`);
      if (seenWalls.has(edge)) warnings.push(`重複牆壁已合併：${edge}`);
      seenWalls.add(edge);
    }

    const voidSet = new Set();
    for (const rawCell of Array.isArray(source.voidCells) ? source.voidCells : []) {
      const cell = cellKey(rawCell);
      if (!cell || !inBounds(cell, map.width, map.height)) errors.push(`無效封閉格：${JSON.stringify(rawCell)}`);
      else if (voidSet.has(cell)) warnings.push(`重複封閉格已合併：${cell}`);
      else voidSet.add(cell);
    }

    const zoneAnchors = new Set();
    for (const type of ["entrance", "dungeon"]) {
      const label = type === "entrance" ? "入口" : "地牢";
      const anchor = map.zones[type].anchor;
      if (!anchor || !inBounds(anchor, map.width, map.height)) {
        errors.push(`${label}尚未設定`);
        continue;
      }
      if (voidSet.has(anchor)) errors.push(`${label}不能放在封閉格 ${anchor}`);
      if (zoneAnchors.has(anchor)) errors.push("入口與地牢不能位於同一格");
      zoneAnchors.add(anchor);
      if (map.zones[type].exits.length === 0) errors.push(`${label}至少需要一個未被牆阻擋的相鄰出口`);
    }

    const seenTreasureIds = new Set();
    const seenTreasureCells = new Set();
    for (const treasure of map.treasures) {
      if (!TREASURE_ID_SET.has(treasure.id)) errors.push(`未知寶藏 ID：${treasure.id}`);
      if (seenTreasureIds.has(treasure.id)) errors.push(`寶藏 ID 重複：${treasure.id}`);
      seenTreasureIds.add(treasure.id);
      if (!inBounds(treasure.position, map.width, map.height)) errors.push(`寶藏 ${treasure.id} 超出地圖`);
      if (voidSet.has(treasure.position)) errors.push(`寶藏 ${treasure.id} 不能放在封閉格`);
      if (zoneAnchors.has(treasure.position)) errors.push(`寶藏 ${treasure.id} 不能放在入口或地牢`);
      if (seenTreasureCells.has(treasure.position)) errors.push(`同一格不能放兩個寶藏：${treasure.position}`);
      seenTreasureCells.add(treasure.position);
    }
    if (requireComplete) {
      for (const id of TREASURE_IDS) if (!seenTreasureIds.has(id)) errors.push(`缺少寶藏 ${id}`);
      if (map.treasures.length !== TREASURE_IDS.length) errors.push(`完整地圖必須包含 ${TREASURE_IDS.length} 個寶藏`);
    } else if (map.treasures.length < TREASURE_IDS.length) {
      warnings.push(`尚有 ${TREASURE_IDS.length - map.treasures.length} 個寶藏未放置`);
    }

    if (errors.every((error) => !error.includes("寬度") && !error.includes("高度") && !error.includes("尚未設定"))) {
      const graph = buildMovementGraph(map);
      const floorSet = new Set(Object.keys(graph.passages));
      const entranceExits = map.zones.entrance.exits.filter((cell) => floorSet.has(cell));
      const visited = new Set(entranceExits);
      const queue = [...entranceExits];
      while (queue.length) {
        const current = queue.shift();
        for (const next of graph.passages[current] || []) {
          if (visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }
      const unreachableFloors = [...floorSet].filter((cell) => !visited.has(cell));
      if (unreachableFloors.length) errors.push(`有 ${unreachableFloors.length} 個道路格無法從入口抵達`);
      for (const exit of map.zones.dungeon.exits) {
        if (!visited.has(exit)) errors.push(`地牢出口 ${exit} 無法連到入口區域`);
      }
      for (const treasure of map.treasures) {
        if (floorSet.has(treasure.position) && !visited.has(treasure.position)) errors.push(`寶藏 ${treasure.id} 無法從入口抵達`);
      }
      const deadEnds = [...floorSet].filter((cell) => (graph.passages[cell] || []).length === 1);
      if (deadEnds.length) warnings.push(`地圖包含 ${deadEnds.length} 個死路格`);
    }

    return {
      valid: errors.length === 0,
      complete: TREASURE_IDS.every((id) => seenTreasureIds.has(id)),
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      map
    };
  }

  function mapStats(mapInput) {
    const map = refreshZoneExits(mapInput);
    const graph = buildMovementGraph(map);
    const passageCount = Object.values(graph.passages).reduce((total, cells) => total + cells.length, 0) / 2;
    return {
      width: map.width,
      height: map.height,
      floorCells: Object.keys(graph.passages).length,
      walls: map.walls.length,
      passages: passageCount,
      voidCells: map.voidCells.length,
      treasures: map.treasures.length
    };
  }

  return Object.freeze({
    KIND,
    SCHEMA_VERSION,
    LIMITS,
    GROUPS,
    TREASURE_IDS,
    clone,
    parseCell,
    cellKey,
    compareCells,
    inBounds,
    areAdjacent,
    canonicalEdge,
    slug,
    todayIso,
    createBlankMap,
    normalizeMap,
    neighbors,
    deriveZoneExits,
    refreshZoneExits,
    buildMovementGraph,
    validateMap,
    mapStats
  });
});
