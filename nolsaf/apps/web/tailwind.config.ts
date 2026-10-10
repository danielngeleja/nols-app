// tailwind.config.ts
import type { Config } from "tailwindcss";

// NOTE: This TS config mirrors tailwind.config.js. We keep it neutral (no prefix)
// to avoid conflicts where core utilities like `bg-white` would be renamed.
export default {
  darkMode: "class",
  // prefix intentionally omitted – use core class names like `bg-white`, `p-4`, etc.
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./pages/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#02665e",
          50: "#e9f5f4",
          100: "#c8e7e4",
          200: "#a4d7d0",
          300: "#76c2b7",
          400: "#45aa99",
          500: "#028a7a",
          600: "#02665e",
          700: "#014e47",
          800: "#013a35",
          900: "#012a26",
        },
        surface: { DEFAULT: "#fafcfc" },
        info: { DEFAULT: "#022099" },
        success: { DEFAULT: "#16a34a" },
        danger: { DEFAULT: "#dc2626" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,.05), 0 4px 10px rgba(0,0,0,.06)",
      },
      keyframes: {
        shimmer: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(400%)" } },
        "spin-slow": { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
        "rotate-clock": { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
        "rotate-minute": { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
        "pulse-soft": { "0%, 100%": { opacity: "0.4" }, "50%": { opacity: "0.6" } },
        "fade-in": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        shrink: { "0%": { width: "100%" }, "100%": { width: "0%" } },
      },
      animation: { 
        shimmer: "shimmer 1.35s linear infinite",
        "spin-slow": "spin-slow 30s linear infinite",
        "rotate-clock": "rotate-clock 120s linear infinite",
        "rotate-minute": "rotate-minute 3600s linear infinite",
        "pulse-soft": "pulse-soft 3s ease-in-out infinite",
        "fadeIn": "fade-in 0.22s ease-out both",
        shrink: "shrink 6s linear forwards",
      },
    },
  },
  plugins: [require("@tailwindcss/typography"), require("@tailwindcss/forms")],
} satisfies Config;
