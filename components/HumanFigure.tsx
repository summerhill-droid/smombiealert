/**
 * HumanFigure.tsx — SVG human silhouette illustrations for behavior stages
 *
 * Each stage shows a distinct pose:
 *   ACTIVE   — energetic walking, arms/legs swinging wide
 *   PASSIVE  — standing still, head tilted down at phone
 *   TOOL     — walking with phone raised in one hand
 *   BASELINE — neutral upright standing position
 */

import React from "react";
import Svg, { Circle, Line, Rect, G } from "react-native-svg";
import type { BehaviorStage } from "@/context/BehaviorContext";

interface HumanFigureProps {
  stage: BehaviorStage;
  color: string;
  size?: number;
}

const STROKE = 3.5;

export function HumanFigure({ stage, color, size = 64 }: HumanFigureProps) {
  const vb = "0 0 60 100";
  const s = { stroke: color, strokeWidth: STROKE, strokeLinecap: "round" as const };
  const f = { fill: color };

  switch (stage) {
    case "active":
      return (
        <Svg width={size} height={size * 1.6} viewBox={vb}>
          <Circle cx="27" cy="10" r="8" fill="none" {...s} />
          <Line x1="27" y1="18" x2="31" y2="54" {...s} />
          <Line x1="29" y1="30" x2="13" y2="19" {...s} />
          <Line x1="29" y1="30" x2="45" y2="39" {...s} />
          <Line x1="31" y1="54" x2="16" y2="82" {...s} />
          <Line x1="31" y1="54" x2="46" y2="76" {...s} />
          <Line x1="16" y1="82" x2="10" y2="78" {...s} />
          <Line x1="46" y1="76" x2="52" y2="80" {...s} />
        </Svg>
      );

    case "passive":
      return (
        <Svg width={size} height={size * 1.6} viewBox={vb}>
          <Circle cx="30" cy="12" r="8" fill="none" {...s} />
          <Line x1="30" y1="20" x2="30" y2="57" {...s} />
          <Line x1="30" y1="34" x2="20" y2="52" {...s} />
          <Line x1="30" y1="34" x2="40" y2="52" {...s} />
          <Rect x="18" y="48" width="22" height="14" rx="2" fill="none" {...s} />
          <Line x1="21" y1="51" x2="37" y2="51" stroke={color} strokeWidth={1.5} />
          <Line x1="21" y1="54" x2="34" y2="54" stroke={color} strokeWidth={1.5} />
          <Line x1="30" y1="57" x2="22" y2="84" {...s} />
          <Line x1="30" y1="57" x2="38" y2="84" {...s} />
          <Line x1="22" y1="84" x2="18" y2="82" {...s} />
          <Line x1="38" y1="84" x2="42" y2="82" {...s} />
        </Svg>
      );

    case "tool":
      return (
        <Svg width={size} height={size * 1.6} viewBox={vb}>
          <Circle cx="29" cy="10" r="8" fill="none" {...s} />
          <Line x1="29" y1="18" x2="32" y2="54" {...s} />
          <Line x1="30" y1="29" x2="16" y2="16" {...s} />
          <Rect x="8" y="8" width="12" height="16" rx="2" fill="none" {...s} />
          <Line x1="30" y1="29" x2="46" y2="40" {...s} />
          <Line x1="32" y1="54" x2="18" y2="80" {...s} />
          <Line x1="32" y1="54" x2="46" y2="78" {...s} />
          <Line x1="18" y1="80" x2="12" y2="77" {...s} />
          <Line x1="46" y1="78" x2="52" y2="82" {...s} />
        </Svg>
      );

    case "baseline":
    default:
      return (
        <Svg width={size} height={size * 1.6} viewBox={vb}>
          <Circle cx="30" cy="12" r="8" fill="none" {...s} />
          <Line x1="30" y1="20" x2="30" y2="57" {...s} />
          <Line x1="30" y1="32" x2="16" y2="46" {...s} />
          <Line x1="30" y1="32" x2="44" y2="46" {...s} />
          <Line x1="30" y1="57" x2="22" y2="84" {...s} />
          <Line x1="30" y1="57" x2="38" y2="84" {...s} />
          <Line x1="22" y1="84" x2="18" y2="82" {...s} />
          <Line x1="38" y1="84" x2="42" y2="82" {...s} />
        </Svg>
      );
  }
}
