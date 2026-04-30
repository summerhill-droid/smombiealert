/**
 * (tabs)/_layout.tsx — Tab bar navigation layout
 *
 * Defines the four main tabs of the app:
 *   Monitor  (index)   — Main detection screen
 *   Map      (map)     — Live GIS map with crosswalk markers
 *   History  (history) — Incident log
 *   Settings (settings)— Alert preferences and app info
 *
 * TWO IMPLEMENTATIONS:
 *
 *   NativeTabLayout — uses expo-router's unstable-native-tabs API, which
 *     renders the platform's native tab bar on iOS 26+ (Liquid Glass UI).
 *     Uses SF Symbols for the icons (iOS only).
 *
 *   ClassicTabLayout — standard cross-platform tab bar.
 *     On iOS:      frosted glass background via BlurView
 *     On Android:  solid background color
 *     On web:      solid background with fixed height for browser chrome
 *
 * isLiquidGlassAvailable() checks at runtime whether the native tab
 * implementation is supported; falls back to ClassicTabLayout otherwise.
 *
 * ICONS:
 *   iOS:     SymbolView (SF Symbols — system icons that match iOS style)
 *   Android/Web: Feather icons from @expo/vector-icons
 */

import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";

/** Native tab bar (iOS 26+ Liquid Glass) */
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "shield", selected: "shield.fill" }} />
        <Label>Monitor</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="map">
        <Icon sf={{ default: "map", selected: "map.fill" }} />
        <Label>Map</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <Icon sf={{ default: "clock", selected: "clock.fill" }} />
        <Label>History</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

/** Cross-platform tab bar (iOS < 26, Android, Web) */
function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,       // Red when selected
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,                           // Each screen manages its own header
        tabBarStyle: {
          position: "absolute",                       // Float above content (for blur)
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),           // Taller bar for browser
        },
        tabBarBackground: () =>
          isIOS ? (
            // Frosted glass effect on iOS (requires position: absolute above)
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            // Solid background for web
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Monitor",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="shield" tintColor={color} size={24} />
            ) : (
              <Feather name="shield" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="map" tintColor={color} size={24} />
            ) : (
              <Feather name="map" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="clock" tintColor={color} size={24} />
            ) : (
              <Feather name="clock" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="gearshape" tintColor={color} size={24} />
            ) : (
              <Feather name="settings" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  // Use native tabs on supported iOS versions; classic tabs elsewhere
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
