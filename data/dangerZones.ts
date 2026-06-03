export type DangerKind = "crosswalk" | "stairs" | "intersection" | "construction" | "bikepath";

export type DangerZone = {
  id: string;
  name: string;
  kind: DangerKind;
  lat: number;
  lng: number;
  radius: number;
  severity: 1 | 2 | 3;
  note: string;
};

export const DANGER_ZONES: DangerZone[] = [
  {
    id: "z1",
    name: "광화문 교차로",
    kind: "intersection",
    lat: 37.5720,
    lng: 126.9769,
    radius: 60,
    severity: 3,
    note: "8차선 대형 교차로 · 우회전 차량 다수",
  },
  {
    id: "z2",
    name: "시청역 5번 출구 계단",
    kind: "stairs",
    lat: 37.5658,
    lng: 126.9772,
    radius: 25,
    severity: 2,
    note: "하행 계단 · 우측 통행",
  },
  {
    id: "z3",
    name: "을지로입구역 횡단보도",
    kind: "crosswalk",
    lat: 37.5664,
    lng: 126.9826,
    radius: 35,
    severity: 3,
    note: "신호 짧음 · 좌회전 차량 주의",
  },
  {
    id: "z4",
    name: "청계천 자전거 도로",
    kind: "bikepath",
    lat: 37.5696,
    lng: 126.9786,
    radius: 40,
    severity: 2,
    note: "보행로와 자전거 도로 혼재",
  },
  {
    id: "z5",
    name: "종각역 공사 구간",
    kind: "construction",
    lat: 37.5703,
    lng: 126.9826,
    radius: 30,
    severity: 2,
    note: "보도 일부 통제 · 임시 우회",
  },
  {
    id: "z6",
    name: "광화문역 D 출구",
    kind: "stairs",
    lat: 37.5715,
    lng: 126.9760,
    radius: 22,
    severity: 1,
    note: "지하 계단 · 미끄럼 주의",
  },
  {
    id: "z7",
    name: "세종대로 사거리",
    kind: "intersection",
    lat: 37.5697,
    lng: 126.9775,
    radius: 55,
    severity: 3,
    note: "다방향 차량 진입",
  },
  {
    id: "z8",
    name: "무교동 횡단보도",
    kind: "crosswalk",
    lat: 37.5672,
    lng: 126.9787,
    radius: 28,
    severity: 1,
    note: "단신호 횡단보도",
  },
];

export const DANGER_LABELS: Record<DangerKind, string> = {
  crosswalk: "횡단보도",
  stairs: "계단",
  intersection: "교차로",
  construction: "공사 구간",
  bikepath: "자전거 도로",
};

export const DANGER_ICON: Record<DangerKind, string> = {
  crosswalk: "git-commit",
  stairs: "bar-chart-2",
  intersection: "alert-octagon",
  construction: "tool",
  bikepath: "navigation",
};

// Simulated "smombie center" — Seoul City Hall vicinity, used as default map center
// and to seed the simulated walking path for the demo.
export const SEOUL_CENTER = { lat: 37.5665, lng: 126.978 };
