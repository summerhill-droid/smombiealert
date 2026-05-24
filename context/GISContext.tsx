/**
 * GISContext.tsx — Geographic Information System (GIS) data provider
 *
 * PURPOSE (Research Schedule, Weeks 4–5):
 *   Implements the "crosswalk entry detection module" described in the research plan.
 *   - Watches the user's GPS location in real time
 *   - Queries the OpenStreetMap Overpass API to find nearby crosswalks,
 *     streetlights, and road types (no API key required — open data)
 *   - Computes an "environment risk boost" (0–100) that the DetectionContext
 *     uses to escalate alerts when the user is near a crosswalk or on a
 *     busy road at night
 *
 * THREE-TRIGGER LOGIC (from research design spec):
 *   Trigger 1: GPS within 30–350 m of a crosswalk  → crosswalk proximity boost
 *   Trigger 2: Handled in DetectionContext (gyroscope pitch angle)
 *   Trigger 3: No streetlights nearby               → darkness risk boost
 *              Heavy/moderate traffic road type       → traffic risk boost
 *              Steep slope from altitude change       → slope risk boost
 *
 * DATA SOURCES:
 *   1. Seoul Official Dataset (서울특별시 횡단보도 현황, 2023-05-30)
 *      39,036 crosswalks pre-loaded as a local asset — instant, offline, zero
 *      network cost.  Used whenever the user is within Seoul's bounding box.
 *   2. OpenStreetMap Overpass API (overpass-api.de + two fallback mirrors)
 *      No registration or API key needed.  Supplies streetlamps and road type
 *      for Seoul, and all three data types (crosswalks + lights + roads) for
 *      locations outside Seoul.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import { isInSeoul, querySeoulCrosswalks } from "@/utils/seoulGIS";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A simple lat/lng coordinate pair (used throughout the module) */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Risk level of a crosswalk, inferred from OSM crossing tags.
 *
 *   "danger"  — uncontrolled or unmarked crossing: no traffic signals,
 *               no pedestrian protections → highest pedestrian risk
 *   "caution" — signalised or marked: some protection but still risky
 *               when distracted
 *   "low"     — footway / pedestrian zone: minimal vehicle conflict
 */
export type CrosswalkRisk = "danger" | "caution" | "low";

/**
 * A crosswalk node returned by the Overpass API.
 * id = OpenStreetMap node ID (unique identifier)
 * riskLevel = inferred danger level for map colour-coding
 */
export interface Crosswalk {
  id: string;
  lat: number;
  lng: number;
  riskLevel: CrosswalkRisk;
}

/**
 * Traffic level inferred from OSM road type tags.
 * Maps to the "traffic volume API" in the research plan.
 * Since we use open OSM data, we infer from road classification rather
 * than live traffic counts.
 */
export type TrafficLevel = "none" | "light" | "moderate" | "heavy";

/** Whether location permission has been granted, denied, or not yet asked */
export type PermissionStatus = "unknown" | "granted" | "denied";

/** All GIS state and actions exposed to child components via context */
export interface GISState {
  /** Current GPS position of the user (null until first fix) */
  userLocation: (LatLng & { altitude: number | null; heading: number | null }) | null;
  /** All crosswalk nodes found within 350 m */
  nearbyCrosswalks: Crosswalk[];
  /** Distance in metres to the nearest crosswalk (null = none found) */
  nearestCrosswalkDist: number | null;
  /** Number of streetlamp nodes found within 80 m */
  streetlightCount: number;
  /** Highest traffic level among all roads found within 80 m */
  trafficLevel: TrafficLevel;
  /** Terrain slope as a grade percentage (e.g. 8 = 8% grade) */
  slope: number;
  /** Combined environment risk score 0–100 fed into the detection engine */
  gisRiskBoost: number;
  /**
   * Which dataset crosswalks came from:
   *   "seoul"   — official Seoul City dataset (local, offline, fastest)
   *   "osm"     — OpenStreetMap Overpass API (live, global)
   *   "none"    — no data yet
   */
  dataSource: "seoul" | "osm" | "none";
  permissionStatus: PermissionStatus;
  isLoadingGIS: boolean;
  gisError: string | null;
  /** Ask the OS for foreground location permission */
  requestPermission: () => Promise<void>;
  /** Force a fresh Overpass query at the current position */
  refreshGIS: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Earth radius in metres — used by the Haversine formula */
const EARTH_R = 6_371_000;

/**
 * Haversine formula: great-circle distance between two lat/lng points.
 * Used to:
 *   1. Find the nearest crosswalk distance
 *   2. Detect when the user has moved >100 m (triggers a new Overpass fetch)
 *   3. Compute slope from consecutive GPS fixes
 */
function haversine(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/**
 * Maps an OSM highway tag to a traffic level.
 * Motorways/primary roads → heavy; residential/service → light; footways → none.
 * This is how we replicate "traffic volume API" data from the research plan
 * using freely available OpenStreetMap tags.
 */
const TRAFFIC_MAP: Record<string, TrafficLevel> = {
  motorway: "heavy",
  motorway_link: "heavy",
  trunk: "heavy",
  trunk_link: "heavy",
  primary: "heavy",
  primary_link: "heavy",
  secondary: "moderate",
  secondary_link: "moderate",
  tertiary: "moderate",
  tertiary_link: "moderate",
  unclassified: "light",
  residential: "light",
  living_street: "light",
  service: "light",
  pedestrian: "none",
  footway: "none",
  path: "none",
  cycleway: "none",
  steps: "none",
};

/** Numeric rank for comparison — used to pick the "worst" road within 80 m */
function trafficRank(level: TrafficLevel): number {
  return { none: 0, light: 1, moderate: 2, heavy: 3 }[level];
}

/**
 * Overpass API mirrors — tried in order.
 * overpass-api.de is the main server; the others are community mirrors.
 * Having backups prevents the "GIS unavailable" error when the main
 * server is slow (common from cloud IPs).
 */
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/**
 * Infers the pedestrian danger level of a crosswalk from its OSM tags.
 *
 * OSM `crossing` tag values and their real-world meanings:
 *   traffic_signals / pelican / toucan → protected by signals → "caution"
 *   marked / zebra / raised / island   → physically marked   → "caution"
 *   uncontrolled                        → no protection       → "danger"
 *   unmarked                            → not even painted    → "danger"
 *   (missing / unknown)                 → assume uncontrolled → "danger"
 *
 * Also reads `crossing:signals=yes` and `crossing:island=yes` as fallbacks.
 */
function inferCrosswalkRisk(tags: Record<string, string> | undefined): CrosswalkRisk {
  if (!tags) return "danger";
  const ct = tags["crossing"] ?? tags["crossing:type"] ?? "";
  const hasSignals =
    ct === "traffic_signals" ||
    ct === "pelican" ||
    ct === "toucan" ||
    ct === "pegasus" ||
    tags["crossing:signals"] === "yes";
  const isMarked =
    ct === "marked" ||
    ct === "zebra" ||
    ct === "raised" ||
    ct === "island" ||
    tags["crossing:island"] === "yes";
  if (hasSignals || isMarked) return "caution";
  if (ct === "uncontrolled" || ct === "unmarked") return "danger";
  // No crossing tag at all → unprotected, treat as danger
  return "danger";
}

/**
 * queryOverpass — Fetches crosswalk, accident area, streetlight, and road data.
 *
 * Query breakdown:
 *   node["highway"="crossing"](around:350,...) — all crosswalks within 350 m
 *                                                (includes crossing tags for risk)
 *   node["highway"="street_lamp"](around:80,...) — streetlights within 80 m
 *   way["highway"](around:80,...)               — road segments within 80 m
 *
 * Uses `out body` (not `out body geom`) to keep response size small.
 * Node elements include lat/lon AND all tags (for risk classification).
 *
 * Tries each mirror in sequence; throws only when all three fail.
 */
async function queryOverpass(
  lat: number,
  lng: number
): Promise<{ crosswalks: Crosswalk[]; streetlightCount: number; trafficLevel: TrafficLevel }> {
  // timeout:15 gives mirrors more breathing room; AbortSignal is 16s
  const query = `
[out:json][timeout:15];
(
  node["highway"="crossing"](around:350,${lat},${lng});
  node["highway"="street_lamp"](around:80,${lat},${lng});
  way["highway"](around:80,${lat},${lng});
);
out body;
  `.trim();

  let lastError: Error | null = null;

  for (const mirror of OVERPASS_MIRRORS) {
    try {
      // AbortSignal.timeout() is NOT supported in React Native's Hermes engine.
      // Instead we use Promise.race with a manual timeout that rejects after
      // 16 seconds.  The AbortController lets us also cancel the fetch so we
      // don't leave dangling connections.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 16_000);

      let res: Response;
      try {
        res = await Promise.race([
          fetch(mirror + "?data=" + encodeURIComponent(query), {
            signal: controller.signal,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${mirror}`)), 16_000)
          ),
        ]);
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} from ${mirror}`);
      const json = await res.json();

      const crosswalks: Crosswalk[] = [];
      let streetlightCount = 0;
      let bestTraffic: TrafficLevel = "none";

      for (const el of json.elements ?? []) {
        if (el.type === "node") {
          const hw = el.tags?.["highway"];
          if (hw === "crossing") {
            // Classify each crossing by its OSM tags
            const risk = inferCrosswalkRisk(el.tags);
            crosswalks.push({ id: String(el.id), lat: el.lat, lng: el.lon, riskLevel: risk });
          } else if (hw === "street_lamp") {
            streetlightCount += 1;
          }
        } else if (el.type === "way") {
          const hw = el.tags?.["highway"] as string | undefined;
          if (hw) {
            const lvl = TRAFFIC_MAP[hw] ?? "light";
            if (trafficRank(lvl) > trafficRank(bestTraffic)) bestTraffic = lvl;
          }
        }
      }

      return { crosswalks, streetlightCount, trafficLevel: bestTraffic };
    } catch (e) {
      lastError = e as Error;
      // Continue to next mirror
    }
  }

  throw lastError ?? new Error("All Overpass mirrors failed");
}

// ─── Context ──────────────────────────────────────────────────────────────────

const GISContext = createContext<GISState | null>(null);

/**
 * GISProvider — wrap your app in this to give any child component access
 * to live GIS data via `useGIS()`.
 *
 * Provider hierarchy (from _layout.tsx):
 *   GISProvider > DetectionProvider > screens
 *
 * This ordering means DetectionProvider can read gisRiskBoost and call
 * setExternalBoost through the home screen's useEffect bridge.
 */
export function GISProvider({ children }: { children: React.ReactNode }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [userLocation, setUserLocation] = useState<GISState["userLocation"]>(null);
  const [nearbyCrosswalks, setNearbyCrosswalks] = useState<Crosswalk[]>([]);
  const [nearestCrosswalkDist, setNearestCrosswalkDist] = useState<number | null>(null);
  const [streetlightCount, setStreetlightCount] = useState(0);
  const [trafficLevel, setTrafficLevel] = useState<TrafficLevel>("none");
  const [slope, setSlope] = useState(0);
  const [gisRiskBoost, setGisRiskBoost] = useState(0);
  const [dataSource, setDataSource] = useState<GISState["dataSource"]>("none");
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("unknown");
  const [isLoadingGIS, setIsLoadingGIS] = useState(false);
  const [gisError, setGisError] = useState<string | null>(null);

  // ── Refs (survive re-renders without causing them) ────────────────────────
  /** Last position where we ran a full Overpass query — re-fetch after 50 m */
  const lastFetchLocRef = useRef<LatLng | null>(null);
  /** Timestamp (ms) of the last successful Overpass fetch — re-fetch after 2 min */
  const lastFetchTimeRef = useRef<number>(0);
  /** Sliding window of recent altitude+distance pairs — used to compute slope */
  const altitudeHistoryRef = useRef<Array<{ alt: number; dist: number }>>([]);
  /** Reference to the active Location.watchPositionAsync subscription */
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  /** Periodic refresh timer handle (2-minute interval) */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Prevents two simultaneous Overpass fetches (e.g. on rapid GPS updates) */
  const isFetchingRef = useRef(false);
  /** Becomes true after the first successful Overpass response */
  const gisLoadedRef = useRef(false);
  /** Stores the latest GPS location in a ref so the timer can read it */
  const userLocationRef = useRef<GISState["userLocation"]>(null);
  /**
   * slopeRef — mirrors the slope state value for use inside fetchGIS.
   * This BREAKS the fetchGIS → slope dependency so that slope changes do NOT
   * recreate fetchGIS (and thus do NOT restart the GPS location watcher).
   */
  const slopeRef = useRef(0);

  // ── Slope calculation ──────────────────────────────────────────────────────
  /**
   * Approximates terrain slope from consecutive GPS altitude readings.
   * Keeps a rolling window of 6 samples; computes rise-over-run as %.
   * Replaces the "slope sensor" mentioned in the research plan — GPS altitude
   * is noisy but gives a reasonable approximation at walking speeds.
   */
  function updateSlope(newAlt: number | null, distFromLast: number) {
    if (newAlt === null || distFromLast === 0) return;
    const hist = altitudeHistoryRef.current;
    hist.push({ alt: newAlt, dist: distFromLast });
    if (hist.length > 6) hist.shift();       // Keep window at 6 entries max
    if (hist.length < 2) return;             // Need at least 2 points for slope

    const totalDist = hist.reduce((s, h) => s + h.dist, 0);
    const altChange = Math.abs(hist[hist.length - 1].alt - hist[0].alt);
    // grade % = (vertical rise / horizontal run) × 100
    const gradePct = totalDist > 1 ? (altChange / totalDist) * 100 : 0;
    setSlope(Math.round(Math.min(gradePct, 40)));  // Cap at 40% (very steep hill)
  }

  // ── Boost calculation ──────────────────────────────────────────────────────
  /**
   * Combines all GIS factors into a single 0–100 risk score.
   * This score is added to the sensor-based detection in DetectionContext.
   *
   * Risk factors and their weights:
   *   Crosswalk < 15 m  → +35  (you are IN the crosswalk)
   *   Crosswalk 15–50 m → +25  (approaching crosswalk)
   *   Crosswalk 50–150 m→ +15
   *   Crosswalk 150–300m→ +5
   *   No streetlights   → +20  (dark = higher risk at night)
   *   < 3 streetlights  → +10
   *   Heavy traffic road → +25
   *   Moderate traffic  → +15
   *   Light traffic     → +5
   *   Slope > 10%       → +20  (steep hill reduces visibility)
   *   Slope > 5%        → +10
   */
  function computeBoost(
    nearestDist: number | null,
    lights: number,
    traffic: TrafficLevel,
    slopePct: number,
    dataLoaded: boolean
  ): number {
    let boost = 0;
    // Don't add boost until we have real data (avoid false alarms on startup)
    if (!dataLoaded) return 0;

    if (nearestDist !== null) {
      if (nearestDist < 15) boost += 35;
      else if (nearestDist < 50) boost += 25;
      else if (nearestDist < 150) boost += 15;
      else if (nearestDist < 300) boost += 5;
    }
    if (lights === 0) boost += 20;
    else if (lights < 3) boost += 10;

    if (traffic === "heavy") boost += 25;
    else if (traffic === "moderate") boost += 15;
    else if (traffic === "light") boost += 5;

    if (slopePct > 10) boost += 20;
    else if (slopePct > 5) boost += 10;

    return Math.min(boost, 100);  // Cap at 100
  }

  // ── Overpass fetch (lights + roads only) ────────────────────────────────────
  /**
   * queryOverpassLightsRoads — a slimmed-down Overpass query that skips
   * crosswalks entirely (we already have them from the Seoul dataset).
   * Only fetches streetlamps and road types within 80 m.
   * Used in the Seoul code path to supplement the local crosswalk data.
   */
  async function queryOverpassLightsRoads(
    lat: number,
    lng: number
  ): Promise<{ streetlightCount: number; trafficLevel: TrafficLevel }> {
    const query = `
[out:json][timeout:10];
(
  node["highway"="street_lamp"](around:80,${lat},${lng});
  way["highway"](around:80,${lat},${lng});
);
out body;
    `.trim();

    let lastError: Error | null = null;
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 12_000);
        let res: Response;
        try {
          res = await Promise.race([
            fetch(mirror + "?data=" + encodeURIComponent(query), { signal: controller.signal }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout: ${mirror}`)), 12_000)
            ),
          ]);
        } finally {
          clearTimeout(tid);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        let lights = 0;
        let bestTraffic: TrafficLevel = "none";
        for (const el of json.elements ?? []) {
          if (el.type === "node" && el.tags?.["highway"] === "street_lamp") lights += 1;
          if (el.type === "way" && el.tags?.["highway"]) {
            const lvl = TRAFFIC_MAP[el.tags["highway"] as string] ?? "light";
            if (trafficRank(lvl) > trafficRank(bestTraffic)) bestTraffic = lvl;
          }
        }
        return { streetlightCount: lights, trafficLevel: bestTraffic };
      } catch (e) {
        lastError = e as Error;
      }
    }
    throw lastError ?? new Error("All mirrors failed");
  }

  // ── Primary GIS fetch ──────────────────────────────────────────────────────
  /**
   * fetchGIS — dual-source GIS update for a given GPS position.
   *
   * SEOUL PATH (user within Seoul bounding box):
   *   1. Query Seoul City dataset instantly from local JSON → crosswalks
   *   2. Run slimmed Overpass query → streetlights + road type
   *   3. dataSource = "seoul"
   *
   * GLOBAL PATH (outside Seoul):
   *   1. Run full Overpass query → crosswalks + streetlights + road type
   *   2. dataSource = "osm"
   *
   * Both paths feed the same computeBoost() and update the same state.
   * Guarded by isFetchingRef so only one request runs at a time.
   */
  const fetchGIS = useCallback(async (lat: number, lng: number) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoadingGIS(true);
    setGisError(null);

    const here: LatLng = { lat, lng };

    try {
      let crosswalks: Crosswalk[];
      let lights: number;
      let traffic: TrafficLevel;

      if (isInSeoul(lat, lng)) {
        // ── Seoul path ────────────────────────────────────────────────────────
        // 1. Try local Seoul JSON first (instant, offline)
        crosswalks = querySeoulCrosswalks(lat, lng, 350);

        if (crosswalks.length === 0) {
          // Seoul JSON didn't load (bundling issue) — fall back to full Overpass
          try {
            const overpassResult = await queryOverpass(lat, lng);
            crosswalks = overpassResult.crosswalks;
            lights    = overpassResult.streetlightCount;
            traffic   = overpassResult.trafficLevel;
          } catch {
            crosswalks = [];
            lights     = 3;
            traffic    = "moderate";
          }
          setDataSource("osm");
        } else {
          // Seoul JSON loaded fine; get lights+roads from Overpass silently
          try {
            const overpassResult = await queryOverpassLightsRoads(lat, lng);
            lights  = overpassResult.streetlightCount;
            traffic = overpassResult.trafficLevel;
          } catch {
            // Secondary data unavailable — use neutral defaults, no error shown
            lights  = 3;
            traffic = "moderate";
          }
          setDataSource("seoul");
        }
      } else {
        // ── Global path: full Overpass for everything ─────────────────────────
        const overpassResult = await queryOverpass(lat, lng);
        crosswalks = overpassResult.crosswalks;
        lights = overpassResult.streetlightCount;
        traffic = overpassResult.trafficLevel;
        setDataSource("osm");
      }

      // Find nearest crosswalk
      let nearestDist: number | null = null;
      for (const cw of crosswalks) {
        const d = haversine(here, { lat: cw.lat, lng: cw.lng });
        if (nearestDist === null || d < nearestDist) nearestDist = d;
      }

      // Commit to state
      setNearbyCrosswalks(crosswalks);
      setNearestCrosswalkDist(nearestDist !== null ? Math.round(nearestDist) : null);
      setStreetlightCount(lights);
      setTrafficLevel(traffic);
      lastFetchLocRef.current = here;
      lastFetchTimeRef.current = Date.now();
      gisLoadedRef.current = true;

      setGisRiskBoost(
        computeBoost(
          nearestDist !== null ? Math.round(nearestDist) : null,
          lights,
          traffic,
          slopeRef.current,   // ← ref instead of state: no slope dependency
          true
        )
      );
    } catch {
      setGisError("GIS unavailable — sensors only");
    } finally {
      setIsLoadingGIS(false);
      isFetchingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // ← stable: fetchGIS never changes, location watcher is never restarted

  // ── Immediate location on startup ──────────────────────────────────────────
  /**
   * fetchInitialLocation — called once as soon as permission is confirmed.
   * Uses getCurrentPositionAsync (one-shot) to get a position immediately
   * without waiting for the watcher to fire (which requires physical movement
   * or a 5 s timeout).  This ensures GIS data appears within seconds of
   * opening the app, not after the user has walked 10 m.
   */
  const fetchInitialLocation = useCallback(async () => {
    if (Platform.OS === "web") return;  // Location API not available in web build
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude: lat, longitude: lng, altitude, heading } = loc.coords;
      setUserLocation({ lat, lng, altitude, heading: heading ?? null });
      fetchGIS(lat, lng);  // Kick off the first Overpass query
    } catch {
      // Will fall back to the watcher's first callback
    }
  }, [fetchGIS]);

  // ── Location watcher ───────────────────────────────────────────────────────
  /**
   * startLocationWatch — subscribes to ongoing GPS updates.
   *
   * Settings:
   *   accuracy: Balanced — good enough for 30 m crosswalk detection,
   *             conserves battery vs. BestForNavigation
   *   distanceInterval: 10 — fires at minimum every 10 m of movement
   *   timeInterval: 5000 — also fires every 5 s when stationary
   *
   * On each update:
   *   1. Computes slope from altitude delta
   *   2. Updates userLocation state and userLocationRef (for timer reads)
   *   3. If moved >50 m from last Overpass fetch OR >2 min have elapsed,
   *      re-queries OSM data
   */
  const startLocationWatch = useCallback(async () => {
    if (Platform.OS === "web") return;
    if (locationSubRef.current) return;  // Already watching

    fetchInitialLocation();  // Get first fix immediately (don't wait for watcher)

    let prevLoc: (LatLng & { altitude: number | null }) | null = null;

    locationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 10,
        timeInterval: 5000,
      },
      (loc) => {
        const { latitude: lat, longitude: lng, altitude, heading } = loc.coords;
        const distFromPrev = prevLoc ? haversine(prevLoc, { lat, lng }) : 0;

        updateSlope(altitude, distFromPrev);
        const locObj = { lat, lng, altitude, heading: heading ?? null };
        setUserLocation(locObj);
        userLocationRef.current = locObj;
        prevLoc = { lat, lng, altitude };

        // Re-fetch if moved >50 m OR >2 minutes since last fetch
        const lastFetch = lastFetchLocRef.current;
        const moveDist = lastFetch ? haversine(lastFetch, { lat, lng }) : Infinity;
        const timeSince = Date.now() - lastFetchTimeRef.current;
        if (moveDist > 50 || timeSince > 120_000) {
          fetchGIS(lat, lng);
        }
      }
    );

    // Periodic timer: re-fetch every 2 minutes even if user is stationary.
    // Useful for testing in one location and for bus/tram passengers.
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const loc = userLocationRef.current;
      if (!loc || isFetchingRef.current) return;
      const timeSince = Date.now() - lastFetchTimeRef.current;
      if (timeSince > 119_000) { // ≈ 2 min
        fetchGIS(loc.lat, loc.lng);
      }
    }, 30_000); // Check every 30 s, fetch only when 2 min window passes
  }, [fetchGIS, fetchInitialLocation]);

  /** Removes the location subscription and periodic timer (called on unmount) */
  const stopLocationWatch = useCallback(() => {
    locationSubRef.current?.remove();
    locationSubRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ── Permission flow ────────────────────────────────────────────────────────
  /**
   * requestPermission — called from GISInfoCard's "Enable Location" button.
   * Shows the OS location permission dialog, then starts the watcher if granted.
   */
  const requestPermission = useCallback(async () => {
    if (Platform.OS === "web") return;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === "granted") {
      setPermissionStatus("granted");
      await startLocationWatch();
    } else {
      setPermissionStatus("denied");
    }
  }, [startLocationWatch]);

  // ── Startup effect ─────────────────────────────────────────────────────────
  /**
   * On mount: check if permission was already granted (e.g. from a previous
   * session).  If yes, start the watcher immediately without showing a dialog.
   * On web, location APIs are not used (sensors run in simulation mode).
   */
  useEffect(() => {
    if (Platform.OS === "web") {
      setPermissionStatus("denied");  // Web shows "Enable Location" placeholder
      return;
    }
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === "granted") {
        setPermissionStatus("granted");
        await startLocationWatch();
      } else {
        setPermissionStatus(status === "denied" ? "denied" : "unknown");
      }
    })();
    return () => stopLocationWatch();  // Cleanup on unmount
  }, [startLocationWatch, stopLocationWatch]);

  // ── Slope-only boost update ────────────────────────────────────────────────
  /**
   * When slope changes, keep slopeRef in sync and recalculate the boost.
   * slopeRef lets fetchGIS read the latest slope WITHOUT depending on the
   * slope state variable — breaking the slope → fetchGIS → startLocationWatch
   * → useEffect cascade that was restarting the GPS watcher on every step.
   */
  useEffect(() => {
    slopeRef.current = slope;
    if (gisLoadedRef.current) {
      setGisRiskBoost(
        computeBoost(nearestCrosswalkDist, streetlightCount, trafficLevel, slope, true)
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slope, nearestCrosswalkDist, streetlightCount, trafficLevel]);

  // ── Manual refresh ─────────────────────────────────────────────────────────
  /** Called from the refresh button in GISInfoCard and NativeMapView. */
  const refreshGIS = useCallback(() => {
    if (userLocation) {
      lastFetchLocRef.current = null;   // Reset distance threshold
      lastFetchTimeRef.current = 0;     // Reset time threshold
      fetchGIS(userLocation.lat, userLocation.lng);
    }
  }, [userLocation, fetchGIS]);

  return (
    <GISContext.Provider
      value={{
        userLocation,
        nearbyCrosswalks,
        nearestCrosswalkDist,
        streetlightCount,
        trafficLevel,
        slope,
        gisRiskBoost,
        dataSource,
        permissionStatus,
        isLoadingGIS,
        gisError,
        requestPermission,
        refreshGIS,
      }}
    >
      {children}
    </GISContext.Provider>
  );
}

/**
 * useGIS — hook to access GIS state from any child of GISProvider.
 * Throws a clear error if used outside the provider tree.
 */
export function useGIS(): GISState {
  const ctx = useContext(GISContext);
  if (!ctx) throw new Error("useGIS must be used within GISProvider");
  return ctx;
}
