/**
 * _layout.tsx — Root layout and provider hierarchy (v2)
 *
 * PROVIDER HIERARCHY:
 *
 *   SafeAreaProvider
 *   └─ ErrorBoundary
 *      └─ QueryClientProvider
 *         └─ GestureHandlerRootView
 *            └─ GISProvider          — GPS + Overpass GIS data
 *               └─ BehaviorProvider  — 3-stage behavior classifier (NEW in v2)
 *                  └─ DetectionProvider — sensor fusion + 4-level alerts
 *                     └─ screens
 *
 * WHY BehaviorProvider wraps DetectionProvider:
 *   DetectionProvider calls activate()/deactivate() on BehaviorProvider
 *   via useBehavior(), and reads behaviorStage to calibrate alert levels.
 *   BehaviorProvider must therefore be above DetectionProvider.
 */

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary }     from "@/components/ErrorBoundary";
import { BehaviorProvider }  from "@/context/BehaviorContext";
import { DetectionProvider } from "@/context/DetectionContext";
import { GISProvider }       from "@/context/GISContext";
import { WatchingOverlay }   from "@/components/WatchingOverlay";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <GISProvider>
              <BehaviorProvider>
                <DetectionProvider>
                  <RootLayoutNav />
                  <WatchingOverlay />
                </DetectionProvider>
              </BehaviorProvider>
            </GISProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
