/**
 * colors.ts — Design token palette
 *
 * All color values used throughout the app are defined here.
 * Components never use hardcoded hex strings — they always read
 * from useColors() which resolves to this palette.
 *
 * SEMANTIC TOKENS:
 *   primary        — brand red (#E84545), used for buttons, active states
 *   safe           — green (#27AE60), shown when no smombie detected
 *   warning        — amber (#F39C12), caution alert level
 *   danger         — red (#E84545), danger alert level (same as primary)
 *   muted          — light grey, used for backgrounds of inactive elements
 *   mutedForeground— medium grey, used for secondary text
 *   border         — very light grey, card/separator borders
 *
 * DARK MODE:
 *   A `dark` key can be added here in the future. The useColors() hook
 *   automatically switches to it when the device is in dark mode.
 *   (See hooks/useColors.ts for the switching logic.)
 */

const colors = {
  light: {
    text: "#0f0f0f",
    tint: "#E84545",           // App tint color (used by expo-router tab bar)

    background: "#FAFAFA",     // Main screen background
    foreground: "#0f0f0f",     // Primary text color

    card: "#FFFFFF",           // Card / sheet background
    cardForeground: "#0f0f0f",

    primary: "#E84545",        // Brand red — buttons, active indicators
    primaryForeground: "#FFFFFF",

    secondary: "#FFF0F0",      // Light red tint for secondary surfaces
    secondaryForeground: "#1a1a1a",

    muted: "#F3F3F3",          // Inactive tab background, progress track
    mutedForeground: "#888888",// Secondary / placeholder text

    accent: "#FF6B35",         // Warm orange accent (not widely used yet)
    accentForeground: "#FFFFFF",

    destructive: "#C0392B",    // Trash / delete actions
    destructiveForeground: "#FFFFFF",

    border: "#EBEBEB",         // Card borders, dividers
    input: "#EBEBEB",          // Input field borders

    // ── Semantic alert colors ───────────────────────────────────────────────
    safe: "#27AE60",           // Green — monitoring active, no smombie
    safeForeground: "#FFFFFF",
    warning: "#F39C12",        // Amber — caution level
    warningForeground: "#FFFFFF",
    danger: "#E84545",         // Red — danger level
    dangerForeground: "#FFFFFF",
  },

  radius: 12,  // Default border radius used throughout the design system
};

export default colors;
