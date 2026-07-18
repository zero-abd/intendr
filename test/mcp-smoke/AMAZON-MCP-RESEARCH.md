# Amazon MCP Server — Implementation Research

**Purpose:** Everything an implementing agent needs to build (or rebuild) an MCP server that lets an AI agent search Amazon, manage a cart, place orders, and track shipments via browser automation.

**Basis:** Reverse-engineered from the published reference implementation `@striderlabs/mcp-amazon@0.2.0` (npm; internal `mcpName: io.github.markswendsen-code/amazon`), plus empirical findings from live testing on 2026-07-18. Section 12 records what was verified vs. assumed.

> ⚠️ **Nature of this software.** This drives a **real, logged-in Amazon account** and can spend real money. It is browser automation against amazon.com — not an official Amazon API (Amazon has no consumer purchasing API). Treat every design decision through the lens of: *bot-detection fragility*, *irreversible financial side effects*, and *no test/sandbox environment exists*.

---

## 1. Architecture Overview

```
┌─────────────┐   stdio (JSON-RPC)   ┌──────────────────┐   Playwright/patchright   ┌───────────────┐
│  MCP client │◄────────────────────►│  MCP server      │◄─────────────────────────►│  Chromium      │──► amazon.com
│ (agent/LLM) │                      │  (this project)  │                            │  (headless)    │
└─────────────┘                      └──────────────────┘                            └───────────────┘
                                             │
                                             ▼
                                   ~/.strider/amazon/
                                     cookies.json   (session persistence)
                                     session.json   (cached login state)
```

**Three-module layout (mirrors the reference; recommended):**

| Module | Responsibility |
|--------|----------------|
| `index.ts` | MCP server: tool definitions (`tools/list`), dispatch (`tools/call`), response envelopes, top-level error classification. **No Playwright code here.** |
| `browser.ts` | All browser automation: singleton browser/context/page, stealth setup, one exported async function per operation. Returns plain data. |
| `auth.ts` | Cookie + session persistence to disk. Pure filesystem, no browser. |

**Key architectural properties:**
- **Singleton browser.** One `browser`/`context`/`page` reused across all tool calls in a process. Lazily initialized on first tool call (`initBrowser()` guards on `if (browser && context && page) return`). This is why the smoke test (only `tools/list`) never launches a browser — the browser boots only when a *browser-backed tool* is called.
- **Stdio transport.** The server talks JSON-RPC over stdio. **All logging must go to `stderr`** (`console.error`) — anything on stdout corrupts the protocol.
- **Stateless tools, stateful browser.** Each tool navigates fresh (`page.goto`), scrapes, persists cookies, returns. State lives in the browser session + disk cookies, not in server memory.

---

## 2. Dependencies & Runtime

```jsonc
// package.json essentials
{
  "type": "module",              // ESM throughout
  "bin": { "striderlabs-mcp-amazon": "dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/server": "…",  // OR "@modelcontextprotocol/sdk" (see note)
    "patchright": "^1.58.2",              // stealth Playwright fork — NOT plain playwright
    "@cfworker/json-schema": "^4.1.1"     // schema validation (optional)
  }
}
```

- **Node.js ≥ 20**, ESM (`"type": "module"`). Shebang `#!/usr/bin/env node` on `index.js` + `chmod +x`.
- **MCP SDK note:** the reference imports `{ Server, StdioServerTransport } from "@modelcontextprotocol/server"` (a 2.0-alpha package). The mainstream, better-documented choice is **`@modelcontextprotocol/sdk`** (`.../server/index.js` + `.../server/stdio.js`). Prefer the official `sdk` unless you have a reason not to; the tool contracts below are identical either way.
- **`patchright`, not `playwright`.** patchright is a drop-in Playwright fork with runtime-level stealth patches (masks `navigator.webdriver`, closed shadow-root leaks, `Runtime.enable` CDP leak, etc.). Its stealth is strongest with **its own bundled Chromium, run headful, in a persistent context.** Importing plain `playwright` throws away the entire point (this was the one real bug found in the sibling `mcp-opentable` package — it imported `playwright` and got hard-blocked).
- **Browser binary:** `npx patchright install chromium` (or `playwright install chromium`) downloads it to `~/Library/Caches/ms-playwright` (macOS). If that download host is unreachable, fall back to system Chrome via `channel: "chrome"` in `launch()` — but note this **disables patchright's deepest patches** (they require its patched driver), so stealth is weaker.

---

## 3. Authentication & Session Model

**There is no API key and no programmatic login.** Login is **interactive and human-driven**; the agent cannot type the password or clear 2FA/CAPTCHA. The model:

1. `amazon_login` navigates to `https://www.amazon.com/ap/signin` and returns a URL + instructions. **The human signs in themselves** (ideally in a visible/headful browser the first time).
2. On success, Amazon sets auth cookies in the browser context.
3. Every operation calls `saveCookies(context)` at the end → writes **all** context cookies to `~/.strider/amazon/cookies.json`.
4. On next `initBrowser()`, `loadCookies(context)` reads that file, **filters out expired cookies** (`!c.expires || c.expires > now`), and `context.addCookies(validCookies)`.
5. `amazon_status` navigates to the homepage and infers login state from the account nav element.

**Persistence files (`~/.strider/amazon/`):**
- `cookies.json` — array of Playwright cookie objects (the actual session).
- `session.json` — cached `{ isLoggedIn, userName, isPrime, lastUpdated, defaultAddress }` for cheap status reads.

**Login-state detection (`checkLoginStatus`)** — scrape the top-right account nav:
```
selector: "#nav-link-accountList-nav-line-1, #nav-item-signout, [data-nav-role='signin'] span.nav-line-1"
loggedIn  = text exists AND does not contain "sign in" / "hello, sign in"
userName  = /Hello,\s+(.+)/i capture
isPrime   = presence of "#nav-prime-btn, .nav-prime-badge, [data-nav-role='prime']"
address   = "#nav-global-location-popover-link, [data-nav-role='location']" text
```

**⚠️ Critical limitation — session portability.** The reference stores its own cookie jar in an **isolated Playwright context**. It does **not** reuse your everyday Chrome profile. So "I'm already logged into Amazon in my normal Chrome" does **not** carry over — you must log in *through the server's browser* once. If you want to leverage an existing logged-in profile, use `chromium.launchPersistentContext(userDataDir, …)` pointed at a real Chrome profile dir instead of `launch()` + `newContext()` (bigger change; higher bot-detection risk if the profile is also in active human use).

---

## 4. Browser & Stealth Configuration

```js
browser = await chromium.launch({
  // channel: "chrome",   // ONLY as fallback when bundled Chromium unavailable
  headless: true,          // headful is materially more block-resistant; see §8
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--window-size=1366,768",
  ],
});

context = await browser.newContext({
  userAgent: <random from a small pool>,     // rotate per session
  viewport: { width: 1366, height: 768 },
  screen:   { width: 1366, height: 768 },
  locale: "en-US", timezoneId: "America/New_York", colorScheme: "light",
  deviceScaleFactor: 1, hasTouch: false, javaScriptEnabled: true,
  extraHTTPHeaders: {
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept": "text/html,application/xhtml+xml,…",
  },
});
```

**`page.addInitScript` stealth patches (applied before every page load):**
- `navigator.webdriver` → `false`
- `navigator.plugins` → fake 3-plugin array (Chrome PDF Plugin/Viewer, Native Client)
- `navigator.languages` → `["en-US","en"]`
- `navigator.hardwareConcurrency` → `8`
- `navigator.permissions.query` → return `denied` for `notifications`
- `window.chrome.runtime` → `{}`

**Human-like pacing:** every operation sprinkles `randomDelay(min,max)` (setTimeout of 300–3000ms depending on step) between navigation, clicks, and scrapes. Keep this — it measurably reduces blocks.

> Note: several of these init-script patches duplicate what patchright already does natively. They're harmless belt-and-suspenders. The single most important lever is **headful + patchright's own Chromium** (§8), not these JS shims.

---

## 5. Tool Catalog (the MCP contract)

14 tools. All return `{ content: [{ type: "text", text: JSON.stringify(payload) }] }`. Payloads always include `success: boolean`. Errors set `isError: true` and add a `suggestion` string (see §7).

| Tool | Required args | Optional args | Reads/Writes | Purpose |
|------|--------------|---------------|--------------|---------|
| `amazon_status` | — | — | read | Live login check + cached session info |
| `amazon_login` | — | — | read | Returns signin URL + manual instructions |
| `amazon_logout` | — | — | **write (deletes cookies)** | Clears `cookies.json` + `session.json`, closes browser |
| `amazon_search` | `query` | `maxResults` (def 10, cap 50) | read | Search results w/ ASIN, price, rating, Prime |
| `amazon_get_product` | `asinOrUrl` | — | read | Full product detail by ASIN or URL |
| `amazon_add_to_cart` | `asinOrQuery` | `quantity` (def 1) | **write (cart)** | Add ASIN / URL / top search hit to cart |
| `amazon_view_cart` | — | — | read | Cart items, quantities, subtotal, tax |
| `amazon_clear_cart` | — | — | **write (cart)** | Remove all cart items (loop) |
| `amazon_preview_order` | — | — | read | Dry-run checkout: address, delivery, payment, blockers |
| `amazon_place_order` | — | `confirm` (bool, def false) | **⚠️ SPENDS MONEY** | Place order — only when `confirm===true` |
| `amazon_track_order` | `orderId` | — | read | Shipment status/tracking for one order |
| `amazon_get_orders` | — | `maxOrders` (def 10, cap 50) | read | Recent order history |
| `amazon_prime_check` | — | — | read | Prime membership status/benefits |
| `amazon_set_address` | `address` | — | **write (account)** | Set/add delivery address |

### 5.1 Exact input schemas (JSON Schema)

```jsonc
amazon_search:       { query: string!, maxResults?: number }        // required: ["query"]
amazon_get_product:  { asinOrUrl: string! }                         // required: ["asinOrUrl"]
amazon_add_to_cart:  { asinOrQuery: string!, quantity?: number }    // required: ["asinOrQuery"]
amazon_place_order:  { confirm?: boolean }                          // NO required — defaults to preview
amazon_track_order:  { orderId: string! }                          // format 123-1234567-1234567
amazon_get_orders:   { maxOrders?: number }
amazon_set_address:  { address: string! }                          // full address or ZIP
// status/login/logout/view_cart/clear_cart/preview_order/prime_check: {} (no properties)
```

### 5.2 Representative return shapes

```jsonc
// amazon_search → products[]
{ name, asin, price:"$12.49", originalPrice?, rating:"4.5 stars", reviewCount?,
  imageUrl?, url:"https://www.amazon.com/dp/…", isPrime:bool, inStock:bool, badge? }

// amazon_view_cart
{ items:[{ name, asin?, quantity, price, seller? }], subtotal:"$12.49", estimatedTax?, itemCount }

// amazon_preview_order
{ canPlace:bool, cart:{…}, deliveryAddress?, deliveryEstimate?, paymentMethod?, issues?:string[] }

// amazon_place_order (confirm=true, success)
{ orderPlaced:true, orderId:"123-1234567-1234567", total, estimatedDelivery, message }

// amazon_status
{ session:{ isLoggedIn, userName?, isPrime, defaultAddress?, lastUpdated }, savedSession, configDir, message }
```

---

## 6. Per-Operation Flow & Selectors

All flows share the preamble: `initBrowser()` → `page.goto(url, {waitUntil:"domcontentloaded", timeout:30000})` → `randomDelay()` → `checkForCaptcha()` → scrape → `saveCookies()`. URLs are relative to `https://www.amazon.com`.

| Operation | Navigates to | Key selectors / logic |
|-----------|-------------|----------------------|
| **search** | `/s?k={encodeURIComponent(query)}` | Wait `[data-component-type="s-search-result"], .s-result-item[data-asin]`. Iterate `[data-component-type="s-search-result"][data-asin]:not([data-asin=""])`. Price: `.a-price-whole` + `.a-price-fraction`, fallback `.a-offscreen`. Rating: `.a-icon-alt`. Prime: `.a-icon-prime`. |
| **get_product** | `/dp/{ASIN}` or the URL | Title `#productTitle,#title`. Price `.a-price .a-offscreen,#priceblock_*`. Features `#feature-bullets li span.a-list-item`. Seller `#sellerProfileTriggerId,#merchant-info a`. Delivery `#mir-layout-DELIVERY_BLOCK .a-text-bold`. |
| **add_to_cart** | `/dp/{ASIN}` (searches first if given a free-text query) | Qty: `select#quantity`. Add btn: `#add-to-cart-button, input[name='submit.add-to-cart'], button[name='submit.add-to-cart']`. **Dismiss warranty/upsell modal:** `#attachSiNoCoverage, #siNoCoverage, [data-action='siNoCoverage'], #attachDisplayAddAccessories-skip-btn`. Cart count: `#nav-cart-count`. Success: `#NATC_SMART_WAGON_CONF_MSG_SUCCESS, #huc-v2-order-row-confirm-text, .a-alert-success`. |
| **view_cart** | `/cart` | Empty: `.sc-empty-cart` / title contains "empty". Items: `.sc-list-item[data-asin]`. Subtotal: `#sc-subtotal-amount-activecart .sc-price`. |
| **clear_cart** | `/cart` | Loop-click `input[value='Delete'], [data-action='delete'], .sc-action-delete input` until none found (hard cap 100). |
| **preview_order** | `/gp/buy/spc/handlers/display.html` | Blockers: CAPTCHA; sign-in prompt `#ap_email,#signInSubmit`. Scrape address `#address-book-entry-0,.displayAddressDiv`; delivery `.delivery-date-display`; payment `.pmts-instrument-name-use`. `canPlace = issues.length===0`. |
| **place_order** | `/gp/buy/spc/handlers/display.html` | **Place btn:** `#submitOrderButtonId input, #placeYourOrder input, input[name='placeYourOrder1'], #place-order-button`. After click, `waitForURL(/\/gp\/buy\/thankyou\/|\/order\//i)`. Extract orderId via `\b\d{3}-\d{7}-\d{7}\b` regex fallback. |
| **track_order** | `/gp/your-account/order-details?orderID={id}` | Status `.order-status-widget .a-alert-heading`; tracking `.carrier-tracking-number,[data-tracking-id]`. |
| **get_orders** | `/gp/your-account/order-history` | Sign-in guard `#ap_email,#signInSubmit`. Cards `.order,[class*='order-card']`. |
| **prime_check** | `/gp/primecentral` | `isPrime` if prime heading present / title contains "prime". |
| **set_address** | `/gp/ship-to/handlers/display.html` | Input `#address-ui-widgets-enterAddressLine1`; autocomplete `.pac-item,[role='option']`; submit `#address-ui-widgets-form-submit-btn`. |

> **Selectors are the #1 maintenance burden.** Amazon A/B-tests and rotates DOM constantly, ships different markup by locale/account/experiment, and heavily uses sponsored-result injection. Every selector list above is multi-fallback for that reason. Expect to re-verify them; treat any single-selector assumption as a latent bug.

---

## 7. Error Handling & Bot-Detection

**CAPTCHA detection (`checkForCaptcha`)** runs after every navigation. Returns true if any of:
`form[action*="validateCaptcha"]`, `#captchacharacters`, `input[id="captchacharacters"]`, `.a-box-inner:has(img[src*="captcha"])`, or URL contains `captcha`/`validateCaptcha`. On hit → throw a descriptive error telling the human to solve it at amazon.com.

**Top-level error classifier (`index.ts` catch block)** inspects the message and attaches a `suggestion`:
- contains "captcha" → "Amazon has detected automation. Visit amazon.com, complete the CAPTCHA, then retry."
- contains "login"/"auth"/"sign in" → "Use amazon_login to authenticate first."
- contains "timeout" → "Page load timed out. Check connection and retry."

**Design principle:** browser functions **throw** on failure; `index.ts` catches, serializes `{success:false, error, suggestion, isError:true}`. Never let an exception escape the dispatch handler (it would break the stdio stream).

---

## 8. Bot-Detection: What Actually Works (empirical)

From live testing 2026-07-18 across this package family:

- ✅ **Amazon search reached the site and returned 10 real products** with `patchright` + system Chrome, headless. Amazon's storefront (`/s`, `/dp`) is comparatively tolerant of automation.
- 🚫 **Sibling `mcp-yelp` and `mcp-opentable` were hard-blocked** ("Access Denied" / Akamai edge, or silent empty results). OpenTable's failure was self-inflicted: it imported plain `playwright` instead of `patchright`.
- **Ranking of stealth levers, most → least impactful:**
  1. Use **patchright's bundled Chromium** (not `channel:"chrome"`, not plain playwright).
  2. Run **headful** (`headless:false`) — the single biggest signal Amazon keys on for checkout/account pages.
  3. **Persistent context** with a warmed profile (real cookies, history).
  4. Human-like delays + UA/viewport realism (already present).
  5. The `addInitScript` shims (marginal on top of patchright).
- **The account nav / checkout / order-history pages are stricter than storefront search.** Expect more CAPTCHAs there. A logged-in session cookie lowers (not eliminates) the wall.
- **No sandbox exists.** You cannot test order placement without risking a real purchase. Build the confirm-gate (§9) as a hard invariant, not a nicety.

---

## 9. Safety Model — MUST implement

Purchasing is **irreversible and spends real money**. The reference bakes in a confirm-gate; keep and strengthen it.

1. **`amazon_place_order` is preview-by-default.** With `confirm` falsy it returns `{requiresConfirmation:true, preview}` and **does not click Place Order.** Only `confirm===true` proceeds. The tool description explicitly says *"NEVER set to true without explicit user confirmation."*
2. **Two-step protocol for agents:** `amazon_preview_order` (or `place_order` w/o confirm) → surface total + address + payment to the human → obtain explicit yes → `place_order {confirm:true}`.
3. **Never enroll in Prime / accept upsells.** Live checkout shows a Prime free-trial interstitial (recurring $14.99/mo). The automation must click **"No thanks"** / skip, never "Try Prime". Same for warranty/accessory upsell modals (already dismissed in add_to_cart).
4. **Payment is inherited, never entered.** The server never sees, selects, or types card details — checkout uses whatever **default payment method + address** the account already has. Document this loudly; the agent cannot choose a card. (Verified live: checkout auto-populated the account's default Visa and address with zero input.)
5. **Report, don't fabricate.** If confirmation (order id via `\d{3}-\d{7}-\d{7}` or a thankyou URL) can't be verified after clicking, return `success:false` "could not confirm" — never invent an order id. (This is a real bug pattern; the sibling opentable package explicitly removed a `Date.now()` fake-id for exactly this reason.)
6. **CAPTCHA/loginrequired = stop and ask the human.** Never attempt to solve or bypass bot-detection.

---

## 10. Known Weaknesses in the Reference (fix these)

| # | Weakness | Impact | Fix |
|---|----------|--------|-----|
| 1 | **Silent-success on empty scrapes.** search/cart can return `success:true` with `[]` when actually blocked or when selectors broke. | Agent can't tell "nothing found" from "blocked/broken". | Distinguish: if the results *container* is present but empty → genuine; if container missing / block markers present → `success:false` with a distinct code. |
| 2 | **Sponsored-result contamination.** search grabs `Sponsored`/`Amazon's Choice` cards; top hit used by `add_to_cart` may be an ad, not the best match. | `add_to_cart("query")` may cart the wrong item. | Filter sponsored (`[data-component-type="sp-sponsored-result"]`, "Sponsored" label) or prefer organic results; better: require the agent to pass an explicit ASIN for cart/order ops. |
| 3 | **`headless:true` default.** Weakens stealth on the strict account/checkout pages. | More CAPTCHAs / blocks on the exact ops that matter. | Default headful for order/account flows, or make headless configurable via env. |
| 4 | **Fragile single-context cookie jar.** Can't reuse the user's real logged-in Chrome. | Forces a separate manual login; session expires silently. | Offer `launchPersistentContext(userDataDir)` mode; detect+report expiry proactively in `amazon_status`. |
| 5 | **Selector rot.** Hardcoded DOM selectors with no telemetry. | Breaks whenever Amazon ships markup changes. | Add a selftest tool that validates key selectors against a live page; log selector-miss counts. |
| 6 | **No idempotency on add_to_cart.** Re-running double-adds. | Duplicate cart items. | Check cart before/after; return delta. |
| 7 | **`--disable-web-security`** is a heavy hammer. | Larger fingerprint / security surface. | Remove unless a specific cross-origin need is proven. |

---

## 11. Build & Test Strategy

**Build:** `tsc` to `dist/`, ESM output, shebang preserved on `index.js`.

**Layered testing (safe → risky):**
1. **MCP smoke test** — spawn over stdio, `initialize` handshake, `tools/list`. Verifies protocol wiring **without launching a browser** (no side effects). Reference harness pattern: `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport` pointing at `dist/index.js`.
2. **Read-only live test** — call `amazon_search` (public, no auth). Asserts real products returned; classify BLOCKED vs WORKS by checking for Access-Denied/CAPTCHA markers and non-empty result *containers*.
3. **Authed read test** — after manual login: `amazon_status` shows `isLoggedIn:true`; `amazon_view_cart`, `amazon_get_orders`, `amazon_prime_check`.
4. **Cart write test** — `amazon_add_to_cart` (cheap item by ASIN) → `amazon_view_cart` confirms → `amazon_clear_cart` cleans up. **Reversible.**
5. **Checkout preview** — `amazon_preview_order` / `place_order` **without** confirm. Verify address/payment/total surface correctly. **Never** pass `confirm:true` in automated tests.

**Fixtures:** cheap, always-in-stock, Amazon-sold item for cart tests (e.g. AmazonBasics AAA batteries, ASIN `B00NTCHCU2`, ~$12.49). Sold-by-Amazon avoids third-party seller-selection edge cases.

**CI caveat:** steps 2–5 need a real browser + network (and 3–5 need a live session), so they can't run in vanilla CI. Gate them behind an env flag and run locally/headful.

---

## 12. Verified vs. Assumed (provenance)

**Verified by live test 2026-07-18:**
- `tools/list` returns the 14 tools above; server identifies as `strider-amazon@0.1.0` / mcpName `io.github.markswendsen-code/amazon`.
- `amazon_search "wireless headphones"` returned 10 real products (incl. sponsored noise) via patchright+system-Chrome headless.
- End-to-end **cart→checkout** flow reaches the real "Place your order" page; **payment (Visa) + address auto-populated from account defaults with zero input**; a Prime free-trial interstitial appears and must be declined. (This was exercised via direct Chrome automation on a real logged-in account, stopping *before* placing the order — no purchase made.)
- Config/persistence path `~/.strider/amazon/{cookies.json,session.json}` confirmed in source.

**From source reading (not runtime-verified):** exact selectors for cart/checkout/order-history/prime/address flows, CAPTCHA selectors, and the place-order confirmation extraction. These are Amazon-DOM-dependent and should be re-validated against a live page before relying on them.

**Assumed / recommended (not in reference):** persistent-context login reuse (§3), sponsored-filtering (§10.2), selftest tool (§10.5), headful-by-default for checkout (§10.3).

---

## 13. Quick-Start Checklist for the Implementing Agent

- [ ] Scaffold ESM TS project; `index.ts` / `browser.ts` / `auth.ts`; shebang + `bin`.
- [ ] Depend on `@modelcontextprotocol/sdk` + `patchright`; `patchright install chromium`.
- [ ] Implement `auth.ts` (cookie/session persistence to `~/.<ns>/amazon/`).
- [ ] Implement singleton `initBrowser()` with stealth context + init scripts (§4).
- [ ] Implement the 14 browser functions (§6 selectors), each: goto → delay → captcha-check → scrape → saveCookies.
- [ ] Wire `tools/list` + `tools/call` dispatch with the error classifier (§7).
- [ ] **Enforce the confirm-gate on `place_order`** and the "decline Prime/upsell" + "never fabricate order id" invariants (§9).
- [ ] All logs → `stderr`. Clean up browser on `onclose`/`SIGINT`/`SIGTERM`/`exit`.
- [ ] Smoke test (`tools/list`, no browser) → read-only live search → authed reads → reversible cart test → preview-only checkout.
- [ ] Address the §10 weaknesses (esp. silent-success #1 and sponsored #2) before shipping.
```
