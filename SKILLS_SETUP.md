# Skills setup (ECC harness)

This repo uses the **[ECC](https://github.com/affaan-m/ECC)** ("Everything Claude Code") agent harness — a project-local set of Claude Code **skills, agents, commands, rules, hooks, and MCP configs** that give any coding agent working in this repo a consistent, batteries-included workflow set.

The harness is **not committed** to the repo (it's ~970 files). Instead, each developer installs it locally with one command. The install writes everything under `.claude/`, which is **gitignored**.

## Install (one command, run from the repo root)

```bash
# npx (recommended) — installs project-local into ./.claude/
npx ecc-universal@latest install --target claude-project --profile full
```

That's it. Restart Claude Code (or reload the window) so it picks up the new `.claude/` skills, agents, and commands.

### Alternative: clone + install script

```bash
git clone --depth 1 https://github.com/affaan-m/ECC.git /tmp/ECC

# Windows (PowerShell), from the repo root:
& /tmp/ECC/install.ps1 --target claude-project --profile full

# macOS / Linux (bash), from the repo root:
bash /tmp/ECC/install.sh --target claude-project --profile full
```

> Both entrypoints use the **current working directory** as the project root, so run them from the root of this repo. `--target claude-project` keeps the install **project-local** (nothing is written to your global `~/.claude`).

## What gets installed (into `./.claude/`)

| Component | Count | Location |
|---|---|---|
| Skills | ~277 | `.claude/skills/ecc/` (e.g. `mcp-server-patterns`, `agent-payment-x402`, `api-connector-builder`, `api-design`, `backend-patterns`, `bun-runtime`) |
| Agents | ~67 | `.claude/agents/` |
| Commands | ~94 | `.claude/commands/` |
| Rules | ~122 | `.claude/rules/ecc/` |
| Hooks | — | `.claude/hooks/` |
| MCP configs | — | `.claude/mcp-configs/` |

Install profile: **`full`** (the complete harness). For a lighter setup, swap `--profile full` for `--profile developer`, `--profile core`, or `--profile minimal`. Run `npx ecc-universal@latest install --help` to see all profiles, targets, and options.

## Preview without writing files

```bash
npx ecc-universal@latest install --target claude-project --profile full --dry-run
```

## Verify

After installing, from the repo root:

```bash
ls .claude/skills/ecc | head          # skill directories
ls .claude/agents | head              # agent definitions
```

In Claude Code, the skills become available in the skill picker while you work in this repo.

## Update

Re-run the same install command to pull the latest ECC harness; the installer tracks state in `.claude/ecc/install-state.json`.
