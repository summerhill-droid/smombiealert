import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import type { BehaviorWindowPayload } from "@/services/behaviorApi";

type Vec3 = {
  x: number;
  y: number;
  z: number;
};

type BehaviorWindowState = {
  payload?: BehaviorWindowPayload;
  ready: boolean;
  sampleCount: number;
  error?: string;
};

const SENSOR_INTERVAL_MS = 33; // 약 30Hz
const TARGET_SAMPLES = 60; // 약 2초 window

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function pushLimit(arr: number[], value: number, limit = TARGET_SAMPLES) {
  arr.push(value);
  if (arr.length > limit) arr.splice(0, arr.length - limit);
}

function fillToLength(values: number[], length: number, fallback = 0): number[] {
  if (values.length >= length) return values.slice(values.length - length);

  const missing = length - values.length;
  return [...Array.from({ length: missing }, () => fallback), ...values];
}

function computePitchDeg(acc: Vec3): number {
  const ax = toNumber(acc.x);
  const ay = toNumber(acc.y);
  const az = toNumber(acc.z, 9.8);

  const pitchRad = Math.atan2(-ax, Math.sqrt(ay * ay + az * az));
  return (pitchRad * 180) / Math.PI;
}

async function getApproxLux(): Promise<number> {
  try {
    const Brightness = await import("expo-brightness");
    const brightness = await Brightness.getBrightnessAsync();

    // 실제 lux는 아니지만 API 입력 필드명을 맞추기 위한 근사값
    return Math.round(toNumber(brightness, 0.5) * 600);
  } catch {
    return 300;
  }
}

export function useBehaviorWindowPayload(): BehaviorWindowState {
  const [state, setState] = useState<BehaviorWindowState>({
    ready: false,
    sampleCount: 0,
  });

  const axRef = useRef<number[]>([]);
  const ayRef = useRef<number[]>([]);
  const azRef = useRef<number[]>([]);

  const gxRef = useRef<number[]>([]);
  const gyRef = useRef<number[]>([]);
  const gzRef = useRef<number[]>([]);

  const pitchRef = useRef<number[]>([]);
  const luxRef = useRef<number[]>([]);
  const stepsRef = useRef<number[]>([]);
  const pressureRef = useRef<number[]>([]);

  const latestAccRef = useRef<Vec3>({ x: 0, y: 0, z: 9.8 });
  const latestGyroRef = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const latestLuxRef = useRef<number>(300);
  const latestStepsRef = useRef<number>(0);
  const latestPressureRef = useRef<number>(1013);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let luxTimer: ReturnType<typeof setInterval> | undefined;

    const subscriptions: { remove: () => void }[] = [];

    async function startSensors() {
      try {
        // Replit web preview에서는 센서가 없으므로 여기서 중단
        // 실제 테스트는 Expo Go 휴대폰에서 해야 함
        if (Platform.OS === "web") {
          setState({
            ready: false,
            sampleCount: 0,
            error: "Sensor collection is only available on a real phone.",
          });
          return;
        }

        const Sensors = await import("expo-sensors");
        const { Accelerometer, Gyroscope, Barometer, Pedometer } = Sensors;

        Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
        Gyroscope.setUpdateInterval(SENSOR_INTERVAL_MS);

        const accSub = Accelerometer.addListener((data) => {
          latestAccRef.current = {
            x: toNumber(data.x),
            y: toNumber(data.y),
            z: toNumber(data.z, 9.8),
          };
        });

        const gyroSub = Gyroscope.addListener((data) => {
          latestGyroRef.current = {
            x: toNumber(data.x),
            y: toNumber(data.y),
            z: toNumber(data.z),
          };
        });

        subscriptions.push(accSub, gyroSub);

        try {
          const barometerAvailable = await Barometer.isAvailableAsync();

          if (barometerAvailable) {
            Barometer.setUpdateInterval(200);

            const barometerSub = Barometer.addListener((data) => {
              latestPressureRef.current = toNumber(data.pressure, 1013);
            });

            subscriptions.push(barometerSub);
          }
        } catch (e) {
          console.log("[BehaviorWindow] barometer unavailable:", e);
        }

        try {
          const pedometerAvailable = await Pedometer.isAvailableAsync();

          if (pedometerAvailable) {
            const pedometerSub = Pedometer.watchStepCount((result) => {
              latestStepsRef.current = toNumber(result.steps, 0);
            });

            subscriptions.push(pedometerSub);
          }
        } catch (e) {
          console.log("[BehaviorWindow] pedometer unavailable:", e);
        }

        latestLuxRef.current = await getApproxLux();

        luxTimer = setInterval(async () => {
          latestLuxRef.current = await getApproxLux();
        }, 500);

        timer = setInterval(() => {
          if (!mounted) return;

          const acc = latestAccRef.current;
          const gyro = latestGyroRef.current;

          pushLimit(axRef.current, acc.x);
          pushLimit(ayRef.current, acc.y);
          pushLimit(azRef.current, acc.z);

          pushLimit(gxRef.current, gyro.x);
          pushLimit(gyRef.current, gyro.y);
          pushLimit(gzRef.current, gyro.z);

          pushLimit(pitchRef.current, computePitchDeg(acc));
          pushLimit(luxRef.current, latestLuxRef.current);
          pushLimit(stepsRef.current, latestStepsRef.current);
          pushLimit(pressureRef.current, latestPressureRef.current);

          const sampleCount = axRef.current.length;
          const ready = sampleCount >= TARGET_SAMPLES;

          if (!ready) {
            setState({
              ready: false,
              sampleCount,
            });
            return;
          }

          const steps = fillToLength(
            stepsRef.current,
            TARGET_SAMPLES,
            latestStepsRef.current,
          );

          const payload: BehaviorWindowPayload = {
            ax: fillToLength(axRef.current, TARGET_SAMPLES, 0),
            ay: fillToLength(ayRef.current, TARGET_SAMPLES, 0),
            az: fillToLength(azRef.current, TARGET_SAMPLES, 9.8),

            gx: fillToLength(gxRef.current, TARGET_SAMPLES, 0),
            gy: fillToLength(gyRef.current, TARGET_SAMPLES, 0),
            gz: fillToLength(gzRef.current, TARGET_SAMPLES, 0),

            pitch: fillToLength(pitchRef.current, TARGET_SAMPLES, 0),

            lux: fillToLength(luxRef.current, TARGET_SAMPLES, 300),

            steps,
            step_count: steps,

            pressure: fillToLength(
              pressureRef.current,
              TARGET_SAMPLES,
              1013,
            ),
          };
          
          setState({
            payload,
            ready: true,
            sampleCount,
          });
        }, SENSOR_INTERVAL_MS);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Unknown sensor error";

        console.log("[BehaviorWindow] start error:", message);

        if (mounted) {
          setState({
            ready: false,
            sampleCount: 0,
            error: message,
          });
        }
      }
    }

    startSensors();

    return () => {
      mounted = false;

      if (timer) clearInterval(timer);
      if (luxTimer) clearInterval(luxTimer);

      for (const sub of subscriptions) {
        try {
          sub.remove();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return state;
}