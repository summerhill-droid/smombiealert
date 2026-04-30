/**
 * StatusIcon.tsx — Animated alert-level icon
 *
 * Displayed inside the AlertRing on the Monitor screen.
 * Shows a different Feather icon and color for each state:
 *
 *   not monitoring → shield-off (grey)
 *   safe           → shield      (green)
 *   caution        → alert-circle (amber, bouncing)
 *   danger         → alert-triangle (red, bouncing fast)
 *
 * ANIMATION:
 *   When level is caution or danger, the icon bounces (scale 1 → 1.15 → 1)
 *   using a looping sequence. The bounce stops and resets when safe.
 *   useNativeDriver: true — GPU-accelerated (scale is a transform).
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AlertLevel } from "@/context/DetectionContext";
import { useColors } from "@/hooks/useColors";

interface StatusIconProps {
  level: AlertLevel;
  isMonitoring: boolean;
  size?: number;  // Icon size in pixels (default 52)
}

export function StatusIcon({ level, isMonitoring, size = 52 }: StatusIconProps) {
  const colors = useColors();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Icon color: mirrors the AlertRing color logic
  const iconColor =
    level === "danger"
      ? colors.danger
      : level === "caution"
      ? colors.warning
      : isMonitoring
      ? colors.safe
      : colors.mutedForeground;

  // Icon name: different icon for each state
  const iconName =
    level === "danger"
      ? "alert-triangle"
      : level === "caution"
      ? "alert-circle"
      : isMonitoring
      ? "shield"       // Active and safe
      : "shield-off";  // Not yet started

  useEffect(() => {
    if (level !== "safe") {
      // Bounce animation: 300 ms up, 300 ms down, looping
      const bounce = Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.15,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ])
      );
      bounce.start();
      return () => bounce.stop();
    } else {
      scaleAnim.setValue(1);  // Reset to normal size
    }
  }, [level, scaleAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Feather name={iconName as keyof typeof Feather.glyphMap} size={size} color={iconColor} />
    </Animated.View>
  );
}
