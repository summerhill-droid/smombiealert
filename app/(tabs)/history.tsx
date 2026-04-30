/**
 * history.tsx — Incident History screen (v2)
 *
 * ADDITIONS in v2:
 *   - Each incident card now shows the behaviorStage at time of incident
 *   - Stage breakdown stats: Active / Passive / Tool counts
 *   - Stage-color-coded severity in IncidentCard
 */

import React from "react";
import {
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useDetection } from "@/context/DetectionContext";
import { useColors }    from "@/hooks/useColors";
import { IncidentCard } from "@/components/IncidentCard";
import {
  STAGE_LABELS,
  STAGE_ICONS_EMOJI,
  type BehaviorStage,
} from "@/context/BehaviorContext";

// Emoji icons for stage (imported or inline if not re-exported)
const ICONS: Record<BehaviorStage, string> = {
  active:   "💬",
  passive:  "👁️",
  tool:     "🧭",
  baseline: "📵",
};

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { incidents, totalSmombieTime, clearIncidents } = useDetection();

  const topPad    = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  function handleClear() {
    Alert.alert(
      "Clear History",
      "Delete all incidents? This cannot be undone.",
      [
        { text: "Cancel",     style: "cancel"      },
        { text: "Clear All",  style: "destructive", onPress: clearIncidents },
      ]
    );
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const dangerCount   = incidents.filter((i) => i.level === "danger").length;
  const warningCount  = incidents.filter((i) => i.level === "warning").length;
  const activeCount   = incidents.filter((i) => i.behaviorStage === "active").length;
  const passiveCount  = incidents.filter((i) => i.behaviorStage === "passive").length;
  const toolCount     = incidents.filter((i) => i.behaviorStage === "tool").length;
  const avgDuration   =
    incidents.length > 0
      ? Math.round(incidents.reduce((s, i) => s + i.duration, 0) / incidents.length)
      : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 16, borderBottomColor: colors.border },
        ]}
      >
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Incident History
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {incidents.length} total · {Math.round(totalSmombieTime / 60)}m distracted
          </Text>
        </View>
        {incidents.length > 0 && (
          <TouchableOpacity onPress={handleClear} activeOpacity={0.7}>
            <Feather name="trash-2" size={20} color={colors.destructive} />
          </TouchableOpacity>
        )}
      </View>

      {incidents.length > 0 ? (
        <FlatList
          data={incidents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom:     bottomPad + 100,
          }}
          ListHeaderComponent={
            <>
              {/* ── Alert level summary ─────────────────────────────────── */}
              <View style={styles.statSection}>
                <Text style={[styles.statSectionTitle, { color: colors.mutedForeground }]}>
                  By Alert Level
                </Text>
                <View style={styles.statsRow}>
                  <StatPill label="Critical"  value={dangerCount}  color={colors.danger}          colors={colors} />
                  <StatPill label="Warning"   value={warningCount} color={colors.warning}         colors={colors} />
                  <StatPill label="Avg Dur."  value={avgDuration}  color={colors.primary} unit="s" colors={colors} />
                </View>
              </View>

              {/* ── Behavior stage breakdown ────────────────────────────── */}
              <View style={styles.statSection}>
                <Text style={[styles.statSectionTitle, { color: colors.mutedForeground }]}>
                  By Behavior Stage
                </Text>
                <View style={styles.stageBreakdownRow}>
                  <StagePill icon="💬" label="Active"  count={activeCount}  color={colors.danger}  colors={colors} />
                  <StagePill icon="👁️" label="Passive" count={passiveCount} color={colors.warning} colors={colors} />
                  <StagePill icon="🧭" label="Tool"    count={toolCount}    color={colors.safe}    colors={colors} />
                </View>
              </View>

              <Text style={[styles.listTitle, { color: colors.foreground }]}>
                All Incidents
              </Text>
            </>
          }
          renderItem={({ item }) => (
            <View style={styles.incidentWrapper}>
              <IncidentCard incident={item} />
              {/* Stage badge overlaid below the card */}
              <View
                style={[
                  styles.stageBadge,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Text style={styles.stageBadgeIcon}>
                  {ICONS[item.behaviorStage ?? "baseline"]}
                </Text>
                <Text style={[styles.stageBadgeText, { color: colors.mutedForeground }]}>
                  {STAGE_LABELS[item.behaviorStage ?? "baseline"]}
                </Text>
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
        />
      ) : (
        /* ── Empty state ─────────────────────────────────────────────────── */
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
            <Feather name="check-circle" size={32} color={colors.safe} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No incidents recorded
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
            Start monitoring and walk safely!
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatPill({
  label, value, color, unit = "", colors,
}: {
  label: string; value: number; color: string; unit?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.statPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.statPillValue, { color }]}>{value}{unit}</Text>
      <Text style={[styles.statPillLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function StagePill({
  icon, label, count, color, colors,
}: {
  icon: string; label: string; count: number; color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.stagePill,
        { backgroundColor: color + "12", borderColor: color + "40" },
      ]}
    >
      <Text style={styles.stagePillIcon}>{icon}</Text>
      <Text style={[styles.stagePillCount, { color }]}>{count}</Text>
      <Text style={[styles.stagePillLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom:     14,
    borderBottomWidth: 1,
    flexDirection:     "row",
    justifyContent:    "space-between",
    alignItems:        "flex-end",
  },
  title:    { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  statSection: {
    marginTop: 16,
    gap:       8,
  },
  statSectionTitle: {
    fontSize:      11,
    fontFamily:    "Inter_600SemiBold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  statsRow: {
    flexDirection: "row",
    gap:           8,
  },
  statPill: {
    flex:          1,
    borderWidth:   1,
    borderRadius:  12,
    padding:       12,
    alignItems:    "center",
    gap:           4,
  },
  statPillValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statPillLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center" },
  stageBreakdownRow: {
    flexDirection: "row",
    gap:           8,
  },
  stagePill: {
    flex:          1,
    borderWidth:   1,
    borderRadius:  12,
    padding:       10,
    alignItems:    "center",
    gap:           4,
  },
  stagePillIcon:  { fontSize: 20 },
  stagePillCount: { fontSize: 18, fontFamily: "Inter_700Bold" },
  stagePillLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  listTitle: {
    fontSize:   15,
    fontFamily: "Inter_700Bold",
    marginTop:  20,
    marginBottom: 8,
  },
  incidentWrapper: {
    gap: 2,
  },
  stageBadge: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               5,
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderRadius:      8,
    borderWidth:       1,
    alignSelf:         "flex-start",
    marginBottom:      6,
    marginLeft:        4,
  },
  stageBadgeIcon: { fontSize: 12 },
  stageBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  emptyContainer: {
    flex:           1,
    alignItems:     "center",
    justifyContent: "center",
    gap:            12,
  },
  emptyIcon: {
    width:          72,
    height:         72,
    borderRadius:   36,
    alignItems:     "center",
    justifyContent: "center",
  },
  emptyTitle:    { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
