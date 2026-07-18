import type { ReactNode } from "react";

export type CardColor = "lime" | "violet" | "amber" | "slate";
export type CardFace = "active" | "frozen" | "closed";

const BRAND_MARK: Record<string, ReactNode> = {
  visa: <span className="cc__brand-visa">VISA</span>,
  mastercard: (
    <span className="cc__brand-mc" aria-label="Mastercard">
      <span className="cc__mc-dot cc__mc-dot--a" />
      <span className="cc__mc-dot cc__mc-dot--b" />
    </span>
  ),
  amex: <span className="cc__brand-amex">AMEX</span>,
  discover: <span className="cc__brand-amex">DISCOVER</span>,
};

/**
 * A virtual card face. Presentational only — it never receives a full PAN; `last4`
 * is the sole number shown. `spentCents`/`limitCents` drive an inline usage bar.
 */
export function CreditCard({
  nickname,
  brand = "visa",
  last4,
  expMonth,
  expYear,
  color = "lime",
  status = "active",
  spentCents,
  limitCents,
  holder = "VIRTUAL CARD",
  compact = false,
}: {
  nickname: string;
  brand?: string;
  last4: string;
  expMonth: number;
  expYear: number;
  color?: CardColor;
  status?: CardFace;
  spentCents?: number;
  limitCents?: number;
  holder?: string;
  compact?: boolean;
}) {
  const usage = limitCents && limitCents > 0 ? Math.min((spentCents ?? 0) / limitCents, 1) : 0;
  const exp = `${String(expMonth).padStart(2, "0")}/${String(expYear).slice(-2)}`;

  return (
    <div
      className={`cc cc--${color} ${status !== "active" ? `cc--${status}` : ""} ${compact ? "cc--compact" : ""}`}
      data-status={status}
    >
      <div className="cc__sheen" aria-hidden />
      <div className="cc__top">
        <span className="cc__nick">{nickname}</span>
        {status === "frozen" && <span className="cc__flag">❄ Frozen</span>}
        {status === "closed" && <span className="cc__flag cc__flag--closed">Closed</span>}
      </div>

      <div className="cc__chip" aria-hidden>
        <span className="cc__chip-line" />
        <span className="cc__chip-line" />
      </div>

      <div className="cc__num mono">
        <span>••••</span>
        <span>••••</span>
        <span>••••</span>
        <span className="cc__last4">{last4}</span>
      </div>

      <div className="cc__foot">
        <div className="cc__meta">
          <span className="cc__label">{holder}</span>
          <span className="cc__exp mono">EXP {exp}</span>
        </div>
        {BRAND_MARK[brand] ?? <span className="cc__brand-amex">{brand.toUpperCase()}</span>}
      </div>

      {limitCents != null && limitCents > 0 && (
        <div className="cc__usage" style={{ ["--usage" as string]: `${Math.round(usage * 100)}%` }}>
          <div className="cc__usage-fill" />
        </div>
      )}
    </div>
  );
}
