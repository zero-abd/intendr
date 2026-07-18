/**
 * MCP smoke test for a representative sample of @striderlabs/* servers.
 *
 * SAFE BY DESIGN: for each server we only
 *   1. spawn the server process over stdio,
 *   2. run the MCP `initialize` handshake,
 *   3. call `tools/list` (and `resources/list` if advertised).
 * We never *call* a tool, so no browser is driven, no account is touched,
 * and no real-world order/booking is ever placed.
 *
 * A server "PASSES" if it completes the handshake and returns a tool list.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const require = createRequire(import.meta.url);

const PACKAGES = [
  "@striderlabs/mcp-doordash",
  "@striderlabs/mcp-airbnb",
  "@striderlabs/mcp-spotify",
  "@striderlabs/mcp-gmail",
  "@striderlabs/mcp-amazon",
  "@striderlabs/mcp-uber",
  "@striderlabs/mcp-yelp",
  "@striderlabs/mcp-googlemaps",
  "@striderlabs/mcp-opentable",
];

const CONNECT_TIMEOUT_MS = 30_000;

/** Resolve the executable entry (bin or main) for an installed package. */
function resolveEntry(pkgName) {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const pkgDir = dirname(pkgJsonPath);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  let rel;
  if (typeof pkg.bin === "string") rel = pkg.bin;
  else if (pkg.bin && typeof pkg.bin === "object") rel = Object.values(pkg.bin)[0];
  else rel = pkg.main || "index.js";
  return { entry: join(pkgDir, rel), version: pkg.version };
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function testServer(pkgName) {
  const started = Date.now();
  let version = "?";
  let transport;
  const client = new Client(
    { name: "striderlabs-smoke-test", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    const { entry, version: v } = resolveEntry(pkgName);
    version = v;

    transport = new StdioClientTransport({
      command: process.execPath, // node
      args: [entry],
      // Headless hints in case a tool path is eagerly touched; harmless otherwise.
      env: { ...process.env, CI: "true", MCP_SMOKE_TEST: "1" },
      stderr: "pipe",
    });

    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `${pkgName} connect`);

    const serverInfo = client.getServerVersion();
    const caps = client.getServerCapabilities() ?? {};

    const toolsRes = await withTimeout(
      client.listTools(),
      CONNECT_TIMEOUT_MS,
      `${pkgName} tools/list`
    );
    const tools = toolsRes.tools ?? [];

    let resources = [];
    if (caps.resources) {
      try {
        const r = await withTimeout(client.listResources(), 10_000, `${pkgName} resources/list`);
        resources = r.resources ?? [];
      } catch {
        /* resources are optional; ignore */
      }
    }

    return {
      pkg: pkgName,
      version,
      status: "PASS",
      serverName: serverInfo?.name ?? "?",
      serverVersion: serverInfo?.version ?? "?",
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      resourceCount: resources.length,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      pkg: pkgName,
      version,
      status: "FAIL",
      error: err?.message ?? String(err),
      ms: Date.now() - started,
    };
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    try {
      await transport?.close();
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  console.log(`\n🔬 @striderlabs MCP smoke test — ${PACKAGES.length} servers`);
  console.log("   (initialize + tools/list only — no tools invoked, no accounts touched)\n");

  const results = [];
  for (const pkg of PACKAGES) {
    process.stdout.write(`  → ${pkg} ... `);
    const r = await testServer(pkg);
    results.push(r);
    if (r.status === "PASS") {
      console.log(`✅ ${r.toolCount} tools (${r.ms}ms)`);
    } else {
      console.log(`❌ ${r.error} (${r.ms}ms)`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));
  for (const r of results) {
    const tag = r.status === "PASS" ? "✅ PASS" : "❌ FAIL";
    console.log(`\n${tag}  ${r.pkg}@${r.version}`);
    if (r.status === "PASS") {
      console.log(`   server:    ${r.serverName}@${r.serverVersion}`);
      console.log(`   tools (${r.toolCount}): ${r.toolNames.join(", ") || "(none)"}`);
      if (r.resourceCount) console.log(`   resources: ${r.resourceCount}`);
    } else {
      console.log(`   error:     ${r.error}`);
    }
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  console.log("\n" + "=".repeat(72));
  console.log(`RESULT: ${passed}/${results.length} servers passed the MCP smoke test`);
  console.log("=".repeat(72) + "\n");

  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("Harness crashed:", e);
  process.exit(2);
});
