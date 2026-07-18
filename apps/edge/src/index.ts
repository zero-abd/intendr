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

// Permissive CORS for the device-code endpoints. The login page posts same-origin, but keep this
// open so the flow works regardless of where the branded page is hosted.
const DEVICE_CODE_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
} as const;

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

// Browser login page for the npx connector (device-code flow, ?code=<code>). Supabase auth, client-side.
app.get("/login", (c) => {
  const html = loginPage(c.env.SUPABASE_URL ?? "", c.env.SUPABASE_ANON_KEY ?? "", c.req.query("code") ?? "");
  // Never let Cloudflare cache the login page (each request carries a one-shot device code).
  return c.html(html, 200, { "Cache-Control": "no-store" });
});

// Device-code completion: the login page (same origin) posts the fresh session here keyed by the code.
app.options("/auth/complete", (c) => c.body(null, 204, DEVICE_CODE_CORS));
app.post("/auth/complete", async (c) => {
  const { code, access_token, refresh_token, expires_in } = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!code || !access_token || !c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_KEY)
    return c.json({ error: "bad request" }, 400, DEVICE_CODE_CORS);
  const session = { access_token, refresh_token: refresh_token ?? "", expires_in: expires_in ?? 3600 };
  const res = await fetch(`${c.env.SUPABASE_URL}/rest/v1/auth_codes`, {
    method: "POST",
    headers: {
      apikey: c.env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${c.env.SUPABASE_SERVICE_KEY}`,
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ code, session }),
  });
  if (!res.ok) return c.json({ error: "store failed", detail: (await res.text()).slice(0, 200) }, 502, DEVICE_CODE_CORS);
  return c.json({ ok: true }, 200, DEVICE_CODE_CORS);
});

// Device-code poll: the connector polls this until the session shows up, then consumes it (single-use).
app.options("/auth/poll", (c) => c.body(null, 204, DEVICE_CODE_CORS));
app.get("/auth/poll", async (c) => {
  const code = c.req.query("code");
  if (!code || !c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_KEY) return c.json({ error: "bad request" }, 400, DEVICE_CODE_CORS);
  const headers = { apikey: c.env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${c.env.SUPABASE_SERVICE_KEY}` };
  const res = await fetch(`${c.env.SUPABASE_URL}/rest/v1/auth_codes?code=eq.${encodeURIComponent(code)}&select=session`, { headers });
  if (!res.ok) return c.json({ error: "lookup failed" }, 502, DEVICE_CODE_CORS);
  const rows = (await res.json().catch(() => [])) as { session?: unknown }[];
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row?.session) return c.json({ status: "pending" }, 200, DEVICE_CODE_CORS);
  // Single-use: delete before returning so a code can never be redeemed twice.
  await fetch(`${c.env.SUPABASE_URL}/rest/v1/auth_codes?code=eq.${encodeURIComponent(code)}`, { method: "DELETE", headers });
  return c.json({ status: "complete", session: row.session }, 200, DEVICE_CODE_CORS);
});

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
