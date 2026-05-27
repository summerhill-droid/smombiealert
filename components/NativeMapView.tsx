/**
 * NativeMapView.tsx — Web build of the Map tab.
 *
 * Strategy: embed the same Kakao Map HTML page the native build uses
 * (https://summerhill-droid.github.io/kakao-map/) via a sandboxed <iframe>,
 * then overlay native-style stats panels on top.
 *
 * Note on cross-origin: the iframe loads from a different origin, so we
 * cannot directly call `iframe.contentWindow.updateLocation(...)` — we use
 * `postMessage` instead. The GitHub-hosted page listens for those messages
 * (added in the kakao-map repo) and forwards them to the existing
 * `window.updateLocation/updateCrosswalks/centerMap` globals.
 *
 * Even if postMessage is not wired on the remote page yet, the iframe still
 * renders a usable Seoul-centred Kakao map below the stats panel, which is
 * a huge UX improvement over the previous text-only fallback.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useGIS, TrafficLevel } from "@/context/GISContext";

const KAKAO_PAGE_URL = "https://summerhill-droid.github.io/kakao-map/";
const KAKAO_ORIGIN   = "https://summerhill-droid.github.io";

const EARTH_R = 6_371_000;
function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

function trafficColor(level: TrafficLevel): string {
  return level === "heavy"    ? "#E84545"
       : level === "moderate" ? "#F39C12"
       : level === "light"    ? "#27AE60"
       : "#888888";
}

export default function NativeMapView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);

  const {
    userLocation,
    nearbyCrosswalks,
    nearestCrosswalkDist,
    streetlightCount,
    trafficLevel,
    slope,
    gisRiskBoost,
    permissionStatus,
    requestPermission,
  } = useGIS();

  const sortedCrosswalks = useMemo(() => {
    if (!userLocation || nearbyCrosswalks.length === 0) return [];
    return nearbyCrosswalks
      .map((cw) => ({
        ...cw,
        dist: haversineM(userLocation.lat, userLocation.lng, cw.lat, cw.lng),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 50);
  }, [nearbyCrosswalks, userLocation]);

  const boostColor =
    gisRiskBoost > 60 ? colors.danger
    : gisRiskBoost > 30 ? colors.warning
    : colors.safe;

  // Listen for the embedded map's "ready" handshake, then push initial state.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (ev: MessageEvent) => {
      if (ev.origin !== KAKAO_ORIGIN) return;
      let payload: { type?: string } = {};
      try { payload = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data; }
      catch { return; }
      if (payload?.type === "ready") {
        readyRef.current = true;
        sendToIframe();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push location + crosswalk updates whenever they change.
  useEffect(() => {
    if (Platform.OS === "web" && readyRef.current) sendToIframe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation, sortedCrosswalks, boostColor]);

  function sendToIframe() {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    if (userLocation) {
      w.postMessage(
        { type: "updateLocation", lat: userLocation.lat, lng: userLocation.lng, color: boostColor },
        KAKAO_ORIGIN
      );
    }
    if (sortedCrosswalks.length > 0) {
      w.postMessage(
        { type: "updateCrosswalks", crosswalks: sortedCrosswalks },
        KAKAO_ORIGIN
      );
    }
  }

  // ── No permission ────────────────────────────────────────────────────────
  if (permissionStatus === "unknown" || permissionStatus === "denied") {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top + 40 }]}>
        <Feather name="navigation" size={48} color={colors.primary} />
        <Text style={[styles.centerTitle, { color: colors.foreground }]}>Location needed</Text>
        <Text style={[styles.centerSub, { color: colors.mutedForeground }]}>
          Enable location to load the GIS map with crosswalks and traffic data.
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

  const dangerCount  = nearbyCrosswalks.filter(c => c.riskLevel === "danger").length;
  const cautionCount = nearbyCrosswalks.filter(c => c.riskLevel === "caution").length;
  const lowCount     = nearbyCrosswalks.filter(c => c.riskLevel === "low").length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Kakao map iframe — fills the background */}
      {Platform.OS === "web" && (
        // @ts-ignore — DOM iframe inside RNW View
        <iframe
          ref={iframeRef}
          src={KAKAO_PAGE_URL}
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            width: "100%", height: "100%",
            border: "none",
          }}
          title="Kakao Map"
          allow="geolocation"
        />
      )}

      {/* Top bar */}
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + 8,
            backgroundColor: `${colors.background}EE`,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.topTitle, { color: colors.foreground }]}>Live GIS Map</Text>
        <View style={[styles.sourceBadge, { backgroundColor: "#FFCD00" }]}>
          <Text style={[styles.sourceBadgeText, { color: "#3A1D1D" }]}>Kakao Maps</Text>
        </View>
      </View>

      {/* Bottom stats panel */}
      <View
        style={[
          styles.bottomPanel,
          {
            backgroundColor: `${colors.background}F5`,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 90,
          },
        ]}
      >
        <View style={styles.statsGrid}>
          <PanelStat
            icon="crosshair"
            label="Crosswalk"
            value={nearestCrosswalkDist !== null ? `${nearestCrosswalkDist}m` : "—"}
            color={
              nearestCrosswalkDist !== null && nearestCrosswalkDist < 50   ? colors.danger
              : nearestCrosswalkDist !== null && nearestCrosswalkDist < 150 ? colors.warning
              : colors.safe
            }
          />
          <PanelStat
            icon="sun"
            label="Lights"
            value={String(streetlightCount)}
            color={
              streetlightCount === 0 ? colors.danger
              : streetlightCount < 3  ? colors.warning
              : colors.safe
            }
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

        <View style={styles.legend}>
          <LegendDot color="#E84545" label={`Danger (${dangerCount})`} />
          <LegendDot color="#F39C12" label={`Caution (${cautionCount})`} />
          <LegendDot color="#1ABC9C" label={`Safe (${lowCount})`} />
        </View>
      </View>
    </View>
  );
}

function PanelStat({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  const colors = useColors();
  return (
    <View style={styles.stat}>
      <Feather name={icon as keyof typeof Feather.glyphMap} size={14} color={color} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

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
  container:    { flex: 1 },
  center:       { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 16 },
  centerTitle:  { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  centerSub:    { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  permBtn:      { paddingHorizontal: 28, paddingVertical: 13, borderRadius: 12, marginTop: 8 },
  permBtnText:  { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  topBar: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    zIndex: 10,
    gap: 12,
  },
  topTitle:        { fontSize: 18, fontFamily: "Inter_700Bold", flex: 1 },
  sourceBadge:     { alignSelf: "center", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  sourceBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#fff", letterSpacing: 0.2 },
  bottomPanel: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    gap: 12,
    zIndex: 10,
  },
  statsGrid:  { flexDirection: "row", justifyContent: "space-between" },
  stat:       { alignItems: "center", gap: 3, flex: 1 },
  statValue:  { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel:  { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.3 },
  boostRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  boostLabel: { fontSize: 11, fontFamily: "Inter_500Medium", minWidth: 100 },
  boostTrack: { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  boostFill:  { height: "100%", borderRadius: 3 },
  boostVal:   { fontSize: 13, fontFamily: "Inter_700Bold", minWidth: 28, textAlign: "right" },
  legend:     { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot:  { width: 10, height: 10, borderRadius: 5 },
  legendLabel:{ fontSize: 11, fontFamily: "Inter_400Regular" },
});
