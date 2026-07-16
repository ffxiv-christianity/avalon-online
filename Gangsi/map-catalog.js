"use strict";

const fs = require("fs");
const path = require("path");
const { randomIntInclusive } = require("../Shared/server/random");
const MapFormat = require("./map-format");

const MAPS_DIR = path.join(__dirname, "maps");
const INDEX_FILE = path.join(MAPS_DIR, "index.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadIndex() {
  const payload = readJson(INDEX_FILE);
  if (Number(payload.schemaVersion) !== MapFormat.SCHEMA_VERSION || !Array.isArray(payload.maps)) {
    throw new Error("Invalid Gangsi map catalog");
  }
  return payload.maps.map((entry) => ({
    id: String(entry.id || ""),
    name: String(entry.name || ""),
    file: String(entry.file || ""),
    builtIn: entry.builtIn === true
  }));
}

function resolveMapFile(fileName) {
  if (!/^[a-z0-9-]+\.json$/i.test(fileName)) throw new Error("Invalid Gangsi map file name");
  const mapsRoot = path.resolve(MAPS_DIR);
  const filePath = path.resolve(MAPS_DIR, fileName);
  if (!filePath.startsWith(`${mapsRoot}${path.sep}`)) throw new Error("Gangsi map path escaped catalog root");
  return filePath;
}

function loadBuiltInMaps() {
  return loadIndex().map((entry) => {
    const payload = readJson(resolveMapFile(entry.file));
    const result = MapFormat.validateMap(payload);
    if (!result.valid) throw new Error(`Invalid Gangsi map ${entry.id}: ${result.errors.join("; ")}`);
    const map = MapFormat.clone(result.map);
    map.id = entry.id;
    map.name = entry.name || map.name;
    const huntValidation = MapFormat.validateHuntMap(payload);
    return Object.freeze({
      ...entry,
      huntCompatible: huntValidation.valid,
      huntErrors: Object.freeze(huntValidation.errors.slice()),
      map: Object.freeze(map)
    });
  });
}

function getBuiltInMap(mapId) {
  const entry = loadBuiltInMaps().find((candidate) => candidate.id === mapId);
  return entry ? MapFormat.clone(entry.map) : null;
}

function randomBuiltInMap(options = {}) {
  const entries = loadBuiltInMaps().filter((entry) => options.hunt !== true || entry.huntCompatible);
  if (!entries.length) return null;
  return MapFormat.clone(entries[randomIntInclusive(0, entries.length - 1)].map);
}

function validateCustomMap(payload) {
  return MapFormat.validateMap(payload);
}

module.exports = {
  MAPS_DIR,
  loadIndex,
  loadBuiltInMaps,
  getBuiltInMap,
  randomBuiltInMap,
  validateCustomMap
};
