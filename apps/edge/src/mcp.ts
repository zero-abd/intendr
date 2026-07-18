import { createBudgetPolicy } from "@intendr/budget";
import { createCardIssuer, resolveGeoFromCf, type CardIssuerEnv, type Geo } from "@intendr/commerce";
import type { Cents, FetchLike, PaymentRail, WorkspaceId } from "@intendr/contracts";
import { buildTools, type McpDeps, type ToolDef } from "@intendr/mcp";
import { AmazonProvider, DoorDashProvider, OrthogonalProvider, ProviderRegistry, UberProvider } from "@intendr/providers";

interface McpEnv extends CardIssuerEnv {
  ORTHOGONAL_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  /** Base URL of the amazon-agent service. Unset → the built-in deterministic mock. */
  AMAZON_AGENT_URL?: string;
}

const SUPPORTED_PROTOCOL = "2024-11-05";

const SERVER_INSTRUCTIONS =
  "Flow: search_services(query) -> get_service(id) to read price + params (query/body/path) -> " +
  "pay_and_run(id, {query,body,path}) to pay and execute against your wallet balance. Writes/over-balance " +
  "return BLOCKED. Ids come from search_services, e.g. 'orthogonal:company-enrich::GET::/companies/enrich'.";
const ID_HINT = "Capability id from search_services, e.g. 'orthogonal:company-enrich::GET::/companies/enrich' or 'uber:ride'.";

const TOOL_SCHEMAS: Record<string, { description: string; inputSchema: Record<string, unknown> }> = {
  get_wallet: { description: "Wallet balance and remaining budget.", inputSchema: { type: "object", properties: {} } },
  search_services: {
    description: "Search the full Orthogonal catalog (plus commerce providers Uber/DoorDash) for paid capabilities by natural language. Returns capability ids for get_service / pay_and_run.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "what you want to do, e.g. 'enrich a company by domain'" } }, required: ["query"] },
  },
  get_service: {
    description: "Price (priceCents), side-effect class, and input schema for one capability (params grouped by query/body/path).",
    inputSchema: { type: "object", properties: { id: { type: "string", description: ID_HINT, examples: ["uber:ride"] } }, required: ["id"] },
  },
  pay_and_run: {
    description: "Pay for and execute a capability, debiting your wallet balance. Put each param in the bucket get_service says: query, body, or path. Real-world writes (e.g. 'amazon:buy') return BLOCKED + needsApproval with a live preview; re-call with confirm:true ONLY after the user approves to actually purchase. Example: orthogonal:company-enrich::GET::/companies/enrich with query:{domain:'stripe.com'}.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: ID_HINT },
        query: { type: "object" }, body: { type: "object" }, path: { type: "object" },
        confirm: { type: "boolean", description: "Set true ONLY after explicit user approval to execute a real-world write (e.g. a purchase)." },
      },
      required: ["id"],
    },
  },
  get_spend_summary: { description: "Balance remaining and spend so far.", inputSchema: { type: "object", properties: {} } },
  approve: {
    description: "Acknowledge a gated payment: approve | raise_cap | skip. (Top up balance from the intendr dashboard.)",
    inputSchema: { type: "object", properties: { decision: { type: "string", enum: ["approve", "raise_cap", "skip"] }, newCapCents: { type: "number" } }, required: ["decision"] },
  },
};

const REQUIRED_ARGS: Record<string, string[]> = { search_services: ["query"], get_service: ["id"], pay_and_run: ["id"], approve: ["decision"] };

const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const rpcOk = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Per-user wallet over the shared Supabase (balance model). Atomic debit lives in mcp_charge.
class SupabaseSpendStore implements PaymentRail {
  readonly id = "supabase";
  pendingService = "unknown";
  constructor(private readonly url: string, private readonly key: string, private readonly uid: string) {}

  private async rpc(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const res = await globalThis.fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: this.key, authorization: `Bearer ${this.key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`supabase ${fn} ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as unknown;
    return (data && typeof data === "object" ? (data as Record<string, unknown>) : null);
  }

  async balance(): Promise<number> {
    const w = await this.rpc("mcp_wallet", { uid: this.uid });
    return Number(w?.balance_cents ?? 0);
  }
  async tryReserve(_ws: WorkspaceId, cents: Cents, _cap: Cents): Promise<boolean> {
    return (await this.balance()) >= Math.ceil(cents);
  }
  async settle(_ws: WorkspaceId, _reservationCents: Cents, actualCents: Cents): Promise<void> {
    await this.rpc("mcp_charge", { uid: this.uid, amount_cents: Math.ceil(actualCents), svc: this.pendingService });
  }
  async refund(): Promise<void> {
    /* balance model: nothing was held */
  }
  async remaining(): Promise<Cents> {
    return this.balance();
  }
}

// Resolve the signed-in user from the connector's Bearer token. No token -> no wallet.
async function resolveUid(env: McpEnv, request: Request): Promise<string | null> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const res = await globalThis.fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${bearer}` },
      });
      if (res.ok) {
        const u = (await res.json()) as { id?: string };
        if (u?.id) return u.id;
      }
    } catch {
      /* unauthenticated */
    }
  }
  return null;
}

async function buildDeps(env: McpEnv, store: SupabaseSpendStore, geo?: Geo): Promise<McpDeps> {
  const balance = await store.balance();
  const platformFetch: FetchLike = (url, init) => globalThis.fetch(url, init);
  const issuer = createCardIssuer(env, platformFetch); // default: mock test card (no real money)
  const registry = new ProviderRegistry()
    .register(new OrthogonalProvider({ apiKey: env.ORTHOGONAL_API_KEY ?? "", fetch: platformFetch }))
    .register(new UberProvider())
    .register(new DoorDashProvider())
    .register(new AmazonProvider({ fetch: platformFetch, baseUrl: env.AMAZON_AGENT_URL, issuer, geo }));
  const budget = createBudgetPolicy({ store, settings: { sessionCapCents: balance, monthlyCapCents: 100000, perCallWarnCents: 200 } });
  return {
    workspaceId: "user" as WorkspaceId,
    registry,
    budget,
    rail: store,
    guardrails: { globalCapCents: 100000, categoryCapsCents: {}, merchantAllowlist: [] },
    state: { spentCents: 0, spentByCategoryCents: {} },
  };
}

function shapeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === "pay_and_run")
    return { id: args.id, input: { body: args.body, query: args.query, path: args.path, confirm: args.confirm } };
  return args;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const okResult = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

async function callTool(env: McpEnv, uid: string | null, name: string, args: Record<string, unknown>, geo?: Geo): Promise<ToolResult> {
  if (!TOOL_SCHEMAS[name]) return errorResult(`unknown tool: ${name}`);
  if (!uid) return errorResult("authentication required — connect with the intendr connector (npx -y intendr) and sign in");
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return errorResult("wallet backend not configured");
  const missing = (REQUIRED_ARGS[name] ?? []).filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
  if (missing.length > 0) return errorResult(`missing required argument(s): ${missing.join(", ")}`);

  const store = new SupabaseSpendStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, uid);
  if (name === "pay_and_run") store.pendingService = String(args.id);
  const deps = await buildDeps(env, store, geo);
  const tool = new Map<string, ToolDef>(buildTools(deps).map((t) => [t.spec.name, t] as const)).get(name);
  if (!tool) return errorResult(`unknown tool: ${name}`);

  try {
    return okResult(await tool.handler(shapeArgs(name, args)));
  } catch (e) {
    return errorResult(msg(e));
  }
}

export async function handleMcp(request: Request, env: McpEnv): Promise<Response> {
  if (request.method === "GET") {
    return json({ service: "intendr", transport: "streamable-http (POST JSON-RPC)", tools: Object.keys(TOOL_SCHEMAS) });
  }

  const uid = await resolveUid(env, request);
  // Cloudflare attaches edge-resolved geo to request.cf — used for nearest-address.
  const geo = resolveGeoFromCf((request as unknown as { cf?: unknown }).cf);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(rpcErr(null, -32700, "parse error"), 400);
  }

  if (body && typeof body === "object" && !Array.isArray(body) && typeof body.tool === "string") {
    return json({ result: await callTool(env, uid, body.tool, (body.input as Record<string, unknown>) ?? {}, geo) });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleOne = async (req: any): Promise<unknown | null> => {
    const id = req?.id ?? null;
    const method: string | undefined = req?.method;
    if (method === "initialize") {
      return rpcOk(id, { protocolVersion: SUPPORTED_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "intendr", version: "0.4.0" }, instructions: SERVER_INSTRUCTIONS });
    }
    if (method === "tools/list") {
      return rpcOk(id, { tools: Object.entries(TOOL_SCHEMAS).map(([name, s]) => ({ name, description: s.description, inputSchema: s.inputSchema })) });
    }
    if (method === "tools/call") {
      return rpcOk(id, await callTool(env, uid, req?.params?.name, (req?.params?.arguments as Record<string, unknown>) ?? {}, geo));
    }
    if (method === "ping") return rpcOk(id, {});
    if (typeof method === "string" && method.startsWith("notifications/")) return null;
    return rpcErr(id, -32601, `method not found: ${method ?? "(none)"}`);
  };

  if (Array.isArray(body)) {
    if (body.length === 0) return json(rpcErr(null, -32600, "invalid request: empty batch"), 400);
    const out = (await Promise.all(body.map(handleOne))).filter((x) => x !== null);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const res = await handleOne(body);
  return res === null ? new Response(null, { status: 202 }) : json(res);
}
