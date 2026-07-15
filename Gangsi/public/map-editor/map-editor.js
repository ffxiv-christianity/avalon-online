(function initializeGangsiMapEditor() {
  "use strict";

  const Format = window.GangsiMapFormat;
  const Classes = window.GangsiMapClasses;
  const Rules = window.GangsiRules;
  if (!Format || !Classes || !Rules) throw new Error("Gangsi modules are unavailable");

  const STORAGE_KEY = "gangsi-map-editor-v1";
  const mapBoard = document.querySelector("#mapBoard");
  const cellLayer = document.querySelector("#cellLayer");
  const edgeLayer = document.querySelector("#edgeLayer");
  const mapTitle = document.querySelector("#mapTitle");
  const boardStats = document.querySelector("#boardStats");
  const editorStatus = document.querySelector("#editorStatus");
  const mapName = document.querySelector("#mapName");
  const mapAuthor = document.querySelector("#mapAuthor");
  const mapDate = document.querySelector("#mapDate");
  const mapWidth = document.querySelector("#mapWidth");
  const mapHeight = document.querySelector("#mapHeight");
  const treasurePalette = document.querySelector("#treasurePalette");
  const treasureProgress = document.querySelector("#treasureProgress");
  const validationBadge = document.querySelector("#validationBadge");
  const validationList = document.querySelector("#validationList");
  const jsonPreview = document.querySelector("#jsonPreview");
  const builtInMap = document.querySelector("#builtInMap");
  const importInput = document.querySelector("#importInput");
  const undoButton = document.querySelector("#undoButton");
  const redoButton = document.querySelector("#redoButton");

  let map = Format.createBlankMap();
  let mode = "wall";
  let selectedTreasureId = Format.TREASURE_IDS[0];
  let undoStack = [];
  let redoStack = [];
  let catalog = [];
  let statusTimer = null;
  let draggingTreasureId = null;
  let suppressCellClick = false;

  function setStatus(message, tone = "neutral") {
    editorStatus.textContent = message;
    editorStatus.dataset.tone = tone;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      editorStatus.textContent = "已自動保存草稿";
      editorStatus.dataset.tone = "neutral";
    }, 3200);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  }

  function commit(mutator, message) {
    undoStack.push(Format.clone(map));
    if (undoStack.length > 150) undoStack.shift();
    redoStack = [];
    mutator(map);
    map = Format.refreshZoneExits(map);
    persist();
    render();
    setStatus(message || "草稿已更新");
  }

  function replaceMap(nextMap, message, rememberCurrent = true) {
    if (rememberCurrent) undoStack.push(Format.clone(map));
    redoStack = [];
    map = Format.refreshZoneExits(nextMap);
    selectedTreasureId = Format.TREASURE_IDS.find((id) => !map.treasures.some((treasure) => treasure.id === id))
      || Format.TREASURE_IDS[0];
    persist();
    render();
    setStatus(message);
  }

  function treasureAt(cell) {
    return map.treasures.find((treasure) => treasure.position === cell) || null;
  }

  function removeTreasureAt(cell) {
    map.treasures = map.treasures.filter((treasure) => treasure.position !== cell);
  }

  function placeTreasure(id, cell, { toggle = false } = {}) {
    if (Classes.cellClassAt(map, cell) !== "floor") {
      setStatus("寶藏只能放在一般道路格", "error");
      return;
    }
    selectedTreasureId = id;
    mode = "treasure";
    const occupying = treasureAt(cell);
    if (!toggle && occupying?.id === id) return;
    commit(() => {
      const selected = map.treasures.find((treasure) => treasure.id === id);
      const targetTreasure = treasureAt(cell);
      if (toggle && targetTreasure?.id === id) {
        map.treasures = map.treasures.filter((treasure) => treasure.id !== id);
        return;
      }
      map.treasures = map.treasures.filter((treasure) => (
        treasure.id !== id && treasure.position !== cell
      ));
      if (selected && targetTreasure) map.treasures.push({ id: targetTreasure.id, position: selected.position });
      map.treasures.push({ id, position: cell });
    }, `${id} 已放在 ${cell}`);
  }

  function syncModeButtons() {
    document.querySelectorAll(".mode-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    });
  }

  function clearDropTargets() {
    document.querySelectorAll(".map-cell.is-drop-target").forEach((cell) => {
      cell.classList.remove("is-drop-target");
    });
  }

  function startTreasureDrag(event, id) {
    draggingTreasureId = id;
    selectedTreasureId = id;
    mode = "treasure";
    edgeLayer.classList.add("is-disabled");
    syncModeButtons();
    treasurePalette.querySelectorAll(".treasure-choice").forEach((button) => {
      const isSelected = button.textContent === id;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-selected", String(isSelected));
    });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-gangsi-treasure", id);
    event.dataTransfer.setData("text/plain", id);
  }

  function finishTreasureDrag() {
    draggingTreasureId = null;
    suppressCellClick = true;
    clearDropTargets();
    requestAnimationFrame(() => { suppressCellClick = false; });
  }

  function handleCellClick(cell) {
    if (mode === "wall") return;
    const currentClass = Classes.cellClassAt(map, cell);

    if (mode === "void") {
      if (currentClass === "entrance" || currentClass === "dungeon") {
        setStatus("入口與地牢不能改成封閉格", "error");
        return;
      }
      commit(() => {
        const cells = new Set(map.voidCells);
        if (cells.has(cell)) cells.delete(cell);
        else {
          cells.add(cell);
          removeTreasureAt(cell);
        }
        map.voidCells = [...cells];
      }, map.voidCells.includes(cell) ? `已恢復道路 ${cell}` : `已封閉 ${cell}`);
      return;
    }

    if (mode === "entrance" || mode === "dungeon") {
      const label = mode === "entrance" ? "入口" : "地牢";
      commit(() => {
        const zone = map.zones[mode];
        zone.anchor = zone.anchor === cell ? null : cell;
        map.voidCells = map.voidCells.filter((entry) => entry !== cell);
        removeTreasureAt(cell);
        const otherType = mode === "entrance" ? "dungeon" : "entrance";
        if (map.zones[otherType].anchor === cell) map.zones[otherType].anchor = null;
      }, `${label}位置已更新`);
      return;
    }

    if (mode === "treasure") {
      placeTreasure(selectedTreasureId, cell, { toggle: true });
    }
  }

  function handleEdgeClick(edge) {
    if (mode !== "wall") return;
    const walls = new Set(map.walls);
    commit(() => {
      if (walls.has(edge)) walls.delete(edge);
      else walls.add(edge);
      map.walls = [...walls];
    }, walls.has(edge) ? `已移除牆壁 ${edge}` : `已放置牆壁 ${edge}`);
  }

  function addCellButton(x, y, entranceExits, dungeonExits) {
    const cell = Format.cellKey(x, y);
    const cellClass = Classes.cellClassAt(map, cell);
    const treasure = treasureAt(cell);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `map-cell is-${cellClass}`;
    button.dataset.cell = cell;
    button.title = `(${cell}) ${Classes.CELL_CLASSES[cellClass].label}${treasure ? ` ${treasure.id}` : ""}`;
    if (entranceExits.has(cell)) button.classList.add("is-entrance-exit");
    if (dungeonExits.has(cell)) button.classList.add("is-dungeon-exit");

    const coordinate = document.createElement("span");
    coordinate.className = "cell-coordinate";
    coordinate.textContent = cell;
    button.append(coordinate);

    if (cellClass !== "floor") {
      const classLabel = document.createElement("span");
      classLabel.className = "cell-class-label";
      classLabel.textContent = Classes.CELL_CLASSES[cellClass].label;
      button.append(classLabel);
    }

    if (treasure) {
      const token = document.createElement("span");
      token.className = "treasure-token";
      token.dataset.group = treasure.id[0];
      token.textContent = treasure.id;
      token.draggable = true;
      token.title = `拖曳 ${treasure.id} 到其他道路格`;
      token.addEventListener("dragstart", (event) => startTreasureDrag(event, treasure.id));
      token.addEventListener("dragend", finishTreasureDrag);
      button.append(token);
    }

    button.addEventListener("click", () => {
      if (!suppressCellClick) handleCellClick(cell);
    });
    button.addEventListener("dragover", (event) => {
      if (!draggingTreasureId || cellClass !== "floor") return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      button.classList.add("is-drop-target");
    });
    button.addEventListener("dragleave", (event) => {
      if (!button.contains(event.relatedTarget)) button.classList.remove("is-drop-target");
    });
    button.addEventListener("drop", (event) => {
      if (cellClass !== "floor") return;
      event.preventDefault();
      const id = event.dataTransfer.getData("application/x-gangsi-treasure") || draggingTreasureId;
      draggingTreasureId = null;
      clearDropTargets();
      if (Format.TREASURE_IDS.includes(id)) placeTreasure(id, cell);
    });
    cellLayer.append(button);
  }

  function addEdgeButton(left, right, orientation, leftPercent, topPercent) {
    const edge = Format.canonicalEdge(left, right);
    const edgeClass = Classes.edgeClassAt(map, edge);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `edge-button is-${orientation} is-${edgeClass}`;
    button.style.left = `${leftPercent}%`;
    button.style.top = `${topPercent}%`;
    button.title = edgeClass === "wall" ? `移除牆壁 ${edge}` : `放置牆壁 ${edge}`;
    button.addEventListener("click", () => handleEdgeClick(edge));
    edgeLayer.append(button);
  }

  function renderBoard() {
    mapBoard.style.setProperty("--cols", map.width);
    mapBoard.style.setProperty("--rows", map.height);
    cellLayer.replaceChildren();
    edgeLayer.replaceChildren();
    edgeLayer.classList.toggle("is-disabled", mode !== "wall");
    const entranceExits = new Set(map.zones.entrance.exits);
    const dungeonExits = new Set(map.zones.dungeon.exits);

    for (let y = 1; y <= map.height; y += 1) {
      for (let x = 1; x <= map.width; x += 1) addCellButton(x, y, entranceExits, dungeonExits);
    }
    for (let y = 1; y <= map.height; y += 1) {
      for (let x = 1; x < map.width; x += 1) {
        addEdgeButton(
          Format.cellKey(x, y),
          Format.cellKey(x + 1, y),
          "vertical",
          (x / map.width) * 100,
          ((y - 1) / map.height) * 100
        );
      }
    }
    for (let y = 1; y < map.height; y += 1) {
      for (let x = 1; x <= map.width; x += 1) {
        addEdgeButton(
          Format.cellKey(x, y),
          Format.cellKey(x, y + 1),
          "horizontal",
          ((x - 1) / map.width) * 100,
          (y / map.height) * 100
        );
      }
    }
  }

  function renderPalette() {
    treasurePalette.replaceChildren();
    const placed = new Set(map.treasures.map((treasure) => treasure.id));
    for (const [group, definition] of Object.entries(Format.GROUPS)) {
      const groupPanel = document.createElement("section");
      groupPanel.className = "treasure-group";
      groupPanel.dataset.group = group;
      groupPanel.setAttribute("role", "group");
      groupPanel.setAttribute("aria-label", `${group} 組${definition.label}色寶藏：${definition.name}`);

      const heading = document.createElement("div");
      heading.className = "treasure-group-heading";
      const label = document.createElement("strong");
      const swatch = document.createElement("i");
      swatch.setAttribute("aria-hidden", "true");
      label.append(swatch, document.createTextNode(`${group} 組・${definition.label}色・${definition.name}`));
      const count = document.createElement("span");
      const ids = Format.TREASURE_IDS.filter((id) => id.startsWith(group));
      count.textContent = `${ids.filter((id) => placed.has(id)).length} / ${ids.length}`;
      heading.append(label, count);

      const choices = document.createElement("div");
      choices.className = "treasure-group-choices";
      for (const id of ids) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "treasure-choice";
        button.dataset.group = group;
        button.textContent = id;
        button.draggable = true;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(id === selectedTreasureId));
        button.classList.toggle("is-selected", id === selectedTreasureId);
        button.classList.toggle("is-placed", placed.has(id));
        button.title = placed.has(id)
          ? `拖曳 ${id} ${definition.name}可移動位置`
          : `拖曳 ${id} ${definition.name}到道路格`;
        button.addEventListener("click", () => {
          selectedTreasureId = id;
          setMode("treasure");
        });
        button.addEventListener("dragstart", (event) => startTreasureDrag(event, id));
        button.addEventListener("dragend", finishTreasureDrag);
        choices.append(button);
      }
      groupPanel.append(heading, choices);
      treasurePalette.append(groupPanel);
    }
    treasureProgress.textContent = `${map.treasures.length} / ${Format.TREASURE_IDS.length}`;
  }

  function renderValidation() {
    const result = Format.validateMap(map);
    validationList.replaceChildren();
    validationBadge.className = "validation-badge";
    const messages = [];
    if (result.valid) {
      validationBadge.textContent = "可用地圖";
      validationBadge.classList.add("is-valid");
      messages.push({ type: "success", text: "結構、連通性與 23 個寶藏均通過" });
    } else {
      validationBadge.textContent = result.complete ? "需修正" : "草稿";
      validationBadge.classList.add("is-invalid");
      messages.push(...result.errors.map((text) => ({ type: "error", text })));
    }
    messages.push(...result.warnings.map((text) => ({ type: "warning", text })));
    const visible = messages.slice(0, 10);
    if (messages.length > visible.length) visible.push({ type: "warning", text: `另有 ${messages.length - visible.length} 項訊息` });
    for (const message of visible) {
      const item = document.createElement("li");
      item.className = `is-${message.type}`;
      item.textContent = message.text;
      validationList.append(item);
    }
  }

  function renderMetadata() {
    mapTitle.textContent = map.name;
    mapName.value = map.name;
    mapAuthor.value = map.author;
    mapDate.value = map.date;
    mapWidth.value = map.width;
    mapHeight.value = map.height;
    const stats = Format.mapStats(map);
    const entries = [
      ["道路格", stats.floorCells],
      ["通道", stats.passages],
      ["牆壁", stats.walls],
      ["寶藏", stats.treasures]
    ];
    boardStats.replaceChildren();
    for (const [label, value] of entries) {
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      wrapper.append(term, detail);
      boardStats.append(wrapper);
    }
  }

  function render() {
    renderMetadata();
    renderBoard();
    renderPalette();
    renderValidation();
    jsonPreview.value = JSON.stringify(Format.refreshZoneExits(map), null, 2);
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
    syncModeButtons();
  }

  function setMode(nextMode) {
    mode = nextMode;
    render();
  }

  function bindMetadata() {
    mapName.addEventListener("change", () => {
      const nextName = mapName.value.trim() || "未命名地圖";
      commit(() => {
        map.name = nextName;
        map.id = Format.slug(nextName);
      }, "地圖名稱已更新");
    });
    mapAuthor.addEventListener("change", () => {
      commit(() => { map.author = mapAuthor.value.trim().slice(0, 40); }, "作者已更新");
    });
  }

  function resizeMap() {
    const width = Number(mapWidth.value);
    const height = Number(mapHeight.value);
    if (!Number.isInteger(width) || width < Format.LIMITS.minWidth || width > Format.LIMITS.maxWidth
      || !Number.isInteger(height) || height < Format.LIMITS.minHeight || height > Format.LIMITS.maxHeight) {
      setStatus("尺寸超出允許範圍", "error");
      return;
    }
    if (width === map.width && height === map.height) return;
    if (!window.confirm(`將地圖調整為 ${width} × ${height}，超出範圍的物件會被移除。`)) return;
    commit(() => {
      map.width = width;
      map.height = height;
      map.walls = map.walls.filter((edge) => edge.split("|").every((cell) => Format.inBounds(cell, width, height)));
      map.voidCells = map.voidCells.filter((cell) => Format.inBounds(cell, width, height));
      map.treasures = map.treasures.filter((treasure) => Format.inBounds(treasure.position, width, height));
      for (const type of ["entrance", "dungeon"]) {
        if (!Format.inBounds(map.zones[type].anchor, width, height)) map.zones[type].anchor = null;
      }
    }, `尺寸已調整為 ${width} × ${height}`);
  }

  async function loadCatalog() {
    try {
      const response = await fetch("/Gangsi/maps/index.json", { cache: "no-store" });
      if (!response.ok) throw new Error("無法讀取地圖目錄");
      const payload = await response.json();
      catalog = Array.isArray(payload.maps) ? payload.maps : [];
      builtInMap.replaceChildren();
      for (const entry of catalog) {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.name;
        builtInMap.append(option);
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  async function loadBuiltIn(entry) {
    if (!entry) return;
    try {
      const response = await fetch(`/Gangsi/maps/${encodeURIComponent(entry.file)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("無法載入內建地圖");
      const payload = await response.json();
      const result = Format.validateMap(payload);
      if (!result.valid) throw new Error(`內建地圖無效：${result.errors[0]}`);
      replaceMap(result.map, `已載入 ${entry.name}`);
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  async function importMap(file) {
    try {
      const payload = JSON.parse(await file.text());
      if (payload.kind !== Format.KIND || Number(payload.schemaVersion) !== Format.SCHEMA_VERSION) {
        throw new Error("不是可支援的 Gangsi 地圖 JSON");
      }
      const width = Number(payload.width ?? payload.dimensions?.width);
      const height = Number(payload.height ?? payload.dimensions?.height);
      if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error("地圖缺少有效尺寸");
      replaceMap(Format.normalizeMap(payload), `已匯入 ${file.name}`);
    } catch (error) {
      setStatus(`匯入失敗：${error.message}`, "error");
    }
  }

  async function saveJson() {
    const payload = Format.refreshZoneExits(map);
    const result = Format.validateMap(payload);
    if (!result.valid && !window.confirm("地圖尚未通過完整驗證，仍要儲存草稿 JSON 嗎？")) return;
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    const suggestedName = `${payload.id || "gangsi-map"}.json`;
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: "Gangsi map JSON", accept: { "application/json": [".json"] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = suggestedName;
        link.click();
        URL.revokeObjectURL(url);
      }
      setStatus(result.valid ? "可用地圖 JSON 已儲存" : "草稿 JSON 已儲存", result.valid ? "success" : "warning");
    } catch (error) {
      if (error.name !== "AbortError") setStatus(`儲存失敗：${error.message}`, "error");
    }
  }

  function bindActions() {
    document.querySelectorAll(".mode-button").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });
    document.querySelector("#resizeButton").addEventListener("click", resizeMap);
    document.querySelector("#loadBuiltIn").addEventListener("click", () => {
      loadBuiltIn(catalog.find((entry) => entry.id === builtInMap.value));
    });
    document.querySelector("#newMapButton").addEventListener("click", () => {
      if (!window.confirm("建立新的空白地圖？目前草稿仍可用復原取回。")) return;
      replaceMap(Format.createBlankMap(10, 7), "已建立空白地圖");
    });
    document.querySelector("#importButton").addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", async () => {
      const [file] = importInput.files;
      if (file) await importMap(file);
      importInput.value = "";
    });
    document.querySelector("#saveButton").addEventListener("click", saveJson);
    document.querySelector("#copyJsonButton").addEventListener("click", async () => {
      await navigator.clipboard.writeText(jsonPreview.value);
      setStatus("JSON 已複製");
    });
    undoButton.addEventListener("click", () => {
      if (!undoStack.length) return;
      redoStack.push(Format.clone(map));
      map = Format.refreshZoneExits(undoStack.pop());
      persist();
      render();
      setStatus("已復原");
    });
    redoButton.addEventListener("click", () => {
      if (!redoStack.length) return;
      undoStack.push(Format.clone(map));
      map = Format.refreshZoneExits(redoStack.pop());
      persist();
      render();
      setStatus("已重做");
    });
    window.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undoButton.click();
      }
      if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) {
        event.preventDefault();
        redoButton.click();
      }
    });
  }

  async function start() {
    Rules.mount();
    bindMetadata();
    bindActions();
    await loadCatalog();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.kind === Format.KIND) {
        map = Format.refreshZoneExits(saved);
        render();
        setStatus("已恢復本機草稿");
        return;
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    const firstMap = catalog[0];
    if (firstMap) await loadBuiltIn(firstMap);
    else render();
  }

  start();
})();
