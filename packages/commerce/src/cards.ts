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
  /** Expected charge for this card, in cents. */
  amountCents: Cents;
  /** Hard authorization ceiling, in cents (defaults to amountCents). The card declines above it. */
  maxAmountCents?: Cents;
  /** Merchant this card is locked to (e.g. "amazon"). Real issuers scope by MCC/merchant. */
  merchant: string;
  /** Billing zip for AVS; pass the delivery address zip. */
  zip?: string;
  /** Idempotency: reuse the same key to avoid minting duplicate cards on retry. */
  idempotencyKey?: string;
  /** Real issuers verify against an already-approved order — these identify it. */
  userId?: string;
  orderId?: string;
  accountToken?: string;
}

/**
 * A card reference for the token-based flow (real issuers). The full PAN/CVV is
 * NEVER returned here — a trusted checkout executor redeems it once via
 * consumeCardCredentials(). This keeps card credentials out of the edge/model.
 */
export interface CredentialRef {
  secureCredentialToken: string;
  orderId: string;
}

export interface IssuedCard {
  /** Issuer-side id for later close/reconcile (card/vault token). */
  id: string;
  /**
   * Full card details, present ONLY for the mock issuer (test PAN). Real issuers
   * omit this and return a credentialRef instead — the executor fetches the PAN.
   */
  instrument?: CardInstrument;
  /** Token-flow reference; present for real issuers (no PAN). */
  credentialRef?: CredentialRef;
  last4?: string;
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
      last4: TEST_VISA.slice(-4),
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

// ── VirtualCardsIssuer — adapter for the in-repo apps/virtual-cards service ────
// The recommended real path. Talks to the teammate's Lithic-backed service
// (apps/virtual-cards). issue() calls the PUBLIC endpoint and returns only a
// cardToken + last4 (NO PAN). The trusted checkout executor later redeems the
// PAN via consumeCardCredentials(). The service independently re-verifies the
// approved order, so the model can't pick an arbitrary card or limit.
export interface VirtualCardsDeps {
  fetch: FetchLike;
  /** Base URL of apps/virtual-cards, e.g. http://localhost:8790 */
  baseUrl: string;
  /** Default Lithic account token used when a request doesn't supply one. */
  accountToken?: string;
  /** Default userId (until per-user identity is threaded through). */
  defaultUserId?: string;
}

let orderCounter = 0;

export class VirtualCardsIssuer implements CardIssuer {
  readonly kind = "virtualcards";
  private readonly base: string;
  constructor(private readonly deps: VirtualCardsDeps) {
    this.base = deps.baseUrl.replace(/\/+$/, "");
  }

  async issue(req: IssueRequest): Promise<IssuedCard> {
    const orderId = req.orderId ?? req.idempotencyKey ?? `order_${++orderCounter}`;
    const payload = {
      userId: req.userId ?? this.deps.defaultUserId ?? "demo-user",
      orderId,
      accountToken: req.accountToken ?? this.deps.accountToken ?? "",
      merchantName: req.merchant,
      expectedAmount: Math.ceil(req.amountCents),
      maximumAmount: Math.ceil(req.maxAmountCents ?? req.amountCents),
      currency: "USD",
    };
    const res = await this.deps.fetch(`${this.base}/api/virtual-cards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`virtual-cards issue ${res.status}: ${detail}`);
    }
    const body = (await res.json()) as { card?: { cardToken: string; lastFour: string; maximumAmount: number } };
    const card = body.card;
    if (!card?.cardToken) throw new Error("virtual-cards issue: missing card token in response");
    return {
      id: card.cardToken,
      amountCents: req.amountCents,
      merchant: req.merchant,
      mock: false,
      last4: card.lastFour,
      // No PAN here — the executor redeems it via consumeCardCredentials().
      credentialRef: { secureCredentialToken: card.cardToken, orderId },
    };
  }

  async close(): Promise<void> {
    /* single-use cards self-close after one authorization; nothing to do */
  }
}

/**
 * Redeem the one-time PAN/CVV for a card. INTERNAL/executor-only — call this from
 * the trusted checkout executor (apps/amazon-agent), NEVER from the edge/model.
 * Requires the shared INTERNAL_SERVICE_TOKEN.
 */
export interface ConsumeDeps {
  fetch: FetchLike;
  baseUrl: string;
  internalServiceToken: string;
  executorId: string;
}
export interface ConsumedCredentials {
  orderId: string;
  lithicCardToken: string;
  cardData: unknown; // { pan, cvv, expMonth, expYear, ... } in sandbox/PCI programs
}
export async function consumeCardCredentials(deps: ConsumeDeps, ref: CredentialRef): Promise<ConsumedCredentials> {
  const res = await deps.fetch(`${deps.baseUrl.replace(/\/+$/, "")}/internal/card-credentials/consume`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${deps.internalServiceToken}` },
    body: JSON.stringify({
      secureCredentialToken: ref.secureCredentialToken,
      orderId: ref.orderId,
      checkoutExecutorId: deps.executorId,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`virtual-cards consume ${res.status}: ${detail}`);
  }
  return (await res.json()) as ConsumedCredentials;
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
  CARD_ISSUER?: string; // "mock" | "virtualcards" | "lithic" | "stripe-issuing" | "ramp"
  /** apps/virtual-cards base URL. If set (and CARD_ISSUER unset), it's used automatically. */
  VIRTUAL_CARDS_URL?: string;
  VIRTUAL_CARDS_ACCOUNT_TOKEN?: string;
  LITHIC_API_KEY?: string;
  STRIPE_ISSUING_KEY?: string;
  RAMP_CLIENT_ID?: string;
  RAMP_CLIENT_SECRET?: string;
}

/**
 * Pick an issuer from env. Defaults to the mock (no real money). If VIRTUAL_CARDS_URL
 * is set, the in-repo virtual-cards service is used automatically. Selecting a direct
 * real issuer without its credentials throws — fail loud rather than silently mock.
 */
export function createCardIssuer(env: CardIssuerEnv, fetch: FetchLike): CardIssuer {
  const kind = (env.CARD_ISSUER ?? (env.VIRTUAL_CARDS_URL ? "virtualcards" : "mock")).toLowerCase();
  switch (kind) {
    case "mock":
      return new MockCardIssuer();
    case "virtualcards":
      if (!env.VIRTUAL_CARDS_URL) throw new Error("CARD_ISSUER=virtualcards but VIRTUAL_CARDS_URL is unset");
      return new VirtualCardsIssuer({ fetch, baseUrl: env.VIRTUAL_CARDS_URL, accountToken: env.VIRTUAL_CARDS_ACCOUNT_TOKEN });
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
      throw new Error(`unknown CARD_ISSUER "${kind}" (expected mock | virtualcards | lithic | stripe-issuing | ramp)`);
  }
}
