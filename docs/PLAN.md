# intendr — a spend-capped wallet any AI agent can pay with

*Ramp Hackathon · team onboarding + build plan*
*Working name **intendr** (née *Tab* / *Purse* / *Allowance*).*

---

## TL;DR (read this first)

We're building **one MCP server that gives any chatbot's AI agent a real, spend-capped wallet** — so the agent can pay for both **data APIs** and **real-world commerce** (order food, book a ride) while a budget engine makes sure it *can't* overspend.

Paste our server's URL into any MCP-capable chatbot (Claude, ChatGPT, Cursor). The agent now has money with a cap and a catalog of paid capabilities. It can enrich a company for 3¢, order a burger through DoorDash's CLI, and book an Uber — and it will **stop itself** the moment a purchase would break the budget.

**One-line pitch:** *"A wallet with a spending limit that any AI agent can pay with — for real APIs and the real world — over MCP."*

---

## Why this matters (the wedge)

AI agents can increasingly *do* things that cost money, but there's no safe, portable way to hand one a budget:
- Giving an agent your card = reckless.
- Wiring bespoke payment + limits into every chatbot = repetitive toil.

**intendr is the missing layer:** a single MCP endpoint that any agent can point at to get (1) a spend-capped wallet, (2) a catalog of paid capabilities spanning data + commerce, and (3) governance — reserve→settle budgeting, approval gates for expensive or real-world actions, and per-category/merchant limits.

What makes it stand out at the hackathon:
1. **Portable MCP surface** — works from *any* chatbot, not one bespoke app.
2. **Real money** — the balance is a real spendable wallet behind a pluggable payment rail.
3. **Real-world commerce, not just data** — one wallet pays for API calls *and* DoorDash *and* Uber.
4. **Guardrails that visibly work** — the agent gets blocked live when it tries to overspend.

---

## Background: what we're building on

We are **not starting from scratch.** We reuse proven pieces from **Abdullah's previous API-layer demo** — an agent that discovers and calls paid APIs at runtime with a working budget system. (Its code lives in the `ortha` repo; that folder name is just the previous demo's project name.)

That prior demo already solved the hard parts we need:
- A **reserve → run → settle/refund** budget engine with an atomic per-account spend cap.
- Runtime capability discovery via meta-tools (`search` → `get details` → `run` → `expand result`).
- **Cost gates and side-effect gates** (pause for approval before an expensive or state-changing action).
- **Result distillation** (huge API responses are summarized into the model's context, full payload stored out-of-context and pulled back on demand).
- Idempotency + circuit breakers so paid calls are safe and a flaky provider can't stall a turn.

**intendr borrows those patterns into a standalone repo and goes further** where the prior demo stops: it exposes everything over **MCP** (the prior demo had no MCP endpoint), backs the balance with **real money**, and adds **real-world commerce** providers.

---

## Key concepts (glossary for new members)

- **MCP server** — a standard endpoint that any AI chatbot can connect to and call "tools." We serve it over **Streamable HTTP** so it's reachable from a hosted URL (not just a local app).
- **CapabilityProvider** — our unifying interface. Every paid capability — an Orthogonal data API, a DoorDash order, an Uber ride — implements the same three methods (`search`, `details`, `run`), so the wallet treats data and commerce identically.
- **PaymentRail** — where the money actually lives. Pluggable: a local prepaid wallet by default; a real card or stablecoin rail as a one-adapter swap.
- **reserve → settle** — before running a paid action we *reserve* (hold) the estimated cost against the cap; after it runs we *settle* the real cost (releasing any unused hold) or *refund* on failure. This is what prevents overspend and double-charges.
- **Side-effect gate** — any action that changes the world (placing an order, booking a ride) is a "write" and pauses for explicit approval before running.
- **Distillation** — big tool results are compressed to a short summary in context; the full payload is retrievable by a `requestId`.

---

## Architecture

- **One TypeScript/Bun project.** A remote **MCP server over Streamable HTTP** (`@modelcontextprotocol/sdk` v1.29+, `zod`, `express`), deployed to **Railway or Render** (git-push Node hosting). A local `stdio` entry exists as a guaranteed fallback for demos.
- **`CapabilityProvider` interface — the core unification:**
  ```ts
  interface CapabilityProvider {
    search(query: string): Promise<ServiceRef[]>       // discover a capability
    details(id: string): Promise<ServiceDetails>       // schema, priceCents, sideEffect, dynamicPricing
    run(id, input, idemKey): Promise<RunResult>        // { ok, priceCents, data, requestId }
  }
  ```
  Providers (all identical shape):
  - **`OrthogonalProvider`** — real paid data calls to the Orthogonal API catalog (company enrichment, lead/people search, funding, news). Reuses the prior demo's Orthogonal client.
  - **`DoorDashProvider`** — shells out to **`dd-cli`** (DoorDash's CLI: `search` / `order` / `checkout`) for real food orders if we have beta access; otherwise a **mock** provider (local restaurant data + fake checkout) behind the same interface.
  - **`UberProvider`** — **Uber Rides Sandbox** (official, reliable: OAuth + `sandbox-api.uber.com`) for real estimate→request→status; mock fallback.
- **Budget engine (reused).** Every purchase flows through it: estimate → check cap/guardrails → reserve → provider `run` → settle/refund. Writes are never retried; every paid call carries an `idempotencyKey`.
- **`PaymentRail` (pluggable real money).** Default **`LocalWalletRail`** (prepaid balance in integer cents, SQLite/JSON) carries the demo deterministically. Real-money adapters drop in via one env var: **`RampCardRail`** (hold/charge a scoped Ramp Agent Card — on-brand for the hackathon) or **`X402Rail`** (Coinbase USDC, free tier, settles in seconds). Core code is unchanged by the swap.
- **Guardrails module.** Global cap + **per-category cap** (e.g. food ≤ $30/day) + **per-merchant allowlist** + **side-effect confirmation** for writes. Over-limit or write → the tool returns a "needs approval" state the chatbot resolves via the `approve` tool.

---

## Repo layout (target, ~12 files for the server)

```
src/
├─ config.ts            env + guardrail caps (single source of truth for the demo cap)
├─ server.ts            HTTP entry: Express + StreamableHTTPServerTransport, POST /mcp
├─ stdio.ts             local fallback entry (same tool registration)
├─ wallet/rail.ts       PaymentRail interface
├─ wallet/local.ts      LocalWalletRail (prepaid cents ledger) — default
├─ wallet/ramp.ts       RampCardRail (optional real rail)          [cut-first]
├─ providers/provider.ts   CapabilityProvider interface + registry (search across all)
├─ providers/orthogonal.ts real data calls
├─ providers/doordash.ts   dd-cli wrapper + mock fallback
├─ providers/uber.ts       Uber sandbox + mock
├─ guardrails.ts        category caps / merchant allowlist / side-effect gate
└─ tools.ts             registerTools(server): the 6 MCP tools + atomic pay orchestration
```

**SDK gotcha (saves an hour):** `server.registerTool(name, { description, inputSchema: { field: z.string() } }, handler)` — `inputSchema` is a **map of zod fields**, not `z.object({...})`.

---

## MCP tool surface (6 tools; 4 are the MVP)

| Tool | Purpose |
|---|---|
| `get_wallet` | Balance, caps (global + per-category), spent, remaining. |
| `search_services` | Discover capabilities across ALL providers (data + commerce) by query. |
| `get_service` | Schema, price, side-effect class, provider for one capability. |
| **`pay_and_run`** | **Atomic**: estimate → guardrails → (approval if over-cap/write) → reserve → provider `run` → settle/refund → distill → receipt `{summary, requestId, priceCents, balance}`. Returns `BLOCKED` + reason if a cap trips. |
| `get_spend_summary` | The money + time story: spent, **overspend blocked ($ saved)**, cheapest choice, "saved ~N min". |
| `approve` | Human-in-loop: resolve a pending approval (approve / raise_cap / skip). |

**MVP core to build first:** `get_wallet`, `search_services`, `pay_and_run`, `get_spend_summary` — enough for the full demo.

---

## Providers: real vs mock

| Provider | Real path | Fallback | Notes |
|---|---|---|---|
| Orthogonal (data) | Reused client + Orthogonal key — **real paid calls** | — | Strongest "it actually paid for something" proof. |
| DoorDash (food) | **`dd-cli`** live checkout (beta, macOS, waitlist) | mock (restaurant JSON + fake receipt) | Same interface either way; mock is honest if access doesn't land. |
| Uber (ride) | **Uber Rides Sandbox** (official) | mock estimate/confirm | Sandbox is reliable and reads as "real." |
| Money rail | `RampCardRail` or `X402Rail` (USDC) | `LocalWalletRail` (default) | Local always works; x402 is the easiest *real* settlement. |

---

## The demo we're driving toward

The whole punch is a purchase getting **blocked live** on-screen. Set the global cap so the *ride* is the one that crosses it (a config number, not luck).

1. In a fresh, non-Claude chatbot: *"I landed at SFO, starving, need downtown for a 2pm — handle it, under $45, max $30 on food."*
2. Agent `search_services` → finds Orthogonal, DoorDash, Uber. Enriches the venue via **`pay_and_run`(orthogonal)** → real **$0.03** paid API call.
3. **`pay_and_run`(doordash: burger)** → side-effect gate → `approve` → reserve→settle → **$18.50** (real `dd-cli` or mock).
4. **`pay_and_run`(uber: SFO→downtown)** → estimate **$28** → guardrails **BLOCK** ($0.03 + $18.50 + $28 = $46.53 > $45) → returns `BLOCKED` + reason. The agent explains it stopped.
5. `get_spend_summary` → *"Spent $18.53. Blocked a $28 ride that would break your $45 cap — saved you from overspending and ~20 min of manual ordering."*
6. *"ok, raise to $60"* → `approve`(raise_cap) → ride books. Human-in-loop, live.

Covers all four selling points in ~90 seconds: real paid API + real-world commerce + a visible spend block + a money-and-time savings summary.

---

## Workstreams (pick one up in parallel) + 2-day timeline

The pieces are decoupled enough for a small team to split cleanly:

- **A · Wallet & budget** — vendor the budget engine, implement `LocalWalletRail`, wire the budget policy, add `guardrails.ts` (global + category cap, side-effect gate). Owns the "can't overspend" core.
- **B · Providers** — `CapabilityProvider` registry, `OrthogonalProvider` (real), `MockDoorDashProvider` + `dd-cli` wrapper, `UberProvider` (sandbox). Owns "what the agent can buy."
- **C · MCP server & tools** — `server.ts` Streamable HTTP, `tools.ts` (the 6 tools + atomic `pay_and_run`), deploy to Railway/Render, connect a chatbot. Owns the portable surface.
- **D · Demo & polish** — `get_spend_summary` math, tool descriptions (agents route off these), README, demo script + backup video.

**Day 1 (core, local, deterministic):** A + B + C build in parallel → integrate `pay_and_run` end-to-end → verify the full hero flow locally in **MCP Inspector**, including the live block.

**Day 2 (reach + real + polish):** deploy + connect a non-Claude chatbot → swap in Uber sandbox and attempt `dd-cli` beta (keep mock behind a flag) → optional real-money rail (`ramp`/`x402`) → savings/time summary + `approve`/raise_cap → rehearse, record backup video.

**Cut list if time runs short:** drop real-money rail → real `dd-cli` (mock only) → Uber real (mock) → `approve` → `stdio.ts`. Irreducible core = MCP server + local wallet + reused budget + Orthogonal (real) + mock DoorDash + guardrails + the 4 MVP tools. Still shows real paid API calls + commerce + the live cap block.

---

## How to run & verify

1. **Local smoke:** `npm run dev`; open **MCP Inspector**; confirm the 4 core tools list and `get_wallet` shows balance + caps.
2. **Budget unit tests (reused engine):** reserve→settle releases the estimate−actual remainder; refund on provider failure; an over-cap `pay_and_run` returns `BLOCKED` and charges nothing; a repeated `idempotencyKey` never double-charges.
3. **Hero flow, scripted:** Orthogonal call debits ~$0.03 with a real `requestId`; DoorDash write triggers the side-effect gate; the ride crosses the cap and returns `BLOCKED`; `get_spend_summary` reports the blocked $ saved; `approve`(raise_cap) then lets it through.
4. **Any-chatbot proof:** deploy; add the remote `/mcp` URL to a chatbot that is **not** Claude; run the SFO prompt and watch it drive `search_services`→`pay_and_run` autonomously and stop at the cap.
5. **Rail + provider swap:** flip `RAIL=x402` (or `ramp`) and confirm settlement on the real rail; flip a provider mock↔real and confirm the demo still runs offline.

---

## Pitch (say this to judges)

> "Paste one URL into any chatbot and your agent gets a wallet with a spending limit. Watch it enrich a real address for 3 cents, order a burger through DoorDash's CLI, then get **blocked live** when the Uber would break the $45 cap — until I raise it. It's a real-money, real-world spend-control layer for AI agents, over MCP — so *any* agent you talk to can pay for things and still can't overspend."
