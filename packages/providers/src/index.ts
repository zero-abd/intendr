// CapabilityProvider registry + concrete providers.
// OrthogonalProvider makes REAL calls to https://api.orthogonal.com/v1 (search/details/run)
// with a Bearer API key and an injected `fetch` (FetchLike) so this package stays
// runtime-agnostic. Uber/DoorDash are believable mocks behind the same interface.
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
// Service id encodes endpoint identity so the connector stays stateless:
//   orthogonal:<slug>::<METHOD>::<path>
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
      // Surface a clean message (lift the upstream `error`/`message`), and note that
      // 4xx are validation failures the gateway rejects BEFORE billing (no charge).
      const raw = await res.text().catch(() => "");
      let detail = raw.slice(0, 300);
      try {
        const j = JSON.parse(raw) as Record<string, unknown>;
        if (typeof j.error === "string") detail = j.error;
        else if (typeof j.message === "string") detail = j.message;
      } catch {
        /* not JSON — keep raw */
      }
      const noCharge = res.status >= 400 && res.status < 500 ? " (no credits charged)" : "";
      throw new Error(`orthogonal ${path} ${res.status}: ${detail}${noCharge}`);
    }
    return res.json();
  }

  async search(query: string): Promise<ServiceRef[]> {
    if (!query.trim()) return [];
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
      // Uniform {query, body, path} shape across all providers, so an agent can parse one thing.
      inputSchema: { query: ep.queryParams ?? [], body: ep.bodyParams ?? [], path: ep.pathParams ?? [] },
      // Full-precision cents (e.g. 1.225), so get_service matches the actual charge.
      priceCents: ep.price !== undefined ? ep.price * 100 : 0,
      dynamicPricing: ep.hasDynamicPricing === true,
      sideEffect: classifySideEffect(ep.method, ep.path, ep.description ?? ""),
    };
  }

  async run(id: string, input: Record<string, unknown>, idem: IdempotencyKey): Promise<RunResult> {
    const decoded = decodeOrthoId(id);
    // Substitute path params ({name} or :name) into the endpoint path from input.path.
    let path = decoded.path;
    const pathParams = input.path as Record<string, unknown> | undefined;
    if (pathParams) {
      for (const [k, v] of Object.entries(pathParams)) {
        path = path.replace(`{${k}}`, encodeURIComponent(String(v))).replace(`:${k}`, encodeURIComponent(String(v)));
      }
    }
    const body = (input.body as Record<string, unknown> | undefined) ?? undefined;
    const query = stringifyQuery(input.query as Record<string, unknown> | undefined);
    const parsed = RunResponseSchema.parse(
      await this.post("/run", { api: decoded.slug, path, body, query }, { "idempotency-key": idem }),
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

function classifySideEffect(method: string, path: string, description: string): SideEffectClass {
  if (method.toUpperCase() === "GET") return "read";
  const haystack = `${path} ${description}`.toLowerCase();
  return MUTATE_HINTS.some((h) => haystack.includes(h)) ? "write" : "read";
}

function stringifyQuery(query: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!query) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) out[k] = typeof v === "string" ? v : String(v);
  return out;
}

// ── Real-world commerce (mocked until dd-cli / Uber sandbox are configured) ───
// search() only matches intent-relevant queries so these don't pollute data searches.
export class DoorDashProvider implements CapabilityProvider {
  readonly name = "doordash";
  constructor(private readonly useCli = false) {}

  async search(query: string): Promise<ServiceRef[]> {
    if (!/food|eat|meal|restaurant|order|deliver|burger|pizza|dinner|lunch|hungry|takeout|snack/i.test(query)) return [];
    return [{ id: "doordash:order", provider: this.name, title: "Order food via DoorDash" }];
  }

  async details(id: string): Promise<ServiceDetails> {
    return {
      id,
      provider: this.name,
      title: "Place a DoorDash order",
      inputSchema: {
        query: [],
        body: [
          { name: "restaurant", type: "string", required: false },
          { name: "items", type: "array", required: true },
        ],
        path: [],
      },
      priceCents: 1850,
      dynamicPricing: true,
      sideEffect: "write",
    };
  }

  async run(id: string, input: Record<string, unknown>, _idem: IdempotencyKey): Promise<RunResult> {
    const body = (input.body as Record<string, unknown> | undefined) ?? input;
    return {
      ok: true,
      priceCents: 1850,
      data: { orderId: `mock-${newRequestId()}`, eta: "25 min", items: body.items ?? [] },
      requestId: newRequestId(),
    };
  }
}

export class UberProvider implements CapabilityProvider {
  readonly name = "uber";

  async search(query: string): Promise<ServiceRef[]> {
    if (!/ride|uber|car|taxi|drive|airport|trip|commute|lyft|pickup|ride-hail|rideshare/i.test(query)) return [];
    return [{ id: "uber:ride", provider: this.name, title: "Book a ride via Uber" }];
  }

  async details(id: string): Promise<ServiceDetails> {
    return {
      id,
      provider: this.name,
      title: "Book an Uber ride",
      inputSchema: {
        query: [],
        body: [
          { name: "from", type: "string", required: true },
          { name: "to", type: "string", required: true },
        ],
        path: [],
      },
      priceCents: 2800,
      dynamicPricing: true,
      sideEffect: "write",
    };
  }

  async run(id: string, input: Record<string, unknown>, _idem: IdempotencyKey): Promise<RunResult> {
    const body = (input.body as Record<string, unknown> | undefined) ?? input;
    return {
      ok: true,
      priceCents: 2800,
      data: { rideId: `mock-${newRequestId()}`, from: body.from, to: body.to, eta: "6 min" },
      requestId: newRequestId(),
    };
  }
}
