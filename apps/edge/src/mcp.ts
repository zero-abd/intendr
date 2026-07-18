import { createBudgetPolicy } from "@intendr/budget";
import type { FetchLike, WorkspaceId } from "@intendr/contracts";
import { buildTools, type McpDeps } from "@intendr/mcp";
import { DoorDashProvider, OrthogonalProvider, ProviderRegistry, UberProvider } from "@intendr/providers";
import { LocalWalletRail } from "@intendr/wallet";

interface McpEnv {
  ORTHOGONAL_API_KEY?: string;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/**
 * Scaffold MCP handler for the Worker: `GET /mcp` lists tools, `POST /mcp` dispatches one
 * tool (`{ "tool": "pay_and_run", "input": { "id": "...", "input": { "body": {...} } } }`).
 * Wired to the REAL OrthogonalProvider via the Worker's platform fetch + env key.
 *
 * NEXT: replace with Cloudflare's `McpAgent` (from `agents/mcp`) so a Durable Object owns
 * per-session wallet state and speaks Streamable HTTP / SSE. For a fully spec-compliant
 * stdio connector today, use `apps/mcp`.
 */
export async function handleMcp(request: Request, env: McpEnv): Promise<Response> {
  const tools = buildTools(buildDeps(env));

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

function buildDeps(env: McpEnv): McpDeps {
  const registry = new ProviderRegistry()
    .register(new OrthogonalProvider({ apiKey: env.ORTHOGONAL_API_KEY ?? "", fetch: fetch as unknown as FetchLike }))
    .register(new UberProvider())
    .register(new DoorDashProvider());

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
    guardrails: { globalCapCents: 4500, categoryCapsCents: {}, merchantAllowlist: [] },
    state: { spentCents: 0, spentByCategoryCents: {} },
  };
}
