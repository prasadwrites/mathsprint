/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)", surface: "var(--surface)", ink: "var(--ink)", muted: "var(--muted)",
        line: "var(--line)", accent: "var(--accent)", good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)",
      },
      fontFamily: {
        display: ["Bricolage Grotesque", "Segoe UI", "system-ui", "sans-serif"],
        body: ["Atkinson Hyperlegible", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
