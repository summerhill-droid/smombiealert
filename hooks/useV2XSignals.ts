import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchSignals,
  fetchSignalsByIds,
  getIntersections,
  haversine,
  DIR_BEARING,
  type Signal,
  type Phase,
} from "@/services/seoulSignals";

export type DirSignalOut = { bearing: number; phase: Phase; remainingSec?: number; statNm?: string };
export type V2XMarker = {
  itstId: string;
  lat: number;
  lng: number;
  color: "green" | "red" | "grey";
  remainingSec?: number;
  name?: string;
  dirs: DirSignalOut[];
};

function phaseToColor(p: Phase): "green" | "red" | "grey" {
  return p === "green" ? "green" : p === "red" ? "red" : "grey";
}

// 내 위치 기준 이 반경(m) 안의 교차로만 신호를 호출한다.
// 너무 크면 호출 대상이 많아져 한도를 빨리 쓰므로 1km 로 둔다.
const NEARBY_RADIUS_M = 1000;
// 한 번에 호출할 교차로 최대 개수(URL 길이/한도 보호).
const MAX_NEARBY = 5;

/**
 * 실전용: 내 위치(origin) 주변 교차로의 V2X 신호만 자동 호출·표시.
 * - 검색/선택 UI 없음. GPS 가 움직이면 주변 교차로가 자동으로 바뀐다.
 * - origin 을 ~100m 격자로 반올림해 쿼리키를 안정화(미세 이동마다 재호출 방지).
 */
export function useV2XSignals(origin?: { lat: number; lng: number }): V2XMarker[] {
  const intersections = useMemo(() => getIntersections(), []);

  // 위치를 소수점 3자리(~110m)로 반올림 → 쿼리키 안정화.
  const gx = origin ? Math.round(origin.lat * 1000) : 0;
  const gy = origin ? Math.round(origin.lng * 1000) : 0;

  // 주변 반경 안의 교차로 itstId (가까운 순, 최대 MAX_NEARBY 개).
  const nearbyIds = useMemo(() => {
    if (!origin) return [];
    const withDist = intersections
      .map((i) => ({
        id: i.itstId,
        d: haversine(origin, { lat: i.lat, lng: i.lng }),
      }))
      .filter((x) => x.d <= NEARBY_RADIUS_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_NEARBY);
    return withDist.map((x) => x.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intersections, gx, gy]);
  console.log("[V2X] origin=", origin, "nearby=", nearbyIds.length, nearbyIds);
  
  

  const q = useQuery({
    queryKey: ["seoul", "signals", "byIds", nearbyIds.join(",")],  // 주변 ID 바뀌면 재호출
    queryFn: () => fetchSignalsByIds(nearbyIds),                    // 주변 20개만 호출
    enabled: nearbyIds.length > 0,
    refetchInterval: 10000,
    staleTime: 9000,
    retry: 0,
    refetchOnWindowFocus: false,
  });

  return useMemo<V2XMarker[]>(() => {
    if (!nearbyIds.length) return [];
    const byId = new Map<string, Signal>();
    for (const s of q.data ?? []) byId.set(s.itstId, s);

    const wanted = new Set(nearbyIds);
    const seen = new Set<string>();
    const out: V2XMarker[] = [];
    for (const i of intersections) {
      if (!wanted.has(i.itstId) || seen.has(i.itstId)) continue;
      seen.add(i.itstId);
      const sig = byId.get(i.itstId);
      const dirs: DirSignalOut[] = [];
      if (sig?.dirs?.length) {
        for (const d of sig.dirs) {
          const bearing = DIR_BEARING[d.dir];
          if (bearing === undefined) continue;
          dirs.push({ bearing, phase: d.phase, remainingSec: d.remainingSec, statNm: d.label });
        }
      }
      out.push({
        itstId: i.itstId,
        lat: i.lat,
        lng: i.lng,
        color: sig ? phaseToColor(sig.phase) : "grey",
        remainingSec: sig?.remainingSec,
        name: i.name,
        dirs,
      });
    }
    return out;
  }, [intersections, nearbyIds, q.data]);
}