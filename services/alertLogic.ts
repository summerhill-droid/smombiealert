export type AlertLevel = "OFF" | "주의" | "경고" | "위험";

export type DistanceZone = "far" | "approach" | "near" | "unknown";

/**
 * Baseline = 주머니 보행 / 일반 보행 기준 상태
 * Still은 현재 ML API에는 없을 수 있지만,
 * 알림로직상 OFF 처리를 위해 타입에 포함해둔다.
 */
export type Behavior =
  | "Still"
  | "Baseline"
  | "Navigation"
  | "Watching"
  | "Typing";

export type SmartAlertResult = {
  level: AlertLevel;
  title: string;
  message: string;
  reason: string;

  distanceZone: DistanceZone;
  distanceM?: number;

  behavior: Behavior;

  /**
   * V2X 원본 신호값 또는 앱 내부 변환값
   * 예:
   * protected-movement-allowed
   * permissive-movement-allowed
   * protected-clearance
   * permissive-clearance
   * stop-and-remain
   * dark
   * unknown
   */
  signalState?: string | null;
  remainingSec?: number;

  crosswalkName?: string;
  intersectionName?: string;

  headingError?: number;
  crosswalkSelectionReason?: "heading" | "nearest";
  angleError?: number;

  behaviorApiSource?: "mock-api" | "real-api" | "fallback";
  behaviorApiLoading?: boolean;
  behaviorApiError?: string;

  sensorWindowReady?: boolean;
  sensorWindowSampleCount?: number;
};

type SignalKind =
  | "protected-movement-allowed"
  | "permissive-movement-allowed"
  | "protected-clearance"
  | "permissive-clearance"
  | "stop-and-remain"
  | "dark"
  | "unknown";

function getDistanceZone(distanceM?: number): DistanceZone {
  if (distanceM == null || !Number.isFinite(distanceM)) {
    return "unknown";
  }

  if (distanceM <= 10) return "near";
  if (distanceM <= 30) return "approach";
  return "far";
}

/**
 * V2X 원본값을 메시지 선택용 신호 상태로 정리한다.
 * 여기서는 알림 단계를 바꾸지 않고, 메시지 문구만 결정한다.
 */
function normalizeSignalKind(signalState?: string | null): SignalKind {
  if (!signalState) return "unknown";

  const raw = String(signalState).trim().toLowerCase();

  if (
    raw.includes("protected-movement-allowed") ||
    raw.includes("protected-to-allowed") ||
    raw.includes("protected-movement")
  ) {
    return "protected-movement-allowed";
  }

  if (
    raw.includes("permissive-movement-allowed") ||
    raw.includes("permissive-movement")
  ) {
    return "permissive-movement-allowed";
  }

  if (raw.includes("protected-clearance")) {
    return "protected-clearance";
  }

  if (raw.includes("permissive-clearance")) {
    return "permissive-clearance";
  }

  if (
    raw.includes("stop-and-remain") ||
    raw.includes("stop-and-remain") ||
    raw.includes("stop-and-remain") ||
    raw === "red"
  ) {
    return "stop-and-remain";
  }

  if (raw.includes("dark")) {
    return "dark";
  }

  /**
   * 혹시 다른 코드에서 단순 green/yellow로 들어올 경우를 대비
   */
  if (raw === "green") {
    return "protected-movement-allowed";
  }

  if (raw === "yellow") {
    return "protected-clearance";
  }

  if (raw.includes("unknown")) {
    return "unknown";
  }

  return "unknown";
}

/**
 * 알림 단계 결정
 *
 * 핵심:
 * V2X 신호는 단계 결정에 사용하지 않는다.
 * 단계는 오직 거리구간 + 행동분류값으로 결정한다.
 */
function getAlertLevel(input: {
  distanceZone: DistanceZone;
  behavior: Behavior;
}): AlertLevel {
  const { distanceZone, behavior } = input;

  if (distanceZone === "far" || distanceZone === "unknown") {
    return "OFF";
  }

  if (behavior === "Still" || behavior === "Baseline") {
    return "OFF";
  }

  if (distanceZone === "approach") {
    if (behavior === "Navigation") return "주의";
    if (behavior === "Typing" || behavior === "Watching") return "경고";
  }

  if (distanceZone === "near") {
    if (behavior === "Navigation") return "경고";
    if (behavior === "Typing" || behavior === "Watching") return "위험";
  }

  return "OFF";
}

function getAlertTitle(level: AlertLevel): string {
  switch (level) {
    case "주의":
      return "주의 알림";
    case "경고":
      return "경고 알림";
    case "위험":
      return "위험 알림";
    case "OFF":
    default:
      return "알림 없음";
  }
}

/**
 * V2X 신호별 메시지 로직
 *
 * 주의 / 경고 / 위험 단계는 행동 × 거리로 정해진 상태이고,
 * 여기서는 V2X 신호 상태에 따라 메시지만 바꾼다.
 */
function getAlertMessage(level: AlertLevel, signalKind: SignalKind): string {
  if (level === "OFF") {
    return "현재 위험 알림 없음";
  }

  const messages: Record<
    SignalKind,
    {
      주의: string;
      경고: string;
      위험: string;
    }
  > = {
    "protected-movement-allowed": {
      주의: "전방 횡단보도입니다. 전방을 주시하세요.",
      경고: "횡단보도입니다. 스마트폰을 내리고 전방을 주시하세요.",
      위험: "횡단 중 스마트폰 사용 감지! 즉시 폰을 내리고 전방을 보세요.",
    },

    "permissive-movement-allowed": {
      주의: "전방 횡단보도입니다. 우회전 차량에 주의하세요.",
      경고: "횡단보도! 우회전 차량 위험, 스마트폰을 내려주세요.",
      위험: "우회전 차량 위험! 즉시 폰을 내리세요.",
    },

    "protected-clearance": {
      주의: "신호가 곧 바뀝니다. 전방을 주시하세요.",
      경고: "신호 종료 중! 스마트폰을 내리고 멈추세요.",
      위험: "신호 종료! 즉시 폰을 내리고 멈추세요.",
    },

    "permissive-clearance": {
      주의: "신호가 곧 바뀝니다. 우회전 차량에 주의하세요.",
      경고: "신호 종료, 우회전 차량 위험! 스마트폰을 내려주세요.",
      위험: "신호 종료, 우회전 위험! 즉시 폰을 내리세요.",
    },

    "stop-and-remain": {
      주의: "빨간불입니다. 전방을 주시하세요.",
      경고: "빨간불! 스마트폰을 내리고 멈추세요.",
      위험: "빨간불! 즉시 멈추고 폰을 내리세요.",
    },

    dark: {
      주의: "신호 없는 횡단보도입니다. 전방을 주시하세요.",
      경고: "신호 없는 횡단보도입니다. 스마트폰을 내려주세요.",
      위험: "신호 없는 횡단보도 진입! 즉시 폰을 내리세요.",
    },

    unknown: {
      주의: "신호를 확인할 수 없습니다. 전방을 주시하세요.",
      경고: "신호를 확인할 수 없습니다. 스마트폰을 내려주세요.",
      위험: "신호를 확인할 수 없습니다. 즉시 폰을 내리세요!",
    },
  };

  return messages[signalKind][level];
}

/**
 * AlertOverlay, StatusHeader에서 사용하는 행동 라벨
 */
export function getBehaviorLabelKo(behavior: Behavior): string {
  switch (behavior) {
    case "Still":
      return "정지";
    case "Baseline":
      return "일반 보행";
    case "Navigation":
      return "지도 사용";
    case "Watching":
      return "영상 시청";
    case "Typing":
      return "타이핑";
    default:
      return behavior;
  }
}

function getDistanceZoneLabelKo(distanceZone: DistanceZone): string {
  switch (distanceZone) {
    case "far":
      return "30m 밖";
    case "approach":
      return "10~30m";
    case "near":
      return "10m 이내";
    case "unknown":
    default:
      return "거리 확인 중";
  }
}

function getSignalKindLabelKo(signalKind: SignalKind): string {
  switch (signalKind) {
    case "protected-movement-allowed":
      return "보행 가능 신호";
    case "permissive-movement-allowed":
      return "보행 가능, 우회전 차량 주의";
    case "protected-clearance":
      return "신호 종료 중";
    case "permissive-clearance":
      return "신호 종료 중, 우회전 차량 주의";
    case "stop-and-remain":
      return "적색 신호";
    case "dark":
      return "신호 없는 횡단보도";
    case "unknown":
    default:
      return "신호 확인 불가";
  }
}

/**
 * AlertOverlay에서 사용하는 V2X 신호 라벨
 */
export function getSignalLabelKo(signalState?: string | null): string {
  const signalKind = normalizeSignalKind(signalState);

  switch (signalKind) {
    case "protected-movement-allowed":
      return "보행 가능 신호";
    case "permissive-movement-allowed":
      return "우회전 차량 주의";
    case "protected-clearance":
      return "신호 종료 중";
    case "permissive-clearance":
      return "신호 종료, 우회전 주의";
    case "stop-and-remain":
      return "적색 신호";
    case "dark":
      return "신호 없음";
    case "unknown":
    default:
      return "신호 확인 불가";
  }
}

function getAlertReason(input: {
  level: AlertLevel;
  distanceZone: DistanceZone;
  behavior: Behavior;
  signalKind: SignalKind;
  distanceM?: number;
}): string {
  const distanceLabel = getDistanceZoneLabelKo(input.distanceZone);
  const behaviorLabel = getBehaviorLabelKo(input.behavior);
  const signalLabel = getSignalKindLabelKo(input.signalKind);

  const distanceText =
    input.distanceM != null && Number.isFinite(input.distanceM)
      ? `${Math.round(input.distanceM)}m`
      : "거리 확인 중";

  if (input.level === "OFF") {
    if (input.distanceZone === "far") {
      return `현재 횡단보도와의 거리가 ${distanceText}로 30m 밖이므로 알림을 표시하지 않음.`;
    }

    if (input.behavior === "Still" || input.behavior === "Baseline") {
      return `현재 행동이 ${behaviorLabel}으로 분류되어 스마트폰 몰입 보행으로 판단하지 않음.`;
    }

    return "현재 조건은 알림 기준에 해당하지 않음.";
  }

  return `거리구간은 ${distanceLabel}, 행동은 ${behaviorLabel}으로 판단되어 ${input.level} 단계로 분류됨. V2X 신호는 ${signalLabel}로 메시지에 반영됨.`;
}

export function buildSmartAlert(input: {
  distanceM?: number;
  behavior: Behavior;
  signalState?: string | null;
  remainingSec?: number;

  crosswalkName?: string;
  intersectionName?: string;

  headingError?: number;
  crosswalkSelectionReason?: "heading" | "nearest";
  angleError?: number;

  behaviorApiSource?: "mock-api" | "real-api" | "fallback";
  behaviorApiLoading?: boolean;
  behaviorApiError?: string;

  sensorWindowReady?: boolean;
  sensorWindowSampleCount?: number;
}): SmartAlertResult {
  const distanceZone = getDistanceZone(input.distanceM);
  const signalKind = normalizeSignalKind(input.signalState);

  const level = getAlertLevel({
    distanceZone,
    behavior: input.behavior,
  });

  const title = getAlertTitle(level);
  const message = getAlertMessage(level, signalKind);

  const reason = getAlertReason({
    level,
    distanceZone,
    behavior: input.behavior,
    signalKind,
    distanceM: input.distanceM,
  });

  return {
    level,
    title,
    message,
    reason,

    distanceZone,
    distanceM: input.distanceM,

    behavior: input.behavior,

    signalState: input.signalState ?? signalKind,
    remainingSec: input.remainingSec,

    crosswalkName: input.crosswalkName,
    intersectionName: input.intersectionName,

    headingError: input.headingError,
    crosswalkSelectionReason: input.crosswalkSelectionReason,
    angleError: input.angleError,

    behaviorApiSource: input.behaviorApiSource,
    behaviorApiLoading: input.behaviorApiLoading,
    behaviorApiError: input.behaviorApiError,

    sensorWindowReady: input.sensorWindowReady,
    sensorWindowSampleCount: input.sensorWindowSampleCount,
  };
}