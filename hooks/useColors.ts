/**
 * useColors.ts — Color scheme hook
 *
 * Returns the correct color palette based on the device's appearance setting.
 * Currently only a light palette is defined in constants/colors.ts.
 *
 * HOW IT WORKS:
 *   1. useColorScheme() returns "light" | "dark" | null
 *   2. If "dark" and a dark key exists in colors.ts → use dark palette
 *   3. Otherwise → use light palette (the current default)
 *
 * USAGE:
 *   const colors = useColors();
 *   <Text style={{ color: colors.foreground }}>Hello</Text>
 *   <View style={{ backgroundColor: colors.danger }}>...</View>
 *
 * ADDING DARK MODE:
 *   Add a `dark: { ... }` block to constants/colors.ts with the same
 *   token names as `light`. This hook will automatically pick it up.
 */

import { useColorScheme } from "react-native";
import colors from "@/constants/colors";

export function useColors() {
  const scheme = useColorScheme();
  // Use dark palette if device is dark AND a dark key exists in colors.ts
  const palette =
    scheme === "dark" && "dark" in colors
      ? (colors as Record<string, typeof colors.light>).dark
      : colors.light;
  // Spread palette tokens + scheme-independent values (like radius)
  return { ...palette, radius: colors.radius };
}
