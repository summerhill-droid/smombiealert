import { useEffect, useMemo, useRef, useState } from "react";

import { useProtection } from "@/context/ProtectionContext";
import { useBehaviorPrediction } from "@/hooks/useBehaviorPrediction";
import { useBehaviorWindowPayload } from "@/hooks/useBehaviorWindowPayload";
import {
  useNearbyCsvCrosswalks,
  type NearbyCsvCrosswalk,
} from "@/hooks/useNearbyCsvCrosswalks";
import { useV2XSignals } from "@/hooks/useV2XSignals";
import {
  angleDiff,
  bearing,
  matchV2XSignal,
} from "@/services/matchV2XSignal";
import {
  buildSmartAlert,
  type Behavior,
  type SmartAlertResult,
} from "@/services/alertLogic";

const CROSSWALK_DISPLAY_RADIUS_M = 500;
const ALERT_CONTEXT_RADIUS_M = 30;
const MAX_HEADING_ERROR_DEG = 70;

/**
 * 행동분류 안정화 설정
 *
 * 현재 행동분류 API는 약 2초마다 결과를 반환한다.
 * 최근 5회 결과는 약 10초 정도의 행동 패턴을 의미한다.
 */
const BEHAVIOR_HISTORY_SIZE = 5;

type PositionWithHeading = {
  lat: number;
  lng: number;
  heading?: number | null;
};

type SelectedCrosswalk = NearbyCsvCrosswalk & {
  headingError?: number;
  selectionReason: "heading" | "nearest";
};

function isValidHeading(heading: unknown): heading is number {
  return (
    typeof heading === "number" &&
    Number.isFinite(heading) &&
    heading >= 0 &&
    heading <= 360
  );
}

function selectCrosswalkByHeading(
  position: PositionWithHeading,
  candidates: NearbyCsvCrosswalk[],
): SelectedCrosswalk | undefined {
  if (!candidates.length) return undefined;

  const nearest = candidates[0];

  const alertContextCandidates = candidates.filter(
    (c) => c.distance <= ALERT_CONTEXT_RADIUS_M,
  );

  if (!alertContextCandidates.length) {
    return {
      ...nearest,
      selectionReason: "nearest",
    };
  }

  if (!isValidHeading(position.heading)) {
    return {
      ...alertContextCandidates[0],
      selectionReason: "nearest",
    };
  }

  let best: NearbyCsvCrosswalk | undefined;
  let bestHeadingError = Infinity;

  for (const c of alertContextCandidates) {
    const crosswalkBearing = bearing(
      { lat: position.lat, lng: position.lng },
      { lat: c.lat, lng: c.lng },
    );

    const error = angleDiff(position.heading, crosswalkBearing);

    if (error < bestHeadingError) {
      bestHeadingError = error;
      best = c;
    }
  }

  if (!best || bestHeadingError > MAX_HEADING_ERROR_DEG) {
    return {
      ...alertContextCandidates[0],
      selectionReason: "nearest",
    };
  }

  return {
    ...best,
    headingError: Math.round(bestHeadingError),
    selectionReason: "heading",
  };
}

function countBehavior(history: Behavior[], target: Behavior): number {
  return history.filter((b) => b === target).length;
}

/**
 * 최근 행동분류 결과의 빈도를 기반으로 최종 행동값을 안정화한다.
 *
 * 우선순위:
 * 1. Typing 2회 이상 → Typing
 * 2. Watching 2회 이상 → Watching
 * 3. Navigation 3회 이상 → Navigation
 * 4. Baseline 4회 이상 → Baseline
 * 5. 애매하면 이전 안정화 행동 유지
 *
 * 이유:
 * Typing/Watching은 위험도가 높은 행동이므로 2회 이상만 반복되어도 반영한다.
 * Navigation은 중간위험 행동이므로 3회 이상 반복될 때 반영한다.
 * Baseline은 일시적 오분류로 알림이 바로 꺼지는 것을 막기 위해 4회 이상일 때만 반영한다.
 */
function getStableBehaviorFromHistory(
  history: Behavior[],
  previousStableBehavior: Behavior,
): Behavior {
  if (!history.length) return previousStableBehavior;

  /**
   * 초기에는 history가 충분히 쌓이지 않았으므로
   * 현재 결과를 빠르게 반영한다.
   */
  if (history.length < 3) {
    return history[history.length - 1];
  }

  const typingCount = countBehavior(history, "Typing");
  const watchingCount = countBehavior(history, "Watching");
  const navigationCount = countBehavior(history, "Navigation");
  const baselineCount = countBehavior(history, "Baseline");

  if (typingCount >= 2) {
    return "Typing";
  }

  if (watchingCount >= 2) {
    return "Watching";
  }

  if (navigationCount >= 3) {
    return "Navigation";
  }

  if (baselineCount >= 4) {
    return "Baseline";
  }

  /**
   * Still은 현재 ML API에는 없을 수 있지만,
   * 혹시 들어오는 경우에는 반복될 때만 반영한다.
   */
  const stillCount = countBehavior(history, "Still");
  if (stillCount >= 4) {
    return "Still";
  }

  return previousStableBehavior;
}

export function useSmartAlert(): SmartAlertResult {
  const { position } = useProtection();

  const behaviorWindow = useBehaviorWindowPayload();

  const behaviorPrediction = useBehaviorPrediction(
    behaviorWindow.ready ? behaviorWindow.payload : undefined,
  );

  /**
   * 최근 행동분류 결과 저장
   */
  const behaviorHistoryRef = useRef<Behavior[]>([]);
  const [stableBehavior, setStableBehavior] = useState<Behavior>(
    behaviorPrediction.behavior,
  );

  useEffect(() => {
    const nextBehavior = behaviorPrediction.behavior;

    behaviorHistoryRef.current = [
      ...behaviorHistoryRef.current,
      nextBehavior,
    ].slice(-BEHAVIOR_HISTORY_SIZE);

    setStableBehavior((prevStableBehavior) => {
      const nextStableBehavior = getStableBehaviorFromHistory(
        behaviorHistoryRef.current,
        prevStableBehavior,
      );

      console.log(
        "[SmartAlert] behavior history=",
        behaviorHistoryRef.current,
        "raw=",
        nextBehavior,
        "stable=",
        nextStableBehavior,
      );

      return nextStableBehavior;
    });
  }, [behaviorPrediction.behavior]);

  /**
   * 알림로직에는 raw behavior가 아니라
   * 최근 5회 빈도 기반으로 안정화된 행동값을 사용한다.
   */
  const behavior = stableBehavior;

  const nearbyCrosswalks = useNearbyCsvCrosswalks(
    position,
    CROSSWALK_DISPLAY_RADIUS_M,
    2000,
  );

  const v2xSignals = useV2XSignals(position ?? undefined);

  return useMemo(() => {
    const selectedCrosswalk = position
      ? selectCrosswalkByHeading(position, nearbyCrosswalks)
      : undefined;

    const matchedSignal = matchV2XSignal(selectedCrosswalk, v2xSignals);

    return buildSmartAlert({
      distanceM: selectedCrosswalk?.distance,
      behavior,
      signalState: matchedSignal?.statNm ?? matchedSignal?.phase,
      remainingSec: matchedSignal?.remainingSec,

      crosswalkName:
        selectedCrosswalk?.intersection ||
        selectedCrosswalk?.address ||
        selectedCrosswalk?.id,

      intersectionName: matchedSignal?.intersectionName,
      angleError: matchedSignal?.angleError,
      headingError: selectedCrosswalk?.headingError,
      crosswalkSelectionReason: selectedCrosswalk?.selectionReason,

      behaviorApiSource: behaviorPrediction.source,
      behaviorApiLoading: behaviorPrediction.loading,
      behaviorApiError: behaviorWindow.error ?? behaviorPrediction.error,

      sensorWindowReady: behaviorWindow.ready,
      sensorWindowSampleCount: behaviorWindow.sampleCount,
    });
  }, [
    position,
    nearbyCrosswalks,
    v2xSignals,
    behavior,
    behaviorPrediction.source,
    behaviorPrediction.loading,
    behaviorPrediction.error,
    behaviorWindow.ready,
    behaviorWindow.sampleCount,
    behaviorWindow.error,
  ]);
}