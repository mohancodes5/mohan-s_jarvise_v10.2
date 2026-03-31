import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./styles/**/*.css",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        surface: {
          DEFAULT: "#faf9f5",
          muted: "#f0efe9",
          card: "#ffffff",
        },
        ink: {
          DEFAULT: "#1a1a18",
          muted: "#5c5b56",
          faint: "#8a8985",
        },
        accent: {
          DEFAULT: "#c15f3c",
          hover: "#a84f32",
        },
      },
    },
  },
  plugins: [],
};

export default config;
