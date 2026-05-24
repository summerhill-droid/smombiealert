/**
 * SignalCard.tsx — Live V2X Pedestrian Signal Display (v3)
 *
 * Shows the best available pedestrian signal from the Seoul V2X network,
 * but ONLY when the user is within 50 m of a crosswalk.  If the user is
 * farther away the card shows "No intersection within 50 m" instead.
 *
 * PHASE COLORS:
 *   🟢 Green  (protected-Movement-Allowed) — pedestrian may cross
 *   🔴 Red    (stop-And-Remain)            — pedestrian must wait
 *   ⚪ Unknown — no phase info in current data
 */

import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSignal } from "@/context/SignalContext";
import { useColors } from "@/hooks/useColors";
import type { SignalPhase } from "@/services/signalAPI";

// ─── Phase helpers ────────────────────────────────────────────────────────────

const PHASE_COLOR: Record<SignalPhase, string> = {
  green:   "#27AE60",
  red:     "#E84545",
  unknown: "#8E8E93",
};

const PHASE_LABEL: Record<SignalPhase, string> = {
  green:   "WALK",
  red:     "WAIT",
  unknown: "Checking…",
};

const PHASE_ICON: Record<SignalPhase, keyof typeof Feather.glyphMap> = {
  green:   "check-circle",
  red:     "x-circle",
  unknown: "help-circle",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface SignalCardProps {
  isMonitoring: boolean;
}

export function SignalCard({ isMonitoring }: SignalCardProps) {
  const colors = useColors();
  const {
    bestSignal,
    stationCount,
    crosswalkDist,
    isLoadingSignal,
    signalError,
    refreshSignal,
  } = useSignal();

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse faster when green (urgency to cross)
  useEffect(() => {
    const phase    = bestSignal?.phase ?? "unknown";
    const duration = phase === "green" ? 500 : 1_400;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [bestSignal?.phase, pulseAnim]);

  if (!isMonitoring) return null;

  const phase     = bestSignal?.phase ?? "unknown";
  const color     = PHASE_COLOR[phase];
  const remaining = bestSignal?.remainingSec ?? 0;
  const greenDirs = bestSignal?.activeGreenDirs ?? [];

  // ── Determine what to show in the body ──────────────────────────────────
  const distLabel =
    crosswalkDist === null
      ? null
      : crosswalkDist < 1000
      ? `${Math.round(crosswalkDist)} m away`
      : `${(crosswalkDist / 1000).toFixed(1)} km away`;

  // Not within 50 m → show proximity message instead of signal
  const tooFar = crosswalkDist !== null && crosswalkDist > 50;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: colors.foreground }]}>Pedestrian Signal</Text>
          {stationCount > 0 && (
            <View style={[styles.stationBadge, { backgroundColor: `${colors.primary}18` }]}>
              <Text style={[styles.stationText, { color: colors.primary }]}>
                {stationCount} V2X stations live
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={refreshSignal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Body */}
      {isLoadingSignal ? (
        <Text style={[styles.loading, { color: colors.mutedForeground }]}>
          Connecting to Seoul V2X network…
        </Text>
      ) : tooFar ? (
        // User is more than 50 m from the nearest crosswalk
        <View style={styles.noDataRow}>
          <Feather name="map-pin" size={16} color={colors.mutedForeground} />
          <View style={styles.noDataTextCol}>
            <Text style={[styles.noData, { color: colors.mutedForeground }]}>
              No intersection within 50 m
            </Text>
            {distLabel && (
              <Text style={[styles.noDataSub, { color: colors.mutedForeground }]}>
                Nearest crosswalk: {distLabel}
              </Text>
            )}
          </View>
        </View>
      ) : signalError || !bestSignal ? (
        // Within range but no V2X data
        <View style={styles.noDataRow}>
          <Feather name="wifi-off" size={16} color={colors.mutedForeground} />
          <Text style={[styles.noData, { color: colors.mutedForeground }]}>
            {signalError ?? "No V2X data available"}
          </Text>
        </View>
      ) : (
        // Within 50 m — show live signal
        <View style={styles.body}>
          {/* Phase indicator */}
          <Animated.View
            style={[
              styles.phaseCircle,
              { backgroundColor: `${color}20`, transform: [{ scale: pulseAnim }] },
            ]}
          >
            <Feather name={PHASE_ICON[phase]} size={36} color={color} />
          </Animated.View>

          {/* Info column */}
          <View style={styles.infoCol}>
            <Text style={[styles.phaseLabel, { color }]}>{PHASE_LABEL[phase]}</Text>

            {remaining > 0 && (
              <Text style={[styles.countdown, { color: colors.foreground }]}>
                {remaining}s {phase === "green" ? "to cross" : "until green"}
              </Text>
            )}

            {greenDirs.length > 0 && (
              <Text style={[styles.dirs, { color: colors.mutedForeground }]}>
                Green: {greenDirs.join(" · ")}
              </Text>
            )}

            <View style={styles.metaRow}>
              <Text style={[styles.itstId, { color: colors.mutedForeground }]}>
                Station {bestSignal.intersectionId}
              </Text>
              {distLabel && (
                <Text style={[styles.distLabel, { color: colors.mutedForeground }]}>
                  · {distLabel}
                </Text>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding:      16,
    borderRadius: 14,
    borderWidth:  1,
    marginBottom: 16,
    gap:          12,
  },
  headerRow: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "flex-start",
  },
  headerLeft: { gap: 4 },
  title: {
    fontSize:    14,
    fontFamily:  "Inter_700Bold",
    letterSpacing: 0.3,
  },
  stationBadge: {
    alignSelf:         "flex-start",
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      10,
  },
  stationText: {
    fontSize:   10,
    fontFamily: "Inter_600SemiBold",
  },
  loading: { fontSize: 13, fontFamily: "Inter_400Regular" },
  noDataRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  noDataTextCol: { flex: 1, gap: 2 },
  noData:    { fontSize: 13, fontFamily: "Inter_400Regular" },
  noDataSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  body: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           16,
  },
  phaseCircle: {
    width:          72,
    height:         72,
    borderRadius:   36,
    alignItems:     "center",
    justifyContent: "center",
  },
  infoCol: { flex: 1, gap: 4 },
  phaseLabel: {
    fontSize:      22,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.5,
  },
  countdown: {
    fontSize:   15,
    fontFamily: "Inter_600SemiBold",
  },
  dirs: {
    fontSize:   12,
    fontFamily: "Inter_400Regular",
    marginTop:  2,
  },
  metaRow: {
    flexDirection: "row",
    gap:           4,
    marginTop:     2,
  },
  itstId: {
    fontSize:   11,
    fontFamily: "Inter_400Regular",
  },
  distLabel: {
    fontSize:   11,
    fontFamily: "Inter_400Regular",
  },
});
