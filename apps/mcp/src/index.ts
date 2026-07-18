// intendr — MCP connector (stdio). Any MCP-capable agent (Claude Desktop/Code, Cursor,
// ChatGPT desktop, ...) can add this server and get a spend-capped wallet that pays for
// Orthogonal's *entire* catalog (discovered at runtime) plus commerce providers (Uber, DoorDash).
//
// Env:
//   ORTHOGONAL_API_KEY        (required for the Orthogonal tools)
//   INTENDR_OPENING_BALANCE_CENTS  default 5000  ($50 wallet)
//   INTENDR_GLOBAL_CAP_CENTS       default 4500  ($45 spend cap)
//   INTENDR_PER_CALL_WARN_CENTS    default 100   (>$1 asks for approval)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createBudgetPolicy } from "@intendr/budget";
import type { FetchLike, WorkspaceId } from "@intendr/contracts";
import { buildTools, type McpDeps, type ToolDef } from "@intendr/mcp";
import { DoorDashProvider, OrthogonalProvider, ProviderRegistry, UberProvider } from "@intendr/providers";
import { LocalWalletRail } from "@intendr/wallet";

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const apiKey = process.env.ORTHOGONAL_API_KEY ?? "";
if (!apiKey) console.error("[intendr] WARNING: ORTHOGONAL_API_KEY not set — Orthogonal tools will 401.");

const registry = new ProviderRegistry()
  .register(new OrthogonalProvider({ apiKey, fetch: fetch as unknown as FetchLike }))
  .register(new UberProvider())
  .register(new DoorDashProvider());

const rail = new LocalWalletRail(num(process.env.INTENDR_OPENING_BALANCE_CENTS, 5000));
const budget = createBudgetPolicy({
  store: rail,
  settings: {
    sessionCapCents: num(process.env.INTENDR_GLOBAL_CAP_CENTS, 4500),
    monthlyCapCents: 1_000_000,
    perCallWarnCents: num(process.env.INTENDR_PER_CALL_WARN_CENTS, 100),
  },
});

// One long-lived deps instance = the wallet's spend accumulates across tool calls in a
// session (so caps actually bite and the spend summary is real).
const deps: McpDeps = {
  workspaceId: (process.env.INTENDR_WORKSPACE ?? "default") as WorkspaceId,
  registry,
  budget,
  rail,
  guardrails: {
    globalCapCents: num(process.env.INTENDR_GLOBAL_CAP_CENTS, 4500),
    categoryCapsCents: {},
    merchantAllowlist: [],
  },
  state: { spentCents: 0, spentByCategoryCents: {} },
};

const byName = new Map<string, ToolDef>(buildTools(deps).map((t) => [t.spec.name, t]));

const run = async (name: string, input: Record<string, unknown>) => {
  const tool = byName.get(name);
  if (!tool) throw new Error(`no tool: ${name}`);
  const result = await tool.handler(input);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
};

const server = new McpServer({ name: "intendr", version: "0.0.1" });

server.tool("get_wallet", "Wallet balance, spend caps, and remaining budget.", {}, () => run("get_wallet", {}));

server.tool(
  "search_services",
  "Search the full Orthogonal catalog (and commerce providers like Uber/DoorDash) for paid capabilities by natural language. Returns capability ids to use with get_service / pay_and_run.",
  { query: z.string().describe("what you want to do, e.g. 'enrich a company by domain' or 'book a ride'") },
  ({ query }) => run("search_services", { query }),
);

server.tool(
  "get_service",
  "Price, side-effect class, and input schema (query/body/path params) for one capability id.",
  { id: z.string().describe("a capability id from search_services") },
  ({ id }) => run("get_service", { id }),
);

server.tool(
  "pay_and_run",
  "Pay for and execute a capability under the wallet's spend controls (reserve → run → settle). Put each param in the bucket get_service lists it under: query, body, or path. Returns status 'ok' with data, or 'BLOCKED' (write/over-cap) — then call approve and retry.",
  {
    id: z.string().describe("capability id from search_services, e.g. orthogonal:company-enrich::GET::/companies/enrich"),
    body: z.record(z.unknown()).optional(),
    query: z.record(z.string()).optional(),
    path: z.record(z.unknown()).optional(),
  },
  ({ id, body, query, path }) => run("pay_and_run", { id, input: { body, query, path } }),
);

server.tool("get_spend_summary", "Spend so far, remaining budget, and overspend blocked.", {}, () => run("get_spend_summary", {}));

server.tool(
  "approve",
  "Resolve a pending over-cap / side-effect payment: approve, raise_cap (with newCapCents), or skip.",
  { decision: z.enum(["approve", "raise_cap", "skip"]), newCapCents: z.number().optional() },
  ({ decision, newCapCents }) => run("approve", { decision, newCapCents }),
);

await server.connect(new StdioServerTransport());
console.error("[intendr] MCP connector ready on stdio.");
