// Design tokens as TS — mirror of the CSS custom properties in theme.css.
// Import these when you need a token value in JS (charts, inline styles, canvas).
// The CSS variables in theme.css remain the styling source of truth.

export const TOKENS = {
  // Surfaces
  bg: "#08090b",
  bgElev: "#0e1013",
  panel: "#131619",
  // Ink
  ink: "#f3f6f4",
  inkMuted: "#9aa3a0",
  inkFaint: "#5b6360",
  // Accent (Ramp-flavored acid lime) + semantic
  accent: "#c6f24e",
  accentInk: "#0a0d05",
  good: "#45e0a0",
  warn: "#ffbb3c",
  danger: "#ff5d63",
  info: "#7c93ff",
  // Lines
  hairline: "rgba(255,255,255,0.07)",
} as const;

export type TokenName = keyof typeof TOKENS;

/** Meter color for a spent/cap ratio (0..1): lime → amber → red. */
export function meterColor(ratio: number): string {
  if (ratio >= 0.9) return "var(--danger)";
  if (ratio >= 0.7) return "var(--warn)";
  return "var(--accent)";
}

export const UI_VERSION = "0.1.0";
