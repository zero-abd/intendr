import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleMcp } from "./mcp";
import { WalletDO } from "./wallet-do";

export interface Env {
  WALLET_DO: DurableObjectNamespace;
  ORTHOGONAL_API_KEY?: string;
}

const ALLOWED_ORIGINS = new Set(["https://app.intendr.app", "https://intendr.app"]);

const app = new Hono<{ Bindings: Env }>();

// Frontends live on Vercel, so the Worker must allow their origins (+ preview URLs).
app.use(
  "*",
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.has(origin) || origin.endsWith(".vercel.app") ? origin : null),
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, service: "intendr-edge" }));

// MCP endpoint. Scaffold JSON handler for now; wire Cloudflare McpAgent next (see ./mcp.ts).
app.all("/mcp", (c) => handleMcp(c.req.raw, c.env));

export default app;
export { WalletDO };
