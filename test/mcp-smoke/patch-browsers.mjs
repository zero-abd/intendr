/**
 * Patch installed @striderlabs servers to launch SYSTEM Google Chrome
 * (channel:"chrome") instead of the Playwright/patchright bundled browser,
 * which cannot be downloaded in this environment (cdn.playwright.dev blocked).
 *
 * Idempotent: only injects `channel:"chrome"` where a launch() lacks it.
 * This changes ONLY which Chrome runs — not the automation logic.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILES = [
  "node_modules/@striderlabs/mcp-doordash/dist/browser.js",
  "node_modules/@striderlabs/mcp-airbnb/dist/browser.js",
  "node_modules/@striderlabs/mcp-amazon/dist/browser.js",
  "node_modules/@striderlabs/mcp-uber/dist/browser.js",
  "node_modules/@striderlabs/mcp-yelp/dist/browser.js",
  "node_modules/@striderlabs/mcp-googlemaps/dist/index.js",
];

// Matches `.launch({` optionally followed by whitespace, capturing the brace.
const LAUNCH_RE = /\.launch\(\{/g;

for (const rel of FILES) {
  if (!existsSync(rel)) { console.log(`skip (missing): ${rel}`); continue; }
  let src = readFileSync(rel, "utf8");
  let count = 0;
  src = src.replace(LAUNCH_RE, (m) => {
    count++;
    return `.launch({ channel: "chrome", `;
  });
  // Avoid double-injection on re-run
  src = src.replace(/channel: "chrome", channel: "chrome", /g, 'channel: "chrome", ');
  writeFileSync(rel, src);
  console.log(`patched ${count} launch() call(s): ${rel}`);
}
console.log("done.");
