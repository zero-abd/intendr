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
import type { CardInstrument } from "./cards.js";
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
  /** The scoped virtual card to enter at checkout. Present only when confirm=true. */
  card?: CardInstrument;
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
  { asin: "B00NTCHCU2", name: "Amazon Basics 20-Count AAA Alkaline Batteries", priceCents: 1249, isPrime: true, rating: "4.7" },
  { asin: "B07PGL2N7J", name: "Amazon Basics USB-C to USB-A Cable, 6 ft", priceCents: 699, isPrime: true, rating: "4.6" },
  { asin: "B08N5WRWNW", name: "Echo Dot (mock)", priceCents: 4999, isPrime: true, rating: "4.7" },
];

const MOCK_ADDRESSES: Address[] = [
  { id: "addr_home", label: "Home", line1: "1633 Bowen Dr", city: "Folsom", state: "CA", postalCode: "95630", country: "US", lat: 38.6779, lng: -121.1761 },
  { id: "addr_work", label: "Work", line1: "410 Terry Ave N", city: "Seattle", state: "WA", postalCode: "98109", country: "US", lat: 47.6229, lng: -122.3376 },
];

const SHIPPING_CENTS = 699;
const TAX_RATE = 0.0875;

function pickProduct(req: { asin?: string; query?: string }): AmazonProduct {
  if (req.asin) {
    const hit = MOCK_CATALOG.find((p) => p.asin === req.asin);
    if (hit) return hit;
    return { asin: req.asin, name: `Amazon item ${req.asin} (mock)`, priceCents: 1999, isPrime: true };
  }
  const q = (req.query ?? "").toLowerCase();
  return MOCK_CATALOG.find((p) => p.name.toLowerCase().includes(q)) ?? MOCK_CATALOG[0];
}

function totalFor(p: AmazonProduct, quantity: number): Cents {
  const sub = p.priceCents * quantity;
  const shipping = p.isPrime ? 0 : SHIPPING_CENTS;
  return Math.round((sub + shipping) * (1 + TAX_RATE));
}

export const amazonAgentMock = {
  search(req: AmazonSearchRequest): AmazonSearchResponse {
    const q = req.query.toLowerCase();
    const products = MOCK_CATALOG.filter((p) => !q || p.name.toLowerCase().includes(q) || q.length < 3);
    return { products: (products.length ? products : MOCK_CATALOG).slice(0, req.maxResults ?? 10) };
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
    return {
      placed: true,
      orderId: `mock-${product.asin}-${totalCents}`,
      product,
      totalCents,
      address: req.address,
      cardLast4: req.card?.last4,
      estimatedDelivery: "2-3 days (mock)",
      mock: true,
      note: "Mock order — no real charge. Set AMAZON_LIVE=1 with a real card issuer to place real orders.",
    };
  },
};
