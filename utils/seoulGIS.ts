/**
 * seoulGIS.ts — Local crosswalk dataset for Seoul (서울특별시)
 *
 * SOURCE: 서울특별시 자치구별 신호등 및 횡단보도 위치 및 현황 (2023-05-30)
 *   39,036 official crosswalk records, pre-converted to WGS84 and classified.
 *
 * FORMAT: { meta, data: [lat, lng, dangerFlag][] }
 *   dangerFlag = 1  → 비신호 (uncontrolled) → "danger"
 *   dangerFlag = 0  → 신호있음 (signalised)  → "caution"
 *
 * LAZY INIT: The spatial grid is built on first query call, not at module-load
 * time. This avoids crashing the JS bundle if the JSON is slow to parse in
 * the Hermes engine, and allows the rest of the app to load normally.
 *
 * MISSING JSON: if `assets/seoul_crosswalks.json` is not bundled (e.g. file
 * not committed yet), the grid stays empty and `querySeoulCrosswalks` returns
 * []. GISContext detects this and silently falls back to the Overpass API.
 */

import type { Crosswalk } from "@/context/GISContext";

// ─── Seoul bounding box (with 2 km margin) ────────────────────────────────────
const SEOUL_BOUNDS = {
  latMin: 37.40,
  latMax: 37.72,
  lngMin: 126.72,
  lngMax: 127.20,
};

/** Returns true when a GPS position is within Seoul metropolitan area */
export function isInSeoul(lat: number, lng: number): boolean {
  return (
    lat >= SEOUL_BOUNDS.latMin &&
    lat <= SEOUL_BOUNDS.latMax &&
    lng >= SEOUL_BOUNDS.lngMin &&
    lng <= SEOUL_BOUNDS.lngMax
  );
}

// ─── Spatial grid (built lazily on first use) ─────────────────────────────────

const GRID_DEG = 0.003;
const EARTH_R  = 6_371_000;

type GridEntry = { lat: number; lng: number; danger: boolean };
type GridCell  = GridEntry[];

let _grid: Map<string, GridCell> | null = null;
let _totalCount = 0;
let _loadError: string | null = null;

function cellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / GRID_DEG)}_${Math.floor(lng / GRID_DEG)}`;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/**
 * buildGrid — loads the Seoul crosswalk JSON and builds the spatial index.
 * Called once on first query. Returns the grid (may be empty on failure).
 */
function buildGrid(): Map<string, GridCell> {
  if (_grid !== null) return _grid;

  const g = new Map<string, GridCell>();

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../assets/seoul_crosswalks.json");

    if (!raw || !Array.isArray(raw.data)) {
      _loadError = `seoulGIS: invalid JSON shape (data=${typeof raw?.data})`;
      console.error(_loadError);
      _grid = g;
      return g;
    }

    for (const row of raw.data) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const [lat, lng, flag] = row as [number, number, number];
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      const key = cellKey(lat, lng);
      let cell = g.get(key);
      if (!cell) { cell = []; g.set(key, cell); }
      cell.push({ lat, lng, danger: flag === 1 });
      _totalCount++;
    }

    console.log(`[seoulGIS] Grid built: ${_totalCount} crosswalks, ${g.size} cells`);
  } catch (e) {
    _loadError = `seoulGIS: failed to load JSON — ${String(e)}`;
    console.warn(_loadError);
  }

  _grid = g;
  return g;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * querySeoulCrosswalks
 *
 * Returns all official Seoul crosswalks within `radiusM` metres of (lat, lng).
 * Builds the spatial grid on first call (lazy init).
 */
export function querySeoulCrosswalks(
  lat: number,
  lng: number,
  radiusM = 350
): Crosswalk[] {
  const grid = buildGrid();

  if (grid.size === 0) {
    return [];
  }

  const cellSpan =
    Math.ceil(radiusM / (GRID_DEG * EARTH_R * (Math.PI / 180))) + 1;
  const baseLat = Math.floor(lat / GRID_DEG);
  const baseLng = Math.floor(lng / GRID_DEG);

  const results: Crosswalk[] = [];

  for (let dLat = -cellSpan; dLat <= cellSpan; dLat++) {
    for (let dLng = -cellSpan; dLng <= cellSpan; dLng++) {
      const key = `${baseLat + dLat}_${baseLng + dLng}`;
      const cell = grid.get(key);
      if (!cell) continue;
      for (const entry of cell) {
        if (haversineM(lat, lng, entry.lat, entry.lng) <= radiusM) {
          results.push({
            id: `seoul_${entry.lat.toFixed(6)}_${entry.lng.toFixed(6)}`,
            lat: entry.lat,
            lng: entry.lng,
            riskLevel: entry.danger ? "danger" : "caution",
          });
        }
      }
    }
  }

  return results;
}

/** Human-readable status for debugging */
export function getSeoulGISStatus(): string {
  if (_grid === null) return "grid not built";
  if (_grid.size === 0) return `grid empty${_loadError ? ": " + _loadError : ""}`;
  return `${_totalCount} crosswalks, ${_grid.size} cells`;
}

export const SEOUL_CROSSWALK_COUNT = {
  get value() { return _totalCount; },
};

// ─── Streetlights (서울시 가로등 위치 정보) ───────────────────────────────────
//
// Same lazy-grid pattern as crosswalks. JSON shape: { meta, data: [[lat,lng], ...] }
// querySeoulStreetlightCount(lat, lng, radiusM) returns the COUNT of streetlights
// within radiusM metres — matches the Overpass `count(node[highway=street_lamp])`
// semantic that drives the "darkness risk" boost in GISContext.

type LightCell = { lat: number; lng: number }[];
let _lightGrid: Map<string, LightCell> | null = null;
let _lightTotalCount = 0;
let _lightLoadError: string | null = null;

function buildLightGrid(): Map<string, LightCell> {
  if (_lightGrid !== null) return _lightGrid;
  const g = new Map<string, LightCell>();

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../assets/seoul_streetlights.json");
    if (!raw || !Array.isArray(raw.data)) {
      _lightLoadError = `seoulGIS: invalid streetlight JSON shape`;
      console.error(_lightLoadError);
      _lightGrid = g;
      return g;
    }

    for (const row of raw.data) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const [lat, lng] = row as [number, number];
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      const key = cellKey(lat, lng);
      let cell = g.get(key);
      if (!cell) { cell = []; g.set(key, cell); }
      cell.push({ lat, lng });
      _lightTotalCount++;
    }

    console.log(`[seoulGIS] Streetlight grid built: ${_lightTotalCount} lights, ${g.size} cells`);
  } catch (e) {
    _lightLoadError = `seoulGIS: failed to load streetlight JSON — ${String(e)}`;
    console.warn(_lightLoadError);
  }

  _lightGrid = g;
  return g;
}

/**
 * querySeoulStreetlightCount — number of Seoul streetlights within `radiusM`
 * metres of (lat, lng). Returns null if the dataset isn't available (caller
 * should fall back to Overpass). Returns 0 (a real count) when the dataset is
 * loaded but no lights are nearby.
 */
export function querySeoulStreetlightCount(
  lat: number,
  lng: number,
  radiusM = 80,
): number | null {
  const grid = buildLightGrid();
  if (grid.size === 0) return null;

  const cellSpan =
    Math.ceil(radiusM / (GRID_DEG * EARTH_R * (Math.PI / 180))) + 1;
  const baseLat = Math.floor(lat / GRID_DEG);
  const baseLng = Math.floor(lng / GRID_DEG);

  let count = 0;
  for (let dLat = -cellSpan; dLat <= cellSpan; dLat++) {
    for (let dLng = -cellSpan; dLng <= cellSpan; dLng++) {
      const key = `${baseLat + dLat}_${baseLng + dLng}`;
      const cell = grid.get(key);
      if (!cell) continue;
      for (const entry of cell) {
        if (haversineM(lat, lng, entry.lat, entry.lng) <= radiusM) count++;
      }
    }
  }
  return count;
}

export const SEOUL_STREETLIGHT_COUNT = {
  get value() { return _lightTotalCount; },
};
