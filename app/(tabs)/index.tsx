/**
 * index.tsx — Monitor screen (v3 — merged Behavior & Sensors card)
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

import { useDetection }      from "@/context/DetectionContext";
import { useGIS }            from "@/context/GISContext";
import { useBehavior }       from "@/context/BehaviorContext";
import { useColors }         from "@/hooks/useColors";
import { AlertRing }         from "@/components/AlertRing";
import { StatusIcon }        from "@/components/StatusIcon";
import { GISInfoCard }       from "@/components/GISInfoCard";
import { BehaviorStageCard } from "@/components/BehaviorStageCard";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    isMonitoring,
    alertLevel,
    warningType,
    alertMessage,
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

  useEffect(() => {
    setExternalContext({
      boost:           gisRiskBoost,
      nearCrosswalk:   nearestCrosswalkDist !== null && nearestCrosswalkDist <= 10,
      nearAccident:    gisRiskBoost >= 60,
      insideCrosswalk: nearestCrosswalkDist !== null && nearestCrosswalkDist <= 5,
    });
  }, [gisRiskBoost, nearestCrosswalkDist, setExternalContext]);

  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const bannerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    Animated.timing(bannerAnim, {
      toValue: alertLevel !== "safe" ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [alertLevel, bannerAnim]);

  const handleScroll = useCallback(() => {
    if (isMonitoring) recordInteraction("scroll");
  }, [isMonitoring, recordInteraction]);

  function handleToggle() {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isMonitoring) stopMonitoring(); else startMonitoring();
    recordInteraction("tap");
  }

  const todayIncidents = incidents.filter((i) => {
    const today = new Date().toDateString();
    return new Date(i.timestamp).toDateString() === today;
  });

  const topPad    = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const bannerBg =
    alertLevel === "danger"  ? colors.danger  :
    alertLevel === "warning" ? colors.warning :
    alertLevel === "caution" ? "#D4A800"      :
    "transparent";

  const statusColor =
    alertLevel === "danger"  ? colors.danger  :
    alertLevel === "warning" ? colors.warning :
    alertLevel === "caution" ? "#D4A800"      :
    isMonitoring ? colors.safe : colors.mutedForeground;

  const warningIcon =
    warningType === "crosswalk" ? "📍" :
    warningType === "accident"  ? "⚠️" : null;

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

        {/* ── Alert Banner ─────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.alertBanner,
            {
              backgroundColor: bannerBg,
              opacity: bannerAnim,
              transform: [{
                translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }),
              }],
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
              {isMonitoring
                ? alertLevel !== "safe" ? alertMessage : "Safe — Eyes on the road"
                : "Tap to start monitoring"}
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
              backgroundColor: isMonitoring ? colors.danger  : colors.primary,
              shadowColor:     isMonitoring ? colors.danger  : colors.primary,
            },
          ]}
        >
          <Feather name={isMonitoring ? "square" : "play"} size={22} color="#fff" />
          <Text style={styles.mainButtonText}>
            {isMonitoring ? "Stop Monitoring" : "Start Monitoring"}
          </Text>
        </TouchableOpacity>

        {/* ── Merged Behavior & Sensors Card ───────────────────────────── */}
        <BehaviorStageCard
          isMonitoring={isMonitoring}
          walkingSpeed={walkingSpeed}
          phoneAngle={phoneAngle}
          alertLevel={alertLevel}
        />

        {/* ── GIS Risk Factors ──────────────────────────────────────────── */}
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

        {/* ── Alert Levels Reference ────────────────────────────────────── */}
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
              { icon: "⚫", label: "OFF",      desc: "Indoor / stationary",               col: colors.mutedForeground },
              { icon: "🟡", label: "CAUTION",  desc: "Walking detected",                  col: "#D4A800"              },
              { icon: "🟠", label: "WARNING",  desc: "Crosswalk / accident zone ≤ 10 m",  col: colors.warning         },
              { icon: "🔴", label: "CRITICAL", desc: "Active use inside crosswalk ≥ 5 s", col: colors.danger          },
            ].map((item) => (
              <View key={item.label} style={styles.refRow}>
                <Text style={styles.refIcon}>{item.icon}</Text>
                <View style={styles.refTextBlock}>
                  <Text style={[styles.refLabel, { color: item.col }]}>{item.label}</Text>
                  <Text style={[styles.refDesc, { color: colors.mutedForeground }]}>{item.desc}</Text>
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
            { num: incidents.length,                  unit: "",  label: "Total Incidents", color: colors.primary },
            { num: Math.round(totalSmombieTime / 60), unit: "m", label: "Distracted Time", color: colors.warning },
            { num: todayIncidents.length,             unit: "",  label: "Today",            color: colors.safe   },
          ].map((s) => (
            <View
              key={s.label}
              style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.statNumber, { color: s.color }]}>{s.num}{s.unit}</Text>
              <Text style={[styles.statLabel,  { color: colors.mutedForeground }]}>{s.label}</Text>
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
  container: { flex: 1 },
  content:   { paddingHorizontal: 20 },
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
    borderRadius:      12,
    paddingVertical:   12,
    paddingHorizontal: 16,
    marginBottom:      16,
    flexDirection:     "row",
    justifyContent:    "space-between",
    alignItems:        "center",
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
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 18,
    borderRadius:    16,
    marginBottom:    16,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.3,
    shadowRadius:    8,
    elevation:       6,
  },
  mainButtonText: {
    fontSize:   17,
    fontFamily: "Inter_700Bold",
    color:      "#fff",
  },
  sectionTitle: {
    fontSize:      13,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
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
  refIcon:      { fontSize: 18, width: 24, textAlign: "center" },
  refTextBlock: { flex: 1 },
  refLabel: {
    fontSize:      12,
    fontFamily:    "Inter_700Bold",
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
    flex:         1,
    padding:      14,
    borderRadius: 14,
    borderWidth:  1,
    alignItems:   "center",
    gap:          4,
  },
  statNumber: {
    fontSize:   22,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize:      10,
    fontFamily:    "Inter_500Medium",
    textAlign:     "center",
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
