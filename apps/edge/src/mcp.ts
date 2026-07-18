import { createBudgetPolicy } from "@intendr/budget";
import type { Cents, FetchLike, PaymentRail, WorkspaceId } from "@intendr/contracts";
import { buildTools, type McpDeps, type ToolDef } from "@intendr/mcp";
import { DoorDashProvider, OrthogonalProvider, ProviderRegistry, UberProvider } from "@intendr/providers";

interface McpEnv {
  ORTHOGONAL_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}

const SUPPORTED_PROTOCOL = "2024-11-05";
const DEFAULT_CAP_CENTS = 2000;
const OPENING_CENTS = 2000;
const WORKSPACE = "demo";

const SERVER_INSTRUCTIONS =
  "Flow: search_services(query) to discover capabilities -> get_service(id) to read price + params " +
  "(each param belongs in query, body, or path) -> pay_and_run(id, {query,body,path}) to pay and execute. " +
  "A write or over-cap call returns status BLOCKED; call approve (raise_cap to lift the cap) then retry pay_and_run. " +
  "Ids come from search_services, e.g. 'orthogonal:company-enrich::GET::/companies/enrich'.";

const ID_HINT =
  "Capability id from search_services, e.g. 'orthogonal:company-enrich::GET::/companies/enrich' or 'uber:ride'.";

const TOOL_SCHEMAS: Record<string, { description: string; inputSchema: Record<string, unknown> }> = {
  get_wallet: { description: "Wallet balance, spend caps, and remaining budget.", inputSchema: { type: "object", properties: {} } },
  search_services: {
    description: "Search the full Orthogonal catalog (plus commerce providers Uber/DoorDash) for paid capabilities by natural language. Returns capability ids for get_service / pay_and_run.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "what you want to do, e.g. 'enrich a company by domain'" } }, required: ["query"] },
  },
  get_service: {
    description: "Price (priceCents), side-effect class, and input schema for one capability. The input schema lists params grouped by where they go: query, body, or path.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: ID_HINT, examples: ["uber:ride"] } }, required: ["id"] },
  },
  pay_and_run: {
    description: "Pay for and execute a capability under the wallet's spend controls (reserve -> run -> settle). Put each param in the bucket get_service says: query, body, or path. Returns status 'ok' with data, or 'BLOCKED' (write/over-cap) — then call approve and retry. Example: for orthogonal:company-enrich::GET::/companies/enrich pass query:{domain:'stripe.com'}.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: ID_HINT },
        query: { type: "object", description: "query-string params (values are strings)" },
        body: { type: "object", description: "request-body params" },
        path: { type: "object", description: "path params substituted into the endpoint path, e.g. {numberId:'123'}" },
      },
      required: ["id"],
    },
  },
  get_spend_summary: { description: "Cumulative spend, remaining budget, and overspend blocked.", inputSchema: { type: "object", properties: {} } },
  approve: {
    description: "Resolve a pending over-cap / side-effect payment, then retry pay_and_run. decision: approve | raise_cap | skip. newCapCents raises the global cap (use with raise_cap).",
    inputSchema: {
      type: "object",
      properties: { decision: { type: "string", enum: ["approve", "raise_cap", "skip"] }, newCapCents: { type: "number", minimum: 0 } },
      required: ["decision"],
    },
  },
};

const REQUIRED_ARGS: Record<string, string[]> = {
  search_services: ["query"],
  get_service: ["id"],
  pay_and_run: ["id"],
  approve: ["decision"],
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const rpcOk = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── Supabase-backed wallet (shared with the frontend). Atomicity lives in Postgres
//    SECURITY DEFINER functions; the Worker calls them over PostgREST RPC. ──
class SupabaseSpendStore implements PaymentRail {
  readonly id = "supabase";
  constructor(private readonly url: string, private readonly key: string) {}

  private async rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await globalThis.fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: this.key, authorization: `Bearer ${this.key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`supabase ${fn} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async tryReserve(_ws: WorkspaceId, cents: Cents, capCents: Cents): Promise<boolean> {
    return (await this.rpc("wallet_reserve", { ws: WORKSPACE, cents, cap: capCents })) === true;
  }
  async settle(_ws: WorkspaceId, reservationCents: Cents, actualCents: Cents): Promise<void> {
    await this.rpc("wallet_settle", { ws: WORKSPACE, reservation_cents: reservationCents, actual_cents: actualCents });
  }
  async refund(_ws: WorkspaceId, cents: Cents): Promise<void> {
    await this.rpc("wallet_refund", { ws: WORKSPACE, cents });
  }
  async remaining(_ws: WorkspaceId): Promise<Cents> {
    const w = (await this.rpc("wallet_get", { ws: WORKSPACE, default_cap: DEFAULT_CAP_CENTS, default_open: OPENING_CENTS })) as Record<string, unknown>;
    return Number(w.cap_cents) - Number(w.spent_cents) - Number(w.reserved_cents);
  }
  async getWallet(): Promise<{ spentCents: number; reservedCents: number; capCents: number }> {
    const w = (await this.rpc("wallet_get", { ws: WORKSPACE, default_cap: DEFAULT_CAP_CENTS, default_open: OPENING_CENTS })) as Record<string, unknown>;
    return { spentCents: Number(w.spent_cents), reservedCents: Number(w.reserved_cents), capCents: Number(w.cap_cents) };
  }
  async setCap(newCapCents: number): Promise<void> {
    await this.rpc("wallet_set_cap", { ws: WORKSPACE, new_cap: newCapCents });
  }
}

async function logTransaction(env: McpEnv, row: Record<string, unknown>): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  try {
    await globalThis.fetch(`${env.SUPABASE_URL}/rest/v1/transactions`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch {
    /* transaction logging is best-effort */
  }
}

async function buildDeps(env: McpEnv, store: SupabaseSpendStore): Promise<McpDeps> {
  const w = await store.getWallet();
  const platformFetch: FetchLike = (url, init) => globalThis.fetch(url, init);
  const registry = new ProviderRegistry()
    .register(new OrthogonalProvider({ apiKey: env.ORTHOGONAL_API_KEY ?? "", fetch: platformFetch }))
    .register(new UberProvider())
    .register(new DoorDashProvider());

  const budget = createBudgetPolicy({
    store,
    settings: { sessionCapCents: w.capCents, monthlyCapCents: w.capCents, perCallWarnCents: 200 },
  });

  return {
    workspaceId: WORKSPACE as WorkspaceId,
    registry,
    budget,
    rail: store,
    guardrails: { globalCapCents: w.capCents, categoryCapsCents: {}, merchantAllowlist: [] },
    state: { spentCents: w.spentCents, spentByCategoryCents: {} },
  };
}

function shapeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === "pay_and_run") return { id: args.id, input: { body: args.body, query: args.query, path: args.path } };
  return args;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const okResult = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

async function callTool(env: McpEnv, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (!TOOL_SCHEMAS[name]) return errorResult(`unknown tool: ${name}`);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return errorResult("wallet backend not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)");

  const missing = (REQUIRED_ARGS[name] ?? []).filter((k) => {
    const v = args[k];
    return v === undefined || v === null || v === "";
  });
  if (missing.length > 0) return errorResult(`missing required argument(s): ${missing.join(", ")}`);

  const store = new SupabaseSpendStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const deps = await buildDeps(env, store);
  const tool = new Map<string, ToolDef>(buildTools(deps).map((t) => [t.spec.name, t] as const)).get(name);
  if (!tool) return errorResult(`unknown tool: ${name}`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await tool.handler(shapeArgs(name, args));
    if (name === "approve") {
      await store.setCap(deps.guardrails.globalCapCents);
    }
    if (name === "pay_and_run" && result?.status === "ok") {
      await logTransaction(env, {
        id: String(result.requestId ?? `tx_${Date.now()}`),
        workspace_id: WORKSPACE,
        service: String(args.id ?? "unknown"),
        price_cents: Number(result.priceCents ?? 0),
        status: "ok",
        data: { summary: result.summary },
      });
    }
    return okResult(result);
  } catch (e) {
    return errorResult(msg(e));
  }
}

export async function handleMcp(request: Request, env: McpEnv): Promise<Response> {
  if (request.method === "GET") {
    return json({ service: "intendr", transport: "streamable-http (POST JSON-RPC)", tools: Object.keys(TOOL_SCHEMAS) });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(rpcErr(null, -32700, "parse error"), 400);
  }

  if (body && typeof body === "object" && !Array.isArray(body) && typeof body.tool === "string") {
    const result = await callTool(env, body.tool, (body.input as Record<string, unknown>) ?? {});
    return json({ result });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleOne = async (req: any): Promise<unknown | null> => {
    const id = req?.id ?? null;
    const method: string | undefined = req?.method;
    if (method === "initialize") {
      return rpcOk(id, {
        protocolVersion: SUPPORTED_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "intendr", version: "0.3.0" },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    if (method === "tools/list") {
      return rpcOk(id, {
        tools: Object.entries(TOOL_SCHEMAS).map(([name, s]) => ({ name, description: s.description, inputSchema: s.inputSchema })),
      });
    }
    if (method === "tools/call") {
      return rpcOk(id, await callTool(env, req?.params?.name, (req?.params?.arguments as Record<string, unknown>) ?? {}));
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
