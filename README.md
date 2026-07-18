# intendr

**A spend-capped wallet any AI agent can pay with.** One MCP server that gives any chatbot's agent a real, budget-controlled wallet — so it can pay for both **data APIs** and **real-world commerce** (order food, book a ride) while a budget engine makes sure it *can't* overspend.

> Ramp Hackathon project. Working names: intendr (née *Tab* / *Purse*).

## One-liner

Paste one URL into any MCP-capable chatbot (Claude, ChatGPT, Cursor) and the agent gets money with a cap plus a catalog of paid capabilities. It can enrich a company for 3¢, order a burger through DoorDash's CLI, and book an Uber — and it **stops itself** the moment a purchase would break the budget.

## Connect it

One command — no key, no config:

```bash
claude mcp add intendr -- npx -y intendr
```

Or add it as a stdio MCP server in Cursor / ChatGPT desktop: `command: npx`, `args: ["-y", "intendr"]`. Then ask your agent to `search_services`, `get_service`, and `pay_and_run`.

intendr runs **one shared Orthogonal key + spend-capped wallet server-side** — users bring nothing. (Per-user identity & billing via OAuth is on the roadmap.) The connector is a thin proxy to the hosted Worker; see [`apps/mcp/README.md`](apps/mcp/README.md).

## Why

AI agents can increasingly *do* things that cost money, but there's no safe, portable way to hand one a budget. Giving an agent your card is reckless; wiring bespoke payment + limits into every chatbot is toil. intendr is the missing layer: a single MCP endpoint offering (1) a spend-capped wallet, (2) a catalog of paid capabilities spanning data + commerce, and (3) governance — reserve→settle budgeting, approval gates for expensive or real-world actions, and per-category/merchant limits.

## What makes it stand out

1. **Portable MCP surface** — works from *any* chatbot, not one bespoke app.
2. **Real money** — the balance is a real spendable wallet behind a pluggable payment rail.
3. **Real-world commerce, not just data** — one wallet pays for API calls *and* DoorDash *and* Uber.
4. **Guardrails that visibly work** — the agent gets blocked live when it tries to overspend.

## Status

Monorepo scaffolded (Bun workspaces + Turborepo). `apps/{landing,web,edge}` + `packages/{contracts,budget,wallet,providers,guardrails,harness,mcp,db,ui}`. The MCP tool surface (`get_wallet`, `search_services`, `get_service`, `pay_and_run`, `get_spend_summary`, `approve`) and the atomic reserve→settle pay path are wired with in-memory stubs and typecheck green; real providers, rails, and Durable-Object persistence are the next steps.

See [`docs/MONOREPO.md`](docs/MONOREPO.md) for the repo structure + Cloudflare/Vercel hosting plan, and [`docs/PLAN.md`](docs/PLAN.md) for the product architecture, providers, and demo script.

## Development

```bash
bun install          # install + link workspaces
bun run typecheck    # tsc --noEmit across all packages
bun run dev          # turbo: landing + web (Vite) + edge (wrangler dev)

bun --cwd apps/edge run dev     # just the Worker (MCP + API) at http://localhost:8787
bun --cwd apps/web run dev      # just the dashboard
bun --cwd apps/landing run dev  # just the marketing site

ORTHOGONAL_API_KEY=sk-... bun --cwd apps/mcp run start   # the MCP connector (stdio) other agents add
```

**MCP connector** (`apps/mcp`): a real stdio MCP server any agent can add (Claude Desktop/Code, Cursor, …). It exposes the **entire Orthogonal catalog** (discovered at runtime via `search_services` → `get_service` → `pay_and_run`) plus commerce providers (Uber, DoorDash) — all metered through the spend-capped wallet. See [`apps/mcp/README.md`](apps/mcp/README.md).

Hosting is **hybrid**: `apps/edge` → Cloudflare Workers (MCP + API + Durable Objects); `apps/web` + `apps/landing` → Vercel. The ECC agent harness under `.claude/` is installed per-developer (see [SKILLS_SETUP.md](SKILLS_SETUP.md)) and is not committed.

## Agent tooling

This repo uses the full **[ECC](https://github.com/affaan-m/ECC)** (Everything Claude Code) harness — skills, agents, commands, rules, hooks, and MCP configs — installed **project-local** under `.claude/`. The harness itself is **not committed** (it's ~970 files and gitignored); instead, run one command to install it locally. See **[SKILLS_SETUP.md](SKILLS_SETUP.md)**.

```bash
npx ecc-universal@latest install --target claude-project --profile full
```
