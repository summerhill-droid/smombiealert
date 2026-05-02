/**
 * BehaviorStageCard.tsx — Human-Centric Behavior Classification Display
 *
 * Redesigned to show human action silhouettes instead of abstract icons,
 * with a glow effect on the active stage, icon-tagged touch stats,
 * and larger data values for at-a-glance readability.
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
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

// ─── Animated signal bar ──────────────────────────────────────────────────────

interface SignalBarProps {
  label: string;
  value: number;
  displayValue: string;
  color: string;
  colors: ReturnType<typeof useColors>;
}

function SignalBar({ label, value, displayValue, color, colors }: SignalBarProps) {
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: Math.min(Math.max(value, 0), 100),
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [value, widthAnim]);

  return (
    <View style={styles.signalRow}>
      <Text style={[styles.signalLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.signalTrack, { backgroundColor: colors.muted }]}>
        <Animated.View
          style={[
            styles.signalFill,
            {
              backgroundColor: color,
              width: widthAnim.interpolate({
                inputRange: [0, 100],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>
      <Text style={[styles.signalValue, { color: colors.foreground }]}>{displayValue}</Text>
    </View>
  );
}

// ─── Touch stat with icon ─────────────────────────────────────────────────────

function TouchStat({
  icon,
  label,
  value,
  threshold,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: number;
  threshold: number;
  colors: ReturnType<typeof useColors>;
}) {
  const isHigh = value >= threshold;
  const tint = isHigh ? colors.warning : colors.mutedForeground;
  return (
    <View style={[styles.touchPill, { backgroundColor: isHigh ? colors.warning + "20" : colors.muted }]}>
      <Feather name={icon} size={12} color={tint} />
      <Text style={[styles.touchValue, { color: isHigh ? colors.warning : colors.foreground }]}>
        {value}
      </Text>
      <Text style={[styles.touchLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface BehaviorStageCardProps {
  isMonitoring: boolean;
}

export function BehaviorStageCard({ isMonitoring }: BehaviorStageCardProps) {
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
          Behavior Classification
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
              {/* Glow / highlight behind the selected figure */}
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
                  color={isActive ? sColor : colors.mutedForeground + "80"}
                  size={28}
                />
              </View>
              <Text
                style={[
                  styles.stageLabel,
                  { color: isActive ? sColor : colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {stage.charAt(0).toUpperCase() + stage.slice(1)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* ── Stage name + examples ────────────────────────────────────── */}
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

        {/* Pitch angle — big value, small label */}
        <View style={styles.pitchRow}>
          <Text style={[styles.pitchLabel, { color: colors.mutedForeground }]}>Pitch Angle</Text>
          <View style={styles.pitchRight}>
            <Text style={[styles.pitchBigValue, { color: colors.foreground }]}>
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

      {/* ── Touch events — horizontal row with icons ─────────────────── */}
      <View style={styles.touchRow}>
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
    borderRadius: 12,
    borderWidth:  1.5,
    paddingVertical:   8,
    paddingHorizontal: 4,
    alignItems:   "center",
    justifyContent: "center",
    width: "100%",
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
  section: { gap: 8 },
  sectionTitle: {
    fontSize:      12,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom:  2,
  },
  signalRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
  },
  signalLabel: {
    fontSize:   10,
    fontFamily: "Inter_400Regular",
    width:      68,
  },
  signalTrack: {
    flex:         1,
    height:       6,
    borderRadius: 3,
    overflow:     "hidden",
  },
  signalFill: {
    height:       "100%",
    borderRadius: 3,
  },
  signalValue: {
    fontSize:   13,
    fontFamily: "Inter_700Bold",
    width:      40,
    textAlign:  "right",
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
  pitchRight: {
    alignItems: "flex-end",
  },
  pitchBigValue: {
    fontSize:   20,
    fontFamily: "Inter_700Bold",
    lineHeight: 22,
  },
  pitchTag: {
    fontSize:   10,
    fontFamily: "Inter_400Regular",
    marginTop:  1,
  },
  touchRow: {
    gap: 8,
  },
  touchStats: {
    flexDirection: "row",
    gap:           6,
  },
  touchPill: {
    flex:           1,
    flexDirection:  "column",
    alignItems:     "center",
    paddingVertical: 8,
    borderRadius:   10,
    gap:            3,
  },
  touchValue: {
    fontSize:   18,
    fontFamily: "Inter_700Bold",
  },
  touchLabel: {
    fontSize:   9,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.2,
  },
});
