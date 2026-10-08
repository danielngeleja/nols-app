// apps/web/tailwind.config.ts
const config = {
  darkMode: "class",
  // No prefix so core utilities like `bg-white` work unchanged
  // prefix: undefined,
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#02665e", // header/footer/primary
          50:"#e9f5f4",100:"#c8e7e4",200:"#a4d7d0",300:"#76c2b7",400:"#45aa99",
          500:"#028a7a",600:"#02665e",700:"#014e47",800:"#013a35",900:"#012a26",
        },
        surface: { DEFAULT: "#fafcfc" },
        info:    { DEFAULT: "#022099" },
        success: { DEFAULT: "#16a34a" },
        danger:  { DEFAULT: "#dc2626" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,.05), 0 4px 10px rgba(0,0,0,.06)",
      },
      keyframes: {
        shimmer: {"0%":{backgroundPosition:"-480px 0"},"100%":{backgroundPosition:"480px 0"}},
      },
      animation: { shimmer: "shimmer 1.35s linear infinite" },
    },
  },
  plugins: [require("@tailwindcss/typography"), require("@tailwindcss/forms")],
};

module.exports = config;
