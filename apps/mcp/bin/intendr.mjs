#!/usr/bin/env node
// intendr — MCP connector (stdio). A thin proxy to the hosted intendr service, which holds
// the shared Orthogonal key + spend-capped wallet server-side. Users bring nothing: no key,
// no config. Add it to any MCP client:  claude mcp add intendr -- npx -y intendr
//
// Optional env: INTENDR_URL (defaults to the hosted endpoint).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.INTENDR_URL ?? "https://intendr-edge.almahmud-zero.workers.dev").replace(/\/+$/, "");

async function callRemote(tool, input) {
  try {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "intendr-connector/0.1" },
      body: JSON.stringify({ tool, input }),
    });
    if (!res.ok) {
      return { content: [{ type: "text", text: `intendr: upstream HTTP ${res.status} from ${BASE}` }], isError: true };
    }
    const data = await res.json();
    return data.result ?? { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `intendr: ${err?.message ?? String(err)}` }], isError: true };
  }
}

const server = new McpServer({ name: "intendr", version: "0.1.0" });

server.tool("get_wallet", "Wallet balance, spend caps, and remaining budget.", {}, () => callRemote("get_wallet", {}));

server.tool(
  "search_services",
  "Search the Orthogonal catalog (plus commerce providers Uber/DoorDash) for paid capabilities by natural language. Returns capability ids for get_service / pay_and_run.",
  { query: z.string().describe("what you want to do, e.g. 'enrich a company by domain'") },
  ({ query }) => callRemote("search_services", { query }),
);

server.tool(
  "get_service",
  "Price (priceCents), side-effect class, and input schema (query/body/path params) for one capability id.",
  { id: z.string().describe("capability id from search_services, e.g. orthogonal:company-enrich::GET::/companies/enrich") },
  ({ id }) => callRemote("get_service", { id }),
);

server.tool(
  "pay_and_run",
  "Pay for and execute a capability under the wallet's spend controls. Put each param in the bucket get_service lists it under: query, body, or path. Returns status 'ok' with data, or 'BLOCKED' (write/over-cap). Real-world writes (e.g. amazon:buy) return BLOCKED + needsApproval with a live preview; after the user approves, re-call with confirm:true to actually execute the purchase.",
  {
    id: z.string(),
    query: z.record(z.string()).optional(),
    body: z.record(z.any()).optional(),
    path: z.record(z.any()).optional(),
    confirm: z.boolean().optional().describe("Set true ONLY after explicit user approval to execute a real-world write (e.g. a purchase)."),
  },
  (args) => callRemote("pay_and_run", args),
);

server.tool("get_spend_summary", "Cumulative spend, remaining budget, and overspend blocked.", {}, () => callRemote("get_spend_summary", {}));

server.tool(
  "approve",
  "Resolve a pending over-cap / side-effect payment, then retry pay_and_run. decision: approve | raise_cap | skip. newCapCents raises the global cap.",
  { decision: z.enum(["approve", "raise_cap", "skip"]), newCapCents: z.number().optional() },
  (args) => callRemote("approve", args),
);

await server.connect(new StdioServerTransport());
console.error(`[intendr] connector ready -> ${BASE}`);
