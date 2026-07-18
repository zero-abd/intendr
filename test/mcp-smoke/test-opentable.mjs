/**
 * Focused functional test for @striderlabs/mcp-opentable.
 *
 * SAFE: only calls READ-ONLY tools —
 *   - opentable_status   (checks auth state, no side effects)
 *   - opentable_search   (scrapes public restaurant listings from opentable.com)
 * Never calls make_reservation / cancel_reservation / login.
 *
 * NOTE: the installed server's browser.js was patched to launch system Chrome
 * (channel: "chrome") because the Playwright Chromium build could not be
 * downloaded in this environment (cdn.playwright.dev is blocked).
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const require = createRequire(import.meta.url);
const PKG = "@striderlabs/mcp-opentable";

function resolveEntry(pkgName) {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const rel = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin)[0];
  return join(dirname(pkgJsonPath), rel);
}

function textOf(result) {
  return (result.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

const client = new Client({ name: "opentable-func-test", version: "0.1.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolveEntry(PKG)],
  env: { ...process.env },
  stderr: "pipe",
});

try {
  console.log(`\n🍽️  Functional test: ${PKG}\n`);
  await client.connect(transport);
  console.log(`connected → ${JSON.stringify(client.getServerVersion())}\n`);

  console.log("① opentable_status (read-only auth check)");
  const status = await client.callTool({ name: "opentable_status", arguments: {} });
  console.log(textOf(status), "\n");

  console.log("② opentable_search { location: 'San Francisco', cuisine: 'italian', partySize: 2 }");
  console.log("   (launching headless Chrome, scraping opentable.com — ~15-30s)");
  const search = await client.callTool({
    name: "opentable_search",
    arguments: { location: "San Francisco", cuisine: "italian", partySize: 2 },
  });
  const out = textOf(search);
  // Try to pretty-print restaurant count if JSON
  try {
    const parsed = JSON.parse(out);
    const list = parsed.restaurants ?? parsed.result?.restaurants ?? [];
    console.log(`\n   → success=${parsed.success}  restaurants found: ${list.length}`);
    for (const r of list.slice(0, 8)) {
      console.log(`     • ${r.name}${r.cuisine ? ` — ${r.cuisine}` : ""}${r.rating ? ` (★${r.rating})` : ""}${r.priceRange ? ` ${r.priceRange}` : ""}`);
    }
    if (!list.length) console.log("   raw:", out.slice(0, 500));
  } catch {
    console.log("   raw output:", out.slice(0, 800));
  }
  console.log("\n✅ opentable MCP responded to live read-only calls.");
} catch (err) {
  console.error("\n❌ test failed:", err?.message ?? err);
  process.exitCode = 1;
} finally {
  try { await client.close(); } catch {}
  try { await transport.close(); } catch {}
}
