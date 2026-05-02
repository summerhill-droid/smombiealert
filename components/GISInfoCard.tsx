/**
 * GISInfoCard.tsx — GIS environment risk factors panel (redesigned)
 *
 * Changes:
 *  - "Enable Location" → "Check Nearby Hazards" with map-pin icon
 *  - Warning triangle [!] next to loading/status text
 *  - Motivational copy throughout
 */

import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { TrafficLevel } from "@/context/GISContext";
import { useColors } from "@/hooks/useColors";

interface GISInfoCardProps {
  nearestCrosswalkDist: number | null;
  streetlightCount: number;
  trafficLevel: TrafficLevel;
  slope: number;
  gisRiskBoost: number;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  hasPermission: boolean;
  onRequestPermission: () => void;
}

function Factor({
  icon,
  label,
  value,
  sub,
  riskColor,
}: {
  icon: string;
  label: string;
  value: string;
  sub: string;
  riskColor: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.factor, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={[styles.factorIcon, { backgroundColor: `${riskColor}18` }]}>
        <Feather name={icon as keyof typeof Feather.glyphMap} size={15} color={riskColor} />
      </View>
      <View style={styles.factorText}>
        <Text style={[styles.factorLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.factorValue, { color: colors.foreground }]}>{value}</Text>
      </View>
      <Text style={[styles.factorSub, { color: riskColor }]}>{sub}</Text>
    </View>
  );
}

export function GISInfoCard({
  nearestCrosswalkDist,
  streetlightCount,
  trafficLevel,
  slope,
  gisRiskBoost,
  isLoading,
  error,
  onRefresh,
  hasPermission,
  onRequestPermission,
}: GISInfoCardProps) {
  const colors = useColors();

  if (!hasPermission) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="map-pin" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>GIS Risk Factors</Text>
        </View>
        <TouchableOpacity
          onPress={onRequestPermission}
          style={[styles.permBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.85}
        >
          <Feather name="map-pin" size={16} color={colors.primaryForeground} />
          <Text style={[styles.permBtnText, { color: colors.primaryForeground }]}>
            Check Nearby Hazards
          </Text>
        </TouchableOpacity>
        <Text style={[styles.permNote, { color: colors.mutedForeground }]}>
          Grant location access to scan crosswalks, streetlights, traffic and slope nearby
        </Text>
      </View>
    );
  }

  const crosswalkColor =
    nearestCrosswalkDist !== null && nearestCrosswalkDist < 50
      ? colors.danger
      : nearestCrosswalkDist !== null && nearestCrosswalkDist < 150
      ? colors.warning
      : colors.safe;

  const lightColor =
    streetlightCount === 0 ? colors.danger : streetlightCount < 3 ? colors.warning : colors.safe;

  const trafficColor =
    trafficLevel === "heavy"
      ? colors.danger
      : trafficLevel === "moderate"
      ? colors.warning
      : colors.safe;

  const slopeColor = slope > 10 ? colors.danger : slope > 5 ? colors.warning : colors.safe;

  const boostColor =
    gisRiskBoost > 60 ? colors.danger : gisRiskBoost > 30 ? colors.warning : colors.safe;

  const trafficLabel = {
    none: "None",
    light: "Light",
    moderate: "Moderate",
    heavy: "Heavy",
  }[trafficLevel];

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="map-pin" size={16} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>GIS Risk Factors</Text>
        {isLoading ? (
          <View style={styles.loadingRow}>
            <Feather name="alert-triangle" size={12} color={colors.warning} />
            <Text style={[styles.loadingText, { color: colors.warning }]}>
              Loading: crosswalk, streetlight…
            </Text>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : (
          <TouchableOpacity onPress={onRefresh} style={{ marginLeft: "auto" }}>
            <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <Feather name="alert-triangle" size={14} color={colors.warning} />
          <Text style={[styles.error, { color: colors.warning }]}>{error}</Text>
        </View>
      ) : (
        <View style={styles.factorsGrid}>
          <Factor
            icon="crosshair"
            label="Crosswalk"
            value={nearestCrosswalkDist !== null ? `${nearestCrosswalkDist}m` : "—"}
            sub={
              nearestCrosswalkDist !== null && nearestCrosswalkDist < 50
                ? "Nearby!"
                : nearestCrosswalkDist !== null && nearestCrosswalkDist < 150
                ? "Ahead"
                : "Clear"
            }
            riskColor={crosswalkColor}
          />
          <Factor
            icon="sun"
            label="Streetlights"
            value={String(streetlightCount)}
            sub={streetlightCount === 0 ? "Dark!" : streetlightCount < 3 ? "Dim" : "Lit"}
            riskColor={lightColor}
          />
          <Factor
            icon="truck"
            label="Traffic"
            value={trafficLabel}
            sub={trafficLevel === "heavy" ? "Danger" : trafficLevel === "moderate" ? "Caution" : "Safe"}
            riskColor={trafficColor}
          />
          <Factor
            icon="trending-up"
            label="Slope"
            value={`${slope}%`}
            sub={slope > 10 ? "Steep!" : slope > 5 ? "Grade" : "Flat"}
            riskColor={slopeColor}
          />
        </View>
      )}

      {!error && (
        <View style={styles.boostRow}>
          <Text style={[styles.boostLabel, { color: colors.mutedForeground }]}>
            Environment risk
          </Text>
          <View style={[styles.boostTrack, { backgroundColor: colors.muted }]}>
            <View
              style={[
                styles.boostFill,
                {
                  width: `${gisRiskBoost}%` as `${number}%`,
                  backgroundColor: boostColor,
                },
              ]}
            />
          </View>
          <Text style={[styles.boostPct, { color: boostColor }]}>+{gisRiskBoost}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth:  1,
    padding:      14,
    gap:          12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           7,
    flexWrap:      "wrap",
  },
  cardTitle: {
    fontSize:   14,
    fontFamily: "Inter_700Bold",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           5,
    marginLeft:    "auto",
  },
  loadingText: {
    fontSize:   10,
    fontFamily: "Inter_500Medium",
  },
  factorsGrid: { gap: 7 },
  factor: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           10,
    padding:       10,
    borderRadius:  10,
    borderWidth:   1,
  },
  factorIcon: {
    width:           30,
    height:          30,
    borderRadius:    8,
    alignItems:      "center",
    justifyContent:  "center",
  },
  factorText: { flex: 1 },
  factorLabel: {
    fontSize:      10,
    fontFamily:    "Inter_500Medium",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  factorValue: {
    fontSize:   14,
    fontFamily: "Inter_600SemiBold",
    marginTop:  1,
  },
  factorSub: {
    fontSize:   12,
    fontFamily: "Inter_600SemiBold",
  },
  boostRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
  },
  boostLabel: {
    fontSize:   11,
    fontFamily: "Inter_500Medium",
    flex:       0,
    minWidth:   110,
  },
  boostTrack: {
    flex:         1,
    height:       5,
    borderRadius: 3,
    overflow:     "hidden",
  },
  boostFill: {
    height:       "100%",
    borderRadius: 3,
  },
  boostPct: {
    fontSize:   12,
    fontFamily: "Inter_700Bold",
    minWidth:   28,
    textAlign:  "right",
  },
  permBtn: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
    paddingVertical: 13,
    borderRadius:   12,
  },
  permBtnText: {
    fontSize:   15,
    fontFamily: "Inter_700Bold",
  },
  permNote: {
    fontSize:   12,
    fontFamily: "Inter_400Regular",
    textAlign:  "center",
    lineHeight: 17,
  },
  errorRow: {
    flexDirection: "row",
    alignItems:    "flex-start",
    gap:           6,
  },
  error: {
    flex:       1,
    fontSize:   12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
});
