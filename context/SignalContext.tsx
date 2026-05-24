/**
 * SignalContext.tsx — Seoul V2X Signal Provider (v3)
 *
 * WHAT CHANGED FROM v2:
 *   - Reads nearestCrosswalkDist from GISContext (metres, null = not yet known)
 *   - bestSignal is gated: only non-null when a crosswalk is ≤ PROXIMITY_THRESHOLD_M away
 *   - Exposes crosswalkDist so SignalCard can display it
 *
 * POLLING:
 *   Both phase + timing endpoints are fetched together every 5 seconds.
 *   Polling pauses automatically when the app is backgrounded.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";

import { getSignalData, type SignalTiming } from "@/services/signalAPI";
import { useGIS } from "@/context/GISContext";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS       = 5_000;
const PROXIMITY_THRESHOLD_M  = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignalContextValue {
  /** All active V2X signal readings (green-first sorted) */
  signalTimings: SignalTiming[];
  /**
   * Best available signal — non-null only when the user is within
   * PROXIMITY_THRESHOLD_M of a crosswalk (i.e. near an intersection).
   */
  bestSignal: SignalTiming | null;
  /** Total number of active V2X stations returned by the API */
  stationCount: number;
  /** Distance in metres to the nearest crosswalk (null = not yet determined) */
  crosswalkDist: number | null;
  /** True while the very first fetch is in progress */
  isLoadingSignal: boolean;
  /** Last fetch error (null = OK) */
  signalError: string | null;
  /** Force an immediate out-of-cycle refresh */
  refreshSignal: () => void;
}

const SignalContext = createContext<SignalContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SignalProvider({ children }: { children: React.ReactNode }) {
  const { nearestCrosswalkDist } = useGIS();

  const [signalTimings,   setSignalTimings]   = useState<SignalTiming[]>([]);
  const [rawBestSignal,   setRawBestSignal]   = useState<SignalTiming | null>(null);
  const [stationCount,    setStationCount]    = useState(0);
  const [isLoadingSignal, setIsLoadingSignal] = useState(true);
  const [signalError,     setSignalError]     = useState<string | null>(null);

  const isFetchingRef = useRef(false);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchSignals = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const timings = await getSignalData();
      setSignalTimings(timings);
      setStationCount(timings.length);
      setSignalError(null);
      setRawBestSignal(timings.length > 0 ? timings[0] : null);
    } catch {
      setSignalError("V2X data unavailable");
    } finally {
      isFetchingRef.current = false;
      setIsLoadingSignal(false);
    }
  }, []);

  // ── Polling lifecycle ─────────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (timerRef.current) return;
    fetchSignals();
    timerRef.current = setInterval(fetchSignals, POLL_INTERVAL_MS);
  }, [fetchSignals]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // Pause when backgrounded
  useEffect(() => {
    const handler = (state: AppStateStatus) => {
      state === "active" ? startPolling() : stopPolling();
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, [startPolling, stopPolling]);

  const refreshSignal = useCallback(() => { fetchSignals(); }, [fetchSignals]);

  // ── Proximity gate ────────────────────────────────────────────────────────
  // Show the best signal only when a crosswalk is within 50 m.
  // While GPS is still loading (null), we leave bestSignal null too.
  const isNearby   = nearestCrosswalkDist !== null && nearestCrosswalkDist <= PROXIMITY_THRESHOLD_M;
  const bestSignal = isNearby ? rawBestSignal : null;

  return (
    <SignalContext.Provider value={{
      signalTimings,
      bestSignal,
      stationCount,
      crosswalkDist: nearestCrosswalkDist,
      isLoadingSignal,
      signalError,
      refreshSignal,
    }}>
      {children}
    </SignalContext.Provider>
  );
}

export function useSignal(): SignalContextValue {
  const ctx = useContext(SignalContext);
  if (!ctx) throw new Error("useSignal must be used within SignalProvider");
  return ctx;
}
