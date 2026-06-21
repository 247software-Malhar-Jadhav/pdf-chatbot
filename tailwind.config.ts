import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#070912",
        panel: "#121826",
        accent: "#6366f1",
        accent2: "#a855f7",
      },
    },
  },
  plugins: [],
};

export default config;
