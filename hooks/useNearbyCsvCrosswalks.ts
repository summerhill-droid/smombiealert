import { useEffect, useMemo, useState } from "react";

// 빌드 스크립트(`scripts/src/buildCrosswalks.ts`)가 생성하는 컴팩트 튜플:
// [id, gu, address, intersection, lat, lng]
import CROSSWALKS_RAW from "@/assets/crosswalks.json";

export type CsvCrosswalk = {
  id: string;
  gu: string;
  address: string;
  intersection: string;
  lat: number;
  lng: number;
};

export type NearbyCsvCrosswalk = CsvCrosswalk & { distance: number };

type Tuple = [string, string, string, string, number, number];

/** 모듈 로드시 1회만 객체화 — 39k행이라도 한 번만 비용 지불. */
const CROSSWALKS: CsvCrosswalk[] = (CROSSWALKS_RAW as Tuple[]).map(
  ([id, gu, address, intersection, lat, lng]) => ({
    id,
    gu,
    address,
    intersection,
    lat,
    lng,
  }),
);

export const ALL_CROSSWALKS = CROSSWALKS;

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * radiusM === null  → 전체 39k개를 거리 계산 후 정렬해 반환.
 * radiusM === 숫자  → 위도-보정 bbox 프리필터 → haversine → radius 이내 + 정렬.
 *
 * 전체 모드는 한 번 호출당 39k × haversine ≈ 수십ms. FlatList 가상화 덕에
 * 렌더 비용은 화면에 보이는 행 수에만 비례.
 */
export function findNearbyCsv(
  origin: { lat: number; lng: number },
  radiusM: number | null = 500,
): NearbyCsvCrosswalk[] {
  if (radiusM === null) {
    const all: NearbyCsvCrosswalk[] = new Array(CROSSWALKS.length);
    for (let i = 0; i < CROSSWALKS.length; i++) {
      const c = CROSSWALKS[i];
      all[i] = { ...c, distance: haversineMeters(origin.lat, origin.lng, c.lat, c.lng) };
    }
    all.sort((a, b) => a.distance - b.distance);
    return all;
  }

  // 위도 1° ≈ 111km, 경도 1° ≈ 111km × cos(lat).
  // 서울(~37°N) 에서 0.005° lng ≈ 444m 밖에 안되므로 반드시 cos(lat) 보정.
  // 부동소수 오차 대비 +5% safety margin.
  const dLatDeg = (radiusM * 1.05) / 111_000;
  const dLngDeg =
    (radiusM * 1.05) /
    (111_000 * Math.max(Math.cos((origin.lat * Math.PI) / 180), 0.01));
  const loLat = origin.lat - dLatDeg;
  const hiLat = origin.lat + dLatDeg;
  const loLng = origin.lng - dLngDeg;
  const hiLng = origin.lng + dLngDeg;

  const out: NearbyCsvCrosswalk[] = [];
  for (const c of CROSSWALKS) {
    if (c.lat < loLat || c.lat > hiLat || c.lng < loLng || c.lng > hiLng) continue;
    const d = haversineMeters(origin.lat, origin.lng, c.lat, c.lng);
    if (d <= radiusM) out.push({ ...c, distance: d });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/**
 * 사용자 위치가 바뀔 때마다 + (옵션) refreshMs 간격으로 재계산.
 * radiusM=null 이면 전체 39k 거리 정렬 결과 반환.
 */
export function useNearbyCsvCrosswalks(
  origin: { lat: number; lng: number } | null,
  radiusM: number | null = 500,
  refreshMs = 10_000,
): NearbyCsvCrosswalk[] {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (refreshMs <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);

  return useMemo(() => {
    if (!origin) return [];
    return findNearbyCsv(origin, radiusM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.lat, origin?.lng, radiusM, tick]);
}
