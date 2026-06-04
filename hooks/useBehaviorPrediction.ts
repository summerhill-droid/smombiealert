import { useEffect, useRef, useState } from "react";

import type { Behavior } from "@/services/alertLogic";
import {
  makeMockWindowPayload,
  predictBehaviorFromWindow,
  type BehaviorWindowPayload,
} from "@/services/behaviorApi";

type BehaviorApiSource = "mock-api" | "real-api" | "fallback";

type BehaviorPredictionState = {
  behavior: Behavior;
  source: BehaviorApiSource;
  loading: boolean;
  error?: string;
  lastUpdatedAt?: string;
  callCount: number;
};

const DEFAULT_BEHAVIOR: Behavior = "Baseline";
const ENABLE_MOCK_API_TEST = true;
const PREDICT_INTERVAL_MS = 2000;

export function useBehaviorPrediction(
  windowPayload?: BehaviorWindowPayload | null,
): BehaviorPredictionState {
  const latestPayloadRef = useRef<BehaviorWindowPayload | null>(null);
  const latestSourceRef = useRef<BehaviorApiSource>("fallback");
  const runningRef = useRef(false);

  const [state, setState] = useState<BehaviorPredictionState>({
    behavior: DEFAULT_BEHAVIOR,
    source: "fallback",
    loading: false,
    callCount: 0,
  });

  useEffect(() => {
    if (windowPayload) {
      latestPayloadRef.current = windowPayload;
      latestSourceRef.current = "real-api";
    } else if (ENABLE_MOCK_API_TEST) {
      latestPayloadRef.current = makeMockWindowPayload();
      latestSourceRef.current = "mock-api";
    } else {
      latestPayloadRef.current = null;
      latestSourceRef.current = "fallback";
    }
  }, [windowPayload]);

  useEffect(() => {
    let cancelled = false;

    async function runPrediction() {
      if (runningRef.current) return;

      const payload = latestPayloadRef.current;
      const source = latestSourceRef.current;

      if (!payload) {
        setState((prev) => ({
          ...prev,
          behavior: DEFAULT_BEHAVIOR,
          source: "fallback",
          loading: false,
          error: "No behavior window payload is available yet.",
        }));
        return;
      }

      runningRef.current = true;

      setState((prev) => ({
        ...prev,
        source,
        loading: true,
        error: undefined,
      }));

      try {
        console.log(
          "[BehaviorPrediction] CALL",
          new Date().toLocaleTimeString(),
          "source=",
          source,
          "axLast=",
          payload.ax?.[payload.ax.length - 1],
          "gxLast=",
          payload.gx?.[payload.gx.length - 1],
          "pitchLast=",
          payload.pitch?.[payload.pitch.length - 1],
        );

        const result = await predictBehaviorFromWindow(payload);

        console.log(
          "[BehaviorPrediction] RESULT",
          new Date().toLocaleTimeString(),
          "behavior=",
          result.behavior,
        );

        if (cancelled) return;

        setState((prev) => ({
          behavior: result.behavior,
          source,
          loading: false,
          error: undefined,
          lastUpdatedAt: new Date().toLocaleTimeString(),
          callCount: prev.callCount + 1,
        }));
      } catch (e) {
        if (cancelled) return;

        const message =
          e instanceof Error ? e.message : "Unknown behavior API error";

        console.log("[BehaviorPrediction] ERROR", message);

        setState((prev) => ({
          ...prev,
          behavior: DEFAULT_BEHAVIOR,
          source: "fallback",
          loading: false,
          error: message,
        }));
      } finally {
        runningRef.current = false;
      }
    }

    runPrediction();

    const timer = setInterval(runPrediction, PREDICT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}