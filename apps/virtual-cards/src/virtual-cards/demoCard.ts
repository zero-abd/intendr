/**
 * Demo-mode hardcoded card.
 *
 * DEMO ONLY: when `DEMO_MODE=true`, the service still runs the full
 * infrastructure (order verification, one-card-per-order, vault, consume
 * endpoint, audit logs) but skips the live Lithic `cards.create` call and
 * stores credentials from env instead.
 *
 * The real Lithic issuance path in `virtualCard.service.ts` remains the
 * production path — flip `DEMO_MODE=false` and set `LITHIC_API_KEY` to use it.
 */

export interface DemoCardCredentials {
  pan: string;
  cvv: string;
  expMonth: string;
  expYear: string;
  lastFour: string;
  /** Synthetic token used in place of a Lithic card token in demo mode. */
  lithicCardToken: string;
}

export function loadDemoCardCredentials(): DemoCardCredentials {
  const pan = process.env.DEMO_CARD_PAN?.trim() ?? "";
  const cvv = process.env.DEMO_CARD_CVV?.trim() ?? "";
  const expMonth = process.env.DEMO_CARD_EXP_MONTH?.trim() ?? "";
  const expYear = process.env.DEMO_CARD_EXP_YEAR?.trim() ?? "";

  if (!pan || !cvv || !expMonth || !expYear) {
    throw new Error(
      "DEMO_MODE is enabled but DEMO_CARD_PAN / DEMO_CARD_CVV / DEMO_CARD_EXP_MONTH / DEMO_CARD_EXP_YEAR are incomplete.",
    );
  }

  const lastFour = pan.slice(-4);
  if (!/^\d{4}$/.test(lastFour)) {
    throw new Error("DEMO_CARD_PAN must end in 4 digits.");
  }

  return {
    pan,
    cvv,
    expMonth,
    expYear,
    lastFour,
    lithicCardToken: `demo_card_${lastFour}`,
  };
}
