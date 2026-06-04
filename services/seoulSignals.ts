import INTERSECTIONS_RAW from "@/assets/intersections.json";

const BASE = "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi";
// API 키 목록 — 1순위부터 쓰다가 한도(429) 소진되면 다음 키로 자동 전환.
const API_KEYS = [
  "8408a984-5a57-40a2-9193-38c8873c040d", // ① (로그에서 확인된 키 — 네 거 맞으면 그대로)
  "fc852b2e-4d4d-49c9-8b39-b806e977603f", // ②
  "f4fea5ed-5868-4c6f-96e9-f5bfd3aa5410",                 // ③ ← 네가 추가한 키로 교체
  "4da2f70f-1a9e-4158-a545-9a35a386df38",                 // ④ ← 네가 추가한 키로 교체
];

// key를 인자로 받게 변경
function buildSignalUrl(key: string, extra = ""): string {
  return `${BASE}/v2xSignalPhaseTimingFusionInformation/1.0?apikey=${key}&numOfRows=1000${extra}`;
}

// SIGNAL_URL도 시그니처 맞춰서
export const SIGNAL_URL = buildSignalUrl(API_KEYS[0]);

// 마지막으로 살아있던 키 인덱스. 죽은 키(429)를 매 호출마다 다시 때리지 않도록 기억한다.
// 한 번 한도 소진되면 그 세션 동안 다음 키부터 시작 → 헛호출(429 왕복) 제거.
let keyStart = 0;

async function fetchSignalJson(extra = ""): Promise<unknown> {
  let lastErr: unknown;
  for (let n = 0; n < API_KEYS.length; n++) {
    const i = (keyStart + n) % API_KEYS.length;       // 살아있는 키부터 순회
    console.log(`[V2X] 키#${i} 시도 (총 ${API_KEYS.length}개)`);
    const res = await fetch(buildSignalUrl(API_KEYS[i], extra), {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    console.log(`[V2X] 키#${i} status=${res.status} len=${text.length} head=${text.slice(0, 150)}`);
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* 비-JSON */ }

    const limited = res.status === 429 || (json && json.responseCode === 429);
    if (limited) {
      console.warn(`[V2X] 키#${i} 한도 초과 → 다음 키로 전환`);
      lastErr = new Error("rate limit exceeded");
      continue;                                       // 다음 키로 (keyStart는 루프 중 변경 금지!)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    if (json == null) throw new Error("응답을 JSON으로 해석할 수 없습니다");
    keyStart = i;                                     // 이 키 살아있음 → 다음부터 여기서 시작
    console.log(`[V2X] 사용 키#${i}=${API_KEYS[i].slice(0, 8)} 응답 ${text.length}바이트`);
    return json;
  }
  throw lastErr ?? new Error("모든 API 키 한도 소진");
}


export type Intersection = {
  itstId: string;
  lat: number;
  lng: number;
  name?: string;
  raw: Record<string, unknown>;
};

// 교차로 위치는 더 이상 API 에서 받지 않는다 — 로컬 xlsx → JSON 빌드 산출물에서 로드.
// 튜플 포맷: [itstId, name, lat, lng] (scripts/src/buildIntersections.ts 참고).
type IntersectionTuple = [string, string, number, number];
const INTERSECTIONS: Intersection[] = (
  INTERSECTIONS_RAW as IntersectionTuple[]
).map(([itstId, name, lat, lng]) => ({
  itstId,
  name: name || undefined,
  lat,
  lng,
  raw: {},
}));

export type Phase = "red" | "green" | "yellow" | "unknown";

// 한 방위(예: 'nt')의 보행 신호.
export type DirSignal = {
  dir: string; // 'nt' | 'ne' | 'et' | ... (8방위 코드)
  phase: Phase;
  remainingSec?: number;
  label?: string;
};

export type Signal = {
  itstId: string;
  phase: Phase; // 대표 phase (하위호환용 — 8방위 중 우선순위 1개)
  phaseLabel?: string;
  remainingSec?: number;
  // 방위별 신호 전체. 횡단보도가 자기 방위에 맞는 신호를 골라 쓰기 위함.
  dirs: DirSignal[];
  raw: Record<string, unknown>;
};

export type MergedCrosswalk = Intersection & {
  signal?: Signal;
  distance: number;
};

// ────────────────────────────────────────────────────────────────────────────
// Geo helpers
// ────────────────────────────────────────────────────────────────────────────

export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ────────────────────────────────────────────────────────────────────────────
// Flexible parsers (Seoul T-Data response shapes vary across endpoints)
// ────────────────────────────────────────────────────────────────────────────

function pickStr(
  r: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.length) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function pickNum(
  r: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

// Walk the JSON tree and pull out every plain object that looks like a
// signal record (contains an itstId-shaped field). Some Seoul endpoints wrap
// data several levels deep (header/body/items, response/result/rows, etc) and
// arrays may be heterogeneous, so we test each element individually.
function hasItstId(r: Record<string, unknown>): boolean {
  return "itstId" in r || "ITST_ID" in r || "itst_id" in r;
}

function findRecords(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const stack: unknown[] = [data];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
    } else {
      const r = v as Record<string, unknown>;
      if (hasItstId(r)) out.push(r);
      for (const x of Object.values(r)) stack.push(x);
    }
  }
  return out;
}

// 서울 V2X SPaT 응답의 표준 상태명 → phase.
const STAT_TO_PHASE: Record<string, Phase> = {
  "protected-movement-allowed": "green",
  "permissive-movement-allowed": "green",
  "protected-clearance": "yellow",
  "permissive-clearance": "yellow",
  "stop-and-remain": "red",
  "stop-then-proceed": "yellow",
  dark: "unknown",
};

function classifyPhase(label?: string, raw?: string): Phase {
  const s = `${label ?? ""} ${raw ?? ""}`.toLowerCase().trim();
  if (!s) return "unknown";
  // 정확 매칭 우선
  for (const key of Object.keys(STAT_TO_PHASE)) {
    if (s.includes(key)) return STAT_TO_PHASE[key];
  }
  // 사용자 사양: 보행/allowed/walk → green, 정지/stop/wait → red
  if (
    s.includes("보행") ||
    s.includes("allowed") ||
    s.includes("walk") ||
    s.includes("녹") ||
    /\bgreen|^g\b|^2\b|^go\b/.test(s)
  ) {
    return "green";
  }
  if (
    s.includes("정지") ||
    s.includes("stop") ||
    s.includes("wait") ||
    s.includes("적") ||
    /\bred|^r\b|^1\b/.test(s)
  ) {
    return "red";
  }
  if (
    s.includes("황") ||
    s.includes("yellow") ||
    s.includes("amber") ||
    s.includes("clearance") ||
    /^y\b|^3\b/.test(s)
  ) {
    return "yellow";
  }
  return "unknown";
}

// SPaT Fusion 응답은 8방위 키(<dir>PdsgStatNm / <dir>PdsgRmdrCs)에 보행 신호를 담는다.
const DIR_CODES = ["nt", "ne", "et", "se", "st", "sw", "wt", "nw"] as const;

// 각 방위 코드의 나침반 방위각(북=0°, 동=90°, 남=180°, 서=270°).
// 횡단보도가 교차로 중심 기준 어느 방위에 있는지 계산해 가장 가까운 방위의 신호를 매칭한다.
export const DIR_BEARING: Record<string, number> = {
  nt: 0, // North
  ne: 45, // North-East
  et: 90, // East
  se: 135, // South-East
  st: 180, // South
  sw: 225, // South-West
  wt: 270, // West
  nw: 315, // North-West
};

// phase 우선순위 — 마커 1개로 표시할 때 어떤 방향 신호를 대표로 쓸지 결정.
const PHASE_PRIORITY: Record<Phase, number> = {
  green: 3,
  red: 2,
  yellow: 1,
  unknown: 0,
};

function normalizeSignal(r: Record<string, unknown>): Signal | null {
  const itstId = pickStr(r, "itstId", "ITST_ID", "itst_id");
  if (!itstId) return null;

  // 1) 방위 기반 보행 신호 추출 (실제 응답 스키마).
  //    8방위를 각각 dirs[] 에 보존하고, 그중 우선순위 1개를 대표 phase 로도 둔다.
  const dirs: DirSignal[] = [];
  let best: { phase: Phase; remainingSec?: number; label?: string } | null =
    null;
  for (const code of DIR_CODES) {
    const stat = pickStr(r, `${code}PdsgStatNm`);
    const rmdrDs = pickNum(r, `${code}PdsgRmdrCs`); // deciseconds
    if (!stat && rmdrDs === undefined) continue;
    const phase = classifyPhase(stat);
    let remainingSec =
      rmdrDs !== undefined ? Math.max(0, Math.round(rmdrDs / 10)) : undefined;
    // 비정상 잔여시간 방어: 보행 신호가 300초(5분)를 넘는 경우는
    // 신호가 꺼졌거나(dark) 데이터 오류이므로 시간 표시를 버린다.
    if (remainingSec !== undefined && remainingSec > 300)
      remainingSec = undefined;
    // 방위별 신호 보존 (횡단보도 매칭에 사용).
    dirs.push({ dir: code, phase, remainingSec, label: stat });
    if (
      !best ||
      PHASE_PRIORITY[phase] > PHASE_PRIORITY[best.phase] ||
      (PHASE_PRIORITY[phase] === PHASE_PRIORITY[best.phase] &&
        remainingSec !== undefined &&
        (best.remainingSec === undefined || remainingSec < best.remainingSec))
    ) {
      best = { phase, remainingSec, label: stat };
    }
  }
  if (best) {
    return {
      itstId,
      phase: best.phase,
      phaseLabel: best.label,
      remainingSec: best.remainingSec,
      dirs,
      raw: r,
    };
  }

  // 2) 폴백: 일부 응답이 flat 한 phase/remaining 필드를 쓰는 경우 (방위 없음).
  const remaining = pickNum(
    r,
    "minEndTime",
    "remainingTime",
    "remainTime",
    "phaseRemainingTime",
    "scheduledTime",
    "phsTime",
    "remainSec",
  );
  const phaseLabel = pickStr(
    r,
    "phaseTyNm",
    "phaseNm",
    "signalNm",
    "phaseName",
  );
  const phaseRaw = pickStr(
    r,
    "phaseNo",
    "phase",
    "phaseStatus",
    "currentPhase",
    "phaseTy",
  );
  if (!phaseLabel && !phaseRaw && remaining === undefined) return null;
  return {
    itstId,
    phase: classifyPhase(phaseLabel, phaseRaw),
    phaseLabel,
    remainingSec: remaining,
    dirs: [],
    raw: r,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Fetchers
// ────────────────────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("응답을 JSON으로 해석할 수 없습니다");
  }
}



/**
 * 교차로 위치 목록 — 로컬 xlsx 번들에서 즉시 반환.
 * (예전 v2xCrossroadMapInformation API 호출을 대체)
 */
export function getIntersections(): Intersection[] {
  return INTERSECTIONS;
}

// numOfRows 최대가 1000이라(2000은 404 거부), 페이지를 여러 장 받아 커버 교차로 수를 늘린다.
// (3페이지 = 약 3000행 → 중복 제거 후 더 많은 고유 교차로) — 폴링당 요청이 PAGES배.
const PAGES = 3;

export async function fetchSignals(): Promise<Signal[]> {
  const pages = Array.from({ length: PAGES }, (_, i) => i + 1);
  const perPage = await Promise.all(
    pages.map(async (p) => {
      try {
        const recs = findRecords(await fetchSignalJson(`&pageNo=${p}`));
        return recs.map(normalizeSignal).filter((x): x is Signal => !!x);
      } catch (e) {
        console.warn(`[V2X] pageNo=${p} 실패:`, String(e));
        return [];
      }
    }),
  );
  // itstId 기준 중복 제거 (먼저 본 페이지 우선).
  const byId = new Map<string, Signal>();
  for (const arr of perPage) for (const s of arr) if (!byId.has(s.itstId)) byId.set(s.itstId, s);
  const signals = [...byId.values()];
  console.log(`[V2X] ${PAGES}페이지 → 고유 교차로 ${signals.length}개`);
  return signals;
}

// ────────────────────────────────────────────────────────────────────────────
// Merge + filter
// ────────────────────────────────────────────────────────────────────────────

export function mergeAndFilter(
  intersections: Intersection[],
  signals: Signal[],
  origin: { lat: number; lng: number },
  radiusMeters = 500,
): MergedCrosswalk[] {
  // Dedupe by itstId — keep the most recently seen entry for each id.
  const signalById = new Map<string, Signal>();
  for (const s of signals) signalById.set(s.itstId, s);

  const intersectionById = new Map<string, Intersection>();
  for (const i of intersections) intersectionById.set(i.itstId, i);

  const merged: MergedCrosswalk[] = [];
  for (const i of intersectionById.values()) {
    const distance = haversine(origin, { lat: i.lat, lng: i.lng });
    if (distance > radiusMeters) continue;
    merged.push({ ...i, signal: signalById.get(i.itstId), distance });
  }
  merged.sort((a, b) => a.distance - b.distance);
  return merged;
}

export async function fetchSignalsByIds(ids: string[]): Promise<Signal[]> {
  if (!ids.length) return [];
  // t-data 는 &itstId= 파라미터를 무시하고 항상 전체 피드(약 1000행, ~2.3MB)를 반환한다.
  // (로그에서 단일 ID 호출도 len≈2.3MB, 5개 호출 = 신호 5000개로 확인됨.)
  // 따라서 교차로별 N회 호출은 같은 데이터를 N번 받는 낭비 → 전체 1회만 받고 클라에서 필터한다.
  const all = await fetchSignals();
  const want = new Set(ids);
  const filtered = all.filter((s) => want.has(s.itstId));
  console.log(
    `[V2X] byIds 요청 ${ids.length}개 → 전체 ${all.length}개 중 매칭 ${filtered.length}개 | ids=${ids.join(",")}`,
  );
  return filtered;
}