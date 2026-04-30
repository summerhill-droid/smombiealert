/**
 * AlertRing.tsx — Animated concentric alert ring (v2)
 *
 * CHANGES: Now supports 4-level alert system (safe / caution / warning / danger)
 * and maps "warning" (🟠) to the orange visual between caution and danger.
 *
 * Three concentric rings animate outward when an alert fires:
 *   safe    → slow, faint green pulse (idle breathing animation)
 *   caution → gentle amber pulse
 *   warning → faster, brighter orange pulse + wider radius
 *   danger  → rapid red pulse + maximum radius + opacity burst
 */

import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import type { AlertLevel } from "@/context/DetectionContext";

interface AlertRingProps {
  level: AlertLevel;
  size?: number;
}

export function AlertRing({ level, size = 240 }: AlertRingProps) {
  const colors = useColors();

  // Three independent ring animations for depth effect
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const ringColor =
    level === "danger"  ? colors.danger  :
    level === "warning" ? colors.warning :
    level === "caution" ? "#D4A800"     : // amber for caution
    colors.safe;

  /** Duration in ms — shorter = more urgent */
  const pulseDuration =
    level === "danger"  ? 700  :
    level === "warning" ? 1000 :
    level === "caution" ? 1400 :
    2200;

  /** Max scale relative to the inner circle */
  const maxScale =
    level === "danger"  ? 1.9 :
    level === "warning" ? 1.7 :
    level === "caution" ? 1.5 :
    1.3;

  useEffect(() => {
    if (animRef.current) {
      animRef.current.stop();
    }

    // Stagger ring launches so they look like expanding ripples
    const makeRing = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(anim, {
              toValue:         1,
              duration:        pulseDuration,
              easing:          Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(anim, {
            toValue:         0,
            duration:        0,
            useNativeDriver: true,
          }),
        ])
      );

    const stagger = pulseDuration / 3;
    animRef.current = Animated.parallel([
      makeRing(ring1, 0),
      makeRing(ring2, stagger),
      makeRing(ring3, stagger * 2),
    ]);
    animRef.current.start();

    return () => { animRef.current?.stop(); };
  }, [level, pulseDuration, maxScale, ring1, ring2, ring3]);

  const center = size / 2;
  const innerR = size * 0.22;

  const makeRingStyle = (anim: Animated.Value) => ({
    position:        "absolute" as const,
    width:           innerR * 2,
    height:          innerR * 2,
    borderRadius:    innerR,
    borderWidth:     1.5,
    borderColor:     ringColor,
    transform: [
      {
        scale: anim.interpolate({
          inputRange:  [0, 1],
          outputRange: [1, maxScale],
        }),
      },
    ],
    opacity: anim.interpolate({
      inputRange:  [0, 0.2, 1],
      outputRange: [0, 0.65, 0],
    }),
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Ripple rings */}
      <Animated.View style={makeRingStyle(ring1)} />
      <Animated.View style={makeRingStyle(ring2)} />
      <Animated.View style={makeRingStyle(ring3)} />

      {/* Inner filled circle */}
      <View
        style={[
          styles.innerCircle,
          {
            width:       innerR * 2,
            height:      innerR * 2,
            borderRadius: innerR,
            backgroundColor: ringColor + "18",
            borderColor:     ringColor + "60",
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems:     "center",
    justifyContent: "center",
  },
  innerCircle: {
    borderWidth: 2,
  },
});
