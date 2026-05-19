/**
 * featureExtraction.ts — Computes the 30-feature window vector that the
 * XGBoost HAR model expects. Order MUST match assets/models/feature_order.json.
 *
 * Inputs are 50 IMU samples (~0.5s at 100Hz) + scalar context values.
 */

export interface Vec3Sample {
  x: number;
  y: number;
  z: number;
}

export interface WindowContext {
  /** Ambient light, 0–1 (normalized). Default 0.5 if unavailable. */
  brightness: number;
  /** Step count delta over the window. Default 0 if unavailable. */
  stepCount: number;
  /** Barometric pressure difference (hPa) over the window. Default 0 if unavailable. */
  pressureDiff: number;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function std(arr: number[], m?: number): number {
  if (arr.length < 2) return 0;
  const mu = m ?? mean(arr);
  let v = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mu;
    v += d * d;
  }
  return Math.sqrt(v / arr.length);
}

function variance(arr: number[]): number {
  const s = std(arr);
  return s * s;
}

function meanAbs(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += Math.abs(arr[i]);
  return s / arr.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return percentile(s, 0.5);
}

function iqr(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return percentile(s, 0.75) - percentile(s, 0.25);
}

/**
 * Compute the 30-feature vector for one window.
 * Sample count should be 50 (model trained on 0.5s @ 100Hz windows).
 * Feature order MUST match feature_order.json exactly.
 */
export function extractFeatures(
  accel: Vec3Sample[],
  gyro: Vec3Sample[],
  ctx: WindowContext
): Float32Array {
  const ax = accel.map((s) => s.x);
  const ay = accel.map((s) => s.y);
  const az = accel.map((s) => s.z);
  const gx = gyro.map((s) => s.x);
  const gy = gyro.map((s) => s.y);
  const gz = gyro.map((s) => s.z);

  const accMag = accel.map((s) => Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z));
  const gyroMag = gyro.map((s) => Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z));

  // pitch (deg) — convention: tilt angle of phone relative to gravity
  // atan2(-x, sqrt(y^2 + z^2)) — common Android pitch formula
  const pitch = accel.map((s) => {
    const denom = Math.sqrt(s.y * s.y + s.z * s.z);
    return (Math.atan2(-s.x, denom) * 180) / Math.PI;
  });

  const accMagSorted = [...accMag].sort((a, b) => a - b);
  const gyroMagSorted = [...gyroMag].sort((a, b) => a - b);

  const accMagMean = mean(accMag);
  const accMagStd = std(accMag, accMagMean);
  const pitchMean = mean(pitch);
  const pitchRange = Math.max(...pitch) - Math.min(...pitch);
  const gyroVar = variance(gyroMag);

  const gyroMagMean = mean(gyroMag);
  const gyroMagStd = std(gyroMag, gyroMagMean);

  // Order MUST match feature_order.json
  const feat = new Float32Array(30);
  let i = 0;
  feat[i++] = accMagMean;                                  // acc_mag_mean
  feat[i++] = accMagStd;                                   // acc_mag_std
  feat[i++] = pitchMean;                                   // pitch_mean
  feat[i++] = pitchRange;                                  // pitch_range
  feat[i++] = gyroVar;                                     // gyro_var
  feat[i++] = ctx.brightness;                              // brightness
  feat[i++] = ctx.stepCount;                               // step_count
  feat[i++] = ctx.pressureDiff;                            // pressure_diff
  feat[i++] = accMagSorted[0];                             // acc_mag_min
  feat[i++] = accMagSorted[accMagSorted.length - 1];       // acc_mag_max
  feat[i++] = percentile(accMagSorted, 0.5);               // acc_mag_median
  feat[i++] = percentile(accMagSorted, 0.75) - percentile(accMagSorted, 0.25); // acc_mag_iqr
  feat[i++] = gyroMagMean;                                 // gyro_mag_mean
  feat[i++] = gyroMagStd;                                  // gyro_mag_std
  feat[i++] = gyroMagSorted[0];                            // gyro_mag_min
  feat[i++] = gyroMagSorted[gyroMagSorted.length - 1];     // gyro_mag_max
  feat[i++] = percentile(gyroMagSorted, 0.5);              // gyro_mag_median
  feat[i++] = percentile(gyroMagSorted, 0.75) - percentile(gyroMagSorted, 0.25); // gyro_mag_iqr
  feat[i++] = meanAbs(ax);                                 // acc_x_mean_abs
  feat[i++] = std(ax);                                     // acc_x_std
  feat[i++] = meanAbs(ay);                                 // acc_y_mean_abs
  feat[i++] = std(ay);                                     // acc_y_std
  feat[i++] = meanAbs(az);                                 // acc_z_mean_abs
  feat[i++] = std(az);                                     // acc_z_std
  feat[i++] = meanAbs(gx);                                 // gyro_x_gy_mean_abs
  feat[i++] = std(gx);                                     // gyro_x_gy_std
  feat[i++] = meanAbs(gy);                                 // gyro_y_gy_mean_abs
  feat[i++] = std(gy);                                     // gyro_y_gy_std
  feat[i++] = meanAbs(gz);                                 // gyro_z_gy_mean_abs
  feat[i++] = std(gz);                                     // gyro_z_gy_std
  return feat;
}

/** ML class labels (must match assets/models/model_meta.json `classes`) */
export const ML_CLASSES = ["Baseline", "Navigation", "Watching", "Typing"] as const;
export type MLClass = (typeof ML_CLASSES)[number];

/** Map ML class → existing BehaviorStage in the app */
export const ML_TO_STAGE: Record<MLClass, "baseline" | "tool" | "passive" | "active"> = {
  Baseline: "baseline",
  Navigation: "tool",
  Watching: "passive",
  Typing: "active",
};
