/**
 * BehaviorContext.tsx — 3-Stage Pedestrian Behavior Classifier
 *
 * RESEARCH BASIS (PDF Section 3 & 4):
 *   Classifies smartphone interaction into 3 danger tiers + baseline,
 *   using a dual-trigger model: IMU sensor data + touch interaction events.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Stage      │ Behavior                │ Risk  │ IMU Pattern  │
 * ├─────────────┼─────────────────────────┼───────┼──────────────┤
 * │  ACTIVE     │ Typing, gaming, SNS     │ HIGH  │ High accel   │
 * │             │ upload                  │       │ variance +   │
 * │             │                         │       │ gyro spike   │
 * ├─────────────┼─────────────────────────┼───────┼──────────────┤
 * │  PASSIVE    │ YouTube, webtoon,       │ MED   │ Stable angle │
 * │             │ SNS scroll              │       │ low variance │
 * ├─────────────┼─────────────────────────┼───────┼──────────────┤
 * │  TOOL       │ Navigation, music ctrl  │ LOW   │ Brief touch  │
 * │             │                         │       │ then return  │
 * ├─────────────┼─────────────────────────┼───────┼──────────────┤
 * │  BASELINE   │ Pocket / no interaction │ NONE  │ Stable 0° or │
 * │             │                         │       │ covered prox │
 * └─────────────┴─────────────────────────┴───────┴──────────────┘
 *
 * CLASSIFICATION ALGORITHM:
 *   Two complementary signals are fused:
 *
 *   1. TOUCH SIGNAL (reported by screens via recordInteraction()):
 *      - tapCount_10s   : # taps in last 10 seconds
 *      - scrollCount_10s: # scroll events in last 10 seconds
 *      - longpressCount : # long-presses (>400ms holds) in last 30 seconds
 *      - avgTouchDuration: average ms a touch was held
 *
 *   2. IMU SIGNAL (from accelerometer + gyroscope):
 *      - accelVariance  : variance of |accel| magnitude in 5s window
 *                         → High = typing micro-vibrations or active motion
 *      - gyroVariance   : variance of |gyro| in 5s window
 *                         → High = phone rotation during active interaction
 *      - angleStability : std-dev of pitch angle in 5s window
 *                         → Low = stable reading posture (passive viewing)
 *      - pitchAngle     : current 0°–90° tilt
 *                         → 40°–85° = screen-viewing posture
 *
 *   DECISION TREE:
 *     if (touchFreq_30s == 0 AND accelVariance < 0.04) → BASELINE
 *     else if (tapCount_10s ≥ 3 OR longpressCount ≥ 1 OR accelVariance > 0.22) → ACTIVE
 *     else if (scrollCount_10s ≥ 2 OR angleStability < 8) → PASSIVE
 *     else → TOOL
 *
 *   Confidence is computed from the strength of each signal.
 *   A debounce of 3 consecutive same-stage readings prevents flickering.
 *
 * INTEGRATION:
 *   - Screens call recordInteraction() from their touch/scroll handlers
 *   - DetectionContext reads behaviorStage to calibrate alert severity
 *   - Index screen renders BehaviorStageCard with live classification
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { Platform } from "react-native";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The four behavior stages from the research plan.
 * Maps to risk levels: active > passive > tool > baseline
 */
export type BehaviorStage = "active" | "passive" | "tool" | "baseline";

/**
 * Interaction types that screens report via recordInteraction().
 * These mimic the "touch event" sensor column from the research design table.
 */
export type InteractionType =
  | "tap"        // single quick touch (likely message, button, nav)
  | "scroll"     // continuous scroll motion (SNS, webtoon, YouTube)
  | "longpress"  // held touch >400ms (typing, game hold, SNS draft)
  | "swipe"      // directional flick (SNS feed, story, swipe game)
  | "multitouch"; // two-finger gesture (game, zoom, pinch)

/** A single touch event with timestamp, for windowed frequency analysis */
export interface TouchRecord {
  type: InteractionType;
  ts: number;       // unix ms when the interaction occurred
  duration?: number; // ms the touch was held (for longpress/scroll)
}

/** IMU snapshot stored in the sliding window buffer */
interface SensorSnapshot {
  accelMag: number;  // |accel| = sqrt(x²+y²+z²) — walking/motion magnitude
  gyroMag: number;   // |gyro| = sqrt(x²+y²+z²) — rotation rate
  pitchDeg: number;  // atan2(y,z) in degrees — phone viewing angle
  ts: number;
}

/** Rich classification output: stage + supporting signal values for UI */
export interface BehaviorReading {
  stage: BehaviorStage;
  confidence: number;        // 0–100: classifier certainty
  accelVariance: number;     // 5s IMU accel variance (display metric)
  gyroVariance: number;      // 5s IMU gyro variance (display metric)
  pitchAngle: number;        // current pitch in degrees
  angleStability: number;    // pitch std-dev in 5s window (lower = more stable)
  tapCount10s: number;       // taps in last 10 seconds
  scrollCount10s: number;    // scrolls in last 10 seconds
  longpressCount30s: number; // long-presses in last 30 seconds
  avgTouchDuration: number;  // average touch hold time in ms
}

const DEFAULT_READING: BehaviorReading = {
  stage: "baseline",
  confidence: 100,
  accelVariance: 0,
  gyroVariance: 0,
  pitchAngle: 0,
  angleStability: 0,
  tapCount10s: 0,
  scrollCount10s: 0,
  longpressCount30s: 0,
  avgTouchDuration: 0,
};

/** All values BehaviorContext exposes to child components */
interface BehaviorContextValue {
  /** Current classified behavior stage */
  behaviorStage: BehaviorStage;
  /** Full detail reading (for the BehaviorStageCard display) */
  reading: BehaviorReading;
  /** Call this from any screen's touch handlers to feed interaction data */
  recordInteraction: (type: InteractionType, durationMs?: number) => void;
  /** Whether sensors are currently subscribed */
  isActive: boolean;
  /** Start IMU subscriptions (called when monitoring begins) */
  activate: () => void;
  /** Stop IMU subscriptions (called when monitoring stops) */
  deactivate: () => void;
}

const BehaviorContext = createContext<BehaviorContextValue | null>(null);

// ─── Constants ────────────────────────────────────────────────────────────────

/** Sensor sampling interval in ms — matches DetectionContext for battery efficiency */
const SENSOR_INTERVAL_MS = 300;

/** Sliding window durations */
const WINDOW_IMU_MS = 5_000;   // 5s for accel/gyro variance
const WINDOW_TOUCH_10S = 10_000;
const WINDOW_TOUCH_30S = 30_000;

/**
 * Decision thresholds (tuned against GaitX 2025 & research plan Section 3):
 *
 * accelVariance:
 *   BASELINE   < 0.04  (stationary / pocket — pure gravity, tiny noise)
 *   TOOL       < 0.10  (held still while glancing at map)
 *   PASSIVE    < 0.22  (smooth scroll micro-motion, stable viewing posture)
 *   ACTIVE     ≥ 0.22  (typing micro-vibrations, game joystick motion)
 *
 * The paper (GaitX) reports RMS drops during phone use; here we track variance
 * in the magnitude signal to detect high-frequency micro-motion from typing.
 */
const THRESH = {
  accel: { baseline: 0.04, tool: 0.10, passive: 0.22 },
  gyro:  { high: 0.08 },       // gyro variance — high = active rotation
  angle: { readingMin: 40, readingMax: 85 }, // pitch range for viewing posture
  stable: 8,                   // angleStability < 8° std-dev = stable reading
  tap:    { active: 3 },       // taps/10s ≥ 3 = active typing / gaming
  scroll: { passive: 2 },      // scrolls/10s ≥ 2 = passive content consumption
  long:   { active: 1 },       // longpresses/30s ≥ 1 = active (typing, game hold)
  debounce: 3,                 // consecutive readings required to change stage
} as const;

// ─── Math helpers ─────────────────────────────────────────────────────────────

/** Population variance of a numeric array */
function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}

/** Population standard deviation */
function stddev(arr: number[]): number {
  return Math.sqrt(variance(arr));
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function BehaviorProvider({ children }: { children: React.ReactNode }) {
  const [behaviorStage, setBehaviorStage] = useState<BehaviorStage>("baseline");
  const [reading, setReading] = useState<BehaviorReading>(DEFAULT_READING);
  const [isActive, setIsActive] = useState(false);

  // ── Sliding-window buffers (refs — no re-render on each sensor tick) ──────
  const imuBufferRef = useRef<SensorSnapshot[]>([]);
  const touchBufferRef = useRef<TouchRecord[]>([]);

  // ── Sensor data (latest raw values) ──────────────────────────────────────
  const accelRef = useRef({ x: 0, y: 0, z: 0 });
  const gyroRef  = useRef({ x: 0, y: 0, z: 0 });

  // ── Debounce state ────────────────────────────────────────────────────────
  const stageCountRef  = useRef<{ stage: BehaviorStage; count: number }>({
    stage: "baseline",
    count: 0,
  });

  // ── Subscriptions ─────────────────────────────────────────────────────────
  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const gyroSubRef  = useRef<{ remove: () => void } | null>(null);
  const classifyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Interaction recorder ─────────────────────────────────────────────────
  /**
   * recordInteraction — called from any screen's touch/scroll handler.
   *
   * Examples:
   *   <ScrollView onScroll={() => recordInteraction('scroll')} ... />
   *   <TouchableOpacity onPress={() => recordInteraction('tap')} ... />
   *   <TouchableOpacity onLongPress={() => recordInteraction('longpress', 500)} />
   */
  const recordInteraction = useCallback(
    (type: InteractionType, durationMs?: number) => {
      touchBufferRef.current.push({ type, ts: Date.now(), duration: durationMs });
    },
    []
  );

  // ─── Classification engine ────────────────────────────────────────────────
  /**
   * classify — runs every SENSOR_INTERVAL_MS.
   *
   * 1. Appends a new IMU snapshot to the buffer and prunes old entries.
   * 2. Prunes old touch events outside the 30s window.
   * 3. Computes signal features from the windows.
   * 4. Applies the decision tree.
   * 5. Debounces stage changes (requires THRESH.debounce consecutive same results).
   * 6. Updates React state only when stage changes OR features shift enough.
   */
  const classify = useCallback(() => {
    const now = Date.now();
    const { x: ax, y: ay, z: az } = accelRef.current;
    const { x: gx, y: gy, z: gz } = gyroRef.current;

    // ── IMU snapshot ─────────────────────────────────────────────────────
    const accelMag   = Math.sqrt(ax * ax + ay * ay + az * az);
    const gyroMag    = Math.sqrt(gx * gx + gy * gy + gz * gz);
    const pitchDeg   = Math.abs(Math.atan2(ay, az) * (180 / Math.PI));

    imuBufferRef.current.push({ accelMag, gyroMag, pitchDeg, ts: now });
    // Prune to 5s window
    imuBufferRef.current = imuBufferRef.current.filter(
      (s) => now - s.ts <= WINDOW_IMU_MS
    );

    // ── Touch buffer prune ───────────────────────────────────────────────
    touchBufferRef.current = touchBufferRef.current.filter(
      (t) => now - t.ts <= WINDOW_TOUCH_30S
    );

    // ── Feature extraction ───────────────────────────────────────────────
    const buf = imuBufferRef.current;
    const touchBuf = touchBufferRef.current;

    const accelVariance   = variance(buf.map((s) => s.accelMag));
    const gyroVariance    = variance(buf.map((s) => s.gyroMag));
    const angleStability  = stddev(buf.map((s) => s.pitchDeg));

    const recentTaps10s   = touchBuf.filter(
      (t) => now - t.ts <= WINDOW_TOUCH_10S && t.type === "tap"
    ).length;
    const recentScrolls10s = touchBuf.filter(
      (t) => now - t.ts <= WINDOW_TOUCH_10S && (t.type === "scroll" || t.type === "swipe")
    ).length;
    const longpresses30s  = touchBuf.filter(
      (t) => t.type === "longpress" || t.type === "multitouch"
    ).length;
    const touchFreq30s    = touchBuf.length;

    // Average touch duration (for touches that reported a duration)
    const durations = touchBuf
      .map((t) => t.duration)
      .filter((d): d is number => d !== undefined);
    const avgTouchDuration =
      durations.length > 0
        ? durations.reduce((s, d) => s + d, 0) / durations.length
        : 0;

    const inReadingAngle =
      pitchDeg >= THRESH.angle.readingMin && pitchDeg <= THRESH.angle.readingMax;

    // ── Decision tree ────────────────────────────────────────────────────
    let rawStage: BehaviorStage;
    let confidence: number;

    if (touchFreq30s === 0 && accelVariance < THRESH.accel.baseline) {
      // No interaction at all + very stable IMU → phone in pocket / screen off
      rawStage   = "baseline";
      confidence = Math.round(Math.min(100, (1 - accelVariance / THRESH.accel.baseline) * 100));

    } else if (
      recentTaps10s >= THRESH.tap.active ||
      longpresses30s >= THRESH.long.active ||
      accelVariance > THRESH.accel.passive ||
      gyroVariance > THRESH.gyro.high
    ) {
      // High touch frequency or high IMU variance → active interaction
      rawStage = "active";
      const touchScore = Math.min(1, recentTaps10s / THRESH.tap.active);
      const accelScore = Math.min(1, accelVariance / (THRESH.accel.passive * 2));
      confidence = Math.round(Math.max(touchScore, accelScore) * 100);

    } else if (
      recentScrolls10s >= THRESH.scroll.passive ||
      (touchFreq30s > 0 && inReadingAngle && angleStability < THRESH.stable) ||
      (touchFreq30s > 0 && accelVariance < THRESH.accel.passive && inReadingAngle)
    ) {
      // Smooth scrolling OR stable reading posture → passive content consumption
      rawStage = "passive";
      const scrollScore = Math.min(1, recentScrolls10s / (THRESH.scroll.passive * 2));
      const stableScore = angleStability > 0 ? Math.max(0, 1 - angleStability / THRESH.stable) : 0.5;
      confidence = Math.round(Math.max(scrollScore, stableScore) * 100);

    } else if (touchFreq30s > 0) {
      // Some interaction but infrequent + brief → tool use (nav, music)
      rawStage   = "tool";
      confidence = Math.round(
        Math.min(100, (1 - Math.min(accelVariance, THRESH.accel.passive) / THRESH.accel.passive) * 80)
      );

    } else {
      rawStage   = "baseline";
      confidence = 60;
    }

    // ── Debounce: require N consecutive same-stage readings ──────────────
    const deb = stageCountRef.current;
    if (rawStage === deb.stage) {
      deb.count++;
    } else {
      deb.stage = rawStage;
      deb.count = 1;
    }

    const confirmedStage =
      deb.count >= THRESH.debounce ? deb.stage : behaviorStage;

    // ── Emit new state ────────────────────────────────────────────────────
    const newReading: BehaviorReading = {
      stage:            confirmedStage,
      confidence,
      accelVariance:    Math.round(accelVariance * 1000) / 1000,
      gyroVariance:     Math.round(gyroVariance * 1000) / 1000,
      pitchAngle:       Math.round(pitchDeg),
      angleStability:   Math.round(angleStability * 10) / 10,
      tapCount10s:      recentTaps10s,
      scrollCount10s:   recentScrolls10s,
      longpressCount30s: longpresses30s,
      avgTouchDuration: Math.round(avgTouchDuration),
    };

    if (confirmedStage !== behaviorStage) {
      setBehaviorStage(confirmedStage);
    }
    setReading(newReading);
  }, [behaviorStage]);

  // ─── Sensor subscription management ──────────────────────────────────────

  /**
   * activate — starts IMU subscriptions and the classify timer.
   * Called when DetectionContext begins monitoring.
   */
  const activate = useCallback(() => {
    if (isActive) return;
    setIsActive(true);
    imuBufferRef.current = [];

    if (Platform.OS !== "web") {
      Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
      Gyroscope.setUpdateInterval(SENSOR_INTERVAL_MS);

      accelSubRef.current = Accelerometer.addListener((data) => {
        accelRef.current = data;
      });
      gyroSubRef.current = Gyroscope.addListener((data) => {
        gyroRef.current = data;
      });
    } else {
      // Web simulation: synthesize plausible sensor signals for demo
      let t = 0;
      const webSim = setInterval(() => {
        t += 0.3;
        accelRef.current = {
          x: Math.sin(t) * 0.4,
          y: 9.0 + Math.sin(t * 1.2) * 0.35,
          z: Math.cos(t) * 0.15,
        };
        gyroRef.current = {
          x: Math.sin(t * 0.7) * 0.05,
          y: Math.cos(t * 0.5) * 0.04,
          z: Math.sin(t * 1.1) * 0.03,
        };
      }, SENSOR_INTERVAL_MS);
      // Store so we can clear it in deactivate
      (activate as unknown as { _webSim: ReturnType<typeof setInterval> })._webSim = webSim;
    }

    // Classification runs every sensor interval
    classifyTimerRef.current = setInterval(classify, SENSOR_INTERVAL_MS);
  }, [isActive, classify]);

  /**
   * deactivate — removes all subscriptions and resets to baseline.
   */
  const deactivate = useCallback(() => {
    setIsActive(false);
    setBehaviorStage("baseline");
    setReading(DEFAULT_READING);
    imuBufferRef.current = [];
    touchBufferRef.current = [];
    stageCountRef.current = { stage: "baseline", count: 0 };

    accelSubRef.current?.remove();
    gyroSubRef.current?.remove();
    accelSubRef.current = null;
    gyroSubRef.current  = null;

    if (classifyTimerRef.current) {
      clearInterval(classifyTimerRef.current);
      classifyTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => { deactivate(); };
  }, [deactivate]);

  return (
    <BehaviorContext.Provider
      value={{
        behaviorStage,
        reading,
        recordInteraction,
        isActive,
        activate,
        deactivate,
      }}
    >
      {children}
    </BehaviorContext.Provider>
  );
}

/** useBehavior — hook to access behavior classification from any child */
export function useBehavior(): BehaviorContextValue {
  const ctx = useContext(BehaviorContext);
  if (!ctx) throw new Error("useBehavior must be used within BehaviorProvider");
  return ctx;
}

// ─── Utility exports ──────────────────────────────────────────────────────────

/** Human-readable label for each stage (Korean research terminology) */
export const STAGE_LABELS: Record<BehaviorStage, string> = {
  active:   "Active Interaction",   // 능동적 상호작용
  passive:  "Passive Viewing",      // 수동적 시청
  tool:     "Tool Utilization",     // 도구적 활용
  baseline: "No Interaction",       // 기준 상태
};

/** Example behaviors for each stage (for the UI card subtitle) */
export const STAGE_EXAMPLES: Record<BehaviorStage, string> = {
  active:   "Typing · Gaming · SNS Upload",
  passive:  "YouTube · Webtoon · SNS Scroll",
  tool:     "Navigation · Music Control",
  baseline: "Pocket · Screen Off",
};

/** Risk level descriptor for each stage */
export const STAGE_RISK: Record<BehaviorStage, "HIGH" | "MED" | "LOW" | "NONE"> = {
  active:   "HIGH",
  passive:  "MED",
  tool:     "LOW",
  baseline: "NONE",
};

/**
 * Numeric risk weight (0–3) — used by DetectionContext to calibrate
 * the combined alert level when GIS boost is applied.
 * ACTIVE gets maximum weight; BASELINE suppresses alerts entirely.
 */
export const STAGE_WEIGHT: Record<BehaviorStage, number> = {
  active:   3,
  passive:  2,
  tool:     1,
  baseline: 0,
};
