import { createBudgetPolicy } from "@intendr/budget";
import type { WorkspaceId } from "@intendr/contracts";
import { buildTools, type McpDeps } from "@intendr/mcp";
import { DoorDashProvider, OrthogonalProvider, ProviderRegistry, UberProvider } from "@intendr/providers";
import { LocalWalletRail } from "@intendr/wallet";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/**
 * Scaffold MCP handler: `GET /mcp` lists tools, `POST /mcp` dispatches one tool
 * (`{ "tool": "pay_and_run", "input": { ... } }`) — enough for local testing / MCP Inspector.
 *
 * NEXT: replace with Cloudflare's `McpAgent` (from `agents/mcp`) so a Durable Object owns
 * per-session MCP state and speaks Streamable HTTP / SSE natively. `buildTools()` stays as-is.
 */
export async function handleMcp(request: Request, _env: unknown): Promise<Response> {
  const tools = buildTools(buildDemoDeps());

  if (request.method === "GET") {
    return json({ tools: tools.map((t) => t.spec) });
  }

  const body = (await request.json().catch(() => ({}))) as { tool?: string; input?: Record<string, unknown> };
  const tool = tools.find((t) => t.spec.name === body.tool);
  if (!tool) return json({ error: `unknown tool: ${body.tool ?? "(none)"}` }, 404);

  try {
    return json({ result: await tool.handler(body.input ?? {}) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** In-memory demo wiring. Real deps come from the WalletDO + D1 + the selected rail. */
function buildDemoDeps(): McpDeps {
  const registry = new ProviderRegistry()
    .register(new OrthogonalProvider())
    .register(new DoorDashProvider())
    .register(new UberProvider());

  const rail = new LocalWalletRail();
  const budget = createBudgetPolicy({
    store: rail,
    settings: { sessionCapCents: 5000, monthlyCapCents: 100000, perCallWarnCents: 100 },
  });

  return {
    workspaceId: "demo" as WorkspaceId,
    registry,
    budget,
    rail,
    guardrails: { globalCapCents: 4500, categoryCapsCents: { doordash: 3000 }, merchantAllowlist: [] },
    state: { spentCents: 0, spentByCategoryCents: {} },
  };
}
