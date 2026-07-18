// Shared design tokens + (later) React components: TraceBlock, CostMeter, ApprovalChip.
// Kept dependency-free for now so it typechecks without React wired in; add components
// under src/components/*.tsx and re-export them here.

export const TOKENS = {
  accent: "#4F46E5",
  ink: "#18181B",
  muted: "#71717A",
  hairline: "#ECECEB",
} as const;

export const UI_VERSION = "0.0.0";
