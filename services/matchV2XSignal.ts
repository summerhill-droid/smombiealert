import type { V2XMarker } from "@/hooks/useV2XSignals";
import { haversine } from "@/services/seoulSignals";

export type LatLng = {
  lat: number;
  lng: number;
};

export type CrosswalkLike = LatLng & {
  id?: string;
  address?: string;
  intersection?: string;
  distance?: number;
};

export type MatchedV2XSignal = {
  statNm?: string;
  phase: "red" | "green" | "yellow" | "unknown";
  remainingSec?: number;
  angleError?: number;
  intersectionName?: string;
  itstId?: string;
};

const SIGNAL_MATCH_RADIUS_M = 45;
const MAX_DIRECTION_ERROR_DEG = 45;

export function bearing(from: LatLng, to: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function colorToPhase(
  color?: "green" | "red" | "grey",
): "red" | "green" | "yellow" | "unknown" {
  if (color === "green") return "green";
  if (color === "red") return "red";
  return "unknown";
}

/**
 * 선택된 횡단보도에 대응하는 방향별 V2X 보행신호를 찾는 함수.
 *
 * 흐름:
 * 선택된 횡단보도
 * → 가장 가까운 V2X 교차로 탐색
 * → 교차로 중심에서 횡단보도까지 bearing 계산
 * → V2X 방향별 신호와 각도 차이 비교
 * → 가장 각도 차이가 작은 신호 선택
 * → 방향오차 45도 초과 시 매칭 제외
 */
export function matchV2XSignal(
  crosswalk: CrosswalkLike | undefined,
  v2xSignals: V2XMarker[],
): MatchedV2XSignal | undefined {
  if (!crosswalk || !v2xSignals.length) return undefined;

  let nearestIntersection: V2XMarker | undefined;
  let nearestDistance = Infinity;

  for (const signal of v2xSignals) {
    const d = haversine(
      { lat: crosswalk.lat, lng: crosswalk.lng },
      { lat: signal.lat, lng: signal.lng },
    );

    if (d < nearestDistance) {
      nearestDistance = d;
      nearestIntersection = signal;
    }
  }

  if (!nearestIntersection) return undefined;

  // 너무 먼 교차로 신호는 현재 횡단보도 신호로 보지 않음
  if (nearestDistance > SIGNAL_MATCH_RADIUS_M) {
    return undefined;
  }

  const crosswalkBearing = bearing(
    {
      lat: nearestIntersection.lat,
      lng: nearestIntersection.lng,
    },
    {
      lat: crosswalk.lat,
      lng: crosswalk.lng,
    },
  );

  let bestDir: V2XMarker["dirs"][number] | undefined;
  let bestAngleError = Infinity;

  for (const dir of nearestIntersection.dirs ?? []) {
    const error = angleDiff(crosswalkBearing, dir.bearing);

    if (error < bestAngleError) {
      bestAngleError = error;
      bestDir = dir;
    }
  }

  // 방향별 신호가 있고, 방향오차가 45도 이내이면 방향별 신호 사용
  if (bestDir && bestAngleError <= MAX_DIRECTION_ERROR_DEG) {
    return {
      statNm: bestDir.statNm,
      phase: bestDir.phase,
      remainingSec: bestDir.remainingSec,
      angleError: Math.round(bestAngleError),
      intersectionName: nearestIntersection.name,
      itstId: nearestIntersection.itstId,
    };
  }

  // 방향별 매칭 실패 시 대표 신호를 쓰지 않고 제외
  // 이유: 반대편 횡단보도 신호가 잘못 표시될 수 있기 때문
  return undefined;
}