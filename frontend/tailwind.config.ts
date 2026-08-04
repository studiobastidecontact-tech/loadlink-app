import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#4F46E5",
          dark: "#3730A3",
          50: "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
        },
        // DA éditoriale : accent lime sur tons encre / olive / crème.
        accent: {
          DEFAULT: "#CBF24E",
          400: "#D8F56F",
          500: "#CBF24E",
          600: "#AEDB2E",
        },
        ink: {
          DEFAULT: "#16160F",
          900: "#16160F",
          800: "#1E1E15",
          700: "#28281C",
        },
        olive: {
          DEFAULT: "#44442F",
          700: "#3B3B29",
          600: "#4C4C36",
          500: "#5A5A41",
        },
        cream: {
          DEFAULT: "#F4F1E8",
          100: "#F7F5EE",
          200: "#ECE8DA",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 4px 16px -4px rgb(15 23 42 / 0.08)",
        card: "0 1px 3px 0 rgb(15 23 42 / 0.06), 0 8px 24px -8px rgb(15 23 42 / 0.10)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)",
        "hero-glow":
          "radial-gradient(60% 60% at 50% 0%, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0) 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
