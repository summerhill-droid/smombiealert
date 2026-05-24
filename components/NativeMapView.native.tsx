/**
 * NativeMapView.native.tsx — Leaflet map for iOS (Expo Go)
 *
 * Map tiles: CartoDB Voyager via Leaflet.js (Korean labels, no API key)
 * GIS data:  Seoul official JSON + Overpass fallback (unchanged)
 *
 * Crosswalk overlays colour-coded by risk:
 *   Red   (#E84545) = uncontrolled / unmarked crossing → DANGER  (25 m circle)
 *   Amber (#F39C12) = signalised / zebra crossing      → CAUTION (15 m circle)
 *   Teal  (#1ABC9C) = pedestrian / footway zone        → LOW     (10 m circle)
 *
 * Architecture:
 *   - WebView renders the Leaflet map canvas (tiles + markers + circles)
 *   - All UI chrome (top bar, stats panel, buttons) are native RN views overlaid on top
 *   - Data flows RN → WebView via injectJavaScript
 *   - Map signals readiness via ReactNativeWebView.postMessage({type:'ready'})
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import WebView from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useGIS, TrafficLevel, CrosswalkRisk } from "@/context/GISContext";

// ─── Constants ────────────────────────────────────────────────────────────────

const KAKAO_JS_KEY  = "f24b3e12e3246e647e222f62c534115a";
// GitHub Pages — register https://summerhill-droid.github.io in Kakao Console → Platform → Web
const KAKAO_BASE_URL   = "https://summerhill-droid.github.io";
// Full URL of the map page served from GitHub Pages
const KAKAO_SERVER_URL = "https://summerhill-droid.github.io/kakao-map/";

// Method 1 — inline HTML + HTTPS baseUrl (Referer injected via baseUrl)
const KAKAO_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%}
    .user-dot{width:18px;height:18px;background:#4A90E2;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.35)}
    .cw-pin{width:13px;height:13px;border:2.5px solid rgba(255,255,255,0.9);border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,0.4)}
  </style>
  <script type="text/javascript" src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false"></script>
</head>
<body>
  <div id="map" style="width:100%;height:100vh;"></div>
  <script>
    kakao.maps.load(function() {
      var container = document.getElementById('map');
      var options = { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 4 };
      var map = new kakao.maps.Map(container, options);

      var userOverlay=null, userCircle=null, cwOverlays=[], cwCircles=[];

      if (window.ReactNativeWebView)
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));

      window.updateLocation = function(lat, lng, boostColor) {
        var pos = new kakao.maps.LatLng(lat, lng);
        if (userOverlay) userOverlay.setMap(null);
        userOverlay = new kakao.maps.CustomOverlay({position:pos,content:'<div class="user-dot"></div>',yAnchor:0.5,xAnchor:0.5,zIndex:10});
        userOverlay.setMap(map);
        if (userCircle) userCircle.setMap(null);
        userCircle = new kakao.maps.Circle({center:pos,radius:30,strokeWeight:2,strokeColor:boostColor,strokeOpacity:0.55,fillColor:boostColor,fillOpacity:0.12});
        userCircle.setMap(map);
      };
      window.centerMap = function(lat, lng) { map.panTo(new kakao.maps.LatLng(lat, lng)); };
      window.updateCrosswalks = function(crosswalks) {
        cwOverlays.forEach(function(o){o.setMap(null);}); cwCircles.forEach(function(c){c.setMap(null);});
        cwOverlays=[]; cwCircles=[];
        var RC={danger:'#E84545',caution:'#F39C12',low:'#1ABC9C'};
        var RR={danger:25,caution:15,low:10}; var RW={danger:2.5,caution:1.5,low:1.5};
        crosswalks.forEach(function(cw,i){
          var pos=new kakao.maps.LatLng(cw.lat,cw.lng);
          var col=RC[cw.riskLevel]||'#888',rad=RR[cw.riskLevel]||10,sw=RW[cw.riskLevel]||1.5;
          var circle=new kakao.maps.Circle({center:pos,radius:rad,strokeWeight:sw,strokeColor:col,strokeOpacity:0.75,fillColor:col,fillOpacity:0.22});
          circle.setMap(map); cwCircles.push(circle);
          if(i<12){var o=new kakao.maps.CustomOverlay({position:pos,content:'<div class="cw-pin" style="background:'+col+'"></div>',yAnchor:0.5,xAnchor:0.5,zIndex:5});o.setMap(map);cwOverlays.push(o);}
        });
      };
    });
  </script>
</body>
</html>`;

const RISK_COLOR: Record<CrosswalkRisk, string> = {
  danger:  "#E84545",
  caution: "#F39C12",
  low:     "#1ABC9C",
};

const MAX_TOTAL = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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


// ─── Component ────────────────────────────────────────────────────────────────

export default function NativeMapView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const mapReadyRef = useRef(false);

  const {
    userLocation,
    nearbyCrosswalks,
    nearestCrosswalkDist,
    streetlightCount,
    trafficLevel,
    slope,
    gisRiskBoost,
    dataSource,
    isLoadingGIS,
    gisError,
    permissionStatus,
    requestPermission,
    refreshGIS,
  } = useGIS();

  // Sort crosswalks by distance from user, cap at MAX_TOTAL
  const sortedCrosswalks = useMemo(() => {
    if (!userLocation || nearbyCrosswalks.length === 0) return [];
    return nearbyCrosswalks
      .map((cw) => ({
        ...cw,
        dist: haversineM(userLocation.lat, userLocation.lng, cw.lat, cw.lng),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, MAX_TOTAL);
  }, [nearbyCrosswalks, userLocation]);

  const boostColor =
    gisRiskBoost > 60 ? colors.danger
    : gisRiskBoost > 30 ? colors.warning
    : colors.safe;

  // ── Inject helpers ───────────────────────────────────────────────────────
  const inject = useCallback((js: string) => {
    if (webViewRef.current && mapReadyRef.current) {
      webViewRef.current.injectJavaScript(`${js}; true;`);
    }
  }, []);

  // Called when the Kakao map HTML posts {type:'ready'} via ReactNativeWebView.postMessage
  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type !== "ready") return;
    } catch {
      return;
    }
    mapReadyRef.current = true;
    if (!userLocation) return;
    webViewRef.current?.injectJavaScript(
      `updateLocation(${userLocation.lat}, ${userLocation.lng}, '${boostColor}'); true;`
    );
    if (sortedCrosswalks.length > 0) {
      webViewRef.current?.injectJavaScript(
        `updateCrosswalks(${JSON.stringify(sortedCrosswalks)}); true;`
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update user location dot + safety circle whenever GPS changes
  useEffect(() => {
    if (!userLocation) return;
    inject(`updateLocation(${userLocation.lat}, ${userLocation.lng}, '${boostColor}')`);
  }, [userLocation, boostColor, inject]);

  // Update crosswalk circles whenever nearby crosswalks change
  useEffect(() => {
    if (sortedCrosswalks.length === 0) return;
    inject(`updateCrosswalks(${JSON.stringify(sortedCrosswalks)})`);
  }, [sortedCrosswalks, inject]);

  // Center map on user location
  function centerOnUser() {
    if (!userLocation) return;
    inject(`centerMap(${userLocation.lat}, ${userLocation.lng})`);
  }

  const dangerCount  = nearbyCrosswalks.filter(c => c.riskLevel === "danger").length;
  const cautionCount = nearbyCrosswalks.filter(c => c.riskLevel === "caution").length;
  const lowCount     = nearbyCrosswalks.filter(c => c.riskLevel === "low").length;

  const sourceBadgeColor = dataSource === "seoul" ? "#2563EB" : "#7C3AED";
  const sourceBadgeLabel =
    dataSource === "seoul" ? "Seoul Official"
    : dataSource === "osm" ? "OpenStreetMap"
    : null;

  // ── No permission ────────────────────────────────────────────────────────
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

  // ── Waiting for GPS fix ──────────────────────────────────────────────────
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

  // ── Map ──────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* GitHub Pages bridge: page loads from summerhill-droid.github.io/kakao-map/
          which is a real registered HTTPS origin — Kakao domain check passes,
          GitHub's SSL cert is trusted by iOS WKWebView. */}
      <WebView
        ref={webViewRef}
        source={{ uri: KAKAO_SERVER_URL }}
        style={StyleSheet.absoluteFill}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        scrollEnabled={false}
        allowsInlineMediaPlayback
        allowsLinkPreview={false}
      />

      {/* ── Top bar (native, on top of WebView) ───────────────────────── */}
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
        <View style={{ flex: 1 }}>
          <Text style={[styles.topTitle, { color: colors.foreground }]}>Live GIS Map</Text>
          <View style={styles.badgeRow}>
            {/* Map engine badge */}
            <View style={[styles.sourceBadge, { backgroundColor: "#FFCD00" }]}>
              <Text style={[styles.sourceBadgeText, { color: "#3A1D1D" }]}>Kakao Maps</Text>
            </View>
            {/* GIS data source badge */}
            {sourceBadgeLabel && (
              <View style={[styles.sourceBadge, { backgroundColor: sourceBadgeColor }]}>
                <Text style={styles.sourceBadgeText}>{sourceBadgeLabel}</Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={refreshGIS}
          disabled={isLoadingGIS}
          activeOpacity={0.7}
          style={{ padding: 4 }}
        >
          {isLoadingGIS ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="refresh-cw" size={18} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* ── Center-on-user button ────────────────────────────────────────── */}
      <TouchableOpacity
        onPress={centerOnUser}
        style={[styles.centerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.85}
      >
        <Feather name="navigation" size={20} color={colors.primary} />
      </TouchableOpacity>

      {/* ── Bottom stats panel (native, on top of WebView) ─────────────── */}
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
        {gisError && nearbyCrosswalks.length === 0 && (
          <Text style={[styles.errorText, { color: colors.warning }]}>{gisError}</Text>
        )}

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
          <LegendDot color={boostColor}  label="You" />
        </View>
      </View>

    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function LegendDot({ color, label }: { color: string; label: string }) {
  const colors = useColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    zIndex: 10,
    gap: 12,
  },
  topTitle:        { fontSize: 18, fontFamily: "Inter_700Bold" },
  badgeRow:        { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
  sourceBadge:     { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  sourceBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#fff", letterSpacing: 0.2 },

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
  errorText:  { fontSize: 12, fontFamily: "Inter_400Regular" },
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
