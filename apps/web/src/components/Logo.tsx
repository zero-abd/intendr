/** intendr wordmark — a lime aperture glyph + monospace-ish wordmark.
 *  The glyph reads as a "spend gate": a ring with a notch that closes. */
export function Logo({ size = 26, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        <circle cx="16" cy="16" r="13" stroke="var(--accent)" strokeWidth="2.5" opacity="0.35" />
        <path
          d="M16 3a13 13 0 0 1 11.3 19.4"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="16" cy="16" r="4.5" fill="var(--accent)" />
      </svg>
      {withWord && (
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: size * 0.72,
            letterSpacing: "-0.03em",
            color: "var(--ink)",
          }}
        >
          intendr
        </span>
      )}
    </span>
  );
}
