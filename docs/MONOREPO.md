# intendr — Monorepo Architecture & Cloudflare Hosting Plan

*How the repo is structured, what each piece does, and how it all deploys to Cloudflare.*
*Companion to [`PLAN.md`](PLAN.md) (the product/architecture plan). This doc is about the **repo shape** and **hosting**.*

---

## 0. Decisions locked in

| Decision | Choice | Why |
|---|---|---|
| Package manager / workspaces | **Bun workspaces** | Matches Abdullah's `ortha` (the demo we reuse from); already installed. |
| Language | **TypeScript** (strict, NodeNext), TS project references | One language across apps + packages. |
| Task runner | **Turborepo** (thin, optional) | Cached builds + `dev`/`deploy` pipelines across workspaces. Bun scripts work too. |
| Hosting | **Cloudflare** end-to-end | Reuses ortha's edge design (Workers + Durable Objects + D1 + KV); one vendor. |
| Backend + MCP | **Cloudflare Worker** (`apps/edge`) | Serves the MCP endpoint *and* the dashboard API from one Worker. |
| MCP transport | **WebStandard Streamable HTTP** (fetch-based) | The Workers-compatible transport from `@modelcontextprotocol/sdk` (supersedes the Railway/Render note in PLAN.md). |
| Frontends | **Cloudflare Pages** | `apps/web` (dashboard) + `apps/landing` (marketing). |
| Frontend stack | **React + Vite** (dashboard), **Astro** (landing) | Dashboard mirrors ortha's React app; Astro is ideal for a fast static marketing site. |

> These are defaults, not dogma — see [§9 Open decisions](#9-open-decisions).

---

## 1. Top-level layout

```
intendr/
├─ apps/
│  ├─ landing/                 # Marketing site (Astro) → Cloudflare Pages
│  ├─ web/                     # App dashboard (React + Vite SPA) → Cloudflare Pages
│  └─ edge/                    # Cloudflare Worker: MCP server + dashboard API + Durable Objects
│
├─ packages/
│  ├─ contracts/               # Frozen interfaces + shared types (the seams)
│  ├─ mcp/                     # MCP server assembly: tool registration + atomic pay orchestration
│  ├─ budget/                  # reserve → settle/refund engine  (reuse from ortha)
│  ├─ wallet/                  # PaymentRail interface + Local / Ramp / x402 rails
│  ├─ providers/               # CapabilityProvider registry + Orthogonal / DoorDash / Uber
│  ├─ guardrails/              # caps, per-category limits, merchant allowlist, side-effect gate
│  ├─ harness/                 # distill() + HTTP client (timeout/retry/circuit breaker)  (reuse from ortha)
│  ├─ db/                      # D1/SQLite stores, schema, migrations helpers  (reuse from ortha)
│  └─ ui/                      # Shared React components + design tokens (used by web; optional for landing)
│
├─ infra/
│  ├─ cloudflare/              # shared wrangler snippets, binding docs, account/zone notes
│  └─ migrations/              # D1 SQL migrations (source of truth; symlinked/consumed by apps/edge)
│
├─ tooling/
│  ├─ tsconfig/                # base + per-target tsconfigs (node, worker, react, astro)
│  ├─ eslint/                  # shared flat config
│  └─ vitest/                  # shared test config
│
├─ docs/                       # PLAN.md, MONOREPO.md, ADRs
├─ .github/workflows/          # CI: typecheck, test, deploy (Workers + Pages)
├─ package.json                # workspaces + root scripts
├─ turbo.json                  # pipeline (build/dev/deploy/typecheck/test)
├─ tsconfig.base.json          # shared compiler options + path aliases
├─ bun.lock
└─ .gitignore                  # ignores .claude/ (ECC harness), dist/, .wrangler/, .dev.vars, node_modules/
```

**Dependency direction:** `apps/*` depend on `packages/*`; packages depend only on `contracts` (and each other, acyclically). Nothing in `packages/*` imports from `apps/*`.

---

## 2. Apps

### `apps/landing` — marketing site (Cloudflare Pages)
- **Stack:** Astro (static/SSG), minimal JS. Optionally Tailwind.
- **Purpose:** the pitch, "how it works," and a CTA to sign in / get your MCP URL. Fast, SEO-friendly, near-zero runtime.
- **Deploy:** Cloudflare Pages, output `dist/`.
- **Key files:** `astro.config.mjs`, `src/pages/index.astro`, `public/`, `wrangler.toml` (Pages project name) or Pages dashboard config.

### `apps/web` — app dashboard (Cloudflare Pages)
- **Stack:** React + Vite SPA (mirrors ortha's `apps/web`). Talks to `apps/edge` over REST + WebSocket.
- **Purpose (the control plane for the wallet):**
  - Sign in; create/select a workspace.
  - **Wallet:** balance, global cap, per-category caps, merchant allowlist.
  - **Connect a rail:** Local (default) / Ramp Agent Card / x402 — and show the active one.
  - **MCP connection:** generate + copy the `/mcp` URL and a scoped token to paste into any chatbot.
  - **Activity/trace:** live tool-call trace (reuse ortha's trace-block UI), receipts, `expand_result` raw view.
  - **Approvals:** resolve pending over-cap / side-effect payments (approve / raise cap / skip).
- **Deploy:** Cloudflare Pages, output `dist/`; API calls hit the Worker's custom domain.
- **Key files:** `vite.config.ts`, `src/main.tsx`, `src/routes/*`, `index.html`.

### `apps/edge` — the Worker (backend + MCP server)
- **Stack:** Cloudflare Worker (TypeScript, `wrangler`), Hono (or itty-router) for routing.
- **Routes:**
  - `POST /mcp` — **MCP Streamable HTTP** endpoint (WebStandard transport). Exposes the tools from `packages/mcp`; every `pay_and_run` flows through budget + guardrails + providers.
  - `GET/POST /api/*` — dashboard API: auth/sessions, wallet CRUD, caps, allowlist, transactions, approvals, rail connection, MCP token issuance.
  - `GET /api/*/stream` (WebSocket) — live trace to the dashboard.
  - `POST /webhooks/*` — payment-rail settlement callbacks (Ramp / x402).
- **Durable Objects:** `WalletDO` (one per workspace/wallet) owns the atomic reserve→settle state, the approval queue, and out-of-context raw payloads (`expand_result`) — the ortha "one DO per unit" pattern, applied to a wallet/session.
- **Key files:** `src/index.ts` (router), `src/mcp.ts` (mounts `packages/mcp` over the fetch transport), `src/wallet-do.ts` (Durable Object), `src/api/*`, `wrangler.toml`, `migrations/`, `.dev.vars`.

---

## 3. Packages (shared libraries)

| Package | Responsibility | Reuse |
|---|---|---|
| `contracts` | Frozen types + interfaces: `Cents`, `ReservationId`, `SideEffectClass`, `BudgetDecision`, `PaymentRail`, `CapabilityProvider`, `ToolSpec`, `TraceEvent`. The seams everything builds against. | vendor + extend from ortha `packages/contracts` |
| `budget` | `createBudgetPolicy` — reserve → run → settle/refund, atomic cap via `SpendStorePort`. | reuse from ortha `packages/budget` (~90%) |
| `wallet` | `PaymentRail` (= `SpendStorePort`) impls: `LocalWalletRail` (D1/SQLite cents ledger), `RampCardRail`, `X402Rail`. Rail chosen by env. | new |
| `providers` | `CapabilityProvider` registry + `OrthogonalProvider` (real), `DoorDashProvider` (dd-cli/mock), `UberProvider` (sandbox/mock). | new; Orthogonal client from ortha `harness` |
| `guardrails` | global cap + per-category cap + merchant allowlist + side-effect confirmation; emits `permission_required`. | new (builds on `BudgetDecision`) |
| `harness` | `distill()` (pure) + HTTP client with timeout/retry/circuit-breaker/dedupe. | reuse from ortha `packages/harness` |
| `mcp` | Assembles the MCP server: registers the 6 tools (`get_wallet`, `search_services`, `get_service`, `pay_and_run`, `get_spend_summary`, `approve`) and the atomic pay orchestration. Transport-agnostic so `apps/edge` mounts it over the Workers fetch transport (and a `stdio` bin can mount it locally). | new |
| `db` | D1 schema + migrations + typed stores (`tryReserveSpend`, transactions, accounts/workspaces). | reuse from ortha `packages/db` |
| `ui` | Shared React components + design tokens (trace block, cost meter, approval chip). | adapt ortha UI |

> intendr is a **tool/wallet provider**, not an agent runtime — the *calling chatbot* is the agent. So there is **no LLM loop** in the core (unlike ortha). An optional `packages/llm` + an in-dashboard test agent is a later add-on, not core.

---

## 4. Cloudflare hosting plan

### 4.1 What runs where

| Workspace | Cloudflare product | Build output | Notes |
|---|---|---|---|
| `apps/landing` | **Pages** | `dist/` | Static/SSG. Custom domain `intendr.app` (apex). |
| `apps/web` | **Pages** | `dist/` | SPA. Subdomain `app.intendr.app`. |
| `apps/edge` | **Workers** | Worker bundle | API + MCP. `api.intendr.app` (and `/mcp` there). |

### 4.2 Bindings (on `apps/edge`)

| Binding | Product | Used for |
|---|---|---|
| `DB` | **D1** | accounts, workspaces, **spend** (atomic monthly cap), transactions/receipts, allowlist. |
| `SESSIONS` / `SETTINGS` | **KV** | sessions, per-workspace settings, MCP tokens, provider price cache. |
| `WALLET_DO` | **Durable Objects** | per-wallet reserve→settle state, approval queue, raw payload store (`expand_result`). |
| `RAW` | **R2** | large raw tool payloads + receipts/PDFs (cheap out-of-context storage). |
| `SETTLE_Q` | **Queues** | async settlement / webhook reconciliation for real rails (Ramp/x402). |
| `RATE_LIMIT` | KV or DO | per-provider circuit breaker / cross-user rate limiting (future). |

Secrets (via `wrangler secret put`, never committed): `ORTHOGONAL_API_KEY` default, `KEY_ENCRYPTION_KEY`, `RAMP_CLIENT_ID/SECRET`, `X402_*`, `UBER_CLIENT_ID/SECRET`, OAuth creds. Local equivalents in `apps/edge/.dev.vars` (gitignored).

### 4.3 Cloudflare files the repo needs

```
apps/edge/
├─ wrangler.toml            # name, main, compatibility_date, bindings, [env.preview]/[env.production], routes/custom domain
├─ .dev.vars               # local secrets (gitignored)
├─ migrations/             # D1 migrations: 0001_init.sql, ...
└─ src/index.ts            # fetch handler (router) + Durable Object export

apps/web/
├─ wrangler.toml            # Pages project name (or configure in dashboard)
└─ (Vite build → dist/)

apps/landing/
├─ wrangler.toml            # Pages project name
└─ (Astro build → dist/)
```

`wrangler.toml` (edge) — shape:
```toml
name = "intendr-edge"
main = "src/index.ts"
compatibility_date = "2026-07-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]      binding = "DB"        database_name = "intendr"  database_id = "..."
[[kv_namespaces]]     binding = "SESSIONS"  id = "..."
[[r2_buckets]]        binding = "RAW"       bucket_name = "intendr-raw"
[[queues.producers]]  binding = "SETTLE_Q"  queue = "intendr-settle"
[[queues.consumers]]  queue = "intendr-settle"

[durable_objects]
bindings = [{ name = "WALLET_DO", class_name = "WalletDO" }]
[[migrations]]        tag = "v1"  new_classes = ["WalletDO"]

[env.production]
routes = [{ pattern = "api.intendr.app/*", zone_name = "intendr.app" }]
```

### 4.4 Environments & domains
- **Preview**: every PR → Pages preview URLs + a `--env preview` Worker (`api-preview.intendr.app`). Ephemeral D1/KV or a shared preview DB.
- **Production**: `intendr.app` (landing), `app.intendr.app` (dashboard), `api.intendr.app` (Worker + `/mcp`).

---

## 5. Data & state model (summary)

- **Durable Object `WalletDO`** (one per wallet/workspace): single-writer, embedded SQLite — the reserve/settle ledger holds, the approval queue, and raw payloads keyed by `requestId`. Serialized turns = no in-wallet race.
- **D1 `DB`**: cross-wallet aggregation + the transactional **spend cap** (`tryReserveSpend` conditional `UPDATE`) — the one global invariant, enforced by the database.
- **KV**: sessions, settings, MCP tokens, provider price cache (read-heavy, edge-cached).
- **R2**: large raw payloads / receipts out of context.

---

## 6. Local development

```bash
bun install
bun run dev            # turbo: landing + web (Vite) + edge (wrangler dev with local D1/KV/DO)
bun run typecheck
bun run test           # vitest across packages (budget/idempotency/guardrails/distill)

# individual
bun --cwd apps/edge run dev        # Worker locally (Miniflare: D1 + KV + DO + R2 emulation)
bun --cwd apps/web run dev         # dashboard
bun --cwd apps/landing run dev     # marketing site
```

Root `package.json` scripts wrap Turborepo pipelines; each app owns its own `dev`/`build`/`deploy`.

---

## 7. Build & deploy (CI)

`.github/workflows/deploy.yml`:
1. `bun install` → `bun run typecheck` → `bun run test`.
2. **D1 migrations**: `wrangler d1 migrations apply intendr` (prod, gated on main).
3. **Worker**: `wrangler deploy` (`apps/edge`, `--env production`).
4. **Pages**: `wrangler pages deploy apps/web/dist --project-name intendr-web` and `... apps/landing/dist --project-name intendr-landing`.
5. PRs deploy to preview targets; `main` deploys to production.

Requires repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

---

## 8. Migration path (from today's scaffold → monorepo)

**Current state:** repo has `README.md`, `SKILLS_SETUP.md`, `docs/`, `.gitignore` (ECC harness gitignored).

1. **Scaffold workspaces.** Add root `package.json` (workspaces), `turbo.json`, `tsconfig.base.json`, `tooling/`.
2. **Stand up `packages/contracts`** — port + extend the ortha seams. Everything else builds on it.
3. **Vendor reusable packages** — `budget`, `harness` (distill + client), `db` from ortha; wire `wallet` (`LocalWalletRail`) to D1.
4. **`packages/mcp` + `apps/edge`** — register the 4 MVP tools; mount over the Workers fetch transport; `WalletDO`; `wrangler dev` green with MCP Inspector.
5. **`apps/web`** — dashboard: wallet, caps, MCP-URL copy, trace, approvals.
6. **`apps/landing`** — marketing + CTA.
7. **`providers`** — Orthogonal (real) → DoorDash (mock→dd-cli) → Uber (sandbox).
8. **Guardrails + real rails** — per-category caps, allowlist; `RampCardRail` / `X402Rail` behind env.
9. **CI + custom domains** — GH Actions deploy; wire `intendr.app` / `app.` / `api.`.

Each step is independently shippable; the MVP demo (PLAN.md §"the demo") is reachable after step 5 with mock providers.

---

## 9. Open decisions

- **Landing framework**: Astro (recommended) vs Next-on-Pages vs plain HTML.
- **Edge split**: one Worker for MCP + API (recommended, simplest) vs separate `apps/mcp` and `apps/api` Workers.
- **Router in `apps/edge`**: Hono (recommended) vs itty-router vs hand-rolled.
- **Turborepo** vs plain Bun workspace scripts (start plain, add Turbo when builds slow down).
- **Auth**: reuse ortha's PBKDF2 + Google OAuth vs Cloudflare Access vs a provider (Clerk/WorkOS).

---

## 10. Room to grow ("stuff we might add later")

Placeholders so these slot in without reshaping the repo:
- **More providers** (`packages/providers/*`): Shopify/Stripe MCP, flights/hotels, gift cards, more data APIs — each just implements `CapabilityProvider`.
- **More payment rails** (`packages/wallet/*`): Stripe Link, Google AP2, Coinbase CDP — each implements `PaymentRail`.
- **`apps/mobile`** (Expo/React Native) — wallet approvals + push notifications on the go.
- **`packages/cli`** — an `intendr` CLI to manage wallets/caps and print the MCP URL.
- **`apps/docs`** — developer docs / API reference (Cloudflare Pages).
- **`packages/llm` + in-dashboard test agent** — a built-in chat to exercise the tools without an external chatbot.
- **Analytics / observability** — per-turn metrics (Workers Analytics Engine), spend dashboards.
- **Teams / multi-tenant** — shared workspaces, roles, org-level caps and audit export.
- **Webhooks & notifications** — settlement callbacks, budget-threshold alerts (email/Slack).
- **Fleet-wide rate limiting / cross-user cache** — shared circuit breaker in KV or a coordinator DO (ortha's noted next step).
