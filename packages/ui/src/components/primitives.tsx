import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

/* ── Card ──────────────────────────────────────────────────── */
export function Card({
  pad = true,
  glow = false,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { pad?: boolean; glow?: boolean }) {
  return (
    <div className={cx("ui-card", pad && "ui-card--pad", glow && "ui-card--glow", className)} {...rest}>
      {children}
    </div>
  );
}

/* ── Eyebrow ───────────────────────────────────────────────── */
export function Eyebrow({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx("ui-eyebrow", className)} {...rest}>
      {children}
    </span>
  );
}

/* ── Button ────────────────────────────────────────────────── */
type Variant = "primary" | "ghost" | "quiet" | "danger";
export function Button({
  variant = "primary",
  block = false,
  sm = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; sm?: boolean }) {
  return (
    <button
      className={cx("ui-btn", `ui-btn--${variant}`, block && "ui-btn--block", sm && "ui-btn--sm", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── Field ─────────────────────────────────────────────────── */
export function Field({
  label,
  hint,
  money = false,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode; money?: boolean }) {
  return (
    <label className="ui-field">
      {label && <span>{label}</span>}
      <input className={cx("ui-input", money && "ui-input--money", className)} {...rest} />
      {hint && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{hint}</span>}
    </label>
  );
}

/* ── Badge ─────────────────────────────────────────────────── */
type Tone = "neutral" | "good" | "warn" | "danger" | "accent";
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span className={cx("ui-badge", tone !== "neutral" && `ui-badge--${tone}`, className)} {...rest}>
      {dot && <span className="ui-dot" />}
      {children}
    </span>
  );
}

/* ── Stat tile ─────────────────────────────────────────────── */
export function StatTile({
  label,
  value,
  accent,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className={cx("ui-stat", className)} {...rest}>
      <span className="ui-stat__label">{label}</span>
      <span className="ui-stat__value" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
    </div>
  );
}

/* ── Avatar ────────────────────────────────────────────────── */
export function Avatar({
  name,
  src,
  size = 40,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { name?: string | null; src?: string | null; size?: number }) {
  const initials = (name ?? "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  return (
    <div
      className={cx("ui-avatar", className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      {...rest}
    >
      {src ? <img src={src} alt={name ?? ""} /> : initials || "?"}
    </div>
  );
}

/* ── Skeleton ──────────────────────────────────────────────── */
export function Skeleton({ w, h = 14, className, style, ...rest }: HTMLAttributes<HTMLDivElement> & { w?: number | string; h?: number }) {
  return <div className={cx("ui-skeleton", className)} style={{ width: w, height: h, ...style }} {...rest} />;
}
