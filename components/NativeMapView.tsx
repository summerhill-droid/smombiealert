/**
 * NativeMapView.tsx — Web fallback for the Map tab
 *
 * This file is used on WEB only.
 * On iOS/Android, Metro resolves @/components/NativeMapView to
 * NativeMapView.native.tsx (which has the actual react-native-maps map).
 *
 * WHY SEPARATE FILES INSTEAD OF Platform.OS CHECK:
 *   react-native-maps imports native C++ bridge code that cannot be bundled
 *   for web. A runtime Platform.OS check is not enough — the bundler still
 *   processes the import statement at build time. Using `.native.tsx` suffix
 *   tells Metro to exclude this import entirely when building for web.
 *
 * This file shows:
 *   - A "view on your phone" message
 *   - The same GIS statistics displayed as a text table (using GISContext data)
 */

import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useGIS } from "@/context/GISContext";

export default function NativeMapView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // Read GIS data even on web (location won't work but values show)
  const { gisRiskBoost, nearestCrosswalkDist, streetlightCount, trafficLevel, slope } = useGIS();

  // On web the safe area inset is 0 but the URL bar adds ~67px of visual chrome
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: topPad + 20 },
      ]}
    >
      {/* Icon + heading */}
      <Feather name="map" size={52} color={colors.mutedForeground} />
      <Text style={[styles.title, { color: colors.foreground }]}>Live GIS Map</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Open in Expo Go on your phone to see the interactive map with crosswalk markers,
        streetlight coverage, and your live safety zone.
      </Text>

      {/* Stats table (shows same values as the native map panel) */}
      <View style={[styles.preview, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Row
          label="Nearest Crosswalk"
          value={nearestCrosswalkDist !== null ? `${nearestCrosswalkDist}m` : "—"}
          colors={colors}
        />
        <Row label="Streetlights (80m)" value={String(streetlightCount)} colors={colors} />
        <Row
          label="Traffic Level"
          value={{ none: "None", light: "Light", moderate: "Moderate", heavy: "Heavy" }[trafficLevel]}
          colors={colors}
        />
        <Row label="Slope Grade" value={`${slope}%`} colors={colors} />
        <Row label="GIS Risk Boost" value={`+${gisRiskBoost}`} colors={colors} last />
      </View>
    </View>
  );
}

/** Simple two-column table row */
function Row({
  label,
  value,
  colors,
  last,
}: {
  label: string;
  value: string;
  colors: any;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.row,
        { borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border },
      ]}
    >
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  sub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  preview: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  rowValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
