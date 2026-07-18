import { createBudgetPolicy } from "@intendr/budget";
import type { Cents, FetchLike, PaymentRail, WorkspaceId } from "@intendr/contracts";
import { buildTools, type McpDeps, type ToolDef } from "@intendr/mcp";
import { DoorDashProvider, OrthogonalProvider, ProviderRegistry, UberProvider } from "@intendr/providers";

interface McpEnv {
  ORTHOGONAL_API_KEY?: string;
  WALLET_DO: DurableObjectNamespace;
}

const SUPPORTED_PROTOCOL = "2024-11-05";
const DEFAULT_CAP_CENTS = 2000;
const WORKSPACE = "demo";

const SERVER_INSTRUCTIONS =
  "Flow: search_services(query) to discover capabilities -> get_service(id) to read price + params " +
  "(each param belongs in query, body, or path) -> pay_and_run(id, {query,body,path}) to pay and execute. " +
  "A write or over-cap call returns status BLOCKED; call approve (raise_cap to lift the cap) then retry pay_and_run. " +
  "Ids come from search_services, e.g. 'orthogonal:company-enrich::GET::/companies/enrich'.";

const ID_HINT =
  "Capability id from search_services, e.g. 'orthogonal:company-enrich::GET::/companies/enrich' or 'uber:ride'.";

const TOOL_SCHEMAS: Record<string, { description: string; inputSchema: Record<string, unknown> }> = {
  get_wallet: {
    description: "Wallet balance, spend caps, and remaining budget.",
    inputSchema: { type: "object", properties: {} },
  },
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
  get_spend_summary: {
    description: "Cumulative spend, remaining budget, and overspend blocked.",
    inputSchema: { type: "object", properties: {} },
  },
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

function walletStub(env: McpEnv): DurableObjectStub {
  return env.WALLET_DO.get(env.WALLET_DO.idFromName(WORKSPACE));
}

async function walletOp(stub: DurableObjectStub, op: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await stub.fetch(`https://wallet/${op}`, { method: "POST", body: body ? JSON.stringify(body) : "{}" });
  return (await res.json()) as Record<string, unknown>;
}

/** SpendStorePort backed by the WalletDO — every op is atomic within the DO. */
class DurableSpendStore implements PaymentRail {
  readonly id = "durable";
  constructor(private readonly stub: DurableObjectStub) {}
  async tryReserve(_ws: WorkspaceId, cents: Cents, capCents: Cents): Promise<boolean> {
    return (await walletOp(this.stub, "reserve", { cents, capCents })).ok === true;
  }
  async settle(_ws: WorkspaceId, reservationCents: Cents, actualCents: Cents): Promise<void> {
    await walletOp(this.stub, "settle", { reservationCents, actualCents });
  }
  async refund(_ws: WorkspaceId, cents: Cents): Promise<void> {
    await walletOp(this.stub, "refund", { cents });
  }
  async remaining(_ws: WorkspaceId): Promise<Cents> {
    return Number((await walletOp(this.stub, "state")).remainingCents ?? 0);
  }
}

async function buildDeps(env: McpEnv): Promise<McpDeps> {
  const stub = walletStub(env);
  const snap = await walletOp(stub, "state");
  const globalCapCents = Number(snap.globalCapCents ?? DEFAULT_CAP_CENTS);
  const spentCents = Number(snap.spentCents ?? 0);
  const spentByCategoryCents = (snap.spentByCategory as Record<string, number> | undefined) ?? {};

  // Call globalThis.fetch explicitly (a bare/stored fetch throws "Illegal invocation" on Workers).
  const platformFetch: FetchLike = (url, init) => globalThis.fetch(url, init);
  const registry = new ProviderRegistry()
    .register(new OrthogonalProvider({ apiKey: env.ORTHOGONAL_API_KEY ?? "", fetch: platformFetch }))
    .register(new UberProvider())
    .register(new DoorDashProvider());

  const store = new DurableSpendStore(stub);
  const budget = createBudgetPolicy({
    store,
    settings: { sessionCapCents: globalCapCents, monthlyCapCents: globalCapCents, perCallWarnCents: 200 },
  });

  return {
    workspaceId: WORKSPACE as WorkspaceId,
    registry,
    budget,
    rail: store,
    guardrails: { globalCapCents, categoryCapsCents: {}, merchantAllowlist: [] },
    state: { spentCents, spentByCategoryCents },
  };
}

// pay_and_run's handler expects { id, input: { body, query, path } }; other tools take args as-is.
function shapeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === "pay_and_run") return { id: args.id, input: { body: args.body, query: args.query, path: args.path } };
  return args;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const okResult = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

async function callTool(env: McpEnv, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (!TOOL_SCHEMAS[name]) return errorResult(`unknown tool: ${name}`);

  const missing = (REQUIRED_ARGS[name] ?? []).filter((k) => {
    const v = args[k];
    return v === undefined || v === null || v === "";
  });
  if (missing.length > 0) return errorResult(`missing required argument(s): ${missing.join(", ")}`);

  const deps = await buildDeps(env);
  const tools = new Map<string, ToolDef>(buildTools(deps).map((t) => [t.spec.name, t] as const));
  const tool = tools.get(name);
  if (!tool) return errorResult(`unknown tool: ${name}`);

  try {
    const result = await tool.handler(shapeArgs(name, args));
    // Spend is persisted atomically by the DO store during pay_and_run; only the cap needs
    // an explicit write-back after approve.
    if (name === "approve") {
      await walletOp(walletStub(env), "setCap", { newCapCents: deps.guardrails.globalCapCents });
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

  // REST shim: { "tool": "...", "input": {...} } — same error contract as JSON-RPC (200 + isError).
  if (body && typeof body === "object" && !Array.isArray(body) && typeof body.tool === "string") {
    const result = await callTool(env, body.tool, (body.input as Record<string, unknown>) ?? {});
    return json({ result });
  }

  // MCP JSON-RPC (stateless transport; wallet state lives in the DO)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleOne = async (req: any): Promise<unknown | null> => {
    const id = req?.id ?? null;
    const method: string | undefined = req?.method;
    if (method === "initialize") {
      return rpcOk(id, {
        protocolVersion: SUPPORTED_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "intendr", version: "0.2.0" },
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
