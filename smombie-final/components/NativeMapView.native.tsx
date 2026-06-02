/**
 * NativeMapView.native.tsx — Interactive map for iOS and Android
 *
 * This file is used on NATIVE PLATFORMS ONLY (iOS/Android).
 * On web, Metro resolves @/components/NativeMapView to NativeMapView.tsx
 * (the plain text fallback) — so react-native-maps never enters the web bundle.
 *
 * WHAT THE MAP SHOWS (research plan Week 4–5):
 *   - Red pin markers at every crosswalk within 350 m (from Overpass API)
 *   - Semi-transparent red circles around each crosswalk (15 m radius)
 *   - A colored safety zone circle around the user's current position (30 m)
 *     → green = low GIS risk, amber = moderate, red = high
 *   - The standard blue dot for the user's GPS position (showsUserLocation)
 *
 * BOTTOM PANEL:
 *   Shows the same four GIS stats as GISInfoCard (crosswalk, lights,
 *   traffic, slope) + the combined boost bar, so users can see context
 *   without switching to the Monitor tab.
 *
 * REFRESH BUTTON:
 *   Re-runs the Overpass query for the current position.
 *   Useful if the user suspects stale data or the API previously failed.
 *
 * CENTER BUTTON:
 *   Animates the map back to the user's current position.
 *
 * DEPENDENCY:
 *   react-native-maps@1.18.0 — pinned for Expo Go compatibility.
 *   Do NOT add to the plugins array in app.json (Expo Go limitation).
 */

import React, { useRef } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useGIS, TrafficLevel } from "@/context/GISContext";

/** Maps TrafficLevel to a hex color for the bottom panel stat rows */
function trafficColor(level: TrafficLevel): string {
  return level === "heavy"
    ? "#E84545"
    : level === "moderate"
    ? "#F39C12"
    : level === "light"
    ? "#27AE60"
    : "#888888";
}

export default function NativeMapView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Pull all GIS data from context (location, crosswalks, risk stats)
  const {
    userLocation,
    nearbyCrosswalks,
    nearestCrosswalkDist,
    streetlightCount,
    trafficLevel,
    slope,
    gisRiskBoost,
    isLoadingGIS,
    gisError,
    permissionStatus,
    requestPermission,
    refreshGIS,
  } = useGIS();

  // Ref to the MapView for programmatic camera animation
  const mapRef = useRef<MapView>(null);

  /** Animates the map camera back to the user's GPS position */
  function centerOnUser() {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          latitudeDelta: 0.003,   // ~300 m vertical span
          longitudeDelta: 0.003,
        },
        600  // Animation duration in ms
      );
    }
  }

  // ── State: no permission ────────────────────────────────────────────────
  if (permissionStatus === "unknown" || permissionStatus === "denied") {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="navigation" size={48} color={colors.primary} />
        <Text style={[styles.centerTitle, { color: colors.foreground }]}>Location needed</Text>
        <Text style={[styles.centerSub, { color: colors.mutedForeground }]}>
          Enable location to load the GIS map with crosswalks, streetlights, and traffic data.
        </Text>
        <TouchableOpacity
          onPress={requestPermission}
          style={[styles.permBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.85}
        >
          <Text style={[styles.permBtnText, { color: colors.primaryForeground }]}>
            Enable Location
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── State: permission granted but no GPS fix yet ─────────────────────────
  if (!userLocation) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.centerSub, { color: colors.mutedForeground }]}>
          Getting your location…
        </Text>
      </View>
    );
  }

  // ── Safety zone circle color (green/amber/red based on GIS boost) ────────
  const boostColor =
    gisRiskBoost > 60 ? colors.danger : gisRiskBoost > 30 ? colors.warning : colors.safe;

  return (
    <View style={styles.container}>
      {/* ── Full-screen map ─────────────────────────────────────────────── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          latitudeDelta: 0.004,   // ~400 m vertical span on first load
          longitudeDelta: 0.004,
        }}
        showsUserLocation          // Built-in blue dot for GPS position
        showsMyLocationButton={false}  // Hidden — we use our own center button
        showsCompass={false}
      >
        {/* ── Crosswalk markers (one per crossing node from Overpass) ─── */}
        {nearbyCrosswalks.map((cw) => (
          <React.Fragment key={cw.id}>
            {/* Red pin at the exact crosswalk coordinates */}
            <Marker
              coordinate={{ latitude: cw.lat, longitude: cw.lng }}
              title="Crosswalk"
              description="Look both ways!"
              pinColor="#E84545"
            />
            {/* Semi-transparent red circle (15 m radius = "in the crosswalk") */}
            <Circle
              center={{ latitude: cw.lat, longitude: cw.lng }}
              radius={15}
              strokeColor="rgba(232,69,69,0.6)"
              fillColor="rgba(232,69,69,0.12)"
              strokeWidth={1.5}
            />
          </React.Fragment>
        ))}

        {/* ── User safety zone (30 m, color = GIS risk level) ─────────── */}
        <Circle
          center={{ latitude: userLocation.lat, longitude: userLocation.lng }}
          radius={30}
          strokeColor={`${boostColor}60`}  // 60% opacity border
          fillColor={`${boostColor}15`}    // 15% opacity fill
          strokeWidth={1.5}
        />
      </MapView>

      {/* ── Top header bar (floats above the map) ───────────────────────── */}
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + 8,
            backgroundColor: `${colors.background}EE`,  // 93% opacity
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.topTitle, { color: colors.foreground }]}>Live GIS Map</Text>
        {/* Refresh button — re-runs Overpass query at current position */}
        <TouchableOpacity
          onPress={refreshGIS}
          disabled={isLoadingGIS}
          style={{ marginLeft: "auto" }}
          activeOpacity={0.7}
        >
          {isLoadingGIS ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="refresh-cw" size={18} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* ── Center-on-user floating button ──────────────────────────────── */}
      <TouchableOpacity
        onPress={centerOnUser}
        style={[styles.centerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.85}
      >
        <Feather name="navigation" size={20} color={colors.primary} />
      </TouchableOpacity>

      {/* ── Bottom stats panel (floats above the map) ───────────────────── */}
      <View
        style={[
          styles.bottomPanel,
          {
            backgroundColor: `${colors.background}F5`,  // 96% opacity
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 90,  // 90px for tab bar height
          },
        ]}
      >
        {/* API error message */}
        {gisError && (
          <Text style={[styles.errorText, { color: colors.warning }]}>{gisError}</Text>
        )}

        {/* Four stat columns */}
        <View style={styles.statsGrid}>
          <PanelStat
            icon="crosshair"
            label="Crosswalk"
            value={nearestCrosswalkDist !== null ? `${nearestCrosswalkDist}m` : "—"}
            color={
              nearestCrosswalkDist !== null && nearestCrosswalkDist < 50
                ? colors.danger
                : nearestCrosswalkDist !== null && nearestCrosswalkDist < 150
                ? colors.warning
                : colors.safe
            }
          />
          <PanelStat
            icon="sun"
            label="Lights"
            value={String(streetlightCount)}
            color={streetlightCount === 0 ? colors.danger : streetlightCount < 3 ? colors.warning : colors.safe}
          />
          <PanelStat
            icon="truck"
            label="Traffic"
            value={{ none: "None", light: "Low", moderate: "Med", heavy: "High" }[trafficLevel]}
            color={trafficColor(trafficLevel)}
          />
          <PanelStat
            icon="trending-up"
            label="Slope"
            value={`${slope}%`}
            color={slope > 10 ? colors.danger : slope > 5 ? colors.warning : colors.safe}
          />
        </View>

        {/* Combined risk boost bar */}
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
          <Text style={[styles.boostVal, { color: boostColor }]}>+{gisRiskBoost}</Text>
        </View>

        {/* Legend for map markers */}
        <View style={styles.legend}>
          <LegendDot color="#E84545" label={`Crosswalks (${nearbyCrosswalks.length})`} />
          <LegendDot color={boostColor} label="Your safety zone" />
        </View>
      </View>
    </View>
  );
}

// ── Small sub-components for the bottom panel ──────────────────────────────

/** One column in the four-stat grid: icon + big number + label */
function PanelStat({
  icon, label, value, color,
}: { icon: string; label: string; value: string; color: string }) {
  const colors = useColors();
  return (
    <View style={styles.stat}>
      <Feather name={icon as keyof typeof Feather.glyphMap} size={14} color={color} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

/** A colored dot + label for the map legend */
function LegendDot({ color, label }: { color: string; label: string }) {
  const colors = useColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 16 },
  centerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  centerSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  permBtn: { paddingHorizontal: 28, paddingVertical: 13, borderRadius: 12, marginTop: 8 },
  permBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  topBar: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  topTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  centerBtn: {
    position: "absolute",
    right: 16, bottom: 280,
    width: 44, height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    zIndex: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
  },
  bottomPanel: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    gap: 12,
    zIndex: 10,
  },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statsGrid: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", gap: 3, flex: 1 },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.3 },
  boostRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  boostLabel: { fontSize: 11, fontFamily: "Inter_500Medium", minWidth: 100 },
  boostTrack: { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  boostFill: { height: "100%", borderRadius: 3 },
  boostVal: { fontSize: 13, fontFamily: "Inter_700Bold", minWidth: 28, textAlign: "right" },
  legend: { flexDirection: "row", gap: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
