import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

import { DANGER_ZONES, DangerZone, SEOUL_CENTER } from "@/data/dangerZones";
import { useUserLocation, type LocationState } from "@/hooks/useUserLocation";
import { haversine } from "@/services/seoulSignals";

type Position = { lat: number; lng: number };

type ProtectionState = {
  enabled: boolean;
  position: Position;
  hasFix: boolean;
  locationStatus: LocationState["status"];
  locationError?: string;
  activeAlert: DangerZone | null;
  recentAlertId: string | null;
  distanceToday: number;
  alertsToday: number;
  ranked: { zone: DangerZone; distance: number }[];
  toggle: () => void;
  dismissAlert: () => void;
};

const ProtectionContext = createContext<ProtectionState | null>(null);

const STORAGE_KEY = "@smombiealert/state/v2";

export function ProtectionProvider({ children }: { children: React.ReactNode }) {
  const loc = useUserLocation();
  const position: Position = loc.position ?? SEOUL_CENTER;
  const hasFix = !!loc.position;

  const [enabled, setEnabled] = useState(true);
  const [activeAlert, setActiveAlert] = useState<DangerZone | null>(null);
  const [recentAlertId, setRecentAlertId] = useState<string | null>(null);
  const [distanceToday, setDistanceToday] = useState(0);
  const [alertsToday, setAlertsToday] = useState(0);

  const lastPosRef = useRef<Position | null>(null);
  const lastAlertedRef = useRef<string | null>(null);

  // hydrate
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const v = JSON.parse(raw);
        if (typeof v.enabled === "boolean") setEnabled(v.enabled);
        if (typeof v.distanceToday === "number") setDistanceToday(v.distanceToday);
        if (typeof v.alertsToday === "number") setAlertsToday(v.alertsToday);
      })
      .catch(() => {});
  }, []);

  // persist
  useEffect(() => {
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ enabled, distanceToday, alertsToday }),
    ).catch(() => {});
  }, [enabled, distanceToday, alertsToday]);

  // accumulate walking distance from position deltas
  useEffect(() => {
    if (!loc.position) return;
    const prev = lastPosRef.current;
    lastPosRef.current = loc.position;
    if (!prev) return;
    const d = haversine(prev, loc.position);
    if (d > 0.5 && d < 200) setDistanceToday((acc) => acc + d);
  }, [loc.position]);

  // distance ranking against curated danger zones (for the in-map alert demo)
  const ranked = useMemo(() => {
    return DANGER_ZONES.map((zone) => ({
      zone,
      distance: haversine(position, { lat: zone.lat, lng: zone.lng }),
    })).sort((a, b) => a.distance - b.distance);
  }, [position]);

  // proximity alert
  useEffect(() => {
    if (!enabled) {
      setActiveAlert(null);
      return;
    }
    const nearest = ranked[0];
    if (!nearest) return;
    const insideTrigger = nearest.distance <= nearest.zone.radius + 20;
    if (insideTrigger && lastAlertedRef.current !== nearest.zone.id) {
      lastAlertedRef.current = nearest.zone.id;
      setActiveAlert(nearest.zone);
      setRecentAlertId(nearest.zone.id);
      setAlertsToday((n) => n + 1);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning,
        ).catch(() => {});
      }
    }
    if (!insideTrigger && lastAlertedRef.current === nearest.zone.id) {
      const stillClose = nearest.distance <= nearest.zone.radius + 60;
      if (!stillClose) lastAlertedRef.current = null;
    }
  }, [ranked, enabled]);

  const toggle = useCallback(() => {
    setEnabled((e) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(
          e
            ? Haptics.ImpactFeedbackStyle.Light
            : Haptics.ImpactFeedbackStyle.Medium,
        ).catch(() => {});
      }
      return !e;
    });
  }, []);

  const dismissAlert = useCallback(() => {
    setActiveAlert(null);
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
  }, []);

  const value = useMemo<ProtectionState>(
    () => ({
      enabled,
      position,
      hasFix,
      locationStatus: loc.status,
      locationError: loc.error,
      activeAlert,
      recentAlertId,
      distanceToday,
      alertsToday,
      ranked,
      toggle,
      dismissAlert,
    }),
    [
      enabled,
      position,
      hasFix,
      loc.status,
      loc.error,
      activeAlert,
      recentAlertId,
      distanceToday,
      alertsToday,
      ranked,
      toggle,
      dismissAlert,
    ],
  );

  return (
    <ProtectionContext.Provider value={value}>
      {children}
    </ProtectionContext.Provider>
  );
}

export function useProtection() {
  const ctx = useContext(ProtectionContext);
  if (!ctx)
    throw new Error("useProtection must be used within ProtectionProvider");
  return ctx;
}
