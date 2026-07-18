import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleMcp } from "./mcp";
import { loginPage } from "./login";
import { WalletDO } from "./wallet-do";

export interface Env {
  ORTHOGONAL_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  WALLET_DO: DurableObjectNamespace;
}

const ALLOWED_ORIGINS = new Set(["https://app.intendr.app", "https://intendr.app"]);

const app = new Hono<{ Bindings: Env }>();

// Browser dashboard (Vercel) origins; non-browser MCP clients send no Origin.
app.use(
  "*",
  cors({
    origin: (origin) => (!origin || ALLOWED_ORIGINS.has(origin) || origin.endsWith(".vercel.app") ? origin || "*" : "*"),
  }),
);

app.get("/", (c) => c.json({ service: "intendr-edge", mcp: "/mcp", health: "/api/health" }));
app.get("/api/health", (c) => c.json({ ok: true, service: "intendr-edge" }));

// Browser login page for the npx connector (?port= loopback). Supabase auth, client-side.
app.get("/login", (c) => c.html(loginPage(c.env.SUPABASE_URL ?? "", c.env.SUPABASE_ANON_KEY ?? "")));

// Silent token refresh proxied to Supabase (keeps the connector's service-side keys off the client).
app.post("/auth/refresh", async (c) => {
  const { refresh_token } = (await c.req.json().catch(() => ({}))) as { refresh_token?: string };
  if (!refresh_token || !c.env.SUPABASE_URL || !c.env.SUPABASE_ANON_KEY) return c.json({ error: "bad request" }, 400);
  const res = await fetch(`${c.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: c.env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
});

// MCP endpoint: real stateless Streamable-HTTP JSON-RPC (POST) + a simple {tool,input} REST shim.
app.all("/mcp", (c) => handleMcp(c.req.raw, c.env));

export default app;
export { WalletDO };
