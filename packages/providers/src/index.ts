// CapabilityProvider registry + the concrete providers.
// OrthogonalProvider makes REAL calls to https://api.orthogonal.com/v1 (search/details/run)
// with a Bearer API key. It takes an injected `fetch` (FetchLike) so this package stays
// runtime-agnostic — the Worker and the Node MCP server both pass their platform fetch.
import { z } from "zod";
import type {
  CapabilityProvider,
  FetchLike,
  IdempotencyKey,
  RequestId,
  RunResult,
  ServiceDetails,
  ServiceRef,
  SideEffectClass,
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

// ── Orthogonal (real) ────────────────────────────────────────────────────────
// Service id encodes the endpoint identity so the connector stays stateless across
// tool calls: `orthogonal:<slug>::<method>::<path>`.
const ORTHO_PREFIX = "orthogonal:";
const ORTHO_DEFAULT_BASE = "https://api.orthogonal.com/v1";

const SearchResponseSchema = z.object({
  success: z.boolean(),
  results: z.array(
    z.object({
      name: z.string(),
      slug: z.string(),
      endpoints: z.array(
        z.object({
          path: z.string(),
          method: z.string(),
          description: z.string().default(""),
          price: z.string().optional(),
        }),
      ),
    }),
  ),
});

const DetailsResponseSchema = z.object({
  success: z.boolean(),
  api: z.object({ slug: z.string(), verified: z.boolean().optional() }).optional(),
  endpoint: z.object({
    path: z.string(),
    method: z.string(),
    description: z.string().optional(),
    price: z.number().optional(),
    hasDynamicPricing: z.boolean().optional(),
    pathParams: z.array(z.unknown()).optional(),
    queryParams: z.array(z.unknown()).optional(),
    bodyParams: z.array(z.unknown()).optional(),
  }),
});

const RunResponseSchema = z.object({
  success: z.boolean(),
  priceCents: z.number(),
  data: z.unknown(),
  requestId: z.string(),
});

export interface OrthogonalDeps {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}

export class OrthogonalProvider implements CapabilityProvider {
  readonly name = "orthogonal";
  private readonly baseUrl: string;

  constructor(private readonly deps: OrthogonalDeps) {
    this.baseUrl = (deps.baseUrl ?? ORTHO_DEFAULT_BASE).replace(/\/+$/, "");
  }

  private async post(path: string, payload: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    if (!this.deps.apiKey) throw new Error("orthogonal: ORTHOGONAL_API_KEY is not set");
    const res = await this.deps.fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.deps.apiKey}`, ...extraHeaders },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`orthogonal ${path} failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    return res.json();
  }

  async search(query: string): Promise<ServiceRef[]> {
    const parsed = SearchResponseSchema.parse(await this.post("/search", { prompt: query, limit: 10 }));
    const refs: ServiceRef[] = [];
    for (const api of parsed.results) {
      for (const ep of api.endpoints) {
        refs.push({
          id: encodeOrthoId(api.slug, ep.method, ep.path),
          provider: this.name,
          title: `${ep.method.toUpperCase()} ${api.slug}${ep.path} — ${ep.description}`.slice(0, 160),
        });
      }
    }
    return refs;
  }

  async details(id: string): Promise<ServiceDetails> {
    const { slug, path } = decodeOrthoId(id);
    const parsed = DetailsResponseSchema.parse(await this.post("/details", { api: slug, path }));
    const ep = parsed.endpoint;
    return {
      id,
      provider: this.name,
      title: `${ep.method.toUpperCase()} ${slug}${ep.path}`,
      inputSchema: { query: ep.queryParams ?? [], body: ep.bodyParams ?? [], path: ep.pathParams ?? [] },
      priceCents: ep.price !== undefined ? Math.round(ep.price * 100) : 0,
      dynamicPricing: ep.hasDynamicPricing === true,
      sideEffect: classifySideEffect(ep.method, ep.path, ep.description ?? ""),
    };
  }

  async run(id: string, input: Record<string, unknown>, idem: IdempotencyKey): Promise<RunResult> {
    const { slug, path } = decodeOrthoId(id);
    const body = (input.body as Record<string, unknown> | undefined) ?? undefined;
    const query = stringifyQuery(input.query as Record<string, unknown> | undefined);
    const parsed = RunResponseSchema.parse(
      await this.post("/run", { api: slug, path, body, query }, { "idempotency-key": idem }),
    );
    return {
      ok: parsed.success,
      priceCents: parsed.priceCents,
      data: parsed.data,
      requestId: parsed.requestId as unknown as RequestId,
    };
  }
}

const encodeOrthoId = (slug: string, method: string, path: string): string =>
  `${ORTHO_PREFIX}${slug}::${method}::${path}`;

function decodeOrthoId(id: string): { slug: string; method: string; path: string } {
  const [slug = "", method = "GET", ...rest] = id.slice(ORTHO_PREFIX.length).split("::");
  return { slug, method, path: rest.join("::") };
}

const MUTATE_HINTS = [
  "send", "create", "delete", "remove", "update", "modify", "insert",
  "publish", "submit", "cancel", "upload", "charge", "schedule", "write",
];

/** GET is a read; other verbs default to read unless the path/description mutates the world. */
function classifySideEffect(method: string, path: string, description: string): SideEffectClass {
  if (method.toUpperCase() === "GET") return "read";
  const haystack = `${path} ${description}`.toLowerCase();
  return MUTATE_HINTS.some((h) => haystack.includes(h)) ? "write" : "read";
}

/** The gateway rejects numeric query values — coerce everything to strings. */
function stringifyQuery(query: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!query) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) out[k] = typeof v === "string" ? v : String(v);
  return out;
}

// ── Real-world commerce (mocked until dd-cli / Uber sandbox are configured) ───
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
    return {
      ok: true,
      priceCents: 1850,
      data: { orderId: `mock-${newRequestId()}`, eta: "25 min", items: input.items ?? [] },
      requestId: newRequestId(),
    };
  }
}

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
    return {
      ok: true,
      priceCents: 2800,
      data: { rideId: `mock-${newRequestId()}`, from: input.from, to: input.to, eta: "6 min" },
      requestId: newRequestId(),
    };
  }
}
