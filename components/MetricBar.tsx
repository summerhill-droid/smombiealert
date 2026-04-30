/**
 * MetricBar.tsx — Animated progress bar for live sensor metrics
 *
 * Used on the Monitor screen to display three live values:
 *   - Walking Activity  (0–100, from accelerometer)
 *   - Phone Angle       (0–100, from gyroscope)
 *   - Distraction Risk  (0–100, derived from alert level)
 *
 * ANIMATION:
 *   The bar width animates smoothly to each new value over 400 ms.
 *   Uses `useNativeDriver: false` because width is a layout property
 *   (not a transform), so it must be driven by the JS thread.
 *   The width interpolates from a numeric value (0–100) to a percentage
 *   string ("0%"–"100%") that Flexbox can use.
 *
 * PROPS:
 *   label — text shown on the left
 *   value — 0–100 number (clamped internally)
 *   color — fill color (changes with alert level)
 *   unit  — suffix shown next to the numeric value (default "%")
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface MetricBarProps {
  label: string;
  value: number;   // 0–100
  color: string;   // Fill color (hex)
  unit?: string;   // Display unit (default "%")
}

export function MetricBar({ label, value, color, unit = "%" }: MetricBarProps) {
  const colors = useColors();
  // Animated value tracks the current bar fill (0–100)
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Smooth animation to the new value whenever `value` changes
    Animated.timing(widthAnim, {
      toValue: Math.min(100, Math.max(0, value)),  // Clamp 0–100
      duration: 400,
      useNativeDriver: false,  // Width is a layout prop, must use JS driver
    }).start();
  }, [value, widthAnim]);

  return (
    <View style={styles.container}>
      {/* Label row: name on left, numeric value on right */}
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.value, { color: colors.foreground }]}>
          {value}{unit}
        </Text>
      </View>

      {/* Progress track: grey background, colored fill on top */}
      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: color,
              // Interpolate numeric Animated.Value to a CSS-style percentage string
              width: widthAnim.interpolate({
                inputRange: [0, 100],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  value: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",  // Clip the animated fill at the track edges
  },
  fill: {
    height: "100%",
    borderRadius: 3,
  },
});
