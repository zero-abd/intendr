import { meterColor } from "../tokens";

/**
 * Spend meter — visualizes spent-vs-cap. Fill glides lime → amber → red as it
 * nears the cap. `spent` / `cap` in cents. A caption row shows spent / remaining.
 */
export function SpendMeter({
  spent,
  cap,
  label = "Session spend",
  compact = false,
}: {
  spent: number;
  cap: number;
  label?: string;
  compact?: boolean;
}) {
  const ratio = cap > 0 ? Math.min(spent / cap, 1) : 0;
  const pct = Math.round(ratio * 100);
  const color = meterColor(ratio);
  const remaining = Math.max(cap - spent, 0);
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 8 : 12 }}>
      {!compact && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="ui-eyebrow">{label}</span>
          <span
            className="mono"
            style={{ fontSize: 13, color: ratio >= 0.9 ? "var(--danger)" : "var(--ink-muted)" }}
          >
            {pct}%
          </span>
        </div>
      )}
      <div className="ui-meter" style={{ ["--meter" as string]: `${pct}%`, ["--meter-color" as string]: color }}>
        <div className="ui-meter__fill" />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
        <span className="mono" style={{ color: "var(--ink-muted)" }}>
          {fmt(spent)} <span style={{ color: "var(--ink-faint)" }}>spent</span>
        </span>
        <span className="mono" style={{ color: "var(--ink-muted)" }}>
          {fmt(remaining)} <span style={{ color: "var(--ink-faint)" }}>left of {fmt(cap)}</span>
        </span>
      </div>
    </div>
  );
}
