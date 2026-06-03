import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";

export type LocationState = {
  position: { lat: number; lng: number } | null;
  status: "pending" | "granted" | "denied" | "error" | "simulated";
  error?: string;
};

// Fallback path looping through downtown Seoul, used when the device denies
// location or geolocation isn't available (e.g. desktop preview).
const FALLBACK_PATH: { lat: number; lng: number }[] = [
  { lat: 37.5665, lng: 126.978 },
  { lat: 37.5672, lng: 126.9784 },
  { lat: 37.568, lng: 126.9787 },
  { lat: 37.569, lng: 126.9779 },
  { lat: 37.5701, lng: 126.9772 },
  { lat: 37.5712, lng: 126.9766 },
  { lat: 37.572, lng: 126.9769 },
  { lat: 37.5715, lng: 126.9788 },
  { lat: 37.5703, lng: 126.9826 },
  { lat: 37.5685, lng: 126.9828 },
  { lat: 37.5668, lng: 126.9826 },
  { lat: 37.5662, lng: 126.9805 },
];

export function useUserLocation(): LocationState {
  const [state, setState] = useState<LocationState>({
    position: null,
    status: "pending",
  });
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function startFallback(status: LocationState["status"], error?: string) {
      if (cancelled) return;
      let step = 0;
      setState({ position: FALLBACK_PATH[0], status, error });
      fallbackTimerRef.current = setInterval(() => {
        step = (step + 1) % (FALLBACK_PATH.length * 4);
        const i = Math.floor(step / 4);
        const next = FALLBACK_PATH[i];
        const after = FALLBACK_PATH[(i + 1) % FALLBACK_PATH.length];
        const t = (step % 4) / 4;
        setState({
          position: {
            lat: next.lat + (after.lat - next.lat) * t,
            lng: next.lng + (after.lng - next.lng) * t,
          },
          status,
          error,
        });
      }, 1400);
    }

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== "granted") {
          // Surface the real reason (denied) before falling back to demo data.
          setState({
            position: FALLBACK_PATH[0],
            status: "denied",
            error: "위치 권한이 없어 데모 경로로 표시합니다",
          });
          startFallback("denied", "위치 권한이 없어 데모 경로로 표시합니다");
          return;
        }
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (cancelled) return;
        setState({
          position: {
            lat: initial.coords.latitude,
            lng: initial.coords.longitude,
          },
          status: "granted",
        });
        watchRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 3,
            timeInterval: 2000,
          },
          (loc) => {
            setState({
              position: {
                lat: loc.coords.latitude,
                lng: loc.coords.longitude,
              },
              status: "granted",
            });
          },
        );
      } catch (err) {
        if (cancelled) return;
        startFallback(
          "simulated",
          err instanceof Error ? err.message : "위치를 가져올 수 없습니다",
        );
      }
    })();

    return () => {
      cancelled = true;
      watchRef.current?.remove();
      watchRef.current = null;
      if (fallbackTimerRef.current) clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    };
  }, []);

  return state;
}
