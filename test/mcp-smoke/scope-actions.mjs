/**
 * Scope which @striderlabs action-capable servers can actually REACH their
 * target site (precondition for any tangible book/order action).
 *
 * SAFE: calls only READ-ONLY search/estimate tools. Never books, orders, or
 * checks out. No login performed. Classifies each server as:
 *   WORKS   - returned real listings  → tangible actions feasible once logged in
 *   BLOCKED - Access Denied / captcha / empty success → dead like OpenTable
 *   LOGIN   - tool itself requires authentication before it will return data
 *   ERROR   - crashed / timed out launching
 *
 * Browsers were patched to channel:"chrome" (system Chrome) via patch-browsers.mjs.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const require = createRequire(import.meta.url);

// Each: which read-only tool to probe + args. `arrayKeys` = where listings live.
const TARGETS = [
  { pkg: "@striderlabs/mcp-yelp",       tool: "yelp_search_restaurants", args: { location: "San Francisco", query: "sushi" }, arrayKeys: ["restaurants", "businesses", "results"] },
  { pkg: "@striderlabs/mcp-googlemaps", tool: "search_places",           args: { query: "coffee shops", location: "San Francisco" }, arrayKeys: ["places", "results"] },
  { pkg: "@striderlabs/mcp-airbnb",     tool: "airbnb_search",           args: { location: "Miami Beach" }, arrayKeys: ["listings", "results"] },
  { pkg: "@striderlabs/mcp-amazon",     tool: "amazon_search",           args: { query: "wireless headphones" }, arrayKeys: ["products", "results"] },
  { pkg: "@striderlabs/mcp-doordash",   tool: "doordash_search",         args: { query: "pizza" }, arrayKeys: ["restaurants", "stores", "results"] },
  { pkg: "@striderlabs/mcp-uber",       tool: "get_fare_estimate",       args: { pickup: "San Francisco Airport", destination: "Union Square, San Francisco" }, arrayKeys: ["estimates", "rideOptions", "results"] },
];

const CALL_TIMEOUT_MS = 90_000;

function resolveEntry(pkgName) {
  const pj = require.resolve(`${pkgName}/package.json`);
  const pkg = JSON.parse(readFileSync(pj, "utf8"));
  const rel = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin)[0];
  return join(dirname(pj), rel);
}
function textOf(r) { return (r?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n"); }
function withTimeout(p, ms, label) {
  let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out ${ms}ms`)), ms); });
  return Promise.race([p, to]).finally(() => clearTimeout(t));
}

function classify(raw, arrayKeys) {
  const lc = raw.toLowerCase();
  if (/access denied|don't have permission|unusual traffic|captcha|are you a robot|verify you are human|px-captcha|edgesuite/.test(lc))
    return { verdict: "BLOCKED", detail: "anti-bot wall (Access Denied / captcha)" };
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (parsed) {
    const loginish = /log ?in|not authenticated|sign in|session expired|please authenticate/.test(lc);
    for (const k of arrayKeys) {
      const arr = parsed[k] ?? parsed.result?.[k];
      if (Array.isArray(arr)) {
        if (arr.length > 0) return { verdict: "WORKS", detail: `${arr.length} results`, sample: arr.slice(0, 4) };
        // empty array + success:true is the OpenTable silent-block signature
        return { verdict: loginish ? "LOGIN" : "BLOCKED", detail: loginish ? "empty + login hint" : "success:true but 0 results (silent block/stale selectors)" };
      }
    }
    if (loginish || parsed.isLoggedIn === false) return { verdict: "LOGIN", detail: "requires authentication" };
    if (parsed.success === false) return { verdict: "ERROR", detail: parsed.error || "success:false" };
  }
  if (/log ?in|sign in|not authenticated|session expired/.test(lc)) return { verdict: "LOGIN", detail: "requires authentication" };
  return { verdict: "ERROR", detail: raw.slice(0, 160).replace(/\s+/g, " ") };
}

async function probe(t) {
  const started = Date.now();
  const client = new Client({ name: "scope-actions", version: "0.1.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolveEntry(t.pkg)], env: { ...process.env }, stderr: "pipe" });
  try {
    await withTimeout(client.connect(transport), 30_000, `${t.pkg} connect`);
    const res = await withTimeout(client.callTool({ name: t.tool, arguments: t.args }), CALL_TIMEOUT_MS, `${t.pkg} ${t.tool}`);
    const raw = textOf(res);
    const c = classify(raw, t.arrayKeys);
    return { pkg: t.pkg, tool: t.tool, ...c, ms: Date.now() - started };
  } catch (e) {
    return { pkg: t.pkg, tool: t.tool, verdict: "ERROR", detail: e?.message ?? String(e), ms: Date.now() - started };
  } finally {
    try { await client.close(); } catch {}
    try { await transport.close(); } catch {}
  }
}

const ICON = { WORKS: "✅", BLOCKED: "🚫", LOGIN: "🔒", ERROR: "❌" };

console.log(`\n🎯 Scoping tangible-action reachability — ${TARGETS.length} servers`);
console.log("   (read-only search/estimate only; no login, no orders)\n");
const results = [];
for (const t of TARGETS) {
  process.stdout.write(`  → ${t.pkg.padEnd(30)} ${t.tool} ... `);
  const r = await probe(t);
  results.push(r);
  console.log(`${ICON[r.verdict]} ${r.verdict} — ${r.detail} (${(r.ms/1000).toFixed(1)}s)`);
  if (r.sample) for (const s of r.sample) console.log(`        • ${s.name ?? s.title ?? JSON.stringify(s).slice(0,80)}`);
}

console.log("\n" + "=".repeat(72));
for (const v of ["WORKS", "LOGIN", "BLOCKED", "ERROR"]) {
  const list = results.filter(r => r.verdict === v);
  if (list.length) console.log(`${ICON[v]} ${v}: ${list.map(r => r.pkg.replace("@striderlabs/mcp-", "")).join(", ")}`);
}
console.log("=".repeat(72) + "\n");
