// Contract + mock backend for the Amazon automation service.
//
// The AmazonProvider (runs on the edge Worker) talks to a separate Node service
// (apps/amazon-agent) that drives a real browser — because a Worker can't run
// Playwright. This module is the SHARED contract between them, plus a
// deterministic MOCK backend used in two places:
//   1. apps/amazon-agent when AMAZON_LIVE != "1" (no browser, no login), and
//   2. AmazonProvider directly when no AMAZON_AGENT_URL is configured.
// One source of mock truth → the slice behaves identically with or without the
// service running.
import type { Cents } from "@intendr/contracts";
import type { CardInstrument, CredentialRef } from "./cards.js";
import type { Address } from "./location.js";

export interface AmazonProduct {
  asin: string;
  name: string;
  priceCents: Cents;
  isPrime: boolean;
  rating?: string;
  url?: string;
}

export interface AmazonSearchRequest { query: string; maxResults?: number }
export interface AmazonSearchResponse { products: AmazonProduct[] }

export interface AmazonAddressesResponse { addresses: Address[] }

/** A purchase request. `confirm:false` returns a preview and never places the order. */
export interface AmazonPurchaseRequest {
  asin?: string;
  query?: string; // used when no asin: buys the top matching product
  quantity?: number;
  address: Address;
  /**
   * A full mock card to enter directly (mock issuer only). For real issuers the
   * PAN never leaves the executor — cardRef is passed instead and the executor
   * redeems the PAN server-side via consumeCardCredentials().
   */
  card?: CardInstrument;
  /** Token reference for the real card flow (PAN redeemed by the executor). */
  cardRef?: CredentialRef;
  confirm: boolean;
}

export interface AmazonPurchaseResponse {
  placed: boolean;
  /** true when this is a preview (confirm was false). */
  preview?: boolean;
  orderId?: string;
  product: AmazonProduct;
  /** Actual total charged (item + shipping + tax), for dynamic-pricing settle. */
  totalCents: Cents;
  address: Address;
  cardLast4?: string;
  estimatedDelivery?: string;
  mock: boolean;
  note?: string;
}

// ── Deterministic mock catalog ────────────────────────────────────────────────
const MOCK_CATALOG: AmazonProduct[] = [
  { asin: "B07GBTND3T", name: "Etekcity Digital Body Weight Bathroom Scale, 400 lb, Backlit", priceCents: 2199, isPrime: true, rating: "4.6" },
  { asin: "B08LKRXST5", name: "RENPHO Smart Bluetooth Body Weight Scale, Body Fat BMI", priceCents: 2899, isPrime: true, rating: "4.7" },
  { asin: "B0CMDWZ2K5", name: "INEVIFIT Digital Bathroom Weight Scale, Tempered Glass", priceCents: 1899, isPrime: true, rating: "4.5" },
  { asin: "B00NTCHCU2", name: "Amazon Basics 20-Count AAA Alkaline Batteries", priceCents: 1249, isPrime: true, rating: "4.7" },
  { asin: "B07PGL2N7J", name: "Amazon Basics USB-C to USB-A Cable, 6 ft", priceCents: 699, isPrime: true, rating: "4.6" },
  { asin: "B08N5WRWNW", name: "Echo Dot Smart Speaker", priceCents: 4999, isPrime: true, rating: "4.7" },
];

const MOCK_ADDRESSES: Address[] = [
  { id: "addr_home", label: "Home", line1: "1633 Bowen Dr", city: "Folsom", state: "CA", postalCode: "95630", country: "US", lat: 38.6779, lng: -121.1761 },
  { id: "addr_work", label: "Work", line1: "410 Terry Ave N", city: "Seattle", state: "WA", postalCode: "98109", country: "US", lat: 47.6229, lng: -122.3376 },
];

const SHIPPING_CENTS = 699;
const TAX_RATE = 0.0875;

const STOP = new Set([
  "the", "a", "an", "for", "me", "my", "best", "cheap", "cheapest", "good", "quality", "buy", "get",
  "on", "in", "at", "of", "to", "under", "below", "over", "less", "than", "dollars", "dollar", "usd",
  "please", "some", "with", "and", "or", "amazon", "product", "item", "price", "around", "about",
]);

/** Parse a budget ceiling from the query, e.g. "under $30", "below 30 dollars", "$25". */
function parseBudgetCents(q: string): number | undefined {
  const m = q.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)?/);
  return m ? Math.round(parseFloat(m[1]) * 100) : undefined;
}

/** Score catalog by keyword overlap; respect a "under $X" budget when present. */
function rankProducts(query: unknown): AmazonProduct[] {
  // Coerce defensively: an LLM may hand us a non-string (e.g. {query:"…"} in the
  // wrong param bucket). Never let that throw a raw TypeError out of pay_and_run.
  const q = (typeof query === "string" ? query : query == null ? "" : String(query)).toLowerCase();
  const budget = parseBudgetCents(q);
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  const pool = budget ? MOCK_CATALOG.filter((p) => p.priceCents <= budget) : MOCK_CATALOG;
  const scored = (pool.length ? pool : MOCK_CATALOG)
    .map((p) => ({ p, s: words.filter((w) => p.name.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.s - a.s || a.p.priceCents - b.p.priceCents);
  return scored.map((x) => x.p);
}

function pickProduct(req: { asin?: string; query?: string }): AmazonProduct {
  if (req.asin) {
    const hit = MOCK_CATALOG.find((p) => p.asin === req.asin);
    if (hit) return hit;
    return { asin: req.asin, name: `Amazon item ${req.asin} (mock)`, priceCents: 1999, isPrime: true };
  }
  return rankProducts(req.query ?? "")[0] ?? MOCK_CATALOG[0];
}

function totalFor(p: AmazonProduct, quantity: number): Cents {
  const sub = p.priceCents * quantity;
  const shipping = p.isPrime ? 0 : SHIPPING_CENTS;
  return Math.round((sub + shipping) * (1 + TAX_RATE));
}

export const amazonAgentMock = {
  search(req: AmazonSearchRequest): AmazonSearchResponse {
    return { products: rankProducts(req.query).slice(0, req.maxResults ?? 10) };
  },

  addresses(): AmazonAddressesResponse {
    return { addresses: MOCK_ADDRESSES };
  },

  purchase(req: AmazonPurchaseRequest): AmazonPurchaseResponse {
    const product = pickProduct(req);
    const quantity = req.quantity ?? 1;
    const totalCents = totalFor(product, quantity);
    if (!req.confirm) {
      return {
        placed: false,
        preview: true,
        product,
        totalCents,
        address: req.address,
        mock: true,
        note: "Preview only — no order placed. Call again with confirm=true (after approval) to purchase.",
      };
    }
    // The demo card is a test instrument with no real funds, so checkout fails at payment.
    // (With AMAZON_LIVE=1 + a funded card issuer, this places a real order instead.)
    return {
      placed: false,
      product,
      totalCents,
      address: req.address,
      cardLast4: req.card?.last4 ?? "4242",
      mock: true,
      note: `Payment declined at checkout — the card on file is a test card (ending ${req.card?.last4 ?? "4242"}) with no real funds. Add a funded card to complete the purchase of "${product.name}" for $${(totalCents / 100).toFixed(2)}.`,
    };
  },
};
