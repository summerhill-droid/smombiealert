/**
 * GISInfoCard.tsx — GIS environment risk factors panel
 *
 * Shown on the Monitor screen below the sensor metrics.
 * Displays four live GIS factors from GISContext and the combined boost score.
 *
 * STATES:
 *   1. No permission → "Enable Location" button
 *   2. Permission granted, data loading → spinner in header
 *   3. Overpass API failed → error message with refresh button
 *   4. Data loaded → four factor rows + boost bar
 *
 * FOUR FACTORS (from research plan detection spec):
 *   Crosswalk — nearest crosswalk distance in metres
 *   Streetlights — count of street lamps within 80 m
 *   Traffic — OSM road type classification (None/Light/Moderate/Heavy)
 *   Slope — terrain grade % from GPS altitude delta
 *
 * COLOR CODING:
 *   green  = low risk    (crosswalk far, many lights, light traffic, flat)
 *   amber  = medium risk
 *   red    = high risk   (crosswalk < 50 m, no lights, heavy traffic, steep)
 *
 * BOOST BAR:
 *   Horizontal progress bar showing gisRiskBoost (0–100).
 *   Color matches severity: green < 30, amber 30–60, red > 60.
 */

import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { TrafficLevel } from "@/context/GISContext";
import { useColors } from "@/hooks/useColors";

interface GISInfoCardProps {
  nearestCrosswalkDist: number | null; // metres (null = none found within 350 m)
  streetlightCount: number;            // count within 80 m
  trafficLevel: TrafficLevel;
  slope: number;                       // grade %
  gisRiskBoost: number;               // combined score 0–100
  dataSource: "seoul" | "osm" | "none";
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  hasPermission: boolean;
  onRequestPermission: () => void;
}

// ── Sub-component: single factor row ──────────────────────────────────────────
/**
 * Factor — one row in the four-factor grid.
 * Icon + label on the left, value in the center, risk label on the right.
 * Background tint and text colors reflect the risk level.
 */
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
      {/* Icon with 18% opacity background tint matching risk color */}
      <View style={[styles.factorIcon, { backgroundColor: `${riskColor}18` }]}>
        <Feather name={icon as keyof typeof Feather.glyphMap} size={15} color={riskColor} />
      </View>
      <View style={styles.factorText}>
        <Text style={[styles.factorLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.factorValue, { color: colors.foreground }]}>{value}</Text>
      </View>
      {/* Short risk assessment word: "Nearby!", "Dark!", "Safe", etc. */}
      <Text style={[styles.factorSub, { color: riskColor }]}>{sub}</Text>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function GISInfoCard({
  nearestCrosswalkDist,
  streetlightCount,
  trafficLevel,
  slope,
  gisRiskBoost,
  dataSource,
  isLoading,
  error,
  onRefresh,
  hasPermission,
  onRequestPermission,
}: GISInfoCardProps) {
  const colors = useColors();

  // ── Permission not granted: show enable button ────────────────────────────
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
          <Feather name="navigation" size={15} color={colors.primaryForeground} />
          <Text style={[styles.permBtnText, { color: colors.primaryForeground }]}>
            Enable Location
          </Text>
        </TouchableOpacity>
        <Text style={[styles.permNote, { color: colors.mutedForeground }]}>
          Required to load crosswalk, streetlight, traffic, and slope data
        </Text>
      </View>
    );
  }

  // ── Derive risk colors for each factor ────────────────────────────────────
  // Crosswalk: red if very close, amber if nearby, green if far
  const crosswalkColor =
    nearestCrosswalkDist !== null && nearestCrosswalkDist < 50
      ? colors.danger
      : nearestCrosswalkDist !== null && nearestCrosswalkDist < 150
      ? colors.warning
      : colors.safe;

  // Streetlights: red if none, amber if few, green if sufficient
  const lightColor =
    streetlightCount === 0 ? colors.danger : streetlightCount < 3 ? colors.warning : colors.safe;

  // Traffic: mirrors TRAFFIC_MAP severity
  const trafficColor =
    trafficLevel === "heavy"
      ? colors.danger
      : trafficLevel === "moderate"
      ? colors.warning
      : colors.safe;

  // Slope: red > 10%, amber > 5%, green = flat
  const slopeColor = slope > 10 ? colors.danger : slope > 5 ? colors.warning : colors.safe;

  // Overall boost bar color
  const boostColor =
    gisRiskBoost > 60 ? colors.danger : gisRiskBoost > 30 ? colors.warning : colors.safe;

  // Human-readable traffic label
  const trafficLabel = {
    none: "None",
    light: "Light",
    moderate: "Moderate",
    heavy: "Heavy",
  }[trafficLevel];

  // Data source badge config
  const sourceBadge =
    dataSource === "seoul"
      ? { label: "서울시 공식 데이터", color: "#2563EB", bg: "#EFF6FF" }
      : dataSource === "osm"
      ? { label: "OpenStreetMap", color: "#7C3AED", bg: "#F5F3FF" }
      : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header: title + data source badge + loading/refresh */}
      <View style={styles.cardHeader}>
        <Feather name="map-pin" size={16} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>GIS Risk Factors</Text>
        {sourceBadge && (
          <View style={[styles.sourceBadge, { backgroundColor: sourceBadge.bg, borderColor: sourceBadge.color + "40" }]}>
            <Text style={[styles.sourceBadgeText, { color: sourceBadge.color }]}>
              {sourceBadge.label}
            </Text>
          </View>
        )}
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: "auto" }} />
        ) : (
          <TouchableOpacity onPress={onRefresh} style={{ marginLeft: "auto" }}>
            <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* Error state: show message instead of factor rows */}
      {error ? (
        <Text style={[styles.error, { color: colors.warning }]}>{error}</Text>
      ) : (
        // Four factor rows
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

      {/* Combined boost bar (hidden when API error) */}
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
          {/* Numeric boost value (+30, +65, etc.) */}
          <Text style={[styles.boostPct, { color: boostColor }]}>+{gisRiskBoost}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  sourceBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
  cardTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  factorsGrid: { gap: 7 },
  factor: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  factorIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  factorText: { flex: 1 },
  factorLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  factorValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginTop: 1,
  },
  factorSub: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  boostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  boostLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    flex: 0,
    minWidth: 110,
  },
  boostTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  boostFill: {
    height: "100%",
    borderRadius: 3,
  },
  boostPct: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    minWidth: 28,
    textAlign: "right",
  },
  permBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    borderRadius: 10,
  },
  permBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  permNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 17,
  },
  error: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
});
