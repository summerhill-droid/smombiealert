/**
 * BehaviorStageCard.tsx — Unified Behavior & Live Sensors card
 *
 * Merges the 3-stage behavior classification and live sensor body map
 * into a single card:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  BEHAVIOR & SENSORS                      [conf]     │
 *   │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐              │
 *   │  │Active│ │Passiv│ │ Tool │ │ Base │  stage icons  │
 *   │  └──────┘ └──────┘ └──────┘ └──────┘              │
 *   │  [Stage name + risk badge]   [examples]            │
 *   │                                                     │
 *   │  ┌──────────┐  Walking Activity  ████░  100%       │
 *   │  │  body    │  Phone Angle       ████░  100%       │
 *   │  │  map     │  Distraction Risk  ███░░   70%       │
 *   │  └──────────┘                                      │
 *   │                                                     │
 *   │  IMU Signals                                       │
 *   │  Accel Var.  ████░░  0.18                         │
 *   │  ...                                               │
 *   │                                                     │
 *   │  Touch (10s)  [👆 0]  [↓ 21]  [⏱ 0]              │
 *   └─────────────────────────────────────────────────────┘
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Rect } from "react-native-svg";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { HumanFigure } from "@/components/HumanFigure";
import {
  useBehavior,
  STAGE_LABELS,
  STAGE_EXAMPLES,
  STAGE_RISK,
  type BehaviorStage,
} from "@/context/BehaviorContext";

const STAGE_ORDER: BehaviorStage[] = ["active", "passive", "tool", "baseline"];

function getStageColor(
  stage: BehaviorStage,
  colors: ReturnType<typeof useColors>
): string {
  switch (stage) {
    case "active":   return colors.danger;
    case "passive":  return colors.warning;
    case "tool":     return colors.safe;
    case "baseline": return colors.mutedForeground;
  }
}

// ─── Animated bar (shared) ────────────────────────────────────────────────────

function AnimatedBar({
  value,
  color,
  colors,
}: {
  value: number;
  color: string;
  colors: ReturnType<typeof useColors>;
}) {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(w, {
      toValue: Math.min(100, Math.max(0, value)),
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [value, w]);
  return (
    <View style={[barStyles.track, { backgroundColor: colors.muted }]}>
      <Animated.View
        style={[
          barStyles.fill,
          {
            backgroundColor: color,
            width: w.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }),
          },
        ]}
      />
    </View>
  );
}
const barStyles = StyleSheet.create({
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  fill:  { height: "100%", borderRadius: 3 },
});

// ─── Body-mapped sensor section ───────────────────────────────────────────────

function BodyMapRow({
  walkingSpeed,
  phoneAngle,
  alertLevel,
  colors,
}: {
  walkingSpeed: number;
  phoneAngle: number;
  alertLevel: string;
  colors: ReturnType<typeof useColors>;
}) {
  const distractionRisk =
    alertLevel === "danger"  ? 95 :
    alertLevel === "warning" ? 70 :
    alertLevel === "caution" ? 40 : 10;

  const walkColor =
    walkingSpeed > 50 ? colors.primary : colors.safe;
  const angleColor =
    phoneAngle > 50 && phoneAngle < 85 ? colors.warning : colors.safe;
  const riskColor =
    alertLevel === "danger"  ? colors.danger  :
    alertLevel === "warning" ? colors.warning :
    alertLevel === "caution" ? "#D4A800"      : colors.safe;

  const ST = { stroke: colors.foreground + "40", strokeWidth: 2.5, strokeLinecap: "round" as const };

  return (
    <View style={bm.row}>
      {/* Silhouette with hotspots */}
      <Svg width={56} height={128} viewBox="0 0 40 90">
        <Circle cx="20" cy="7"  r="6" fill="none" {...ST} />
        <Line x1="20" y1="13" x2="20" y2="47" {...ST} />
        <Line x1="20" y1="22" x2="10" y2="34" {...ST} />
        <Line x1="20" y1="22" x2="30" y2="34" {...ST} />
        <Line x1="20" y1="47" x2="13" y2="70" {...ST} />
        <Line x1="20" y1="47" x2="27" y2="70" {...ST} />
        <Line x1="13" y1="70" x2="9"  y2="68" {...ST} />
        <Line x1="27" y1="70" x2="31" y2="68" {...ST} />
        {/* head — distraction risk */}
        <Circle cx="20" cy="7"  r="4"   fill={riskColor}  opacity={0.3} />
        <Circle cx="20" cy="7"  r="2"   fill={riskColor} />
        {/* arms — phone angle */}
        <Circle cx="10" cy="34" r="3.5" fill={angleColor} opacity={0.3} />
        <Circle cx="10" cy="34" r="1.8" fill={angleColor} />
        <Circle cx="30" cy="34" r="3.5" fill={angleColor} opacity={0.3} />
        <Circle cx="30" cy="34" r="1.8" fill={angleColor} />
        {/* legs — walking */}
        <Circle cx="13" cy="60" r="3.5" fill={walkColor}  opacity={0.3} />
        <Circle cx="13" cy="60" r="1.8" fill={walkColor} />
        <Circle cx="27" cy="60" r="3.5" fill={walkColor}  opacity={0.3} />
        <Circle cx="27" cy="60" r="1.8" fill={walkColor} />
      </Svg>

      {/* Metric bars */}
      <View style={bm.bars}>
        {[
          { icon: "activity"    as const, label: "Walking Activity",  value: walkingSpeed,      color: walkColor  },
          { icon: "smartphone"  as const, label: "Phone Angle",       value: phoneAngle,        color: angleColor },
          { icon: "eye"         as const, label: "Distraction Risk",  value: distractionRisk,   color: riskColor  },
        ].map(({ icon, label, value, color }) => (
          <View key={label} style={bm.metric}>
            <View style={bm.metricHeader}>
              <View style={bm.metricLabel}>
                <Feather name={icon} size={10} color={color} />
                <Text style={[bm.labelText, { color: colors.mutedForeground }]}>{label}</Text>
              </View>
              <Text style={[bm.valueText, { color: colors.foreground }]}>{value}%</Text>
            </View>
            <AnimatedBar value={value} color={color} colors={colors} />
          </View>
        ))}
      </View>
    </View>
  );
}

const bm = StyleSheet.create({
  row:         { flexDirection: "row", alignItems: "center", gap: 12 },
  bars:        { flex: 1, gap: 12 },
  metric:      { gap: 5 },
  metricHeader:{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metricLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
  labelText:   { fontSize: 10, fontFamily: "Inter_500Medium", letterSpacing: 0.4, textTransform: "uppercase" },
  valueText:   { fontSize: 16, fontFamily: "Inter_700Bold" },
});

// ─── IMU signal bar ───────────────────────────────────────────────────────────

function SignalBar({ label, value, displayValue, color, colors }: {
  label: string; value: number; displayValue: string; color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={sig.row}>
      <Text style={[sig.label, { color: colors.mutedForeground }]}>{label}</Text>
      <AnimatedBar value={value} color={color} colors={colors} />
      <Text style={[sig.value, { color: colors.foreground }]}>{displayValue}</Text>
    </View>
  );
}
const sig = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 10, fontFamily: "Inter_400Regular", width: 68 },
  value: { fontSize: 13, fontFamily: "Inter_700Bold", width: 40, textAlign: "right" },
});

// ─── Touch stat pill ──────────────────────────────────────────────────────────

function TouchStat({ icon, label, value, threshold, colors }: {
  icon: keyof typeof Feather.glyphMap; label: string; value: number;
  threshold: number; colors: ReturnType<typeof useColors>;
}) {
  const isHigh = value >= threshold;
  return (
    <View style={[ts.pill, { backgroundColor: isHigh ? colors.warning + "20" : colors.muted }]}>
      <Feather name={icon} size={12} color={isHigh ? colors.warning : colors.mutedForeground} />
      <Text style={[ts.value, { color: isHigh ? colors.warning : colors.foreground }]}>{value}</Text>
      <Text style={[ts.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}
const ts = StyleSheet.create({
  pill:  { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, gap: 3 },
  value: { fontSize: 18, fontFamily: "Inter_700Bold" },
  label: { fontSize: 9, fontFamily: "Inter_500Medium" },
});

// ─── Main export ──────────────────────────────────────────────────────────────

interface BehaviorStageCardProps {
  isMonitoring: boolean;
  walkingSpeed: number;
  phoneAngle: number;
  alertLevel: string;
}

export function BehaviorStageCard({
  isMonitoring,
  walkingSpeed,
  phoneAngle,
  alertLevel,
}: BehaviorStageCardProps) {
  const colors = useColors();
  const { behaviorStage, reading } = useBehavior();

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: isMonitoring ? 1 : 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [isMonitoring, fadeAnim]);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.03, duration: 150, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 150, useNativeDriver: true }),
    ]).start();
  }, [behaviorStage, pulseAnim]);

  if (!isMonitoring) return null;

  const stageColor = getStageColor(behaviorStage, colors);
  const riskLabel  = STAGE_RISK[behaviorStage];

  const accelNorm  = Math.min(100, (reading.accelVariance / 0.5) * 100);
  const gyroNorm   = Math.min(100, (reading.gyroVariance  / 0.2) * 100);
  const stableNorm = Math.min(100, (reading.angleStability / 30) * 100);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor:     stageColor + "60",
          opacity:         fadeAnim,
          transform:       [{ scale: pulseAnim }],
          shadowColor:     stageColor,
        },
      ]}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>
          Behavior & Sensors
        </Text>
        <View style={[styles.confidenceBadge, { backgroundColor: stageColor + "20" }]}>
          <Text style={[styles.confidenceText, { color: stageColor }]}>
            {reading.confidence}% conf.
          </Text>
        </View>
      </View>

      {/* ── Human silhouette stage selector ─────────────────────────── */}
      <View style={styles.stageRow}>
        {STAGE_ORDER.map((stage) => {
          const isActive = stage === behaviorStage;
          const sColor   = getStageColor(stage, colors);
          return (
            <View key={stage} style={styles.stageCell}>
              <View
                style={[
                  styles.figureWrap,
                  {
                    backgroundColor: isActive ? sColor + "18" : "transparent",
                    borderColor:     isActive ? sColor + "80" : "transparent",
                  },
                ]}
              >
                <HumanFigure
                  stage={stage}
                  color={isActive ? sColor : colors.mutedForeground + "70"}
                  size={28}
                />
              </View>
              <Text
                style={[styles.stageLabel, { color: isActive ? sColor : colors.mutedForeground }]}
                numberOfLines={1}
              >
                {stage.charAt(0).toUpperCase() + stage.slice(1)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* ── Stage info banner ────────────────────────────────────────── */}
      <View style={[styles.stageInfo, { backgroundColor: stageColor + "10" }]}>
        <View style={styles.stageInfoRow}>
          <Text style={[styles.stageName, { color: stageColor }]}>
            {STAGE_LABELS[behaviorStage]}
          </Text>
          <View style={[styles.riskBadge, { backgroundColor: stageColor + "25" }]}>
            <Text style={[styles.riskText, { color: stageColor }]}>{riskLabel} RISK</Text>
          </View>
        </View>
        <Text style={[styles.stageExamples, { color: colors.mutedForeground }]}>
          {STAGE_EXAMPLES[behaviorStage]}
        </Text>
      </View>

      {/* ── Divider ──────────────────────────────────────────────────── */}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* ── Body-mapped live sensors ─────────────────────────────────── */}
      <BodyMapRow
        walkingSpeed={walkingSpeed}
        phoneAngle={phoneAngle}
        alertLevel={alertLevel}
        colors={colors}
      />

      {/* ── Divider ──────────────────────────────────────────────────── */}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* ── IMU Signals ──────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>IMU Signals</Text>
        <SignalBar
          label="Accel Var."
          value={accelNorm}
          displayValue={reading.accelVariance.toFixed(3)}
          color={accelNorm > 60 ? colors.danger : accelNorm > 30 ? colors.warning : colors.safe}
          colors={colors}
        />
        <SignalBar
          label="Gyro Var."
          value={gyroNorm}
          displayValue={reading.gyroVariance.toFixed(3)}
          color={gyroNorm > 50 ? colors.warning : colors.safe}
          colors={colors}
        />
        <SignalBar
          label="Stability"
          value={stableNorm}
          displayValue={`${reading.angleStability.toFixed(1)}°`}
          color={stableNorm < 30 ? colors.safe : stableNorm < 60 ? colors.warning : colors.danger}
          colors={colors}
        />
        <View style={styles.pitchRow}>
          <Text style={[styles.pitchLabel, { color: colors.mutedForeground }]}>Pitch Angle</Text>
          <View style={styles.pitchRight}>
            <Text style={[styles.pitchValue, { color: colors.foreground }]}>
              {reading.pitchAngle}°
            </Text>
            <Text
              style={[
                styles.pitchTag,
                {
                  color:
                    reading.pitchAngle >= 40 && reading.pitchAngle <= 85
                      ? colors.warning
                      : colors.mutedForeground,
                },
              ]}
            >
              {reading.pitchAngle >= 40 && reading.pitchAngle <= 85
                ? "reading posture"
                : "normal"}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Touch events ─────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Touch (10s)</Text>
        <View style={styles.touchStats}>
          <TouchStat icon="mouse-pointer" label="Taps"    value={reading.tapCount10s}      threshold={3} colors={colors} />
          <TouchStat icon="arrow-down"    label="Scrolls" value={reading.scrollCount10s}    threshold={2} colors={colors} />
          <TouchStat icon="clock"         label="Long"    value={reading.longpressCount30s} threshold={1} colors={colors} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius:  16,
    borderWidth:   1.5,
    padding:       16,
    gap:           14,
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius:  12,
    elevation:     4,
    marginBottom:  16,
  },
  header: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
  },
  cardTitle: {
    fontSize:      13,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      20,
  },
  confidenceText: {
    fontSize:   11,
    fontFamily: "Inter_600SemiBold",
  },
  stageRow: {
    flexDirection: "row",
    gap:           6,
  },
  stageCell: {
    flex:       1,
    alignItems: "center",
    gap:        5,
  },
  figureWrap: {
    borderRadius:      12,
    borderWidth:       1.5,
    paddingVertical:   8,
    paddingHorizontal: 4,
    alignItems:        "center",
    justifyContent:    "center",
    width:             "100%",
  },
  stageLabel: {
    fontSize:      9,
    fontFamily:    "Inter_600SemiBold",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  stageInfo: {
    borderRadius: 10,
    padding:      12,
    gap:          4,
  },
  stageInfoRow: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
  },
  stageName: {
    fontSize:   14,
    fontFamily: "Inter_700Bold",
  },
  riskBadge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      20,
  },
  riskText: {
    fontSize:      10,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.8,
  },
  stageExamples: {
    fontSize:   12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  divider: {
    height:       1,
    borderRadius: 1,
    marginVertical: -2,
  },
  section: { gap: 8 },
  sectionTitle: {
    fontSize:      12,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom:  2,
  },
  pitchRow: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    paddingTop:     2,
  },
  pitchLabel: {
    fontSize:   10,
    fontFamily: "Inter_400Regular",
  },
  pitchRight:  { alignItems: "flex-end" },
  pitchValue: {
    fontSize:   20,
    fontFamily: "Inter_700Bold",
    lineHeight: 22,
  },
  pitchTag: {
    fontSize:   10,
    fontFamily: "Inter_400Regular",
    marginTop:  1,
  },
  touchStats: {
    flexDirection: "row",
    gap:           6,
  },
});
