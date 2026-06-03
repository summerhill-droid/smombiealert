/**
 * MLClassifier.ts — Railway API 기반 HAR 추론 파이프라인
 *
 * ONNX 런타임 대신 Railway API 서버를 사용하여 Expo Go 호환성 확보.
 * 인터페이스는 기존과 완전히 동일하게 유지.
 *
 * Pipeline:
 *   1. 가속도 + 자이로 @ 100Hz 구독
 *   2. 마지막 126 IMU 샘플 링 버퍼 유지 (실제 iOS ~63Hz × 2초)
 *   3. 20샘플마다 Railway API 호출 → 추론
 *   4. 최근 K개 윈도우 다수결 스무딩
 *   5. (stage, confidence) 콜백 방출
 */

import { Platform } from "react-native";
import { Accelerometer, Gyroscope, Barometer, Pedometer } from "expo-sensors";
import * as Brightness from "expo-brightness";
import {
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
  raw: { stage: MLStage; mlClass: MLClass };
}

// ── 설정
const API_URL = "https://web-production-856f9.up.railway.app";
const WINDOW_SIZE = 126;        // 실제 iOS ~63Hz × 2초
const STRIDE = 20;              // 20샘플마다 API 호출
const TARGET_INTERVAL_MS = 10; // 100Hz 목표
const SMOOTH_K = 3;            // 최근 K개 다수결

type Subscription = { remove: () => void };

export class MLClassifier {
  private isReady = false;
  private isRunning = false;
  private loadError: string | null = null;

  private accelBuf: Vec3Sample[] = [];
  private gyroBuf:  Vec3Sample[] = [];
  private latestAccel: Vec3Sample = { x: 0, y: 0, z: 0 };
  private latestGyro:  Vec3Sample = { x: 0, y: 0, z: 0 };
  private sampleCount = 0;
  private samplesSinceLastInfer = 0;

  private brightness = 0.5;
  private stepCountStart = 0;
  private stepCountCurrent = 0;
  private pressureStart: number | null = null;
  private pressureCurrent: number | null = null;

  private accelSub: Subscription | null = null;
  private gyroSub:  Subscription | null = null;
  private baroSub:  Subscription | null = null;
  private pedoSub:  Subscription | null = null;
  private brightTimer: ReturnType<typeof setInterval> | null = null;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;

  private predHistory: MLClass[] = [];
  private onResult: ((r: MLResult) => void) | null = null;
  private inferring = false;

  get ready(): boolean { return this.isReady; }
  get error(): string | null { return this.loadError; }
  get running(): boolean { return this.isRunning; }

  /** API 연결 확인. Idempotent. */
  async load(): Promise<void> {
    if (this.isReady) return;
    try {
      const res = await fetch(`${API_URL}/`);
      if (res.ok) {
        this.isReady = true;
        this.loadError = null;
      } else {
        throw new Error(`API 응답 오류: ${res.status}`);
      }
    } catch (e: any) {
      this.loadError = String(e?.message ?? e);
      this.isReady = false;
      console.warn("[MLClassifier] API 연결 실패:", this.loadError);
    }
  }

  /** 센서 구독 + 추론 루프 시작 */
  async start(onResult: (r: MLResult) => void): Promise<void> {
    if (this.isRunning) return;
    this.onResult = onResult;
    this.isRunning = true;
    this.accelBuf = [];
    this.gyroBuf  = [];
    this.predHistory = [];
    this.sampleCount = 0;
    this.samplesSinceLastInfer = 0;

    if (Platform.OS === "web") {
      // Web fallback: 합성 모션
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
      this.gyroSub  = Gyroscope.addListener((d)  => { this.latestGyro  = d; });

      // 기압
      try {
        Barometer.setUpdateInterval(500);
        this.baroSub = Barometer.addListener((d: any) => {
          const p = d?.pressure;
          if (typeof p === "number") {
            if (this.pressureStart === null) this.pressureStart = p;
            this.pressureCurrent = p;
          }
        });
      } catch { /* 기압 센서 없음 */ }

      // 만보기
      try {
        const available = await Pedometer.isAvailableAsync();
        if (available) {
          this.pedoSub = Pedometer.watchStepCount((res: any) => {
            this.stepCountCurrent = res?.steps ?? this.stepCountCurrent;
          });
        }
      } catch { /* 만보기 없음 */ }

      // 화면 밝기 (1Hz — 학습 데이터와 동일)
      this.brightTimer = setInterval(async () => {
        try {
          const b = await Brightness.getBrightnessAsync();
          this.brightness = b; // 0~1 그대로
        } catch { /* 권한 없음 */ }
      }, 1000);

      this.sampleTimer = setInterval(() => this.tick(), TARGET_INTERVAL_MS);
    } catch (e) {
      console.warn("[MLClassifier] start 실패:", e);
    }
  }

  /** 센서 + 추론 중지 */
  stop(): void {
    this.isRunning = false;
    this.onResult  = null;
    this.accelSub?.remove(); this.accelSub = null;
    this.gyroSub?.remove();  this.gyroSub  = null;
    this.baroSub?.remove();  this.baroSub  = null;
    this.pedoSub?.remove();  this.pedoSub  = null;
    if (this.sampleTimer)  { clearInterval(this.sampleTimer);  this.sampleTimer  = null; }
    if (this.brightTimer)  { clearInterval(this.brightTimer);  this.brightTimer  = null; }
    this.accelBuf    = [];
    this.gyroBuf     = [];
    this.predHistory = [];
  }

  /** 샘플링 틱 */
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

  /** Railway API 추론 */
  private async runInference(): Promise<void> {
    if (this.inferring) return;
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
      this.stepCountStart  = this.stepCountCurrent;
      this.pressureStart   = this.pressureCurrent;

      // API 요청 body
      const body = {
        ax: this.accelBuf.map(d => d.x * 9.81),
        ay: this.accelBuf.map(d => d.y * 9.81),
        az: this.accelBuf.map(d => d.z * 9.81),
        gx: this.gyroBuf.map(d => d.x),
        gy: this.gyroBuf.map(d => d.y),
        gz: this.gyroBuf.map(d => d.z),
        pitch: this.accelBuf.map(d => {
          const denom = Math.sqrt(d.y * d.y + d.z * d.z);
          return Math.atan2(-d.x, denom);
        }),
        lux:      new Array(WINDOW_SIZE).fill(ctx.brightness),
        steps:    new Array(WINDOW_SIZE).fill(ctx.stepCount),
        pressure: new Array(WINDOW_SIZE).fill(ctx.pressureDiff),
      };

      const res  = await fetch(`${API_URL}/predict/window`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      const mlClass    = data.class_name as MLClass;
      const confidence = Math.round(data.confidence * 100);
      const probs      = ML_CLASSES.map((c: MLClass) => data.probabilities?.[c] ?? 0);
      const rawStage   = ML_TO_STAGE[mlClass];

      // 다수결 스무딩
      this.predHistory.push(mlClass);
      if (this.predHistory.length > SMOOTH_K) this.predHistory.shift();

      const counts: Record<string, number> = {};
      for (const c of this.predHistory) counts[c] = (counts[c] ?? 0) + 1;
      let smoothed: MLClass = mlClass;
      let best = 0;
      for (const c of Object.keys(counts)) {
        if (counts[c] > best) { best = counts[c]; smoothed = c as MLClass; }
      }
      const smoothedStage = ML_TO_STAGE[smoothed];

      this.onResult?.({
        stage:         smoothedStage,
        mlClass:       smoothed,
        confidence,
        probabilities: probs,
        raw:           { stage: rawStage, mlClass },
      });
    } catch (e) {
      console.warn("[MLClassifier] API 추론 오류:", e);
    } finally {
      this.inferring = false;
    }
  }
}

/** 싱글톤 */
export const mlClassifier = new MLClassifier();