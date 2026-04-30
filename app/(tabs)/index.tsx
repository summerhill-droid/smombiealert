/**
 * index.tsx — Monitor screen (v2)
 *
 * KEY ADDITIONS in v2:
 *   1. BehaviorStageCard — live 3-stage classification display
 *   2. 4-level alert banner with contextual messages
 *   3. Touch event reporting via recordInteraction()
 *   4. warningType-specific overlay (crosswalk vs accident zone)
 *   5. GIS context bridge: setExternalContext() replaces setExternalBoost()
 *
 * TOUCH TRACKING:
 *   This screen wraps its ScrollView with onScroll and the button
 *   with onPress/onLongPress that call recordInteraction().
 *   In a real deployment, wrap all interactive views similarly.
 *
 * GIS BRIDGE (updated from v1):
 *   Now passes the full GISContext object (nearCrosswalk, nearAccident,
 *   insideCrosswalk) rather than just the raw boost score, enabling
 *   precise WARNING_TYPE1/TYPE2/CRITICAL routing in DetectionContext.
 */

import React, { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useDetection }                        from "@/context/DetectionContext";
import { useGIS }                              from "@/context/GISContext";
import { useBehavior }                         from "@/context/BehaviorContext";
import { useColors }                           from "@/hooks/useColors";
import { AlertRing }                           from "@/components/AlertRing";
import { StatusIcon }                          from "@/components/StatusIcon";
import { MetricBar }                           from "@/components/MetricBar";
import { GISInfoCard }                         from "@/components/GISInfoCard";
import { BehaviorStageCard }                   from "@/components/BehaviorStageCard";

// ─── Alert level visual config ────────────────────────────────────────────────

const ALERT_BANNER_COLORS = {
  safe:    null,                          // No banner when safe
  caution: "#8B6914",
  warning: "#B85C00",
  danger:  "#C41E3A",
};

export default function HomeScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();

  const {
    isMonitoring,
    alertLevel,
    warningType,
    alertMessage,
    isSmombie,
    walkingSpeed,
    phoneAngle,
    incidents,
    totalSmombieTime,
    alertDurationSec,
    setExternalContext,
    startMonitoring,
    stopMonitoring,
  } = useDetection();

  const {
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

  const { recordInteraction } = useBehavior();

  // ── GIS context bridge (v2: full object) ─────────────────────────────────
  useEffect(() => {
    setExternalContext({
      boost:           gisRiskBoost,
      nearCrosswalk:   nearestCrosswalkDist !== null && nearestCrosswalkDist <= 10,
      nearAccident:    gisRiskBoost >= 60,  // proxy until accident zone API is added
      insideCrosswalk: nearestCrosswalkDist !== null && nearestCrosswalkDist <= 5,
    });
  }, [gisRiskBoost, nearestCrosswalkDist, setExternalContext]);

  // ── Animations ────────────────────────────────────────────────────────────
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const bannerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 600, useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Animate banner in/out on alert level change
  useEffect(() => {
    Animated.timing(bannerAnim, {
      toValue:  alertLevel !== "safe" ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [alertLevel, bannerAnim]);

  // ── Scroll-based touch tracking ───────────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (isMonitoring) recordInteraction("scroll");
  }, [isMonitoring, recordInteraction]);

  // ── Start/Stop ────────────────────────────────────────────────────────────
  function handleToggle() {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    if (isMonitoring) {
      stopMonitoring();
    } else {
      startMonitoring();
    }
    recordInteraction("tap");
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const todayIncidents = incidents.filter((i) => {
    const today = new Date().toDateString();
    return new Date(i.timestamp).toDateString() === today;
  });

  const topPad    = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  // ── Alert banner color ────────────────────────────────────────────────────
  const bannerBg =
    alertLevel === "danger"  ? colors.danger  :
    alertLevel === "warning" ? colors.warning :
    alertLevel === "caution" ? "#D4A800"     :
    "transparent";

  // ── Status text ───────────────────────────────────────────────────────────
  const statusText = !isMonitoring
    ? "Tap to start monitoring"
    : alertMessage;

  const statusColor =
    alertLevel === "danger"  ? colors.danger  :
    alertLevel === "warning" ? colors.warning :
    alertLevel === "caution" ? "#D4A800"     :
    isMonitoring ? colors.safe : colors.mutedForeground;

  // ── Warning type icon ─────────────────────────────────────────────────────
  const warningIcon =
    warningType === "crosswalk" ? "📍" :
    warningType === "accident"  ? "⚠️" :
    null;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 20, paddingBottom: bottomPad + 100 },
      ]}
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={500}
    >
      <Animated.View style={{ opacity: fadeAnim }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.appName, { color: colors.primary }]}>SmombieAlert</Text>
            <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
              AI Pedestrian Safety Guard
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>
              {todayIncidents.length} today
            </Text>
          </View>
        </View>

        {/* ── Alert Banner (appears when level != safe) ────────────────── */}
        <Animated.View
          style={[
            styles.alertBanner,
            {
              backgroundColor: bannerBg,
              opacity:         bannerAnim,
              transform: [
                {
                  translateY: bannerAnim.interpolate({
                    inputRange: [0, 1], outputRange: [-8, 0],
                  }),
                },
              ],
            },
          ]}
          pointerEvents={alertLevel !== "safe" ? "auto" : "none"}
        >
          <Text style={styles.bannerText}>
            {warningIcon ? `${warningIcon} ` : ""}{alertMessage}
          </Text>
          {alertDurationSec > 0 && (
            <Text style={styles.bannerDuration}>{alertDurationSec}s</Text>
          )}
        </Animated.View>

        {/* ── Main Detection Ring ──────────────────────────────────────── */}
        <View style={styles.ringContainer}>
          <AlertRing level={alertLevel} size={240} />
          <View style={styles.ringCenter}>
            <StatusIcon level={alertLevel} isMonitoring={isMonitoring} size={48} />
            <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={3}>
              {isMonitoring ? (
                alertLevel !== "safe" ? alertMessage : "Safe — Eyes on the road"
              ) : (
                "Tap to start monitoring"
              )}
            </Text>
          </View>
        </View>

        {/* ── Start / Stop Button ──────────────────────────────────────── */}
        <TouchableOpacity
          onPress={handleToggle}
          onLongPress={() => recordInteraction("longpress", 600)}
          activeOpacity={0.85}
          style={[
            styles.mainButton,
            {
              backgroundColor: isMonitoring ? colors.muted : colors.primary,
              borderColor:     isMonitoring ? colors.border : colors.primary,
            },
          ]}
        >
          <Feather
            name={isMonitoring ? "square" : "play"}
            size={20}
            color={isMonitoring ? colors.foreground : colors.primaryForeground}
          />
          <Text
            style={[
              styles.mainButtonText,
              { color: isMonitoring ? colors.foreground : colors.primaryForeground },
            ]}
          >
            {isMonitoring ? "Stop Monitoring" : "Start Monitoring"}
          </Text>
        </TouchableOpacity>

        {/* ── 3-Stage Behavior Classification Card (NEW) ───────────────── */}
        <BehaviorStageCard isMonitoring={isMonitoring} />

        {/* ── Live Sensor Metrics ──────────────────────────────────────── */}
        {isMonitoring && (
          <View
            style={[
              styles.metricsCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Live Sensors
            </Text>
            <View style={styles.metricsList}>
              <MetricBar
                label="Walking Activity"
                value={walkingSpeed}
                color={walkingSpeed > 50 ? colors.primary : colors.safe}
              />
              <MetricBar
                label="Phone Angle"
                value={phoneAngle}
                color={phoneAngle > 50 && phoneAngle < 85 ? colors.warning : colors.safe}
              />
              <MetricBar
                label="Distraction Risk"
                value={
                  alertLevel === "danger"  ? 95 :
                  alertLevel === "warning" ? 70 :
                  alertLevel === "caution" ? 40 : 10
                }
                color={
                  alertLevel === "danger"  ? colors.danger  :
                  alertLevel === "warning" ? colors.warning :
                  alertLevel === "caution" ? "#D4A800"     :
                  colors.safe
                }
              />
            </View>
          </View>
        )}

        {/* ── GIS Risk Factors Card ────────────────────────────────────── */}
        <View style={{ marginBottom: 16 }}>
          <GISInfoCard
            nearestCrosswalkDist={nearestCrosswalkDist}
            streetlightCount={streetlightCount}
            trafficLevel={trafficLevel}
            slope={slope}
            gisRiskBoost={gisRiskBoost}
            isLoading={isLoadingGIS}
            error={gisError}
            onRefresh={refreshGIS}
            hasPermission={permissionStatus === "granted"}
            onRequestPermission={requestPermission}
          />
        </View>

        {/* ── 4-Level Warning Reference Card ───────────────────────────── */}
        {isMonitoring && (
          <View
            style={[
              styles.warningRefCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Alert Levels
            </Text>
            {[
              { icon: "⚫", label: "OFF",      desc: "Indoor / stationary",             col: colors.mutedForeground },
              { icon: "🟡", label: "CAUTION",  desc: "Walking detected",                col: "#D4A800"              },
              { icon: "🟠", label: "WARNING",  desc: "Crosswalk / accident zone ≤ 10m", col: colors.warning         },
              { icon: "🔴", label: "CRITICAL", desc: "Active use inside crosswalk ≥ 5s",col: colors.danger          },
            ].map((item) => (
              <View key={item.label} style={styles.refRow}>
                <Text style={styles.refIcon}>{item.icon}</Text>
                <View style={styles.refTextBlock}>
                  <Text style={[styles.refLabel, { color: item.col }]}>{item.label}</Text>
                  <Text style={[styles.refDesc,  { color: colors.mutedForeground }]}>
                    {item.desc}
                  </Text>
                </View>
                {alertLevel === item.label.toLowerCase() && (
                  <View style={[styles.activeDot, { backgroundColor: item.col }]} />
                )}
              </View>
            ))}
          </View>
        )}

        {/* ── Stats Row ────────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          {[
            { num: incidents.length,              unit: "",  label: "Total Incidents", color: colors.primary },
            { num: Math.round(totalSmombieTime / 60), unit: "m", label: "Distracted Time", color: colors.warning },
            { num: todayIncidents.length,         unit: "",  label: "Today",           color: colors.safe    },
          ].map((s) => (
            <View key={s.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statNumber, { color: s.color }]}>
                {s.num}{s.unit}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Safety tip ───────────────────────────────────────────────── */}
        <View
          style={[
            styles.tipCard,
            { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}30` },
          ]}
        >
          <Feather name="info" size={16} color={colors.primary} />
          <Text style={[styles.tipText, { color: colors.foreground }]}>
            Pocket your phone at crosswalks. Active typing while walking carries 3× the collision risk.
          </Text>
        </View>

      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  content:      { paddingHorizontal: 20 },
  header: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "flex-start",
    marginBottom:   20,
  },
  appName: {
    fontSize:      24,
    fontFamily:    "Inter_700Bold",
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize:   13,
    fontFamily: "Inter_400Regular",
    marginTop:  2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical:   5,
    borderRadius:      20,
  },
  badgeText: {
    fontSize:   12,
    fontFamily: "Inter_600SemiBold",
  },
  alertBanner: {
    borderRadius:  12,
    paddingVertical:   12,
    paddingHorizontal: 16,
    marginBottom:  16,
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:    "center",
  },
  bannerText: {
    flex:       1,
    fontSize:   14,
    fontFamily: "Inter_600SemiBold",
    color:      "#fff",
    lineHeight: 20,
  },
  bannerDuration: {
    fontSize:   13,
    fontFamily: "Inter_700Bold",
    color:      "rgba(255,255,255,0.7)",
    marginLeft: 8,
  },
  ringContainer: {
    alignItems:     "center",
    justifyContent: "center",
    marginBottom:   24,
    position:       "relative",
    height:         240,
  },
  ringCenter: {
    position:       "absolute",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
    width:          160,
  },
  statusText: {
    fontSize:   12,
    fontFamily: "Inter_600SemiBold",
    textAlign:  "center",
    lineHeight: 17,
  },
  mainButton: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            10,
    paddingVertical: 16,
    borderRadius:   14,
    borderWidth:    1.5,
    marginBottom:   16,
  },
  mainButtonText: {
    fontSize:   16,
    fontFamily: "Inter_600SemiBold",
  },
  metricsCard: {
    padding:      16,
    borderRadius: 14,
    borderWidth:  1,
    marginBottom: 16,
    gap:          14,
  },
  sectionTitle: {
    fontSize:      13,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  metricsList:  { gap: 12 },
  warningRefCard: {
    padding:      16,
    borderRadius: 14,
    borderWidth:  1,
    marginBottom: 16,
    gap:          10,
  },
  refRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           10,
  },
  refIcon: { fontSize: 18, width: 24, textAlign: "center" },
  refTextBlock: { flex: 1 },
  refLabel: {
    fontSize:   12,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  refDesc: {
    fontSize:   11,
    fontFamily: "Inter_400Regular",
    marginTop:  1,
  },
  activeDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },
  statsRow: {
    flexDirection: "row",
    gap:           10,
    marginBottom:  16,
  },
  statCard: {
    flex:        1,
    padding:     14,
    borderRadius: 14,
    borderWidth:  1,
    alignItems:  "center",
    gap:          4,
  },
  statNumber: {
    fontSize:   22,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize:   10,
    fontFamily: "Inter_500Medium",
    textAlign:  "center",
    letterSpacing: 0.3,
  },
  tipCard: {
    flexDirection: "row",
    gap:           10,
    padding:       14,
    borderRadius:  12,
    borderWidth:   1,
    alignItems:    "flex-start",
  },
  tipText: {
    flex:       1,
    fontSize:   13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
});
