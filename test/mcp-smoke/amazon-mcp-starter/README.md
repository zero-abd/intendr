# Amazon MCP — Starter Skeleton

A wired-up scaffold for building the Amazon MCP server. **Read
[`../AMAZON-MCP-RESEARCH.md`](../AMAZON-MCP-RESEARCH.md) first** — it is the full
spec; this is the code stub that implements its §1 architecture.

## What's already done vs. what you must do

| File | State | Your job |
|------|-------|----------|
| `src/auth.ts` | ✅ **Complete** — cookie/session persistence to `~/.<ns>/amazon/`. | Usually nothing. |
| `src/index.ts` | ✅ **Complete** — all 14 tool definitions, dispatch, error classifier, stdio wiring. | Nothing, unless you add tools. |
| `src/browser.ts` | 🟡 **Structured stubs.** Browser bootstrap + stealth + CAPTCHA check are real; each operation has the correct navigation + `TODO(agent)` scrape blocks. | **Fill every `TODO(agent)`** using the selectors in RESEARCH §6, then verify against a live page. |

Search for `TODO(agent)` — that string marks every spot needing work.

## Setup

```bash
cd amazon-mcp-starter
npm install
npx patchright install chromium      # if the download host is blocked, see RESEARCH §2 (channel:"chrome")
npm run build                        # tsc -> dist/
node dist/index.js                   # starts the MCP server on stdio
```

## Hard rules (do NOT violate — see RESEARCH §9)

1. **`amazon_place_order` spends real money.** It must stay preview-by-default;
   only proceed when `confirm === true`, and only after explicit human yes.
2. **Never enter payment/card data.** Checkout inherits the account's default
   payment + address. The server must never see or type card details.
3. **Never fabricate an order id.** If you can't verify the order completed
   (order-number regex `\d{3}-\d{7}-\d{7}` or a thankyou URL), return
   `success:false`. Do not invent a `Date.now()` id.
4. **Decline Prime + all upsells** during checkout (click "No thanks").
5. **CAPTCHA / login-required = stop and tell the human.** Never bypass bot
   detection.
6. **All logs go to `stderr`** (`console.error`). `stdout` is the MCP wire —
   one stray `console.log` corrupts the protocol.

## Build order (recommended)

1. `amazon_search` (public, no auth) → get the read path + stealth working first.
2. `amazon_status` / `amazon_login` → confirm the session model end-to-end.
3. `amazon_get_product`, `amazon_view_cart`, `amazon_get_orders` (reads).
4. `amazon_add_to_cart` → `amazon_clear_cart` (reversible writes).
5. `amazon_preview_order` (read-only checkout).
6. `amazon_place_order` **last**, tested only with `confirm:false` until the
   confirm-gate is proven. Never pass `confirm:true` in an automated test.

## Testing

Reuse the harness one level up (`../smoke-test.mjs` pattern): spawn `dist/index.js`
over stdio, run `initialize`, then `tools/list` (no browser launched). Then the
layered live tests in RESEARCH §11. Steps needing a browser/session can't run in
vanilla CI — gate them behind an env flag and run locally, headful.
