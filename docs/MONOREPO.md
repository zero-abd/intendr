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
| Hosting | **Hybrid: Cloudflare (backend) + Vercel (frontends)** | Stateful MCP/backend where the primitives fit best; frontend DX + previews on Vercel. |
| Backend + MCP | **Cloudflare Worker** (`apps/edge`) via **`McpAgent`** (agents SDK, Durable-Object-backed) | Serves the MCP endpoint *and* the dashboard API from one Worker; `McpAgent` is purpose-built for stateful remote MCP. |
| MCP transport | **Streamable HTTP + SSE via `McpAgent`** | DO-backed transport from Cloudflare's `agents` SDK — no hand-rolled transport, no Railway/Render (supersedes PLAN.md's note). |
| Frontends | **Vercel** | `apps/web` (dashboard) + `apps/landing` (marketing) as two Vercel projects. |
| Frontend stack | **React + Vite** (dashboard), **Astro** (landing) | Dashboard mirrors ortha's React app; Astro is ideal for a fast static marketing site. |

> These are defaults, not dogma — see [§9 Open decisions](#9-open-decisions).

---

## 1. Top-level layout

```
intendr/
├─ apps/
│  ├─ landing/                 # Marketing site (Astro) → Vercel
│  ├─ web/                     # App dashboard (React + Vite SPA) → Vercel
│  └─ edge/                    # Cloudflare Worker (McpAgent/DO): MCP server + dashboard API
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

### `apps/landing` — marketing site (Vercel)
- **Stack:** Astro (static/SSG), minimal JS. Optionally Tailwind.
- **Purpose:** the pitch, "how it works," and a CTA to sign in / get your MCP URL. Fast, SEO-friendly, near-zero runtime.
- **Deploy:** Vercel (project Root Directory `apps/landing`), Astro build output `dist/`.
- **Key files:** `astro.config.mjs`, `src/pages/index.astro`, `public/`, `wrangler.toml` (Pages project name) or Pages dashboard config.

### `apps/web` — app dashboard (Vercel)
- **Stack:** React + Vite SPA (mirrors ortha's `apps/web`). Talks to `apps/edge` over REST + WebSocket.
- **Purpose (the control plane for the wallet):**
  - Sign in; create/select a workspace.
  - **Wallet:** balance, global cap, per-category caps, merchant allowlist.
  - **Connect a rail:** Local (default) / Ramp Agent Card / x402 — and show the active one.
  - **MCP connection:** generate + copy the `/mcp` URL and a scoped token to paste into any chatbot.
  - **Activity/trace:** live tool-call trace (reuse ortha's trace-block UI), receipts, `expand_result` raw view.
  - **Approvals:** resolve pending over-cap / side-effect payments (approve / raise cap / skip).
- **Deploy:** Vercel (project Root Directory `apps/web`); talks to the Worker at `api.intendr.app` (CORS-allowed), with `PUBLIC_API_URL` set per Vercel environment.
- **Key files:** `vite.config.ts`, `src/main.tsx`, `src/pages/*`, `src/api/*`, `src/lib/supabase.ts`, `index.html`.

#### Running `apps/web` locally

The dashboard talks to **Supabase directly** (auth + wallet/transactions) — no local Worker needed for the wallet UI. Two build-time env vars are required; without them the app renders a "connect Supabase" onboarding screen instead of the authed UI.

```bash
bun install                                    # from the repo root (installs + links workspaces)
cp apps/web/.env.example apps/web/.env.local   # then fill in the two VITE_ vars below
bun run --cwd apps/web dev                      # dashboard at http://localhost:5173
```

`apps/web/.env.local` (git-ignored — never commit it):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key — safe in the browser; RLS protects data>
```

Get both from the Supabase dashboard → Project Settings → API. Use the **anon/publishable** key, never `service_role`. Restart Vite after editing `.env.local` (Vite only reads env at startup).

Build / typecheck the web app in isolation:

```bash
bun run --cwd apps/web build       # NOTE: flag goes AFTER `run`. `bun --cwd apps/web run build`
bun run --cwd apps/web typecheck   # is misparsed by bun 1.3.x and just prints help.
# or, from the repo root, via turbo:  bun run build --filter '@intendr/web'
```

**Supabase schema:** run `apps/web/supabase/schema.sql` then `apps/web/supabase/002_cards.sql` once in the SQL editor. A signup trigger auto-provisions a `profiles` + `wallets` row; new wallets start with a **$50 welcome credit** (`balance_cents` default `5000`). RLS scopes every table to `auth.uid()`.

### `apps/edge` — the Worker (backend + MCP server)
- **Stack:** Cloudflare Worker (TypeScript, `wrangler`) using Cloudflare's **`agents` SDK `McpAgent`** (Durable-Object-backed) for the MCP surface, Hono for the REST routes. **CORS** allow-lists the Vercel frontend origins.
- **Routes:**
  - `POST /mcp` (+ SSE) — **MCP endpoint via `McpAgent`** (DO-backed, Streamable HTTP/SSE). Exposes the tools from `packages/mcp`; every `pay_and_run` flows through budget + guardrails + providers.
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
| `apps/landing` | **Vercel** | `dist/` | Astro static/SSG. Custom domain `intendr.app` (apex). |
| `apps/web` | **Vercel** | `dist/` | React SPA. Subdomain `app.intendr.app`. |
| `apps/edge` | **Cloudflare Workers** | Worker bundle | API + MCP (McpAgent/DO). `api.intendr.app` (and `/mcp`). |

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
├─ vercel.json             # Vercel config (build/output, SPA rewrites); Root Directory = apps/web
└─ (Vite build → dist/)

apps/landing/
├─ vercel.json             # Vercel config; Root Directory = apps/landing
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
- **Preview**: every PR → **Vercel preview URLs** (both frontends) + a `--env preview` Worker (`api-preview.intendr.app`). Ephemeral D1/KV or a shared preview DB. Point preview frontends at the preview API via `PUBLIC_API_URL`.
- **Production**: `intendr.app` (landing, Vercel), `app.intendr.app` (dashboard, Vercel), `api.intendr.app` (Worker + `/mcp`, Cloudflare).

### 4.5 Cross-platform wiring (the hybrid tax)

Splitting frontends (Vercel) from the backend (Cloudflare) adds a little glue — plan for it:
- **CORS**: the Worker allow-lists the Vercel origins (`https://app.intendr.app`, `https://intendr.app`, and `*.vercel.app` previews) on `/api/*` and `/mcp`.
- **Config, not hard-coding**: frontends read `PUBLIC_API_URL=https://api.intendr.app` at build time (Vite/Astro env); nothing points at a hard-coded host.
- **Auth across domains**: keep both frontends and the Worker under the shared `intendr.app` parent (Vercel serves `app.`/apex; Cloudflare serves `api.`) so a session cookie with `Domain=.intendr.app; Secure; SameSite=Lax` works across both. If you don't want shared-domain cookies, use bearer tokens for the dashboard API and a scoped token for `/mcp`.
- **Two control planes**: you now watch Vercel (frontends) *and* Cloudflare (Worker/D1/DO/KV). CI reflects the split (§7).

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
4. **Frontends**: deployed by **Vercel's Git integration** — two Vercel projects with Root Directories `apps/web` and `apps/landing`; automatic preview per PR, production on `main`. No wrangler/GH-Actions step for the frontends.
5. Worker preview via `wrangler deploy --env preview` on PRs; production on `main`. Set `PUBLIC_API_URL` per Vercel environment to match the corresponding API.

Requires repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (Worker + D1). Vercel deploys via its own Git integration (no GH secret needed) — or add `VERCEL_TOKEN` if you prefer running `vercel deploy` from CI.

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
- **`apps/docs`** — developer docs / API reference (Vercel, alongside the other frontends).
- **`packages/llm` + in-dashboard test agent** — a built-in chat to exercise the tools without an external chatbot.
- **Analytics / observability** — per-turn metrics (Workers Analytics Engine), spend dashboards.
- **Teams / multi-tenant** — shared workspaces, roles, org-level caps and audit export.
- **Webhooks & notifications** — settlement callbacks, budget-threshold alerts (email/Slack).
- **Fleet-wide rate limiting / cross-user cache** — shared circuit breaker in KV or a coordinator DO (ortha's noted next step).
