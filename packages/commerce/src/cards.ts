// Virtual-card issuance — the "call a virtual card at checkout" seam.
//
// A CardIssuer mints a SINGLE-USE, spend-scoped virtual card that a commerce
// provider enters at a merchant's checkout. The default is a MOCK issuer that
// returns a well-known TEST PAN (no real money moves). Real issuers (Lithic,
// Stripe Issuing, Ramp) are pluggable adapters that require the operator's own
// API credentials — they are scaffolded here but throw until configured, so no
// real card is ever silently charged.
import type { Cents, FetchLike } from "@intendr/contracts";

/** The card details a checkout flow types into a merchant's payment form. */
export interface CardInstrument {
  pan: string; // full card number — for a mock this is a test PAN
  cvv: string;
  expMonth: number; // 1-12
  expYear: number; // 4-digit
  zip?: string; // AVS billing zip; usually the delivery zip
  brand: "visa" | "mastercard" | "amex" | "test";
  last4: string;
}

export interface IssueRequest {
  /** Hard authorization ceiling for this card, in cents. The card must decline above it. */
  amountCents: Cents;
  /** Merchant this card is locked to (e.g. "amazon"). Real issuers scope by MCC/merchant. */
  merchant: string;
  /** Billing zip for AVS; pass the delivery address zip. */
  zip?: string;
  /** Idempotency: reuse the same key to avoid minting duplicate cards on retry. */
  idempotencyKey?: string;
}

export interface IssuedCard {
  /** Issuer-side id for later close/reconcile. */
  id: string;
  instrument: CardInstrument;
  amountCents: Cents;
  merchant: string;
  /** true = fake test card, no real money. Providers MUST surface this to the user. */
  mock: boolean;
}

export interface CardIssuer {
  readonly kind: string;
  /** Mint a scoped, single-use virtual card. */
  issue(req: IssueRequest): Promise<IssuedCard>;
  /** Close/void a card after use or on failure (best-effort). */
  close(cardId: string): Promise<void>;
}

// ── Mock issuer (default) ─────────────────────────────────────────────────────
// Returns Stripe's canonical Visa TEST number. This is a public, non-chargeable
// test PAN — it can never move real money. Safe for the full vertical slice.
const TEST_VISA = "4242424242424242";
let mockCounter = 0;

export class MockCardIssuer implements CardIssuer {
  readonly kind = "mock";

  async issue(req: IssueRequest): Promise<IssuedCard> {
    const id = `mockcard_${req.idempotencyKey ?? ++mockCounter}`;
    return {
      id,
      amountCents: req.amountCents,
      merchant: req.merchant,
      mock: true,
      instrument: {
        pan: TEST_VISA,
        cvv: "123",
        expMonth: 12,
        expYear: 2030,
        zip: req.zip,
        brand: "test",
        last4: TEST_VISA.slice(-4),
      },
    };
  }

  async close(): Promise<void> {
    /* nothing to close for a mock */
  }
}

// ── Real issuer adapters (pluggable; require operator credentials) ─────────────
// Each takes a FetchLike so it stays runtime-agnostic (Worker or Node). They are
// intentionally NOT implemented: wiring a real issuer means real charges, which
// must be an explicit operator decision with their own keys.

export interface RealIssuerDeps {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}

/** Lithic virtual cards (https://lithic.com). Set LITHIC_API_KEY to enable. */
export class LithicIssuer implements CardIssuer {
  readonly kind = "lithic";
  constructor(private readonly _deps: RealIssuerDeps) {}
  async issue(_req: IssueRequest): Promise<IssuedCard> {
    // TODO(operator): POST /v1/cards { type:"SINGLE_USE", spend_limit, spend_limit_duration:"TRANSACTION" }
    throw new Error("LithicIssuer not implemented — provide LITHIC_API_KEY and implement /v1/cards");
  }
  async close(_cardId: string): Promise<void> {
    throw new Error("LithicIssuer.close not implemented");
  }
}

/** Stripe Issuing (https://stripe.com/issuing). Set STRIPE_ISSUING_KEY to enable. */
export class StripeIssuingIssuer implements CardIssuer {
  readonly kind = "stripe-issuing";
  constructor(private readonly _deps: RealIssuerDeps) {}
  async issue(_req: IssueRequest): Promise<IssuedCard> {
    // TODO(operator): create cardholder + card with spending_controls.spending_limits.
    throw new Error("StripeIssuingIssuer not implemented — provide STRIPE_ISSUING_KEY");
  }
  async close(_cardId: string): Promise<void> {
    throw new Error("StripeIssuingIssuer.close not implemented");
  }
}

/** Ramp Agent Card (on-brand for the hackathon). Set RAMP_* to enable. */
export class RampIssuer implements CardIssuer {
  readonly kind = "ramp";
  constructor(private readonly _deps: RealIssuerDeps) {}
  async issue(_req: IssueRequest): Promise<IssuedCard> {
    throw new Error("RampIssuer not implemented — provide RAMP_CLIENT_ID/RAMP_CLIENT_SECRET");
  }
  async close(_cardId: string): Promise<void> {
    throw new Error("RampIssuer.close not implemented");
  }
}

export interface CardIssuerEnv {
  CARD_ISSUER?: string; // "mock" | "lithic" | "stripe-issuing" | "ramp"
  LITHIC_API_KEY?: string;
  STRIPE_ISSUING_KEY?: string;
  RAMP_CLIENT_ID?: string;
  RAMP_CLIENT_SECRET?: string;
}

/**
 * Pick an issuer from env. Defaults to the mock (no real money). Selecting a real
 * issuer without its credentials throws — fail loud rather than silently mock.
 */
export function createCardIssuer(env: CardIssuerEnv, fetch: FetchLike): CardIssuer {
  const kind = (env.CARD_ISSUER ?? "mock").toLowerCase();
  switch (kind) {
    case "mock":
      return new MockCardIssuer();
    case "lithic":
      if (!env.LITHIC_API_KEY) throw new Error("CARD_ISSUER=lithic but LITHIC_API_KEY is unset");
      return new LithicIssuer({ apiKey: env.LITHIC_API_KEY, fetch });
    case "stripe-issuing":
      if (!env.STRIPE_ISSUING_KEY) throw new Error("CARD_ISSUER=stripe-issuing but STRIPE_ISSUING_KEY is unset");
      return new StripeIssuingIssuer({ apiKey: env.STRIPE_ISSUING_KEY, fetch });
    case "ramp":
      if (!env.RAMP_CLIENT_ID || !env.RAMP_CLIENT_SECRET) throw new Error("CARD_ISSUER=ramp but RAMP_CLIENT_ID/SECRET unset");
      return new RampIssuer({ apiKey: env.RAMP_CLIENT_SECRET, fetch });
    default:
      throw new Error(`unknown CARD_ISSUER "${kind}" (expected mock | lithic | stripe-issuing | ramp)`);
  }
}
