/**
 * IncidentCard.tsx — Single incident row in the History tab
 *
 * Displays one recorded smombie incident with:
 *   - Colored left border (red = danger, amber = caution)
 *   - Alert icon + severity label
 *   - Duration in seconds ("12s distracted")
 *   - Date (Today / Yesterday / Dec 5) and time (14:32)
 *
 * DATA SOURCE:
 *   Receives an `Incident` object from DetectionContext's incidents array,
 *   which is loaded from AsyncStorage on startup.
 *
 * RESEARCH NOTE (Week 6):
 *   For study data collection, add a `location` field to Incident and
 *   reverse-geocode the GPS coordinates at incident end time.
 *   Store to Firebase instead of (or in addition to) AsyncStorage so
 *   you can analyze cross-participant data in Python/GeoPandas.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Incident } from "@/context/DetectionContext";
import { useColors } from "@/hooks/useColors";

interface IncidentCardProps {
  incident: Incident;
}

/** Formats a Unix timestamp as "HH:MM" in the device's locale */
function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Formats a date as "Today", "Yesterday", or "Mon DD" */
function formatDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function IncidentCard({ incident }: IncidentCardProps) {
  const colors = useColors();

  // Accent color and icon based on severity
  const accentColor = incident.level === "danger" ? colors.danger : colors.warning;
  const iconName = incident.level === "danger" ? "alert-triangle" : "alert-circle";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: accentColor,  // Colored left stripe = severity indicator
        },
      ]}
    >
      {/* Icon badge */}
      <View style={[styles.iconWrap, { backgroundColor: `${accentColor}15` }]}>
        <Feather name={iconName as keyof typeof Feather.glyphMap} size={18} color={accentColor} />
      </View>

      {/* Severity + duration */}
      <View style={styles.info}>
        <Text style={[styles.level, { color: accentColor }]}>
          {incident.level === "danger" ? "High Risk" : "Caution"}
        </Text>
        <Text style={[styles.duration, { color: colors.foreground }]}>
          {incident.duration}s distracted
        </Text>
      </View>

      {/* Date and time (right-aligned) */}
      <View style={styles.timeWrap}>
        <Text style={[styles.date, { color: colors.mutedForeground }]}>
          {formatDate(incident.timestamp)}
        </Text>
        <Text style={[styles.time, { color: colors.mutedForeground }]}>
          {formatTime(incident.timestamp)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,  // Thicker left border = severity stripe
    gap: 12,
    marginBottom: 8,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    gap: 2,
  },
  level: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.2,
  },
  duration: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  timeWrap: {
    alignItems: "flex-end",
    gap: 2,
  },
  date: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  time: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
