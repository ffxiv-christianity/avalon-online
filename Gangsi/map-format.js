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
    A: Object.freeze({ label: "黃", name: "黃金渡渡鳥聖像", size: 5, color: "yellow" }),
    B: Object.freeze({ label: "紅", name: "龍眼", size: 4, color: "red" }),
    C: Object.freeze({ label: "藍", name: "釣場之皇", size: 4, color: "blue" }),
    D: Object.freeze({ label: "粉", name: "幻想藥", size: 5, color: "pink" }),
    E: Object.freeze({ label: "綠", name: "L房地契", size: 5, color: "green" })
  });
  const TREASURE_IDS = Object.freeze(Object.entries(GROUPS).flatMap(([group, definition]) => (
    Array.from({ length: definition.size }, (_, index) => `${group}${index + 1}`)
  )));
  const TREASURE_ID_SET = new Set(TREASURE_IDS);
  const HUNT_MECHANISM_IDS = Object.freeze(["A", "B"]);
  const HUNT_MECHANISM_TARGET = 4;
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
      hunt: {
        mechanisms: { A: null, B: null }
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

    for (const id of HUNT_MECHANISM_IDS) {
      map.hunt.mechanisms[id] = cellKey(
        source.hunt?.mechanisms?.[id] ?? source.hunt?.gates?.[id]?.mechanism
      );
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

  function huntMarkerCells(map) {
    return HUNT_MECHANISM_IDS.map((id) => map.hunt?.mechanisms?.[id]).filter(Boolean);
  }

  function deriveHuntVoidCells(mapInput) {
    const map = refreshZoneExits(mapInput);
    const baseFloors = new Set(floorCells(map));
    const huntFloors = new Set(baseFloors);
    const markers = new Set(huntMarkerCells(map));
    for (const cell of markers) huntFloors.delete(cell);
    const zoneExits = [
      ...map.zones.entrance.exits,
      ...map.zones.dungeon.exits
    ];
    const walls = new Set(map.walls);

    const reachableWithin = (floors) => {
      const starts = zoneExits.filter((cell) => floors.has(cell));
      const reached = new Set(starts);
      const queue = starts.slice();
      while (queue.length) {
        const current = queue.shift();
        for (const next of neighbors(current, map.width, map.height)) {
          if (
            reached.has(next) ||
            !floors.has(next) ||
            walls.has(canonicalEdge(current, next))
          ) {
            continue;
          }
          reached.add(next);
          queue.push(next);
        }
      }
      return reached;
    };

    const baseReachable = reachableWithin(baseFloors);
    if (!baseReachable.size) return [];
    const huntReachable = reachableWithin(huntFloors);

    return [...baseReachable]
      .filter((cell) => huntFloors.has(cell) && !huntReachable.has(cell))
      .sort(compareCells);
  }

  function applyHuntDerivedVoidCells(mapInput) {
    const map = refreshZoneExits(mapInput);
    const derived = deriveHuntVoidCells(map);
    if (!derived.length) return map;
    map.voidCells = [...new Set([...map.voidCells, ...derived])].sort(compareCells);
    return refreshZoneExits(map);
  }

  function buildMovementGraph(mapInput, options = {}) {
    const map = refreshZoneExits(mapInput);
    const floors = new Set(floorCells(map));
    if (options.hunt === true) {
      for (const cell of huntMarkerCells(map)) floors.delete(cell);
      for (const cell of deriveHuntVoidCells(map)) floors.delete(cell);
    }
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

  function graphDistances(graph, start) {
    if (!graph?.passages?.[start]) return {};
    const distances = { [start]: 0 };
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      for (const next of graph.passages[current] || []) {
        if (Object.prototype.hasOwnProperty.call(distances, next)) continue;
        distances[next] = distances[current] + 1;
        queue.push(next);
      }
    }
    return distances;
  }

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function average(values) {
    const finite = values.filter(Number.isFinite);
    return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : 0;
  }

  function multiSourceDistances(graph, starts) {
    const distances = {};
    const queue = [];
    for (const start of starts) {
      if (!graph?.passages?.[start] || Object.prototype.hasOwnProperty.call(distances, start)) continue;
      distances[start] = 0;
      queue.push(start);
    }
    while (queue.length) {
      const current = queue.shift();
      for (const next of graph.passages[current] || []) {
        if (Object.prototype.hasOwnProperty.call(distances, next)) continue;
        distances[next] = distances[current] + 1;
        queue.push(next);
      }
    }
    return distances;
  }

  function graphDiagnostics(graph) {
    const cells = Object.keys(graph?.passages || {});
    const edgeCount = Object.values(graph?.passages || {})
      .reduce((total, adjacent) => total + adjacent.length, 0) / 2;
    const discovery = {};
    const low = {};
    const parents = {};
    const articulationCells = new Set();
    const bridgeEdges = new Set();
    let time = 0;

    const visit = (cell) => {
      discovery[cell] = ++time;
      low[cell] = discovery[cell];
      let children = 0;
      for (const next of graph.passages[cell] || []) {
        if (!discovery[next]) {
          parents[next] = cell;
          children += 1;
          visit(next);
          low[cell] = Math.min(low[cell], low[next]);
          if (!parents[cell] && children > 1) articulationCells.add(cell);
          if (parents[cell] && low[next] >= discovery[cell]) articulationCells.add(cell);
          if (low[next] > discovery[cell]) bridgeEdges.add(canonicalEdge(cell, next));
        } else if (next !== parents[cell]) {
          low[cell] = Math.min(low[cell], discovery[next]);
        }
      }
    };
    for (const cell of cells) if (!discovery[cell]) visit(cell);

    let diameter = 0;
    for (const cell of cells) {
      const distances = graphDistances(graph, cell);
      for (const distance of Object.values(distances)) diameter = Math.max(diameter, distance);
    }

    const deadEnds = [];
    const straightCells = [];
    const turnCells = [];
    const branchCells = [];
    for (const cell of cells) {
      const adjacent = graph.passages[cell] || [];
      if (adjacent.length === 1) deadEnds.push(cell);
      if (adjacent.length >= 3) branchCells.push(cell);
      if (adjacent.length !== 2) continue;
      const [x, y] = parseCell(cell);
      const vectors = adjacent.map((next) => {
        const [nextX, nextY] = parseCell(next);
        return [nextX - x, nextY - y];
      });
      if (vectors[0][0] === -vectors[1][0] && vectors[0][1] === -vectors[1][1]) {
        straightCells.push(cell);
      } else {
        turnCells.push(cell);
      }
    }

    return {
      cells,
      edgeCount,
      diameter,
      deadEnds,
      straightCells,
      turnCells,
      branchCells,
      articulationCells: [...articulationCells].sort(compareCells),
      bridgeEdges: [...bridgeEdges].filter(Boolean).sort()
    };
  }

  function graphEdges(graph) {
    const edges = new Set();
    for (const [cell, adjacent] of Object.entries(graph?.passages || {})) {
      for (const next of adjacent) {
        const edge = canonicalEdge(cell, next);
        if (edge) edges.add(edge);
      }
    }
    return [...edges].sort();
  }

  function graphDistancesWithoutEdge(graph, start, blockedEdge) {
    if (!graph?.passages?.[start]) return {};
    const [blockedLeft, blockedRight] = blockedEdge.split("|");
    const distances = { [start]: 0 };
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      for (const next of graph.passages[current] || []) {
        if ((current === blockedLeft && next === blockedRight)
          || (current === blockedRight && next === blockedLeft)) continue;
        if (Object.prototype.hasOwnProperty.call(distances, next)) continue;
        distances[next] = distances[current] + 1;
        queue.push(next);
      }
    }
    return distances;
  }

  function zoneHasGraphAccess(map, graph, type, blockedEdge = null) {
    return map.zones[type].exits
      .filter((cell) => graph.passages[cell])
      .some((cell) => (graph.passages[cell] || [])
        .some((next) => canonicalEdge(cell, next) !== blockedEdge));
  }

  function masonEdgePreservesZoneAccess(map, graph, edge) {
    return ["entrance", "dungeon"].every((type) => (
      !zoneHasGraphAccess(map, graph, type)
      || zoneHasGraphAccess(map, graph, type, edge)
    ));
  }

  function summarizeWallControl(cells, edgeDetails, options = {}) {
    const cellBest = Object.fromEntries(cells.map((cell) => [cell, 0]));
    for (const entry of edgeDetails) {
      const [left, right] = entry.edge.split("|");
      cellBest[left] = Math.max(cellBest[left] || 0, entry.control);
      cellBest[right] = Math.max(cellBest[right] || 0, entry.control);
    }
    const cellValues = Object.values(cellBest).sort((left, right) => right - left);
    const peakCount = Math.max(1, Math.ceil(cellValues.length * 0.15));
    const peak = average(cellValues.slice(0, peakCount));
    const consistency = average(cellValues);
    const strongEdgeCount = edgeDetails.filter((entry) => entry.control >= 0.45).length;
    const coverage = cellValues.filter((value) => value >= 0.45).length / Math.max(1, cellValues.length);
    const peakWeight = options.peakWeight ?? 0.45;
    const consistencyWeight = options.consistencyWeight ?? 0.35;
    const coverageWeight = options.coverageWeight ?? 0.2;
    const multiplier = options.multiplier ?? 1;
    const affinity = clamp((
      peak * peakWeight
      + consistency * consistencyWeight
      + clamp(coverage / 0.45) * coverageWeight
    ) * multiplier);
    return {
      affinity,
      strongEdgeCount,
      coverage,
      consistency,
      peak
    };
  }

  function analyzeMasonControl(mapInput, graphInput = null) {
    const map = refreshZoneExits(mapInput);
    const graph = graphInput || buildMovementGraph(map, { hunt: true });
    const cells = Object.keys(graph.passages);
    if (!cells.length) {
      return {
        affinity: 0,
        legalEdges: [],
        strongEdgeCount: 0,
        coverage: 0,
        consistency: 0,
        peak: 0
      };
    }

    const walls = new Set(map.walls);
    const legalEdges = graphEdges(graph)
      .filter((edge) => masonEdgePreservesZoneAccess(map, graph, edge));
    const strategicCells = new Set([
      ...map.zones.entrance.exits,
      ...map.zones.dungeon.exits,
      ...map.treasures.map((treasure) => treasure.position)
    ].filter((cell) => graph.passages[cell]));
    for (const mechanism of Object.values(map.hunt.mechanisms)) {
      for (const cell of neighbors(mechanism, map.width, map.height)) {
        if (!graph.passages[cell] || walls.has(canonicalEdge(mechanism, cell))) continue;
        strategicCells.add(cell);
      }
    }

    const strategic = [...strategicCells];
    const baseDistances = Object.fromEntries(strategic.map((cell) => [cell, graphDistances(graph, cell)]));
    const strategicPairs = [];
    for (let leftIndex = 0; leftIndex < strategic.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < strategic.length; rightIndex += 1) {
        const left = strategic[leftIndex];
        const right = strategic[rightIndex];
        const distance = baseDistances[left]?.[right];
        if (Number.isFinite(distance)) strategicPairs.push({ left, right, distance });
      }
    }

    const edgeDetails = legalEdges.map((edge) => {
      const [left, right] = edge.split("|");
      const leftDistances = graphDistancesWithoutEdge(graph, left, edge);
      const disconnected = !Number.isFinite(leftDistances[right]);
      const separatedSize = disconnected
        ? Math.min(Object.keys(leftDistances).length, cells.length - Object.keys(leftDistances).length)
        : 0;
      const separatedRatio = separatedSize / cells.length;
      const bridgeImpact = disconnected
        ? 0.65 + 0.35 * clamp(separatedRatio / 0.3)
        : 0;
      const detourImpact = disconnected
        ? 1
        : clamp((leftDistances[right] - 1) / 6);

      const changedRoutes = strategicPairs.filter((pair) => {
        const startDistances = baseDistances[pair.left];
        const targetDistances = baseDistances[pair.right];
        const forward = startDistances[left] + 1 + targetDistances[right] === pair.distance;
        const reverse = startDistances[right] + 1 + targetDistances[left] === pair.distance;
        return forward || reverse;
      });
      const routeCoverage = strategicPairs.length
        ? clamp((changedRoutes.length / strategicPairs.length) / 0.22)
        : 0;
      const routeImpact = routeCoverage * (0.45 + detourImpact * 0.55);
      const control = clamp(
        bridgeImpact * 0.45
        + detourImpact * 0.25
        + routeImpact * 0.3
      );
      return {
        edge,
        control,
        disconnected,
        separatedRatio,
        detourImpact,
        routeImpact
      };
    });

    const summary = summarizeWallControl(cells, edgeDetails);
    return {
      ...summary,
      legalEdges,
      edgeDetails
    };
  }

  function analyzePhantomControl(mapInput, graphInput = null, baseWallAnalysis = null) {
    const map = refreshZoneExits(mapInput);
    const graph = graphInput || buildMovementGraph(map, { hunt: true });
    const cells = Object.keys(graph.passages);
    if (!cells.length) {
      return {
        affinity: 0,
        legalEdges: [],
        strongEdgeCount: 0,
        coverage: 0,
        consistency: 0,
        peak: 0
      };
    }

    const base = baseWallAnalysis || analyzeMasonControl(map, graph);
    const walls = new Set(map.walls);
    const escapeApproaches = HUNT_MECHANISM_IDS.map((id) => {
      const mechanism = map.hunt.mechanisms[id];
      return neighbors(mechanism, map.width, map.height)
        .filter((cell) => graph.passages[cell])
        .filter((cell) => !walls.has(canonicalEdge(mechanism, cell)));
    }).filter((approaches) => approaches.length);

    const edgeDetails = base.edgeDetails.map((entry) => {
      let escapeReliability = 1;
      if (entry.disconnected && escapeApproaches.length) {
        const [left] = entry.edge.split("|");
        const leftComponent = new Set(Object.keys(graphDistancesWithoutEdge(graph, left, entry.edge)));
        const leftRatio = leftComponent.size / cells.length;
        escapeReliability = average(escapeApproaches.map((approaches) => {
          const reachesLeft = approaches.some((cell) => leftComponent.has(cell));
          const reachesRight = approaches.some((cell) => !leftComponent.has(cell));
          if (reachesLeft && reachesRight) return 1;
          if (reachesLeft) return leftRatio;
          if (reachesRight) return 1 - leftRatio;
          return 0;
        }));
      }

      const persistentControl = clamp(
        entry.control * 0.7
        + entry.detourImpact * 0.15
        + entry.routeImpact * 0.15
      );
      const phaseReliability = 0.65 + escapeReliability * 0.35;
      const control = clamp(persistentControl * phaseReliability * 1.08);
      return {
        ...entry,
        control,
        escapeReliability
      };
    });
    const summary = summarizeWallControl(cells, edgeDetails, {
      peakWeight: 0.48,
      consistencyWeight: 0.32,
      coverageWeight: 0.2,
      multiplier: 1.02
    });
    return {
      ...summary,
      legalEdges: base.legalEdges.slice(),
      edgeDetails
    };
  }

  function analyzeSightlines(graph) {
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const rays = [];
    for (const cell of Object.keys(graph?.passages || {})) {
      for (const [stepX, stepY] of directions) {
        let current = cell;
        let length = 0;
        while (true) {
          const [x, y] = parseCell(current);
          const next = cellKey(x + stepX, y + stepY);
          if (!next || !(graph.passages[current] || []).includes(next)) break;
          length += 1;
          current = next;
        }
        rays.push(length);
      }
    }
    return {
      maximum: rays.length ? Math.max(...rays) : 0,
      average: average(rays),
      longRatio: rays.length ? rays.filter((length) => length >= 5).length / rays.length : 0
    };
  }

  function ratingStars(score) {
    if (score >= 88) return 5;
    if (score >= 74) return 4;
    if (score >= 60) return 3;
    if (score >= 42) return 2;
    return 1;
  }

  function traitLevel(value, medium, high) {
    if (value >= high) return "high";
    if (value >= medium) return "medium";
    return "low";
  }

  function analyzeMapRating(mapInput) {
    const baseValidation = validateMap(mapInput);
    const huntValidation = validateHuntMap(mapInput);
    if (!baseValidation.valid || !huntValidation.valid) {
      return {
        available: false,
        stars: null,
        score: null,
        summary: "地圖須先通過經典與獵殺模式驗證",
        indicators: [],
        traits: [],
        roleAdvantages: []
      };
    }

    const map = huntValidation.map;
    const graph = buildMovementGraph(map, { hunt: true });
    const diagnostics = graphDiagnostics(graph);
    const sightlines = analyzeSightlines(graph);
    const cells = diagnostics.cells;
    const floorCount = Math.max(1, cells.length);
    const edgeCount = Math.max(1, diagnostics.edgeCount);
    const diameter = Math.max(1, diagnostics.diameter);
    const deadEndRatio = diagnostics.deadEnds.length / floorCount;
    const branchRatio = diagnostics.branchCells.length / floorCount;
    const bridgeRatio = diagnostics.bridgeEdges.length / edgeCount;
    const articulationRatio = diagnostics.articulationCells.length / floorCount;
    const turnBase = diagnostics.turnCells.length + diagnostics.straightCells.length;
    const turnRatio = turnBase ? diagnostics.turnCells.length / turnBase : 0;
    const cycleDensity = Math.max(0, diagnostics.edgeCount - cells.length + 1) / floorCount;
    const derivedVoidRatio = huntValidation.derivedVoidCells.length / floorCount;
    const entranceDistances = multiSourceDistances(graph, map.zones.entrance.exits);
    const dungeonDistances = multiSourceDistances(graph, map.zones.dungeon.exits);
    const walls = new Set(map.walls);
    const entranceExitCount = map.zones.entrance.exits.filter((cell) => graph.passages[cell]).length;
    const dungeonExitCount = map.zones.dungeon.exits.filter((cell) => graph.passages[cell]).length;
    const entranceTerritory = cells.filter((cell) => entranceDistances[cell] < dungeonDistances[cell]).length;
    const dungeonTerritory = cells.filter((cell) => dungeonDistances[cell] < entranceDistances[cell]).length;
    const territoryBias = Math.abs(entranceTerritory - dungeonTerritory) / floorCount;
    let spawnSeparation = diameter;
    for (const entranceExit of map.zones.entrance.exits) {
      const distances = graphDistances(graph, entranceExit);
      for (const dungeonExit of map.zones.dungeon.exits) {
        spawnSeparation = Math.min(spawnSeparation, distances[dungeonExit] ?? Number.POSITIVE_INFINITY);
      }
    }

    const mechanismAnalyses = HUNT_MECHANISM_IDS.map((id) => {
      const position = map.hunt.mechanisms[id];
      const approaches = neighbors(position, map.width, map.height)
        .filter((cell) => graph.passages[cell])
        .filter((cell) => !walls.has(canonicalEdge(position, cell)));
      return {
        id,
        position,
        approaches,
        entranceDistance: Math.min(...approaches.map((cell) => entranceDistances[cell] ?? Number.POSITIVE_INFINITY)) + 1,
        dungeonDistance: Math.min(...approaches.map((cell) => dungeonDistances[cell] ?? Number.POSITIVE_INFINITY)) + 1
      };
    });
    let mechanismSeparation = diameter;
    if (mechanismAnalyses.length === 2) {
      mechanismSeparation = Math.min(...mechanismAnalyses[0].approaches.flatMap((left) => {
        const distances = graphDistances(graph, left);
        return mechanismAnalyses[1].approaches.map((right) => distances[right] ?? Number.POSITIVE_INFINITY);
      }));
    }
    const mechanismDifferentials = mechanismAnalyses.map((entry) => entry.entranceDistance - entry.dungeonDistance);
    const objectiveSideBias = Math.abs(
      average(mechanismAnalyses.map((entry) => entry.entranceDistance))
      - average(mechanismAnalyses.map((entry) => entry.dungeonDistance))
    ) / diameter;
    const sameSideMechanisms = mechanismDifferentials.every((value) => value > 0)
      || mechanismDifferentials.every((value) => value < 0);

    const treasureCells = new Set(map.treasures.map((treasure) => treasure.position));
    const deadEndTreasureRatio = map.treasures.length
      ? diagnostics.deadEnds.filter((cell) => treasureCells.has(cell)).length / map.treasures.length
      : 0;
    const treasureEntranceDistances = map.treasures.map((treasure) => entranceDistances[treasure.position]);
    const treasureDungeonDistances = map.treasures.map((treasure) => dungeonDistances[treasure.position]);
    const treasureSideBias = Math.abs(
      average(treasureEntranceDistances) - average(treasureDungeonDistances)
    ) / diameter;
    const entranceFavoredTreasures = map.treasures
      .filter((treasure) => entranceDistances[treasure.position] < dungeonDistances[treasure.position]).length;
    const dungeonFavoredTreasures = map.treasures
      .filter((treasure) => dungeonDistances[treasure.position] < entranceDistances[treasure.position]).length;
    const treasureRiskBias = map.treasures.length
      ? Math.abs(entranceFavoredTreasures - dungeonFavoredTreasures) / map.treasures.length
      : 0;
    const groupSpreadRatios = Object.keys(GROUPS).map((group) => {
      const positions = map.treasures
        .filter((treasure) => treasure.id.startsWith(group))
        .map((treasure) => treasure.position);
      const pairDistances = [];
      for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
        const distances = graphDistances(graph, positions[leftIndex]);
        for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
          const distance = distances[positions[rightIndex]];
          if (Number.isFinite(distance)) pairDistances.push(distance);
        }
      }
      return average(pairDistances) / diameter;
    });
    const groupSpread = average(groupSpreadRatios);

    const topologyScore = clamp(
      100
      - clamp((deadEndRatio - 0.06) * 150, 0, 22)
      - clamp(derivedVoidRatio * 100, 0, 20)
      - (entranceExitCount === 1 ? 12 : 0)
      - (dungeonExitCount === 1 ? 8 : 0),
      0,
      100
    );
    const objectiveScore = clamp(
      100
      - mechanismAnalyses.reduce((penalty, entry) => penalty + (entry.approaches.length === 1 ? 9 : 0), 0)
      - clamp((0.35 - mechanismSeparation / diameter) * 70, 0, 24)
      - clamp(objectiveSideBias * 30, 0, 20)
      - clamp((0.34 - spawnSeparation / diameter) * 50, 0, 12)
      - (sameSideMechanisms ? 10 : 0),
      0,
      100
    );
    const treasureScore = clamp(
      100
      - clamp(treasureSideBias * 30, 0, 20)
      - clamp(treasureRiskBias * 22, 0, 12)
      - clamp((0.3 - groupSpread) * 80, 0, 24)
      - clamp((deadEndTreasureRatio - 0.3) * 45, 0, 14),
      0,
      100
    );
    const routeScore = clamp(
      100
      - clamp(bridgeRatio * 34, 0, 30)
      - clamp(articulationRatio * 55, 0, 28)
      - clamp((0.08 - cycleDensity) * 150, 0, 12)
      - clamp((0.1 - branchRatio) * 80, 0, 8)
      - (entranceExitCount === 1 ? 8 : 0)
      - clamp((territoryBias - 0.18) * 40, 0, 10),
      0,
      100
    );

    const sightlineAffinity = clamp(
      clamp((sightlines.average - 1.15) / 1.25) * 0.55
      + clamp(sightlines.longRatio / 0.12) * 0.45
    );
    const turnAffinity = clamp((turnRatio - 0.3) / 0.45);
    const branchAffinity = clamp((branchRatio - 0.25) / 0.45);
    const bottleneckAffinity = clamp((bridgeRatio / 0.42 + articulationRatio / 0.28) / 2);
    const spanAffinity = clamp((diameter - 9) / 10);
    const wallAffinity = clamp(map.walls.length / floorCount / 0.55);
    const treasureSpreadAffinity = clamp(groupSpread / 0.38);
    const purification = analyzePurificationPools(map);
    const purificationAffinity = purification.available && !purification.fallback ? 1 : 0.45;
    const masonControl = analyzeMasonControl(map, graph);
    const phantomControl = analyzePhantomControl(map, graph, masonControl);
    const roleAffinities = [
      { id: "gazer", label: "凝視者", value: 20 + sightlineAffinity * 85 },
      { id: "knife", label: "飛刀手", value: 25 + sightlineAffinity * 78 },
      { id: "trap", label: "陷阱鬼", value: 20 + turnAffinity * 35 + bottleneckAffinity * 25 + clamp(deadEndRatio / 0.16) * 12 },
      { id: "scout", label: "斥候", value: 25 + turnAffinity * 35 + branchAffinity * 30 },
      { id: "tombRaider", label: "盜墓者", value: 25 + wallAffinity * 65 },
      { id: "mason", label: "石匠", value: 25 + masonControl.affinity * 65 },
      { id: "burrow", label: "遁地鬼", value: 25 + spanAffinity * 65 },
      { id: "phantom", label: "幻影鬼", value: 25 + phantomControl.affinity * 65 },
      { id: "corrupt", label: "腐化鬼", value: 25 + treasureSpreadAffinity * 45 + purificationAffinity * 18 }
    ].map((entry) => ({ ...entry, value: clamp(entry.value, 0, 100) }));
    const roleValues = roleAffinities.map((entry) => entry.value);
    const roleAverage = average(roleValues);
    const roleDeviation = Math.sqrt(average(roleValues.map((value) => (value - roleAverage) ** 2)));
    const roleRange = Math.max(...roleValues) - Math.min(...roleValues);
    const roleScore = clamp(
      100
      - clamp((roleRange - 28) * 1.05, 0, 30)
      - clamp((roleDeviation - 12) * 1.4, 0, 18),
      0,
      100
    );
    const rolePerfectlyBalanced = roleRange <= 28 && roleDeviation <= 10;

    const indicatorScores = [
      ["topology", "拓樸結構", topologyScore, 25],
      ["objectives", "目標配置", objectiveScore, 25],
      ["treasures", "寶藏分布", treasureScore, 20],
      ["routes", "路線選擇", routeScore, 15],
      ["roles", "角色平衡", roleScore, 15]
    ];
    const indicators = indicatorScores.map(([id, label, score]) => {
      const stars = ratingStars(score);
      return {
        id,
        label,
        score: Math.round(score),
        stars: id === "roles" && !rolePerfectlyBalanced ? Math.min(stars, 4) : stars
      };
    });
    const weightedScore = indicatorScores.reduce((total, [, , score, weight]) => total + score * weight, 0) / 100;
    const weakestStars = Math.min(...indicators.map((indicator) => indicator.stars));
    let stars = ratingStars(weightedScore);
    if (indicators.some((indicator) => indicator.stars < 5)) stars = Math.min(stars, 4);
    if (weakestStars <= 1) stars = Math.min(stars, 2);
    else if (weakestStars === 2) stars = Math.min(stars, 3);

    const sightlineLevel = traitLevel(sightlineAffinity, 0.45, 0.63);
    const turnLevel = traitLevel(turnRatio, 0.45, 0.6);
    const branchLevel = traitLevel(branchRatio, 0.4, 0.58);
    const bottleneckLevel = traitLevel(bottleneckAffinity, 0.42, 0.7);
    const masonControlLevel = traitLevel(masonControl.affinity, 0.4, 0.64);
    const phantomControlLevel = traitLevel(phantomControl.affinity, 0.4, 0.64);
    const spanLevel = traitLevel(diameter / Math.max(1, map.width + map.height - 2), 0.72, 0.98);
    const deadEndLevel = traitLevel(deadEndRatio, 0.07, 0.14);
    const levelText = { low: "少", medium: "中等", high: "多" };
    const traits = [
      { id: "sightlines", label: "長直線", level: sightlineLevel, text: `長直線${levelText[sightlineLevel]}` },
      { id: "turns", label: "彎道", level: turnLevel, text: `彎道${levelText[turnLevel]}` },
      { id: "branches", label: "分岔", level: branchLevel, text: `分岔${levelText[branchLevel]}` },
      { id: "bottlenecks", label: "瓶頸", level: bottleneckLevel, text: `瓶頸${levelText[bottleneckLevel]}` },
      { id: "masonControl", label: "築牆空間", level: masonControlLevel, text: `築牆空間${levelText[masonControlLevel]}` },
      { id: "phantomControl", label: "幻影空間", level: phantomControlLevel, text: `幻影空間${levelText[phantomControlLevel]}` },
      {
        id: "span",
        label: "跨度",
        level: spanLevel,
        text: `跨度${spanLevel === "high" ? "大" : spanLevel === "medium" ? "中等" : "小"}`
      },
      { id: "deadEnds", label: "死路", level: deadEndLevel, text: `死路${levelText[deadEndLevel]}` }
    ];
    const highestAffinity = Math.max(...roleValues);
    const roleAdvantages = roleAffinities
      .filter((entry) => entry.value >= 68 && entry.value >= highestAffinity - 20)
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "zh-Hant"))
      .slice(0, 5)
      .map((entry) => ({ id: entry.id, label: entry.label }));
    const summaries = {
      5: "整體設計優秀，各項配置均衡",
      4: roleAdvantages.length
        ? "整體設計合理，部分角色較能發揮"
        : "整體設計合理，僅有少量配置差異",
      3: "地圖可以遊玩，但存在明顯的路線或角色偏向",
      2: "平衡問題較大，部分目標或角色較難應對",
      1: "地圖存在嚴重失衡，建議重新調整"
    };

    return {
      available: true,
      stars,
      score: Math.round(weightedScore),
      summary: summaries[stars],
      indicators,
      traits,
      roleAdvantages,
      metrics: {
        deadEndRatio,
        branchRatio,
        bridgeRatio,
        articulationRatio,
        turnRatio,
        cycleDensity,
        diameter,
        entranceExitCount,
        dungeonExitCount,
        territoryBias,
        spawnSeparation,
        treasureRiskBias,
        sightlines,
        mechanismSeparation,
        masonControl: {
          affinity: masonControl.affinity,
          legalEdgeCount: masonControl.legalEdges.length,
          strongEdgeCount: masonControl.strongEdgeCount,
          coverage: masonControl.coverage,
          consistency: masonControl.consistency,
          peak: masonControl.peak
        },
        phantomControl: {
          affinity: phantomControl.affinity,
          legalEdgeCount: phantomControl.legalEdges.length,
          strongEdgeCount: phantomControl.strongEdgeCount,
          coverage: phantomControl.coverage,
          consistency: phantomControl.consistency,
          peak: phantomControl.peak,
          averageEscapeReliability: average(phantomControl.edgeDetails.map((entry) => entry.escapeReliability))
        },
        groupSpread
      }
    };
  }

  function analyzePurificationPools(mapInput) {
    const map = refreshZoneExits(mapInput);
    const graph = buildMovementGraph(map, { hunt: true });
    const treasureCells = [...new Set(map.treasures
      .map((treasure) => treasure.position)
      .filter((cell) => graph.passages[cell]))];
    const specialCells = new Set([
      map.zones.entrance.anchor,
      map.zones.dungeon.anchor,
      ...huntMarkerCells(map)
    ].filter(Boolean));
    const candidates = Object.keys(graph.passages)
      .filter((cell) => !specialCells.has(cell))
      .sort(compareCells);
    const distances = Object.fromEntries(candidates.map((cell) => [cell, graphDistances(graph, cell)]));
    const pairs = [];
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const left = candidates[leftIndex];
        const right = candidates[rightIndex];
        const poolDistance = distances[left][right];
        if (!Number.isInteger(poolDistance)) continue;
        let maxTreasureDistance = 0;
        let overThresholdCount = 0;
        let totalTreasureDistance = 0;
        let treasuresReachable = true;
        for (const treasureCell of treasureCells) {
          const nearest = Math.min(
            distances[left][treasureCell] ?? Number.POSITIVE_INFINITY,
            distances[right][treasureCell] ?? Number.POSITIVE_INFINITY
          );
          if (!Number.isFinite(nearest)) {
            treasuresReachable = false;
            maxTreasureDistance = Number.POSITIVE_INFINITY;
            overThresholdCount = treasureCells.length;
            totalTreasureDistance = Number.POSITIVE_INFINITY;
            break;
          }
          maxTreasureDistance = Math.max(maxTreasureDistance, nearest);
          if (nearest > 9) overThresholdCount += 1;
          totalTreasureDistance += nearest;
        }
        pairs.push({
          cells: [left, right],
          poolDistance,
          maxTreasureDistance,
          overThresholdCount,
          totalTreasureDistance,
          standard: treasuresReachable && poolDistance >= 6 && maxTreasureDistance <= 9
        });
      }
    }
    const standardPairs = pairs.filter((pair) => pair.standard);
    const fallback = standardPairs.length === 0;
    const ranked = (fallback ? pairs : standardPairs).slice().sort((left, right) => {
      const primary = left.maxTreasureDistance - right.maxTreasureDistance;
      if (primary) return primary;
      if (fallback) {
        const coverage = left.overThresholdCount - right.overThresholdCount;
        if (coverage) return coverage;
        const totalDistance = left.totalTreasureDistance - right.totalTreasureDistance;
        if (totalDistance) return totalDistance;
      }
      return (
        right.poolDistance - left.poolDistance
        || compareCells(left.cells[0], right.cells[0])
        || compareCells(left.cells[1], right.cells[1])
      );
    });
    const best = ranked[0] || null;
    const bestPairs = best
      ? ranked.filter((pair) => pair.maxTreasureDistance === best.maxTreasureDistance
        && (!fallback || pair.overThresholdCount === best.overThresholdCount)
        && (!fallback || pair.totalTreasureDistance === best.totalTreasureDistance)
        && pair.poolDistance === best.poolDistance)
      : [];
    return {
      available: candidates.length >= 2 && bestPairs.length > 0,
      fallback,
      candidates,
      pairs,
      bestPairs,
      metrics: best ? {
        poolDistance: best.poolDistance,
        maxTreasureDistance: best.maxTreasureDistance,
        overThresholdCount: best.overThresholdCount,
        totalTreasureDistance: best.totalTreasureDistance
      } : {
        poolDistance: null,
        maxTreasureDistance: null,
        overThresholdCount: null,
        totalTreasureDistance: null
      }
    };
  }

  function validateHuntMap(input, options = {}) {
    const base = validateMap(input, options);
    const map = base.map;
    const errors = base.errors.slice();
    const warnings = base.warnings.slice();
    const voidSet = new Set(map.voidCells);
    const zoneAnchors = new Set([map.zones.entrance.anchor, map.zones.dungeon.anchor].filter(Boolean));
    const treasureCells = new Set(map.treasures.map((treasure) => treasure.position));
    const markerCells = new Map();
    const derivedVoidCells = deriveHuntVoidCells(map);
    const derivedVoidSet = new Set(derivedVoidCells);

    for (const id of HUNT_MECHANISM_IDS) {
      const label = `機關 ${id}`;
      const cell = map.hunt?.mechanisms?.[id];
      if (!cell || !inBounds(cell, map.width, map.height)) {
        errors.push(`${label}尚未設定`);
        continue;
      }
      if (voidSet.has(cell)) errors.push(`${label}不能放在封閉格 ${cell}`);
      if (zoneAnchors.has(cell)) errors.push(`${label}不能與入口或地牢重疊`);
      if (treasureCells.has(cell)) errors.push(`${label}不能與寶藏重疊`);
      if (markerCells.has(cell)) errors.push(`${label}不能與${markerCells.get(cell)}重疊`);
      else markerCells.set(cell, label);
    }
    for (const treasure of map.treasures) {
      if (derivedVoidSet.has(treasure.position)) {
        errors.push(`寶藏 ${treasure.id} 不能位於獵殺模式衍生封閉格 ${treasure.position}`);
      }
    }

    if (base.valid && errors.length === base.errors.length) {
      const graph = buildMovementGraph(map, { hunt: true });
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
      if (!entranceExits.length) errors.push("獵殺模式入口沒有可進入的道路");
      const dungeonExits = map.zones.dungeon.exits.filter((cell) => floorSet.has(cell));
      if (!dungeonExits.length) errors.push("獵殺模式地牢沒有可進入的道路");
      for (const id of HUNT_MECHANISM_IDS) {
        const mechanism = map.hunt.mechanisms[id];
        const approaches = neighbors(mechanism, map.width, map.height)
          .filter((cell) => floorSet.has(cell))
          .filter((cell) => !map.walls.includes(canonicalEdge(mechanism, cell)));
        if (!approaches.length) errors.push(`機關 ${id} 沒有可互動的相鄰道路`);
        else if (!approaches.some((cell) => visited.has(cell))) errors.push(`機關 ${id} 無法從入口抵達`);
      }
    }

    return {
      valid: errors.length === 0,
      complete: base.complete,
      huntCompatible: errors.length === 0,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      derivedVoidCells,
      map
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
      treasures: map.treasures.length,
      huntMarkers: huntMarkerCells(map).length
    };
  }

  return Object.freeze({
    KIND,
    SCHEMA_VERSION,
    LIMITS,
    GROUPS,
    TREASURE_IDS,
    HUNT_MECHANISM_IDS,
    HUNT_MECHANISM_TARGET,
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
    huntMarkerCells,
    deriveHuntVoidCells,
    applyHuntDerivedVoidCells,
    buildMovementGraph,
    graphDistances,
    analyzeMasonControl,
    analyzePhantomControl,
    analyzeMapRating,
    analyzePurificationPools,
    validateMap,
    validateHuntMap,
    mapStats
  });
});
