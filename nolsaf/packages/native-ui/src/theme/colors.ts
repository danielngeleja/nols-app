export const colors = {
  brand: {
    50: "#e9f5f4",
    100: "#c8e7e4",
    200: "#a4d7d0",
    300: "#76c2b7",
    400: "#45aa99",
    500: "#028a7a",
    600: "#02665e",
    700: "#014e47",
    800: "#013a35",
    900: "#012a26"
  },
  primary: "#02665e",
  primaryDark: "#014e47",
  primaryDeep: "#012a26",
  surface: "#fafcfc",
  card: "#ffffff",
  ink: "#020617",
  // Primary text color used across screen headers, titles and body copy.
  text: "#0f172a",
  mutedText: "#475569",
  softText: "#64748b",
  border: "#e2e8f0",
  info: "#022099",
  success: "#16a34a",
  danger: "#dc2626",
  warning: "#b45309",
  white: "#ffffff",
  black: "#000000",
  // Soft text/icon tint that reads on the dark teal PartnerHero.
  onHeroSoft: "#cdeee2",
  // Faded brand tint for inactive bottom-nav icons/labels (matches the web mobile nav).
  brandMuted: "rgba(2,102,94,0.45)",
  // Semantic accents for dashboard stat cards, icon chips and charts. Kept here
  // so screens compose from tokens instead of inlining hex (one source of truth).
  accent: {
    blue: "#185fa5",
    blueBright: "#85b7eb",
    blueSoft: "#e6f1fb",
    green: "#3b6d11",
    greenSoft: "#eaf3de",
    teal: "#5dcaa5",
    amber: "#ef9f27",
    amberDark: "#854f0b",
    amberSoft: "#faeeda",
    gold: "#ba7517"
  },
  chart: {
    total: "#2dd4bf",
    done: "#22c55e",
    active: "#60a5fa"
  }
} as const;
