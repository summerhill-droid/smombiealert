/**
 * map.tsx — Map tab route (cross-platform entry point)
 *
 * WHY THIS FILE IS JUST A RE-EXPORT:
 *
 * react-native-maps only works on iOS and Android (not web).
 * Metro bundler uses platform-specific file resolution:
 *   - On iOS/Android: resolves `@/components/NativeMapView` →
 *                     NativeMapView.native.tsx  (full interactive map)
 *   - On web:         resolves `@/components/NativeMapView` →
 *                     NativeMapView.tsx          (web placeholder)
 *
 * If we put the react-native-maps import directly in this route file
 * and added a `map.native.tsx` sibling, Expo Router's file scanner
 * would include the native file in the web bundle — causing a crash.
 * Moving the platform split into the components/ folder avoids this.
 *
 * RESEARCH CONTEXT (Week 4–5):
 *   This screen shows the live GIS map with:
 *   - Red crosswalk markers (all crosswalks within 350 m)
 *   - A colored safety zone circle around the user's position
 *   - Bottom panel with live GIS factor stats and risk boost bar
 */

import NativeMapView from "@/components/NativeMapView";

// Simply export the platform-resolved component as this screen's default
export default NativeMapView;
