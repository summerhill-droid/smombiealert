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
 * DATA SOURCE:
 *   OpenStreetMap Overpass API (overpass-api.de + two fallback mirrors)
 *   - No registration or API key needed
 *   - Queries crosswalks within 350 m, streetlamps within 80 m,
 *     road types within 80 m — all in a single batch request
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

// ─── Types ────────────────────────────────────────────────────────────────────

/** A simple lat/lng coordinate pair (used throughout the module) */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A crosswalk node returned by the Overpass API.
 * id = OpenStreetMap node ID (unique identifier)
 */
export interface Crosswalk {
  id: string;
  lat: number;
  lng: number;
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
 * queryOverpass — Fetches crosswalk, streetlight, and road data from OSM.
 *
 * Query breakdown:
 *   node["highway"="crossing"](around:350,...) — crosswalks within 350 m
 *   node["highway"="street_lamp"](around:80,...) — streetlights within 80 m
 *   way["highway"](around:80,...)               — road segments within 80 m
 *
 * Uses `out body` (not `out body geom`) to keep response size small and
 * avoid timeouts. Node elements include lat/lon; way elements include tags.
 *
 * Tries each mirror in sequence; throws only when all three fail.
 */
async function queryOverpass(
  lat: number,
  lng: number
): Promise<{ crosswalks: Crosswalk[]; streetlightCount: number; trafficLevel: TrafficLevel }> {
  const query = `
[out:json][timeout:10];
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
      const res = await fetch(
        mirror + "?data=" + encodeURIComponent(query),
        { signal: AbortSignal.timeout(11_000) }  // 11s > query timeout=10s
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();

      const crosswalks: Crosswalk[] = [];
      let streetlightCount = 0;
      let bestTraffic: TrafficLevel = "none";

      for (const el of json.elements ?? []) {
        if (el.type === "node") {
          const hw = el.tags?.["highway"];
          if (hw === "crossing") {
            // Each crossing node becomes a Crosswalk entry
            crosswalks.push({ id: String(el.id), lat: el.lat, lng: el.lon });
          } else if (hw === "street_lamp") {
            streetlightCount += 1;  // Count lamps within 80 m
          }
        } else if (el.type === "way") {
          const hw = el.tags?.["highway"] as string | undefined;
          if (hw) {
            // Keep only the "worst" (most dangerous) road type found nearby
            const lvl = TRAFFIC_MAP[hw] ?? "light";
            if (trafficRank(lvl) > trafficRank(bestTraffic)) bestTraffic = lvl;
          }
        }
      }

      return { crosswalks, streetlightCount, trafficLevel: bestTraffic };
    } catch (e) {
      lastError = e as Error;
      // Try the next mirror
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
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("unknown");
  const [isLoadingGIS, setIsLoadingGIS] = useState(false);
  const [gisError, setGisError] = useState<string | null>(null);

  // ── Refs (survive re-renders without causing them) ────────────────────────
  /** Last position where we ran a full Overpass query — re-fetch after 100 m */
  const lastFetchLocRef = useRef<LatLng | null>(null);
  /** Sliding window of recent altitude+distance pairs — used to compute slope */
  const altitudeHistoryRef = useRef<Array<{ alt: number; dist: number }>>([]);
  /** Reference to the active Location.watchPositionAsync subscription */
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  /** Prevents two simultaneous Overpass fetches (e.g. on rapid GPS updates) */
  const isFetchingRef = useRef(false);
  /** Becomes true after the first successful Overpass response */
  const gisLoadedRef = useRef(false);

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

  // ── Overpass fetch ─────────────────────────────────────────────────────────
  /**
   * fetchGIS — runs the Overpass query for a given position and updates state.
   * Guarded by isFetchingRef so only one request runs at a time.
   * After success, immediately recomputes the risk boost with fresh data.
   */
  const fetchGIS = useCallback(async (lat: number, lng: number) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoadingGIS(true);
    setGisError(null);

    try {
      const { crosswalks, streetlightCount: lights, trafficLevel: traffic } =
        await queryOverpass(lat, lng);

      // Find the nearest crosswalk using Haversine
      const here: LatLng = { lat, lng };
      let nearestDist: number | null = null;
      for (const cw of crosswalks) {
        const d = haversine(here, { lat: cw.lat, lng: cw.lng });
        if (nearestDist === null || d < nearestDist) nearestDist = d;
      }

      // Persist results in state
      setNearbyCrosswalks(crosswalks);
      setNearestCrosswalkDist(nearestDist !== null ? Math.round(nearestDist) : null);
      setStreetlightCount(lights);
      setTrafficLevel(traffic);
      lastFetchLocRef.current = here;   // Mark fetch location for 100 m threshold
      gisLoadedRef.current = true;       // Unlock boost computation

      // Immediately recalculate risk boost with the fresh data
      setGisRiskBoost(
        computeBoost(
          nearestDist !== null ? Math.round(nearestDist) : null,
          lights,
          traffic,
          slope,
          true
        )
      );
    } catch {
      // All mirrors failed — degrade gracefully, keep old data if any
      setGisError("GIS data unavailable — sensors only");
    } finally {
      setIsLoadingGIS(false);
      isFetchingRef.current = false;
    }
  }, [slope]);

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
   *   2. Updates userLocation state
   *   3. If moved >100 m from last Overpass fetch, re-queries OSM data
   *      (100 m threshold = crosswalk data stays valid for ~100 m of walking)
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
        setUserLocation({ lat, lng, altitude, heading: heading ?? null });
        prevLoc = { lat, lng, altitude };

        // Re-fetch Overpass data when user has walked >100 m since last query
        const lastFetch = lastFetchLocRef.current;
        const moveDist = lastFetch ? haversine(lastFetch, { lat, lng }) : Infinity;
        if (moveDist > 100) {
          fetchGIS(lat, lng);
        }
      }
    );
  }, [fetchGIS, fetchInitialLocation]);

  /** Removes the location subscription (called when component unmounts) */
  const stopLocationWatch = useCallback(() => {
    locationSubRef.current?.remove();
    locationSubRef.current = null;
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
   * When slope changes (GPS altitude delta), recalculate the boost.
   * Other factors are recalculated directly inside fetchGIS after a new query.
   * We only need this effect for slope since slope changes without a new fetch.
   */
  useEffect(() => {
    if (gisLoadedRef.current) {
      setGisRiskBoost(
        computeBoost(nearestCrosswalkDist, streetlightCount, trafficLevel, slope, true)
      );
    }
  }, [slope]);

  // ── Manual refresh ─────────────────────────────────────────────────────────
  /** Called from the refresh button in GISInfoCard and NativeMapView. */
  const refreshGIS = useCallback(() => {
    if (userLocation) {
      lastFetchLocRef.current = null;  // Reset threshold — forces re-fetch
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
