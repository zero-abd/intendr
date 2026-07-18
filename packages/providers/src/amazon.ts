// AmazonProvider — a CapabilityProvider for real-world Amazon purchasing.
//
// Universal by construction: it implements the SAME CapabilityProvider interface
// as Orthogonal/Uber/DoorDash, so `pay_and_run` routes to it automatically via the
// `amazon:` id prefix and new platforms drop in the same way.
//
// Because a Cloudflare Worker can't run a browser, the actual automation lives in a
// separate Node service (apps/amazon-agent). This provider talks to it over HTTP
// (FetchLike). With no AMAZON_AGENT_URL configured it falls back to the shared
// deterministic mock (amazonAgentMock) so the whole flow works without the service.
//
// Safety: purchasing is sideEffect:"write". A first pay_and_run returns BLOCKED +
// a live preview (via preview()). Only a confirmed call (confirm=true, after the
// guardrail write-gate is satisfied) issues a scoped virtual card and places the
// order. The default card issuer is a MOCK test card — no real money moves.
import type {
  CapabilityProvider,
  FetchLike,
  IdempotencyKey,
  RequestId,
  RunResult,
  ServiceDetails,
  ServiceRef,
} from "@intendr/contracts";
import {
  amazonAgentMock,
  nearestAddress,
  type Address,
  type AmazonPurchaseRequest,
  type AmazonPurchaseResponse,
  type CardIssuer,
  type Geo,
  type IssuedCard,
} from "@intendr/commerce";

let amazonReq = 0;
const newRequestId = (): RequestId => `req_amazon_${++amazonReq}` as unknown as RequestId;

const BUY_ID = "amazon:buy";
// Quoted estimate used for the reservation; actual charge is the returned total
// (dynamicPricing:true → settle uses result.priceCents).
const DEFAULT_ESTIMATE_CENTS = 3000;

export interface AmazonDeps {
  fetch: FetchLike;
  /** Base URL of the amazon-agent service. Empty → use the built-in mock backend. */
  baseUrl?: string;
  /** Virtual-card issuer (mock by default). Used only on a confirmed purchase. */
  issuer: CardIssuer;
  /** Coarse geo (e.g. from the Worker request) for nearest-address selection. */
  geo?: Geo;
}

const SHOP_RE = /amazon|buy|purchase|order|shop|cart|checkout|product|reorder|deliver|prime/i;

export class AmazonProvider implements CapabilityProvider {
  readonly name = "amazon";
  private readonly base?: string;

  constructor(private readonly deps: AmazonDeps) {
    this.base = deps.baseUrl?.replace(/\/+$/, "") || undefined;
  }

  // Route a request to the agent service, or the shared mock when unconfigured.
  private async agent<T>(op: "search" | "addresses" | "purchase", payload: unknown): Promise<T> {
    if (!this.base) {
      if (op === "search") return amazonAgentMock.search(payload as never) as unknown as T;
      if (op === "addresses") return amazonAgentMock.addresses() as unknown as T;
      return amazonAgentMock.purchase(payload as AmazonPurchaseRequest) as unknown as T;
    }
    const res = await this.deps.fetch(`${this.base}/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`amazon-agent ${op} ${res.status}: ${detail}`);
    }
    return (await res.json()) as T;
  }

  async search(query: string): Promise<ServiceRef[]> {
    if (!SHOP_RE.test(query)) return [];
    return [{ id: BUY_ID, provider: this.name, title: "Buy a product on Amazon (real-world purchase)" }];
  }

  async details(_id: string): Promise<ServiceDetails> {
    return {
      id: BUY_ID,
      provider: this.name,
      title: "Buy a product on Amazon",
      inputSchema: {
        query: [],
        body: [
          { name: "query", type: "string", required: false }, // item to buy (top match)
          { name: "asin", type: "string", required: false }, // exact product id (preferred)
          { name: "quantity", type: "number", required: false },
          { name: "address", type: "object", required: false }, // omit → nearest saved address
          { name: "confirm", type: "boolean", required: false }, // true = actually purchase
        ],
        path: [],
      },
      priceCents: DEFAULT_ESTIMATE_CENTS,
      dynamicPricing: true,
      sideEffect: "write",
    };
  }

  /** Resolve which saved address to ship to: explicit → else nearest to geo. */
  private async resolveAddress(body: Record<string, unknown>): Promise<Address> {
    const explicit = body.address as Address | undefined;
    if (explicit && typeof explicit === "object" && explicit.line1) return explicit;
    const { addresses } = await this.agent<{ addresses: Address[] }>("addresses", {});
    const chosen = nearestAddress(this.deps.geo, addresses);
    if (!chosen) throw new Error("no saved Amazon address found and none supplied — pass body.address");
    return chosen;
  }

  private parseBody(input: Record<string, unknown>): Record<string, unknown> {
    return (input.body as Record<string, unknown> | undefined) ?? input;
  }

  /** Live cart preview shown before approval. Never places an order or charges. */
  async preview(_id: string, input: Record<string, unknown>): Promise<unknown> {
    const body = this.parseBody(input);
    const address = await this.resolveAddress(body);
    const req: AmazonPurchaseRequest = {
      asin: body.asin as string | undefined,
      query: body.query as string | undefined,
      quantity: (body.quantity as number | undefined) ?? 1,
      address,
      confirm: false,
    };
    return this.agent<AmazonPurchaseResponse>("purchase", req);
  }

  async run(_id: string, input: Record<string, unknown>, _idem: IdempotencyKey): Promise<RunResult> {
    const body = this.parseBody(input);
    const confirm = input.confirm === true || body.confirm === true;
    const address = await this.resolveAddress(body);
    const asin = body.asin as string | undefined;
    const query = body.query as string | undefined;
    const quantity = (body.quantity as number | undefined) ?? 1;

    if (!confirm) {
      // Reached run() without confirmation → return a no-charge preview.
      const preview = await this.agent<AmazonPurchaseResponse>("purchase", {
        asin, query, quantity, address, confirm: false,
      } satisfies AmazonPurchaseRequest);
      return { ok: false, priceCents: 0, data: { ...preview, needsConfirm: true }, requestId: newRequestId() };
    }

    // Confirmed: price the cart, mint a scoped virtual card for that ceiling, purchase.
    const quote = await this.agent<AmazonPurchaseResponse>("purchase", {
      asin, query, quantity, address, confirm: false,
    } satisfies AmazonPurchaseRequest);

    let card: IssuedCard | undefined;
    try {
      card = await this.deps.issuer.issue({
        amountCents: quote.totalCents,
        merchant: this.name,
        zip: address.postalCode,
        idempotencyKey: String(_idem),
      });
      // Mock issuer → pass the (test) instrument directly. Real issuer → pass only the
      // token ref; the executor redeems the PAN server-side (PAN never transits here).
      const result = await this.agent<AmazonPurchaseResponse>("purchase", {
        asin, query, quantity, address, card: card.instrument, cardRef: card.credentialRef, confirm: true,
      } satisfies AmazonPurchaseRequest);
      if (!result.placed) throw new Error(result.note ?? "amazon purchase did not complete");
      return {
        ok: true,
        priceCents: result.totalCents, // dynamic: settle the actual total
        data: {
          orderId: result.orderId,
          product: result.product,
          address: result.address,
          cardLast4: result.cardLast4,
          estimatedDelivery: result.estimatedDelivery,
          mock: result.mock,
          note: result.note,
        },
        requestId: newRequestId(),
      };
    } finally {
      if (card) await this.deps.issuer.close(card.id).catch(() => {});
    }
  }
}
