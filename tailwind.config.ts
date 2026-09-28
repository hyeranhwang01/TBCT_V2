import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Every one of these is a CSS variable holding an "R G B" triplet
        // (see globals.css's :root / dark blocks), not a fixed hex -- that's
        // what lets every existing opacity-modifier class already in this
        // codebase (bg-success/20, border-critical/40, text-text-muted/50,
        // etc.) keep working unchanged under dark mode: Tailwind substitutes
        // <alpha-value> itself, so the underlying rgb() just needs to be a
        // triplet, not a full color. navy-900/navy-800 stay fixed hex on
        // purpose -- the clinician sidebar (app-shell.tsx) is a permanently
        // dark navy panel regardless of theme, not part of the light/dark
        // toggle.
        background: "rgb(var(--color-background) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-subtle": "rgb(var(--color-surface-subtle) / <alpha-value>)",
        "surface-hover": "rgb(var(--color-surface-hover) / <alpha-value>)",
        "navy-900": "#132A4A",
        "navy-800": "#1B365D",
        "clinical-blue": "rgb(var(--color-clinical-blue) / <alpha-value>)",
        "clinical-blue-light": "rgb(var(--color-clinical-blue-light) / <alpha-value>)",
        "ai-violet": "rgb(var(--color-ai-violet) / <alpha-value>)",
        "ai-violet-light": "rgb(var(--color-ai-violet-light) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        "success-light": "rgb(var(--color-success-light) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        "warning-light": "rgb(var(--color-warning-light) / <alpha-value>)",
        critical: "rgb(var(--color-critical) / <alpha-value>)",
        "critical-light": "rgb(var(--color-critical-light) / <alpha-value>)",
        "text-primary": "rgb(var(--color-text-primary) / <alpha-value>)",
        "text-secondary": "rgb(var(--color-text-secondary) / <alpha-value>)",
        "text-muted": "rgb(var(--color-text-muted) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        "border-strong": "rgb(var(--color-border-strong) / <alpha-value>)",
        // Patient app only -- these variables are defined solely under
        // :root:has(.patient-app) in src/patient/styles/patient-theme.css, so
        // they have no meaning (and no effect) on clinician pages.
        brand: "rgb(var(--color-brand) / <alpha-value>)",
        "brand-strong": "rgb(var(--color-brand-strong) / <alpha-value>)",
        "brand-soft": "rgb(var(--color-brand-soft) / <alpha-value>)",
        "brand-tint": "rgb(var(--color-brand-tint) / <alpha-value>)",
        "brand-ink": "rgb(var(--color-brand-ink) / <alpha-value>)",
        gold: "rgb(var(--color-gold) / <alpha-value>)",
        "gold-strong": "rgb(var(--color-gold-strong) / <alpha-value>)",
        "gold-soft": "rgb(var(--color-gold-soft) / <alpha-value>)",
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "Pretendard", "SUIT", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        panel: "18px",
        card: "20px",
      },
      boxShadow: {
        none: "none",
      },
    },
  },
  plugins: [],
} satisfies Config;
