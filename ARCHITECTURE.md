# SmombieAlert — Complete System Architecture (MVP v2)

## Overview

SmombieAlert is a pedestrian safety app that detects **distracted walking (스몸비)** using:
- **IMU sensor fusion** (accelerometer + gyroscope)
- **3-stage behavior classification** (Active / Passive / Tool use)
- **Real-time GIS geofencing** (Seoul crosswalk & accident data)
- **4-level contextual alert system**

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                         SmombieAlert App                           │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Context Layer                             │   │
│  │                                                             │   │
│  │  ┌──────────────┐    ┌──────────────────┐   ┌───────────┐  │   │
│  │  │ GISContext   │    │ BehaviorContext   │   │Detection  │  │   │
│  │  │              │    │                  │   │Context    │  │   │
│  │  │ • GPS watch  │    │ • Accel variance │   │           │  │   │
│  │  │ • Overpass   │    │ • Gyro variance  │   │• Walking  │  │   │
│  │  │   API        │───▶│ • Touch events   │──▶│  speed    │  │   │
│  │  │ • Crosswalk  │    │ • 3-stage class. │   │• 4-level  │  │   │
│  │  │   geofence   │    │                  │   │  alerts   │  │   │
│  │  │ • Accident   │    │  ACTIVE          │   │• Incident │  │   │
│  │  │   zones      │    │  PASSIVE         │   │  logging  │  │   │
│  │  │ • Risk boost │    │  TOOL            │   │           │  │   │
│  │  │              │    │  BASELINE        │   │           │  │   │
│  │  └──────────────┘    └──────────────────┘   └───────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      UI Layer                                │   │
│  │                                                             │   │
│  │  Monitor Tab          History Tab       Map Tab             │   │
│  │  ┌─────────────┐      ┌──────────────┐  ┌──────────────┐   │   │
│  │  │ AlertRing   │      │ Incident list│  │ MapView      │   │   │
│  │  │ (4 levels)  │      │ + stage tags │  │ + crosswalks │   │   │
│  │  ├─────────────┤      ├──────────────┤  └──────────────┘   │   │
│  │  │ Behavior    │      │ Stage stats  │                      │   │
│  │  │ StageCard   │      │ breakdown    │                      │   │
│  │  │ (3 stages)  │      └──────────────┘                      │   │
│  │  ├─────────────┤                                            │   │
│  │  │ GISInfoCard │                                            │   │
│  │  ├─────────────┤                                            │   │
│  │  │ Alert level │                                            │   │
│  │  │ reference   │                                            │   │
│  │  └─────────────┘                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
artifacts/smombie-detector/
│
├── app/
│   ├── _layout.tsx              ← Provider hierarchy (updated: BehaviorProvider)
│   └── (tabs)/
│       ├── _layout.tsx          ← Tab navigation
│       ├── index.tsx            ← Monitor screen (UPDATED: 3-stage + 4-level)
│       ├── history.tsx          ← History screen (UPDATED: stage breakdown)
│       ├── map.tsx              ← Map screen (unchanged)
│       └── settings.tsx         ← Settings screen (unchanged)
│
├── context/
│   ├── BehaviorContext.tsx      ← NEW: 3-stage behavior classifier
│   ├── DetectionContext.tsx     ← UPDATED: 4-level alerts, behavior integration
│   └── GISContext.tsx           ← Unchanged: GPS + Overpass API
│
├── components/
│   ├── BehaviorStageCard.tsx    ← NEW: live 3-stage classification UI
│   ├── AlertRing.tsx            ← UPDATED: 4-level animation
│   ├── GISInfoCard.tsx          ← Unchanged
│   ├── IncidentCard.tsx         ← Unchanged (behaviorStage field added)
│   ├── MetricBar.tsx            ← Unchanged
│   └── StatusIcon.tsx           ← Unchanged
│
└── hooks/
    └── useColors.ts             ← Unchanged
```

---

## 3-Stage Behavior Classification

### Classification Algorithm

```
INPUT:
  accelVariance  = variance of |accel magnitude| in 5s window
  gyroVariance   = variance of |gyro magnitude| in 5s window
  angleStability = std-dev of pitch angle in 5s window
  tapCount10s    = # taps in last 10 seconds
  scrollCount10s = # scrolls in last 10 seconds
  longpress30s   = # long-presses in last 30 seconds
  touchFreq30s   = total touch events in last 30 seconds

DECISION TREE:
  if touchFreq30s == 0 AND accelVariance < 0.04:
    → BASELINE (pocket / screen off)
  
  elif tapCount10s >= 3 OR longpress30s >= 1 OR accelVariance > 0.22:
    → ACTIVE (typing / gaming)
  
  elif scrollCount10s >= 2 OR (touchFreq30s > 0 AND angleStability < 8°):
    → PASSIVE (YouTube / webtoon / SNS scroll)
  
  elif touchFreq30s > 0:
    → TOOL (navigation / music control)

DEBOUNCE:
  Requires 3 consecutive same-stage readings before committing to a new stage.
  This prevents rapid flickering between states.
```

### Risk Weights (used by DetectionContext)
| Stage    | Weight | Risk  | Examples                    |
|----------|--------|-------|-----------------------------|
| ACTIVE   | 3      | HIGH  | Typing, gaming, SNS upload  |
| PASSIVE  | 2      | MED   | YouTube, webtoon, scrolling |
| TOOL     | 1      | LOW   | Navigation, music control   |
| BASELINE | 0      | NONE  | Pocket, screen off          |

---

## 4-Level Alert System

```
⚫ OFF (safe)
   Trigger: isWalking == false OR behaviorStage == baseline
   Action:  No alert, minimal sensor computation

🟡 CAUTION
   Trigger: Walking detected, GIS data loading / tool-level phone use
   Action:  GIS data sync begins, subtle amber indicator
   Message: "🟡 Walking detected — GIS scanning area..."

🟠 WARNING (Type 1 — Crosswalk)
   Trigger: crosswalkDist <= 10m AND behaviorStage >= passive
   Action:  Vibration + warning banner
   Message: "📱 Crosswalk ahead. Please check your surroundings!"

🟠 WARNING (Type 2 — Accident Zone)
   Trigger: gisBoost >= 60 AND behaviorStage >= passive
   Action:  Vibration + warning banner
   Message: "⚠️ Accident-prone area. Lower your phone now!"

🔴 CRITICAL
   Trigger: insideCrosswalk (dist <= 5m) AND behaviorStage == active
            AND alert continuous for >= 5 seconds
   Action:  Double vibration + full-screen lock (screen lock in prod)
   Message: "🚫 DANGER — Distracted walking detected in crosswalk!"
```

---

## Database Schema (AsyncStorage — MVP)

```typescript
// Key: "smombie_incidents_v2"
interface Incident {
  id:            string;        // timestamp + random suffix
  timestamp:     number;        // unix ms
  level:         AlertLevel;    // "safe" | "caution" | "warning" | "danger"
  duration:      number;        // seconds
  behaviorStage: BehaviorStage; // "active" | "passive" | "tool" | "baseline"
  location?:     string;        // future: reverse-geocoded address
}

// Key: "smombie_total_time_v2"  
// Value: total seconds of distracted walking (cumulative)
```

### Production upgrade path (Week 5-6 in research plan):
Replace AsyncStorage with Firebase Realtime DB:
```typescript
// db.ref(`users/${userId}/incidents`).push(incident)
// db.ref(`users/${userId}/totalTime`).set(totalSeconds)
```

---

## API Integration

### Seoul Public APIs (GISContext)
| API | Source | Update Frequency | Usage |
|-----|--------|-----------------|-------|
| Crosswalk coordinates | Seoul Open Data | Monthly | Geofencing |
| C-ITS traffic signals | ITS Korea | Real-time (sec) | Signal state |
| Accident zones | KOROAD | Annual | Risk boost |
| Road traffic (TOPIS) | Seoul TOPIS | 2-5 min | Speed weight |

### Overpass API (Current MVP)
```
[out:json][timeout:10];
(
  node["highway"="crossing"](around:350,{lat},{lng});
  node["highway"="street_lamp"](around:80,{lat},{lng});
  way["highway"](around:80,{lat},{lng});
);
out body;
```

---

## Sensor Data Pipeline

```
Accelerometer (300ms)
    │
    ├──► BehaviorContext.imuBuffer (5s window)
    │         ├── accelVariance computation
    │         ├── gyroVariance computation
    │         └── angleStability computation
    │                     │
    │                     ▼
    │             BehaviorStage classification
    │                     │
    └──► DetectionContext (300ms)       │
              ├── walkingSpeed proxy    │
              ├── phoneAngle display    │
              └── ◄────────────────────┘
                  stageWeight (0-3)
                       │
                       + gisRiskBoost
                       │
                       ▼
                 AlertLevel (4 levels)
                       │
                       ▼
              Haptics + UI update
```

---

## KPI Targets (Research Plan Section 7)
| Metric | Target | Measurement |
|--------|--------|-------------|
| Behavior classification accuracy | ≥ 92% | Confusion matrix vs ground truth labels |
| Active class Recall | ≥ 95% | TP/(TP+FN) for "active" stage |
| False Positive Rate | ≤ 5% | Alerts during normal walking without phone |
| GIS geofencing accuracy | ± 3m | GPS vs crosswalk coordinate offset |
| Alert latency | ≤ 2s | API receive → screen display |
| Battery overhead | ≤ 5%/hr | Compared to app-off baseline |

---

## Scalability Roadmap

### Phase 1 (MVP — current)
- AsyncStorage for local incident persistence
- OpenStreetMap Overpass API for GIS
- Rule-based behavior classifier

### Phase 2 (Research deployment)
- Firebase Realtime DB for multi-participant data collection
- XGBoost/Random Forest model trained on collected data
- TFLite model bundled in app for on-device inference
- Seoul C-ITS API for real-time signal data

### Phase 3 (Production)
- Personalized baseline calibration (3-min walk on first launch)
- Backend API (Express 5 + PostgreSQL) for analytics dashboard
- Admin web dashboard (React/Vite) for researcher data export
- Push notifications via Expo notifications for post-walk reports
