(function initializeGangsiMapClasses(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GangsiMapClasses = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGangsiMapClasses() {
  "use strict";

  const CELL_CLASSES = Object.freeze({
    floor: Object.freeze({ id: "floor", label: "道路", obstacle: false, normalOccupancy: 1 }),
    void: Object.freeze({ id: "void", label: "封閉格", obstacle: true, normalOccupancy: 0 }),
    entrance: Object.freeze({ id: "entrance", label: "入口", obstacle: true, specialZone: true, normalOccupancy: Infinity }),
    dungeon: Object.freeze({ id: "dungeon", label: "地牢", obstacle: true, specialZone: true, normalOccupancy: Infinity })
  });

  const EDGE_CLASSES = Object.freeze({
    passage: Object.freeze({ id: "passage", label: "通道", obstacle: false }),
    wall: Object.freeze({ id: "wall", label: "牆壁", obstacle: true })
  });

  const OBJECT_CLASSES = Object.freeze({
    treasure: Object.freeze({
      id: "treasure",
      label: "寶藏",
      obstacle: false,
      onPass: "none",
      onAdventurerStop: "offer-reveal",
      onMummyStop: "none"
    }),
    mechanism: Object.freeze({
      id: "mechanism",
      label: "機關",
      obstacle: true,
      classicIgnored: true,
      onAdjacentAdventurerTurn: "activate",
      onComplete: "convert-to-escape-exit"
    }),
    escapeExit: Object.freeze({
      id: "escapeExit",
      label: "逃生出口",
      obstacle: true,
      classicIgnored: true,
      runtimeOnly: true,
      onOpenAdventurerEnter: "escape"
    }),
    hatch: Object.freeze({
      id: "hatch",
      label: "密道",
      obstacle: false,
      runtimeOnly: true
    })
  });

  const PIECE_CLASSES = Object.freeze({
    adventurer: Object.freeze({ id: "adventurer", label: "冒險者" }),
    mummy: Object.freeze({ id: "mummy", label: "提燈怪", tokenLabel: "怪" })
  });

  const MOVEMENT_CLASSES = Object.freeze({
    adventurerNumeric: Object.freeze({
      id: "adventurerNumeric",
      actor: "adventurer",
      mayTurn: true,
      mayRepeatCells: true,
      exactDistance: true,
      stopEarly: false,
      cellInteraction: Object.freeze({ floor: "enter", void: "block", entrance: "block", dungeon: "block" }),
      pieceInteraction: Object.freeze({ adventurer: "pass-only", mummy: "block" })
    }),
    adventurerArrow: Object.freeze({
      id: "adventurerArrow",
      actor: "adventurer",
      mayTurn: false,
      mayRepeatCells: false,
      exactDistance: false,
      stopEarly: false,
      cellInteraction: Object.freeze({ floor: "enter", void: "block", entrance: "block", dungeon: "block" }),
      pieceInteraction: Object.freeze({ adventurer: "block", mummy: "block" })
    }),
    mummy: Object.freeze({
      id: "mummy",
      actor: "mummy",
      mayTurn: true,
      mayRepeatCells: true,
      exactDistance: false,
      stopEarly: true,
      cellInteraction: Object.freeze({ floor: "enter", void: "block", entrance: "block", dungeon: "block" }),
      pieceInteraction: Object.freeze({ adventurer: "capture-and-stop", mummy: "enter" })
    })
  });

  function movementInteraction(movementClassId, targetKind, targetClassId) {
    const movement = MOVEMENT_CLASSES[movementClassId];
    if (!movement) return "block";
    if (targetKind === "cell") return movement.cellInteraction[targetClassId] || "block";
    if (targetKind === "piece") return movement.pieceInteraction[targetClassId] || "block";
    return "block";
  }

  function cellClassAt(map, cell) {
    if (map.zones?.entrance?.anchor === cell) return "entrance";
    if (map.zones?.dungeon?.anchor === cell) return "dungeon";
    if (map.voidCells?.includes(cell)) return "void";
    return "floor";
  }

  function edgeClassAt(map, edge) {
    return map.walls?.includes(edge) ? "wall" : "passage";
  }

  return Object.freeze({
    CELL_CLASSES,
    EDGE_CLASSES,
    OBJECT_CLASSES,
    PIECE_CLASSES,
    MOVEMENT_CLASSES,
    movementInteraction,
    cellClassAt,
    edgeClassAt
  });
});
