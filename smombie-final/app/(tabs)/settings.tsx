/**
 * settings.tsx — Settings screen
 *
 * User preferences and informational content.
 *
 * SECTIONS:
 *   Alerts         — toggles for haptic feedback, sound, auto-start
 *   How It Works   — brief explanation of the detection pipeline
 *   App Info       — version, sensor details
 *   Safety Reminder— legal/ethical disclaimer
 *
 * PERSISTENCE:
 *   Settings are saved to AsyncStorage as a JSON blob under the key
 *   "smombie_settings". On startup, DetectionContext could read this
 *   to apply preferences (currently settings are read-only at the
 *   context level — wiring them up is a Week 5 task).
 *
 * RESEARCH NOTE (Week 2):
 *   This screen is where you could add a "Participant ID" field and
 *   a consent checkbox for IRB compliance, so each participant's data
 *   can be linked to their baseline profile in Firebase.
 *
 * FUTURE:
 *   - Sensitivity slider: adjust speedProxy threshold (currently 5)
 *   - Sensitivity slider: adjust readingAngle range (currently 40–85°)
 *   - Alert cooldown: minimum seconds between repeated haptic alerts
 *   - Export data: share incidents as CSV for researcher analysis
 */

import React, { useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import AsyncStorage from "@react-native-async-storage/async-storage";

type SettingKey = "haptics" | "sound" | "autoStart";

// ── Sub-components ─────────────────────────────────────────────────────────────

/**
 * SettingRow — a toggle switch row with icon, label, and description.
 * Value changes are persisted to AsyncStorage immediately.
 */
function SettingRow({
  icon,
  label,
  description,
  value,
  onToggle,
}: {
  icon: string;
  label: string;
  description: string;
  value: boolean;
  onToggle: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
      {/* Icon badge */}
      <View style={[styles.settingIcon, { backgroundColor: `${colors.primary}15` }]}>
        <Feather name={icon as keyof typeof Feather.glyphMap} size={18} color={colors.primary} />
      </View>
      <View style={styles.settingInfo}>
        <Text style={[styles.settingLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.settingDesc, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
      {/* iOS-style toggle switch */}
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.border, true: `${colors.primary}60` }}
        thumbColor={value ? colors.primary : colors.mutedForeground}
      />
    </View>
  );
}

/** Simple label+value row for the App Info section */
function InfoRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Default settings (could be loaded from AsyncStorage on mount)
  const [settings, setSettings] = useState({
    haptics: true,    // Vibrate on smombie detection
    sound: true,      // Play alert sound (not yet implemented in audio pipeline)
    autoStart: false, // Start monitoring automatically when app opens
  });

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  /** Toggles a setting and persists the updated settings object */
  function toggle(key: SettingKey) {
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Save to AsyncStorage so preferences survive app restarts
      AsyncStorage.setItem("smombie_settings", JSON.stringify(next));
      return next;
    });
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 20, paddingBottom: Platform.OS === "web" ? 34 + 100 : 100 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: colors.foreground }]}>Settings</Text>

      {/* ── Alert preferences ────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>ALERTS</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="zap"
            label="Haptic Feedback"
            description="Vibrate when smombie behavior detected"
            value={settings.haptics}
            onToggle={() => toggle("haptics")}
          />
          <SettingRow
            icon="volume-2"
            label="Sound Alerts"
            description="Play alert sound when in danger zone"
            value={settings.sound}
            onToggle={() => toggle("sound")}
          />
          <SettingRow
            icon="play-circle"
            label="Auto-Start"
            description="Start monitoring when app opens"
            value={settings.autoStart}
            onToggle={() => toggle("autoStart")}
          />
        </View>
      </View>

      {/* ── How it works (matches three-trigger logic from research plan) ─── */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>HOW IT WORKS</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.howItWorks}>
            {[
              {
                icon: "activity",
                title: "Motion Detection",
                desc: "Accelerometer measures your walking rhythm and pace",
              },
              {
                icon: "smartphone",
                title: "Phone Angle",
                desc: "Gyroscope tracks phone orientation to detect reading posture",
              },
              {
                icon: "alert-triangle",
                title: "Risk Assessment",
                desc: "Combines sensor data + crosswalk/traffic data to assess danger",
              },
              {
                icon: "bell",
                title: "Instant Alert",
                desc: "Vibration alerts warn you immediately when smombie behavior is detected",
              },
            ].map((item, i) => (
              <View
                key={i}
                style={[
                  styles.howRow,
                  { borderBottomColor: colors.border, borderBottomWidth: i < 3 ? 1 : 0 },
                ]}
              >
                <View style={[styles.howIcon, { backgroundColor: `${colors.primary}15` }]}>
                  <Feather
                    name={item.icon as keyof typeof Feather.glyphMap}
                    size={16}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.howInfo}>
                  <Text style={[styles.howTitle, { color: colors.foreground }]}>{item.title}</Text>
                  <Text style={[styles.howDesc, { color: colors.mutedForeground }]}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* ── App Info ─────────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>APP INFO</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <InfoRow label="Version" value="1.0.0" />
          <InfoRow label="Detection Method" value="Sensor Fusion + GIS" />
          <InfoRow label="Sensors Used" value="Accelerometer + Gyroscope + GPS" />
          <InfoRow label="Update Rate" value="300ms" />
        </View>
      </View>

      {/* ── Safety reminder / ethical disclaimer ─────────────────────────── */}
      <View
        style={[
          styles.reminderCard,
          { backgroundColor: `${colors.safe}10`, borderColor: `${colors.safe}30` },
        ]}
      >
        <Feather name="shield" size={20} color={colors.safe} />
        <Text style={[styles.reminderText, { color: colors.foreground }]}>
          This app uses motion sensors and public geographic data to promote safer pedestrian habits.
          Always be aware of your surroundings, especially near traffic.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20 },
  pageTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 24,
  },
  section: { marginBottom: 24 },
  sectionHeader: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 2,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  settingInfo: { flex: 1 },
  settingLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  settingDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  howItWorks: {},
  howRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  howIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  howInfo: { flex: 1 },
  howTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  howDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
    lineHeight: 17,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  infoLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  infoValue: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  reminderCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "flex-start",
    marginBottom: 20,
  },
  reminderText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
});
