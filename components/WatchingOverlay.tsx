/**
 * WatchingOverlay.tsx — Full-screen red blocking overlay shown when the
 * ML classifier detects "Watching" (passive viewing) while walking.
 *
 * - Dims the app brightness to a minimum
 * - Pulses a red translucent layer over all content
 * - Shows a large warning message
 * - User must tap "Acknowledge" to dismiss (UI block only; cannot actually
 *   lock the device on iOS/Android without admin/MDM)
 */

import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Brightness from "expo-brightness";
import { useDetection } from "@/context/DetectionContext";

const WATCH_VIBRATION_PATTERN = [0, 600, 400];

export function WatchingOverlay() {
  const { watchingLock, dismissWatchingLock } = useDetection();
  const pulse = useRef(new Animated.Value(0)).current;
  const savedBrightness = useRef<number | null>(null);

  // Brightness dimming + sustained vibration while overlay is active
  useEffect(() => {
    let cancelled = false;
    async function applyDim() {
      if (Platform.OS === "web") return;
      try {
        const current = await Brightness.getBrightnessAsync();
        if (!cancelled) {
          savedBrightness.current = current;
          await Brightness.setBrightnessAsync(0.05);
        }
      } catch { /* permission may be denied — overlay still works */ }
    }
    async function restore() {
      if (Platform.OS === "web") return;
      try {
        if (savedBrightness.current !== null) {
          await Brightness.setBrightnessAsync(savedBrightness.current);
          savedBrightness.current = null;
        } else {
          await Brightness.restoreSystemBrightnessAsync();
        }
      } catch { /* ignore */ }
    }

    if (watchingLock) {
      void applyDim();
      if (Platform.OS !== "web") {
        Vibration.vibrate(WATCH_VIBRATION_PATTERN, true);
      }
    } else {
      Vibration.cancel();
      void restore();
    }

    return () => {
      cancelled = true;
      Vibration.cancel();
      void restore();
    };
  }, [watchingLock]);

  // Pulsing animation
  useEffect(() => {
    if (!watchingLock) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [watchingLock, pulse]);

  const bgOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 0.96] });
  const iconScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });

  return (
    <Modal
      visible={watchingLock}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissWatchingLock}
    >
      <Animated.View style={[styles.fill, { opacity: bgOpacity }]} />
      <View style={styles.content} pointerEvents="box-none">
        <Animated.View style={{ transform: [{ scale: iconScale }] }}>
          <Feather name="eye-off" size={88} color="#fff" />
        </Animated.View>
        <Text style={styles.title}>LOOK UP</Text>
        <Text style={styles.subtitle}>
          You are watching content while walking. This is dangerous — please
          look up at your surroundings now.
        </Text>
        <Pressable
          onPress={dismissWatchingLock}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: pressed ? "#ffffff30" : "#ffffff20" },
          ]}
        >
          <Text style={styles.buttonText}>I am paying attention</Text>
        </Pressable>
        <Text style={styles.note}>
          Tap and hold for 1 second to confirm you have stopped walking or
          looked up. Dismiss only when safe.
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#B71C1C",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 18,
  },
  title: {
    fontSize: 48,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: 2,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 17,
    fontFamily: "Inter_500Medium",
    color: "#fff",
    textAlign: "center",
    lineHeight: 24,
    maxWidth: 340,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#ffffff80",
    marginTop: 16,
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  note: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#ffffffb0",
    textAlign: "center",
    marginTop: 12,
    maxWidth: 300,
    lineHeight: 17,
  },
});
