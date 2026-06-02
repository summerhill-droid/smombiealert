/**
 * DetectionContext.tsx — Core smombie detection engine (v2)
 *
 * CHANGES FROM v1 (research plan implementation, PDF Section 5):
 *   - Integrates BehaviorContext's 3-stage classifier into alert logic
 *   - Implements the full 4-level warning system from the research spec:
 *
 *   ⚫ OFF      → Not walking / indoor stationary
 *   🟡 CAUTION  → Walking detected, GIS data loading
 *   🟠 WARNING  → Crosswalk/accident zone ≤ 10m + phone ON
 *   🔴 CRITICAL → Inside crosswalk + ACTIVE interaction ≥ 5s
 *
 * ALERT CALIBRATION BY BEHAVIOR STAGE:
 *   ACTIVE (weight 3):  Full escalation — CRITICAL reachable, 3s threshold
 *   PASSIVE (weight 2): DANGER level, not CRITICAL (5s threshold)
 *   TOOL (weight 1):    CAUTION only (map glance is lower risk)
 *   BASELINE (weight 0): No alert regardless of GIS proximity
 *
 * ALERT MESSAGE SYSTEM (matches research plan Section 5):
 *   WARNING_TYPE1: "📱 전방에 횡단보도가 있습니다. 주변을 확인하세요!"
 *   WARNING_TYPE2: "⚠️ 사고 다발 구역입니다. 즉시 핸드폰을 내려주세요!"
 *   CRITICAL:      "🚫 위험! 보행 중 스마트폰 사용이 감지되었습니다."
 *
 * SENSOR REUSE:
 *   v2 delegates IMU subscriptions to BehaviorContext (both contexts
 *   previously subscribed separately — now BehaviorContext owns the sensors
 *   and DetectionContext reads behaviorStage from the shared context).
 *   Accelerometer is still used here for walkingSpeed and phoneAngle display.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform, Vibration } from "react-native";
import { Accelerometer } from "expo-sensors";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useBehavior, STAGE_WEIGHT, type BehaviorStage } from "./BehaviorContext";

// ─── Types ────────────────────────────────────────────────────────────────────

/** 4-level alert system matching the research plan warning spec */
export type AlertLevel = "safe" | "caution" | "warning" | "danger";

/**
 * Warning types from the research plan:
 *   crosswalk → WARNING_TYPE1 (횡단보도 접근)
 *   accident  → WARNING_TYPE2 (사고 다발지역 진입)
 */
export type WarningType = "crosswalk" | "accident" | null;

/** A single smombie incident stored in AsyncStorage */
export interface Incident {
  id: string;
  timestamp: number;
  level: AlertLevel;
  duration: number;
  behaviorStage: BehaviorStage;
  location?: string;
}

/** GIS zone context injected from GISContext via setExternalContext() */
export interface GISContext {
  boost: number;
  nearCrosswalk: boolean;   // within 10m of crosswalk
  nearAccident: boolean;    // within 10m of accident zone
  insideCrosswalk: boolean; // within 5m (inside the crosswalk itself)
}

const DEFAULT_GIS: GISContext = {
  boost:           0,
  nearCrosswalk:   false,
  nearAccident:    false,
  insideCrosswalk: false,
};

interface DetectionState {
  isMonitoring: boolean;
  alertLevel: AlertLevel;
  warningType: WarningType;
  alertMessage: string;
  isSmombie: boolean;
  walkingSpeed: number;
  phoneAngle: number;
  incidents: Incident[];
  totalSmombieTime: number;
  sessionStartTime: number | null;
  gisBoost: number;
  /** How many consecutive seconds the current alert has been active */
  alertDurationSec: number;
}

interface DetectionContextValue extends DetectionState {
  startMonitoring: () => void;
  stopMonitoring: () => void;
  clearIncidents: () => void;
  setExternalContext: (ctx: GISContext) => void;
}

const DetectionContext = createContext<DetectionContextValue | null>(null);

const STORAGE_KEY    = "smombie_incidents_v2";
const TOTAL_TIME_KEY = "smombie_total_time_v2";

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

/** Build the contextual alert message based on level + GIS triggers */
function buildAlertMessage(
  level: AlertLevel,
  warnType: WarningType,
  behaviorStage: BehaviorStage
): string {
  if (level === "danger") {
    if (warnType === "accident") {
      return "⚠️ Accident-prone zone. Put your phone down immediately!";
    }
    return "🚫 DANGER — Distracted walking detected in crosswalk!";
  }
  if (level === "warning") {
    if (warnType === "crosswalk") {
      return "📱 Crosswalk ahead. Please check your surroundings!";
    }
    if (warnType === "accident") {
      return "⚠️ Accident-prone area. Lower your phone now!";
    }
    if (behaviorStage === "active") {
      return "🚫 Active phone use while walking detected!";
    }
    if (behaviorStage === "passive") {
      return "👀 You're watching while walking — look up!";
    }
    return "📱 Phone use detected near hazard zone.";
  }
  if (level === "caution") {
    return "🟡 Walking detected — GIS scanning area...";
  }
  return "✅ Safe — Eyes on the road.";
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DetectionProvider({ children }: { children: React.ReactNode }) {
  // ── Behavior classifier (new in v2) ────────────────────────────────────
  const { behaviorStage, activate: activateBehavior, deactivate: deactivateBehavior } =
    useBehavior();

  // ── UI state ─────────────────────────────────────────────────────────
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [alertLevel, setAlertLevel] = useState<AlertLevel>("safe");
  const [warningType, setWarningType] = useState<WarningType>(null);
  const [alertMessage, setAlertMessage] = useState("✅ Safe — Eyes on the road.");
  const [isSmombie, setIsSmombie] = useState(false);
  const [walkingSpeed, setWalkingSpeed] = useState(0);
  const [phoneAngle, setPhoneAngle] = useState(0);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [totalSmombieTime, setTotalSmombieTime] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [gisBoost, setGisBoost] = useState(0);
  const [alertDurationSec, setAlertDurationSec] = useState(0);

  // ── Refs ──────────────────────────────────────────────────────────────
  const accelDataRef    = useRef({ x: 0, y: 0, z: 0 });
  const gisContextRef   = useRef<GISContext>(DEFAULT_GIS);
  const behaviorRef     = useRef<BehaviorStage>("baseline");
  const smombieStartRef = useRef<number | null>(null);
  const alertStartRef   = useRef<number | null>(null);
  const alertLevelRef   = useRef<AlertLevel>("safe");
  const hapticTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep behaviorRef in sync (readable inside analyzeMotion without closure issues)
  useEffect(() => {
    behaviorRef.current = behaviorStage;
  }, [behaviorStage]);

  // ── Persistence ───────────────────────────────────────────────────────
  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) setIncidents(JSON.parse(stored));
      const t = await AsyncStorage.getItem(TOTAL_TIME_KEY);
      if (t) setTotalSmombieTime(parseInt(t, 10));
    } catch { /* ignore */ }
  }

  async function saveIncidents(updated: Incident[]) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch { /* ignore */ }
  }

  // ── GIS context injection ─────────────────────────────────────────────
  const setExternalContext = useCallback((ctx: GISContext) => {
    gisContextRef.current = ctx;
    setGisBoost(ctx.boost);
  }, []);

  // ── Core motion analysis ──────────────────────────────────────────────
  /**
   * analyzeMotion — fuses IMU data + behavior stage + GIS context.
   *
   * STEP 1: Walking detection (same as v1 — accel magnitude deviation)
   * STEP 2: Behavior stage weight (0–3 from BehaviorContext)
   * STEP 3: Determine base alert level from walking + behavior
   * STEP 4: Apply GIS escalation (crosswalk/accident zone proximity)
   * STEP 5: CRITICAL escalation if ACTIVE interaction inside crosswalk ≥ 5s
   * STEP 6: Incident tracking
   */
  const analyzeMotion = useCallback(() => {
    const { x, y, z } = accelDataRef.current;
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    const angleDeg  = Math.abs(Math.atan2(y, z) * (180 / Math.PI));

    const accelOffset  = Math.abs(magnitude - 9.81);
    const speedProxy   = Math.min(100, accelOffset * 20);
    const normalAngle  = Math.min(100, (angleDeg / 90) * 100);

    setWalkingSpeed(Math.round(speedProxy));
    setPhoneAngle(Math.round(normalAngle));

    const isWalking   = speedProxy > 5;
    const stageWeight = STAGE_WEIGHT[behaviorRef.current];
    const gis         = gisContextRef.current;

    // ── Determine smombie state ──────────────────────────────────────
    // Walking + any active phone use (stage > baseline) = smombie
    const smombieDetected = isWalking && stageWeight > 0;
    setIsSmombie(smombieDetected);

    // ── Base alert level ─────────────────────────────────────────────
    let newLevel: AlertLevel = "safe";
    let newWarning: WarningType = null;

    if (!isWalking) {
      // Not walking → OFF state (safe + no alerts)
      newLevel = "safe";
    } else if (!smombieDetected) {
      // Walking but phone away → CAUTION (passive GIS monitoring)
      newLevel = gis.boost > 0 ? "caution" : "safe";
    } else {
      // Walking + phone active → base level from behavior weight
      if (stageWeight >= 2) {
        // ACTIVE or PASSIVE → warning minimum
        newLevel   = "warning";
        newWarning = null;
      } else {
        // TOOL → caution
        newLevel = "caution";
      }
    }

    // ── GIS escalation (research plan Section 5) ─────────────────────
    if (smombieDetected) {
      if (gis.nearAccident && stageWeight >= 1) {
        newLevel   = stageWeight >= 2 ? "danger" : "warning";
        newWarning = "accident";
      } else if (gis.nearCrosswalk && stageWeight >= 1) {
        newLevel   = newLevel === "safe" ? "warning" : newLevel;
        newWarning = "crosswalk";
      } else if (gis.boost >= 50 && newLevel === "warning") {
        newLevel = "danger";
      }
    }

    // ── CRITICAL: inside crosswalk + ACTIVE for 5+ continuous seconds ──
    // Research plan: "화면 잠금으로 기기 사용 강제 차단"
    if (
      gis.insideCrosswalk &&
      behaviorRef.current === "active" &&
      smombieDetected
    ) {
      const alertDuration = alertStartRef.current
        ? (Date.now() - alertStartRef.current) / 1000
        : 0;
      if (alertDuration >= 5) {
        newLevel   = "danger";
        newWarning = "crosswalk";
      }
    }

    // ── Track alert start time ────────────────────────────────────────
    if (newLevel !== "safe") {
      if (alertStartRef.current === null) alertStartRef.current = Date.now();
    } else {
      alertStartRef.current = null;
    }

    // ── Commit state ─────────────────────────────────────────────────
    const msg = buildAlertMessage(newLevel, newWarning, behaviorRef.current);
    setAlertLevel(newLevel);
    setWarningType(newWarning);
    setAlertMessage(msg);
    alertLevelRef.current = newLevel;

    // ── Haptics on escalation ─────────────────────────────────────────
    if (newLevel !== "safe" && smombieDetected) {
      if (alertLevelRef.current === "danger") {
        triggerHaptics("danger");
      }
    }

    // ── Incident tracking ─────────────────────────────────────────────
    if (smombieDetected && smombieStartRef.current === null) {
      smombieStartRef.current = Date.now();
    } else if (!smombieDetected && smombieStartRef.current !== null) {
      const duration = Math.round((Date.now() - smombieStartRef.current) / 1000);
      if (duration >= 2) {
        const incident: Incident = {
          id:            generateId(),
          timestamp:     smombieStartRef.current,
          level:         alertLevelRef.current === "safe" ? "caution" : alertLevelRef.current,
          duration,
          behaviorStage: behaviorRef.current,
        };
        setIncidents((prev) => {
          const updated = [incident, ...prev].slice(0, 100);
          saveIncidents(updated);
          return updated;
        });
        setTotalSmombieTime((prev) => {
          const next = prev + duration;
          AsyncStorage.setItem(TOTAL_TIME_KEY, next.toString());
          return next;
        });
      }
      smombieStartRef.current = null;
    }
  }, []);

  // ── Haptic feedback ───────────────────────────────────────────────────
  function triggerHaptics(level: AlertLevel) {
    if (Platform.OS === "web") return;
    if (level === "danger") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0, 300, 100, 300]);
    } else if (level === "warning") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    hapticTimerRef.current = setTimeout(() => {
      if (alertLevelRef.current !== "safe") triggerHaptics(alertLevelRef.current);
    }, 3000);
  }

  // ── Alert duration counter ────────────────────────────────────────────
  function startAlertTimer() {
    alertTimerRef.current = setInterval(() => {
      setAlertDurationSec((s) => (alertLevelRef.current !== "safe" ? s + 1 : 0));
    }, 1000);
  }

  // ── Monitoring lifecycle ──────────────────────────────────────────────
  const startMonitoring = useCallback(() => {
    setIsMonitoring(true);
    setSessionStartTime(Date.now());
    smombieStartRef.current  = null;
    alertStartRef.current    = null;
    setAlertDurationSec(0);

    // Activate behavior classifier
    activateBehavior();

    if (Platform.OS !== "web") {
      Accelerometer.setUpdateInterval(300);
      Accelerometer.addListener((data) => {
        accelDataRef.current = data;
        analyzeMotion();
      });
    } else {
      // Web simulation: walking sine wave
      let t = 0;
      const sim = setInterval(() => {
        t += 0.3;
        accelDataRef.current = {
          x: Math.sin(t) * 0.5,
          y: 9 + Math.sin(t * 1.3) * 0.3,
          z: Math.cos(t) * 0.2,
        };
        analyzeMotion();
      }, 300);
      (startMonitoring as unknown as { _sim: ReturnType<typeof setInterval> })._sim = sim;
    }

    startAlertTimer();
  }, [analyzeMotion, activateBehavior]);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setSessionStartTime(null);
    setIsSmombie(false);
    setAlertLevel("safe");
    setWarningType(null);
    setAlertMessage("✅ Safe — Eyes on the road.");
    setWalkingSpeed(0);
    setPhoneAngle(0);
    setAlertDurationSec(0);
    smombieStartRef.current = null;
    alertStartRef.current   = null;

    // Deactivate behavior classifier
    deactivateBehavior();

    if (Platform.OS !== "web") Accelerometer.removeAllListeners();

    if (hapticTimerRef.current) {
      clearTimeout(hapticTimerRef.current);
      hapticTimerRef.current = null;
    }
    if (alertTimerRef.current) {
      clearInterval(alertTimerRef.current);
      alertTimerRef.current = null;
    }
  }, [deactivateBehavior]);

  const clearIncidents = useCallback(async () => {
    setIncidents([]);
    setTotalSmombieTime(0);
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.setItem(TOTAL_TIME_KEY, "0");
  }, []);

  return (
    <DetectionContext.Provider
      value={{
        isMonitoring,
        alertLevel,
        warningType,
        alertMessage,
        isSmombie,
        walkingSpeed,
        phoneAngle,
        incidents,
        totalSmombieTime,
        sessionStartTime,
        gisBoost,
        alertDurationSec,
        startMonitoring,
        stopMonitoring,
        clearIncidents,
        setExternalContext,
      }}
    >
      {children}
    </DetectionContext.Provider>
  );
}

export function useDetection(): DetectionContextValue {
  const ctx = useContext(DetectionContext);
  if (!ctx) throw new Error("useDetection must be used within DetectionProvider");
  return ctx;
}

// Re-export AlertLevel for consumers
export type { DetectionContextValue };
