#!/usr/bin/env node
// intendr — MCP connector (stdio). Thin proxy to the hosted intendr service, which holds the
// Orthogonal key server-side and gives each signed-in user their own spend-capped wallet.
//
// On first run it opens a browser to sign in / sign up (Supabase); the token is cached at
// ~/.intendr/auth.json and refreshed silently. Add it with:  claude mcp add intendr -- npx -y intendr
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { exec } from "node:child_process";

const BASE = (process.env.INTENDR_URL ?? "https://intendr-edge.almahmud-zero.workers.dev").replace(/\/+$/, "");
const AUTH_DIR = join(homedir(), ".intendr");
const AUTH_PATH = join(AUTH_DIR, "auth.json");
const log = (...a) => console.error("[intendr]", ...a);

async function readAuth() {
  try {
    return JSON.parse(await readFile(AUTH_PATH, "utf8"));
  } catch {
    return null;
  }
}
async function writeAuth(a) {
  await mkdir(AUTH_DIR, { recursive: true });
  await writeFile(AUTH_PATH, JSON.stringify(a, null, 2));
}
function openBrowser(url) {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGIN_POLL_MS = 2000;
const LOGIN_TIMEOUT_MS = 300000;

// Device-code login (no localhost): open the branded page with a one-shot code, then poll the
// Worker until the browser hands the session back. Nothing listens on a local port.
async function browserLogin() {
  const code = randomUUID();
  const url = `${BASE}/login?code=${encodeURIComponent(code)}`;
  log("Sign in to connect your wallet:", url);
  openBrowser(url);

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(LOGIN_POLL_MS);
    try {
      const res = await fetch(`${BASE}/auth/poll?code=${encodeURIComponent(code)}`, {
        headers: { "user-agent": "intendr-connector/0.3" },
      });
      if (!res.ok) continue;
      const d = await res.json();
      if (d.status === "complete" && d.session?.access_token) {
        const s = d.session;
        return {
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: Date.now() + (Number(s.expires_in) || 3600) * 1000,
        };
      }
    } catch {
      /* transient network error — keep polling */
    }
  }
  throw new Error("login timed out — run again and complete sign-in in the browser");
}

async function refresh(auth) {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  });
  if (!res.ok) throw new Error("refresh failed");
  const d = await res.json();
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000 };
}

let cached = null;
async function ensureToken(force = false) {
  if (!force && cached && cached.expires_at > Date.now() + 60_000) return cached.access_token;
  let auth = cached ?? (await readAuth());
  if (auth && !force && auth.expires_at > Date.now() + 60_000) {
    cached = auth;
    return auth.access_token;
  }
  if (auth?.refresh_token) {
    try {
      auth = await refresh(auth);
      cached = auth;
      await writeAuth(auth);
      return auth.access_token;
    } catch {
      /* fall through to browser login */
    }
  }
  auth = await browserLogin();
  cached = auth;
  await writeAuth(auth);
  log("signed in.");
  return auth.access_token;
}

async function callRemote(tool, input, retry = true) {
  const token = await ensureToken();
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": "intendr-connector/0.3" },
    body: JSON.stringify({ tool, input }),
  });
  if (res.status === 401 && retry) {
    await ensureToken(true);
    return callRemote(tool, input, false);
  }
  if (!res.ok) return { content: [{ type: "text", text: `intendr: upstream HTTP ${res.status}` }], isError: true };
  const data = await res.json();
  return data.result ?? { content: [{ type: "text", text: JSON.stringify(data) }] };
}

// Sign in up front so the wallet is ready before the first tool call.
await ensureToken().catch((e) => log("auth error:", e?.message ?? e));

const server = new McpServer({ name: "intendr", version: "0.3.0" });

server.tool("get_wallet", "Your wallet balance and remaining budget.", {}, () => callRemote("get_wallet", {}));
server.tool(
  "search_services",
  "Search the Orthogonal catalog (plus commerce providers Uber/DoorDash) for paid capabilities by natural language. Returns capability ids for get_service / pay_and_run.",
  { query: z.string().describe("what you want to do, e.g. 'enrich a company by domain'") },
  ({ query }) => callRemote("search_services", { query }),
);
server.tool(
  "get_service",
  "Price (priceCents), side-effect class, and input schema (query/body/path params) for one capability id.",
  { id: z.string().describe("capability id from search_services") },
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
server.tool("get_spend_summary", "Balance remaining and spend so far.", {}, () => callRemote("get_spend_summary", {}));
server.tool(
  "approve",
  "Acknowledge a gated payment: approve | raise_cap | skip. (Top up balance from the intendr dashboard.)",
  { decision: z.enum(["approve", "raise_cap", "skip"]), newCapCents: z.number().optional() },
  (args) => callRemote("approve", args),
);

await server.connect(new StdioServerTransport());
log(`connector ready -> ${BASE}`);
