import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        brand: "var(--shadow-brand)",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        appBg: "var(--app-bg)",
        appSurface: "var(--app-surface)",
        appSurface2: "var(--app-surface2)",
        appCard: "var(--app-card)",
        appPanel: "var(--app-panel)",
        appBorder: "var(--app-border)",
        appMuted: "var(--app-muted)",
        appText: "var(--app-text)",
        appInput: "var(--app-input)",
        /** List / row / chip hover — prefer over slate-* */
        appHover: "var(--app-hover)",
        appHoverStrong: "var(--app-hover-strong)",
        appHoverNight: "var(--app-hover-night)",
        appHoverNightStrong: "var(--app-hover-night-strong)",
        ringBrand: "var(--app-ring)",
        /* Hex here so `/opacity` modifiers work; aligns with --brand-* in globals.css */
        flentGreen: "#008E75",
        flentNight: "#614ECE",
        flentBrick: "#C64747",
        flentGround: "#7F5639",
        flentOrange: "#FFA37B",
        flentYellow: "#FFE98A",
        flentCyan: "#93F2E9",
      },
    },
  },
  plugins: [],
} satisfies Config;
