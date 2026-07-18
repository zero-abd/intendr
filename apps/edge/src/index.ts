import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleMcp } from "./mcp";
import { WalletDO } from "./wallet-do";

export interface Env {
  ORTHOGONAL_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
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

// MCP endpoint: real stateless Streamable-HTTP JSON-RPC (POST) + a simple {tool,input} REST shim.
app.all("/mcp", (c) => handleMcp(c.req.raw, c.env));

export default app;
export { WalletDO };
