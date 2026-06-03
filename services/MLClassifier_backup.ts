/**
 * MLClassifier.ts — ONNX XGBoost HAR inference pipeline.
 *
 * Pipeline:
 *   1. Subscribe to accel + gyro @ 100Hz (best effort), light/baro/steps slow.
 *   2. Keep a ring buffer of the last 50 IMU samples per axis.
 *   3. Every 25 samples (~250ms) extract features and run ONNX inference.
 *   4. Smooth predictions via majority vote over the last K windows.
 *   5. Emit (stage, confidence) callbacks to the consumer.
 *
 * Falls back gracefully on web (no native ORT) — caller should use
 * the legacy threshold classifier in that case.
 */

import { Platform } from "react-native";
import { Accelerometer, Gyroscope, Barometer, LightSensor, Pedometer } from "expo-sensors";
import { Asset } from "expo-asset";
import {
  extractFeatures,
  ML_CLASSES,
  ML_TO_STAGE,
  type MLClass,
  type Vec3Sample,
  type WindowContext,
} from "./featureExtraction";

export type MLStage = (typeof ML_TO_STAGE)[MLClass];

export interface MLResult {
  stage: MLStage;
  mlClass: MLClass;
  confidence: number;          // 0–100
  probabilities: number[];     // length 4, ordered like ML_CLASSES
  raw: { stage: MLStage; mlClass: MLClass }; // pre-smoothing single-window output
}

const WINDOW_SIZE = 50;
const STRIDE = 25;
const TARGET_INTERVAL_MS = 10; // 100Hz
const SMOOTH_K = 3;            // majority vote over last K windows

type Subscription = { remove: () => void };

export class MLClassifier {
  private session: any | null = null;
  private inputName: string = "input";
  private isReady = false;
  private isRunning = false;
  private loadError: string | null = null;

  private accelBuf: Vec3Sample[] = [];
  private gyroBuf: Vec3Sample[] = [];
  private latestAccel: Vec3Sample = { x: 0, y: 0, z: 0 };
  private latestGyro: Vec3Sample = { x: 0, y: 0, z: 0 };
  private sampleCount = 0;
  private samplesSinceLastInfer = 0;

  private brightness = 0.5;
  private stepCountStart = 0;
  private stepCountCurrent = 0;
  private pressureStart: number | null = null;
  private pressureCurrent: number | null = null;

  private accelSub: Subscription | null = null;
  private gyroSub: Subscription | null = null;
  private baroSub: Subscription | null = null;
  private lightSub: Subscription | null = null;
  private pedoSub: Subscription | null = null;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;

  private predHistory: MLClass[] = [];
  private onResult: ((r: MLResult) => void) | null = null;
  private inferring = false;

  /** Public flag — true after the ONNX session is created. */
  get ready(): boolean { return this.isReady; }
  get error(): string | null { return this.loadError; }
  get running(): boolean { return this.isRunning; }

  /** Load the ONNX model. Idempotent. */
  async load(): Promise<void> {
    if (this.isReady || Platform.OS === "web") return;
    try {
      const ort = await import("onnxruntime-react-native");
      const asset = Asset.fromModule(require("../assets/models/har.onnx"));
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const path = uri.startsWith("file://") ? uri.replace("file://", "") : uri;
      this.session = await ort.InferenceSession.create(path);
      this.inputName = this.session.inputNames?.[0] ?? "input";
      this.isReady = true;
    } catch (e: any) {
      this.loadError = String(e?.message ?? e);
      this.isReady = false;
      // Surface to console for diagnostics
      console.warn("[MLClassifier] load failed:", this.loadError);
    }
  }

  /** Begin sensor subscriptions + inference loop. */
  async start(onResult: (r: MLResult) => void): Promise<void> {
    if (this.isRunning) return;
    this.onResult = onResult;
    this.isRunning = true;
    this.accelBuf = [];
    this.gyroBuf = [];
    this.predHistory = [];
    this.sampleCount = 0;
    this.samplesSinceLastInfer = 0;

    if (Platform.OS === "web") {
      // Web fallback: synthesize gentle motion so UI animates.
      let t = 0;
      this.sampleTimer = setInterval(() => {
        t += 0.01;
        this.latestAccel = { x: Math.sin(t) * 0.3, y: 9.0 + Math.sin(t * 1.2) * 0.2, z: Math.cos(t) * 0.1 };
        this.latestGyro  = { x: Math.sin(t * 0.7) * 0.04, y: Math.cos(t * 0.5) * 0.03, z: 0 };
        this.tick();
      }, TARGET_INTERVAL_MS);
      return;
    }

    try {
      Accelerometer.setUpdateInterval(TARGET_INTERVAL_MS);
      Gyroscope.setUpdateInterval(TARGET_INTERVAL_MS);
      this.accelSub = Accelerometer.addListener((d) => { this.latestAccel = d; });
      this.gyroSub  = Gyroscope.addListener((d) => { this.latestGyro = d; });

      // Optional sensors — fail silently if unavailable.
      try {
        Barometer.setUpdateInterval(500);
        this.baroSub = Barometer.addListener((d: any) => {
          const p = d?.pressure;
          if (typeof p === "number") {
            if (this.pressureStart === null) this.pressureStart = p;
            this.pressureCurrent = p;
          }
        });
      } catch { /* no barometer */ }

      try {
        LightSensor.setUpdateInterval(500);
        this.lightSub = LightSensor.addListener((d: any) => {
          // illuminance lux → normalize roughly to 0..1 (cap at 1000 lux indoor)
          if (typeof d?.illuminance === "number") {
            this.brightness = Math.max(0, Math.min(1, d.illuminance / 1000));
          }
        });
      } catch { /* no light sensor */ }

      try {
        const available = await Pedometer.isAvailableAsync();
        if (available) {
          this.pedoSub = Pedometer.watchStepCount((res: any) => {
            this.stepCountCurrent = res?.steps ?? this.stepCountCurrent;
          });
        }
      } catch { /* no pedometer */ }

      // Tick the buffer at TARGET_INTERVAL_MS using a JS timer (re-samples
      // the latest sensor reading). Expo doesn't guarantee 100Hz callbacks,
      // so we resample at a fixed cadence.
      this.sampleTimer = setInterval(() => this.tick(), TARGET_INTERVAL_MS);
    } catch (e) {
      console.warn("[MLClassifier] start failed:", e);
    }
  }

  /** Stop sensors and inference. */
  stop(): void {
    this.isRunning = false;
    this.onResult = null;
    this.accelSub?.remove(); this.accelSub = null;
    this.gyroSub?.remove();  this.gyroSub = null;
    this.baroSub?.remove();  this.baroSub = null;
    this.lightSub?.remove(); this.lightSub = null;
    this.pedoSub?.remove();  this.pedoSub = null;
    if (this.sampleTimer) { clearInterval(this.sampleTimer); this.sampleTimer = null; }
    this.accelBuf = [];
    this.gyroBuf = [];
    this.predHistory = [];
  }

  /** One sampling tick — pushes current sensor values into the ring buffer. */
  private tick(): void {
    this.accelBuf.push(this.latestAccel);
    this.gyroBuf.push(this.latestGyro);
    if (this.accelBuf.length > WINDOW_SIZE) this.accelBuf.shift();
    if (this.gyroBuf.length  > WINDOW_SIZE) this.gyroBuf.shift();
    this.sampleCount++;
    this.samplesSinceLastInfer++;

    if (
      this.accelBuf.length === WINDOW_SIZE &&
      this.samplesSinceLastInfer >= STRIDE
    ) {
      this.samplesSinceLastInfer = 0;
      void this.runInference();
    }
  }

  private async runInference(): Promise<void> {
    if (this.inferring) return;
    if (!this.isReady || !this.session) return;
    this.inferring = true;
    try {
      const ctx: WindowContext = {
        brightness: this.brightness,
        stepCount: Math.max(0, this.stepCountCurrent - this.stepCountStart),
        pressureDiff:
          this.pressureStart !== null && this.pressureCurrent !== null
            ? this.pressureCurrent - this.pressureStart
            : 0,
      };
      this.stepCountStart = this.stepCountCurrent;
      this.pressureStart = this.pressureCurrent;

      const feat = extractFeatures(this.accelBuf, this.gyroBuf, ctx);

      const ort = await import("onnxruntime-react-native");
      const tensor = new ort.Tensor("float32", feat, [1, 30]);
      const feeds: Record<string, any> = { [this.inputName]: tensor };
      const out = await this.session.run(feeds);

      // Find probabilities output (usually second output for XGBoost classifier)
      const outNames = Object.keys(out);
      let probs: number[] | null = null;
      let labelIdx = -1;
      for (const n of outNames) {
        const t = out[n];
        const data = t?.data;
        if (!data) continue;
        // ZipMap → array of maps; tensor → Float32Array of length 4
        if (data instanceof Float32Array && data.length === ML_CLASSES.length) {
          probs = Array.from(data);
        } else if (Array.isArray(data) && data.length === 1 && typeof data[0] === "object") {
          // ZipMap-style: [{ class_name: prob, ... }] or [Map]
          const m = data[0];
          const arr: number[] = [];
          for (const cls of ML_CLASSES) {
            const v = m instanceof Map ? m.get(cls) : m[cls];
            arr.push(typeof v === "number" ? v : 0);
          }
          probs = arr;
        } else if (data instanceof BigInt64Array || data instanceof Int32Array) {
          labelIdx = Number(data[0]);
        }
      }

      let predIdx = -1;
      let confidence = 0;
      if (probs) {
        predIdx = 0;
        for (let i = 1; i < probs.length; i++) if (probs[i] > probs[predIdx]) predIdx = i;
        confidence = Math.round((probs[predIdx] ?? 0) * 100);
      } else if (labelIdx >= 0) {
        predIdx = labelIdx;
        confidence = 100;
      } else {
        return;
      }

      if (predIdx < 0 || predIdx >= ML_CLASSES.length) {
        console.warn("[MLClassifier] predIdx out of range:", predIdx);
        return;
      }
      const mlClass = ML_CLASSES[predIdx] as MLClass;
      const rawStage = ML_TO_STAGE[mlClass];

      this.predHistory.push(mlClass);
      if (this.predHistory.length > SMOOTH_K) this.predHistory.shift();

      // Majority vote
      const counts: Record<string, number> = {};
      for (const c of this.predHistory) counts[c] = (counts[c] ?? 0) + 1;
      let smoothed: MLClass = mlClass;
      let best = 0;
      for (const c of Object.keys(counts)) {
        if (counts[c] > best) { best = counts[c]; smoothed = c as MLClass; }
      }
      const smoothedStage = ML_TO_STAGE[smoothed];

      this.onResult?.({
        stage: smoothedStage,
        mlClass: smoothed,
        confidence,
        probabilities: probs ?? [],
        raw: { stage: rawStage, mlClass },
      });
    } catch (e) {
      console.warn("[MLClassifier] inference error:", e);
    } finally {
      this.inferring = false;
    }
  }
}

/** Singleton — one classifier instance across the app. */
export const mlClassifier = new MLClassifier();
