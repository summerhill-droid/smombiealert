"""
Convert the trained XGBoost HAR (Human Activity Recognition) joblib model to ONNX
so it can be run inside the React Native / Expo app via onnxruntime-react-native.

Outputs (written to assets/models/):
  - har.onnx                : the ONNX model
  - feature_order.json      : exact feature-name order expected by the model
  - model_meta.json         : class labels, sampling rate, window size, version info
"""
import json
import os
import sys
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
JOBLIB_PATH = ROOT / "attached_assets" / "human_activity_recognition_xgboost_model_1779206712801.joblib"
OUT_DIR = ROOT / "assets" / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CATEGORIES = {0: "Baseline", 1: "Navigation", 2: "Watching", 3: "Typing"}

print(f"Loading model: {JOBLIB_PATH}")
model = joblib.load(JOBLIB_PATH)
print(f"Model type: {type(model).__name__}")

booster = model.get_booster() if hasattr(model, "get_booster") else None

feature_names = None
if hasattr(model, "feature_names_in_") and model.feature_names_in_ is not None:
    feature_names = list(model.feature_names_in_)
elif booster is not None and booster.feature_names is not None:
    feature_names = list(booster.feature_names)

if feature_names is None:
    print("ERROR: Could not extract feature names from the model.", file=sys.stderr)
    sys.exit(1)

n_features = len(feature_names)
n_classes = int(getattr(model, "n_classes_", len(CATEGORIES)))

print(f"n_features = {n_features}")
print(f"n_classes  = {n_classes}")
print("feature_names:")
for i, fn in enumerate(feature_names):
    print(f"  [{i:>2}] {fn}")

print("\nConverting to ONNX...")
from onnxmltools.convert import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType

# onnxmltools' XGBoost converter requires booster feature names to be f0..fN.
# We preserve the real human-readable names in feature_order.json instead.
if booster is not None:
    booster.feature_names = [f"f{i}" for i in range(n_features)]
if hasattr(model, "feature_names_in_"):
    try:
        del model.feature_names_in_
    except Exception:
        pass

initial_type = [("input", FloatTensorType([None, n_features]))]
onnx_model = convert_xgboost(model, initial_types=initial_type, target_opset=15)

onnx_path = OUT_DIR / "har.onnx"
with open(onnx_path, "wb") as f:
    f.write(onnx_model.SerializeToString())
print(f"Wrote {onnx_path}  ({onnx_path.stat().st_size:,} bytes)")

(OUT_DIR / "feature_order.json").write_text(json.dumps(feature_names, indent=2))
print(f"Wrote {OUT_DIR / 'feature_order.json'}")

meta = {
    "model": "xgboost-har",
    "source_file": JOBLIB_PATH.name,
    "n_features": n_features,
    "n_classes": n_classes,
    "classes": [CATEGORIES.get(i, str(i)) for i in range(n_classes)],
    "sampling_rate_hz": 100,
    "window_size_samples": 50,
    "window_stride_samples": 25,
    "feature_order": feature_names,
}
(OUT_DIR / "model_meta.json").write_text(json.dumps(meta, indent=2))
print(f"Wrote {OUT_DIR / 'model_meta.json'}")

print("\nSanity check: running inference on a zero vector...")
try:
    import onnxruntime as ort
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    x = np.zeros((1, n_features), dtype=np.float32)
    outs = sess.run(None, {"input": x})
    for name, val in zip([o.name for o in sess.get_outputs()], outs):
        shape = getattr(val, "shape", None)
        print(f"  output '{name}': shape={shape}, sample={str(val)[:120]}")
except ImportError:
    print("  (onnxruntime not installed; skipping local sanity check)")

print("\nDone.")
