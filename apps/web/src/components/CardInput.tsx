import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@intendr/ui";
import {
  brandMeta,
  detectBrand,
  formatCardNumber,
  formatExpiry,
  sandboxTokenize,
  validateCard,
  type CardTokenResult,
} from "../lib/card";

/**
 * SANDBOX card entry. This form is a stand-in for a PCI-compliant provider iframe
 * (Stripe Elements). It validates + tokenizes IN THE COMPONENT and hands back only the
 * token + last4 + brand + expiry via onToken — the raw number and CVC never leave here
 * and are never persisted. In production, swap this component for the provider's element;
 * the onToken contract is identical.
 */
export function CardInput({
  onToken,
  submitting,
}: {
  onToken: (tok: CardTokenResult, holderName: string, makeDefault: boolean) => void;
  submitting?: boolean;
}) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const brand = detectBrand(number);
  const { label: brandLabel, cvcLen } = brandMeta(brand);
  const v = useMemo(() => validateCard({ number, expiry, cvc, name }), [number, expiry, cvc, name]);
  const ready = v.numberOk && v.expiryOk && v.cvcOk && v.nameOk;

  function fillTestCard() {
    setName("Phong Nguyen");
    setNumber("4242 4242 4242 4242");
    setExpiry("08/28");
    setCvc("123");
    setError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const seed = (crypto.randomUUID?.() ?? String(Math.floor(Math.random() * 1e9))).replace(/-/g, "").slice(0, 12);
    const res = sandboxTokenize({ number, expiry, cvc, name }, seed);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onToken(res, name.trim(), makeDefault);
  }

  return (
    <form onSubmit={submit} className="cardform">
      <div className="cardform__banner">
        <LockGlyph />
        <span>
          <strong>Sandbox mode.</strong> Test cards only — your number and CVC never leave this form or reach our
          servers. We store just the brand, last 4, and a token.
        </span>
      </div>

      <label className="ui-field">
        <span>Cardholder name</span>
        <input
          className="ui-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Phong Nguyen"
          autoComplete="off"
        />
      </label>

      <label className="ui-field">
        <span>Card number</span>
        <div className="cardform__numwrap">
          <input
            className="ui-input ui-input--money"
            inputMode="numeric"
            value={number}
            onChange={(e) => setNumber(formatCardNumber(e.target.value))}
            placeholder="4242 4242 4242 4242"
            autoComplete="off"
            spellCheck={false}
          />
          <span className={`cardform__brand cardform__brand--${brand}`}>{brand === "unknown" ? "" : brandLabel}</span>
        </div>
      </label>

      <div className="cardform__row">
        <label className="ui-field">
          <span>Expiry</span>
          <input
            className="ui-input ui-input--money"
            inputMode="numeric"
            value={expiry}
            onChange={(e) => setExpiry(formatExpiry(e.target.value))}
            placeholder="MM/YY"
            autoComplete="off"
          />
        </label>
        <label className="ui-field">
          <span>CVC</span>
          <input
            className="ui-input ui-input--money"
            inputMode="numeric"
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, cvcLen))}
            placeholder={"•".repeat(cvcLen)}
            autoComplete="off"
          />
        </label>
      </div>

      <label className="cardform__check">
        <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
        <span>Make this the default funding source</span>
      </label>

      {error && <div className="auth__alert auth__alert--error">{error}</div>}

      <div className="cardform__actions">
        <Button type="button" variant="quiet" sm onClick={fillTestCard}>
          Use a test card
        </Button>
        <Button type="submit" disabled={!ready || submitting}>
          {submitting ? "Linking…" : "Link card"}
        </Button>
      </div>
    </form>
  );
}

function LockGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flex: "none" }} aria-hidden>
      <rect x="4" y="10" width="16" height="10" rx="2" stroke="var(--accent)" strokeWidth="1.8" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
