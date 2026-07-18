// CapabilityProvider registry + the concrete providers (data + real-world commerce).
// Service id convention: `${provider.name}:${localId}`.
import type {
  CapabilityProvider,
  IdempotencyKey,
  RequestId,
  RunResult,
  ServiceDetails,
  ServiceRef,
} from "@intendr/contracts";

let requestCounter = 0;
const newRequestId = (): RequestId => `req_${++requestCounter}` as unknown as RequestId;

export class ProviderRegistry {
  private readonly providers: CapabilityProvider[] = [];

  register(provider: CapabilityProvider): this {
    this.providers.push(provider);
    return this;
  }

  async search(query: string): Promise<ServiceRef[]> {
    const results = await Promise.all(this.providers.map((p) => p.search(query).catch(() => [])));
    return results.flat();
  }

  find(id: string): CapabilityProvider | undefined {
    return this.providers.find((p) => id.startsWith(`${p.name}:`));
  }
}

/** Real paid data calls. TODO: wire the Orthogonal catalog client (reuse from ortha). */
export class OrthogonalProvider implements CapabilityProvider {
  readonly name = "orthogonal";
  constructor(private readonly apiKey?: string) {}

  async search(query: string): Promise<ServiceRef[]> {
    return [{ id: "orthogonal:enrich", provider: this.name, title: `Enrich company — ${query}` }];
  }

  async details(id: string): Promise<ServiceDetails> {
    return {
      id,
      provider: this.name,
      title: "Enrich company",
      inputSchema: { domain: "string" },
      priceCents: 3,
      dynamicPricing: false,
      sideEffect: "read",
    };
  }

  async run(id: string, input: Record<string, unknown>, _idem: IdempotencyKey): Promise<RunResult> {
    // TODO: real catalog call; distill upstream.
    return { ok: true, priceCents: 3, data: { domain: input.domain, note: "stubbed enrichment" }, requestId: newRequestId() };
  }
}

/** DoorDash via dd-cli (beta) or a believable mock. */
export class DoorDashProvider implements CapabilityProvider {
  readonly name = "doordash";
  constructor(private readonly useCli = false) {}

  async search(query: string): Promise<ServiceRef[]> {
    return [{ id: "doordash:order", provider: this.name, title: `Order food — ${query}` }];
  }

  async details(id: string): Promise<ServiceDetails> {
    return {
      id,
      provider: this.name,
      title: "Place a DoorDash order",
      inputSchema: { restaurant: "string", items: "string[]" },
      priceCents: 1850,
      dynamicPricing: true,
      sideEffect: "write",
    };
  }

  async run(id: string, input: Record<string, unknown>, _idem: IdempotencyKey): Promise<RunResult> {
    // TODO: shell out to `dd-cli order ...` when useCli; else return a mock receipt.
    return {
      ok: true,
      priceCents: 1850,
      data: { orderId: `mock-${newRequestId()}`, eta: "25 min", items: input.items ?? [] },
      requestId: newRequestId(),
    };
  }
}

/** Uber via the official Rides sandbox or a mock. */
export class UberProvider implements CapabilityProvider {
  readonly name = "uber";

  async search(query: string): Promise<ServiceRef[]> {
    return [{ id: "uber:ride", provider: this.name, title: `Book a ride — ${query}` }];
  }

  async details(id: string): Promise<ServiceDetails> {
    return {
      id,
      provider: this.name,
      title: "Book an Uber ride",
      inputSchema: { from: "string", to: "string" },
      priceCents: 2800,
      dynamicPricing: true,
      sideEffect: "write",
    };
  }

  async run(id: string, input: Record<string, unknown>, _idem: IdempotencyKey): Promise<RunResult> {
    // TODO: Uber Rides sandbox estimate -> request -> status; else mock.
    return {
      ok: true,
      priceCents: 2800,
      data: { rideId: `mock-${newRequestId()}`, from: input.from, to: input.to, eta: "6 min" },
      requestId: newRequestId(),
    };
  }
}
