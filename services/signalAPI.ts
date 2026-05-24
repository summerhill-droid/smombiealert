/**
 * signalAPI.ts — Seoul V2X Real-time Traffic Signal Service
 *
 * TWO ENDPOINTS:
 *   1. v2xSignalPhaseInformation        — phase per direction/type (*StatNm)
 *   2. v2xSignalPhaseTimingInformation  — remaining time per dir/type (*RmdrCs ÷ 10 = sec)
 *
 * We only read the pedestrian (*Pdsg*) fields.
 */

const SEOUL_API_KEY =
  process.env.EXPO_PUBLIC_SEOUL_V2X_API_KEY ??
  "fc852b2e-4d4d-49c9-8b39-b806e977603f";

const BASE = "http://t-data.seoul.go.kr/apig/apiman-gateway/tapi";
const PHASE_URL  = `${BASE}/v2xSignalPhaseInformation/1.0?apikey=${SEOUL_API_KEY}`;
const TIMING_URL = `${BASE}/v2xSignalPhaseTimingInformation/1.0?apikey=${SEOUL_API_KEY}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignalPhase = "red" | "green" | "unknown";

export interface SignalTiming {
  intersectionId: string;
  phase:          SignalPhase;
  remainingSec:   number;
  activeGreenDirs: string[];
  timestamp:      number;
}

interface V2XPhaseItem {
  itstId?: string;
  ntPdsgStatNm?: string | null;
  etPdsgStatNm?: string | null;
  stPdsgStatNm?: string | null;
  wtPdsgStatNm?: string | null;
  [key: string]: unknown;
}

interface V2XTimingItem {
  itstId?: string;
  ntPdsgRmdrCs?: number | null;
  etPdsgRmdrCs?: number | null;
  stPdsgRmdrCs?: number | null;
  wtPdsgRmdrCs?: number | null;
  [key: string]: unknown;
}

const DIR_LABELS: Record<string, string> = {
  nt: "north", et: "east", st: "south", wt: "west",
};
const PDSG_STAT_KEYS = ["ntPdsgStatNm", "etPdsgStatNm", "stPdsgStatNm", "wtPdsgStatNm"] as const;
const PDSG_TIME_KEYS = ["ntPdsgRmdrCs", "etPdsgRmdrCs", "stPdsgRmdrCs", "wtPdsgRmdrCs"] as const;

function isGreen(v: string | null | undefined): boolean {
  return typeof v === "string" && v.toLowerCase().includes("allowed");
}
function isRed(v: string | null | undefined): boolean {
  return typeof v === "string" && v.toLowerCase().includes("stop");
}

function fetchWithTimeout(url: string, ms = 10_000): Promise<Response> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
}

function mergeRecord(
  phaseItem: V2XPhaseItem,
  timingItem: V2XTimingItem | undefined,
): SignalTiming {
  const now    = Date.now();
  const itstId = phaseItem.itstId ?? "";

  const greenDirs: string[] = [];
  let anyRed = false;
  let anyGreen = false;

  for (const key of PDSG_STAT_KEYS) {
    const val = phaseItem[key];
    const dir = key.slice(0, 2);
    if (isGreen(val)) { greenDirs.push(DIR_LABELS[dir] ?? dir); anyGreen = true; }
    if (isRed(val))   { anyRed = true; }
  }

  const phase: SignalPhase = anyGreen ? "green" : anyRed ? "red" : "unknown";

  let remainingSec = 0;
  if (timingItem) {
    const rawVals = PDSG_TIME_KEYS
      .map((k) => timingItem[k])
      .filter((v): v is number => typeof v === "number" && v > 0);
    if (rawVals.length > 0) {
      const raw = phase === "green" ? Math.max(...rawVals) : Math.min(...rawVals);
      remainingSec = Math.round(raw / 10);
    }
  }

  return { intersectionId: itstId, phase, remainingSec, activeGreenDirs: greenDirs, timestamp: now };
}

/**
 * getSignalData — fetches phase + timing and merges them.
 * Returns one SignalTiming per active V2X-equipped intersection in Seoul,
 * sorted green-first, then red, then unknown.
 */
export async function getSignalData(): Promise<SignalTiming[]> {
  try {
    const [phaseRes, timingRes] = await Promise.all([
      fetchWithTimeout(PHASE_URL),
      fetchWithTimeout(TIMING_URL),
    ]);

    if (!phaseRes.ok) throw new Error(`Phase API HTTP ${phaseRes.status}`);

    const phaseItems: V2XPhaseItem[]   = await phaseRes.json();
    const timingItems: V2XTimingItem[] = timingRes.ok ? await timingRes.json() : [];

    const timingMap = new Map<string, V2XTimingItem>();
    for (const t of timingItems) {
      if (t.itstId) timingMap.set(t.itstId, t);
    }

    const results = phaseItems.map((p) =>
      mergeRecord(p, p.itstId ? timingMap.get(p.itstId) : undefined)
    );

    return results.sort((a, b) => {
      const rank = { green: 0, red: 1, unknown: 2 } as const;
      return rank[a.phase] - rank[b.phase];
    });
  } catch (err) {
    console.warn("[signalAPI] getSignalData error:", err);
    return [];
  }
}
