# @intendr/mcp-server

The intendr **MCP connector** (stdio). Add it to any MCP-capable agent and it gets a
spend-capped wallet that can pay for **Orthogonal's entire catalog** (discovered at
runtime) plus commerce providers (Uber, DoorDash) — with reserve→settle budgeting,
per-call approval, and side-effect gates.

## Tools

| Tool | What it does |
|---|---|
| `get_wallet` | balance, caps, remaining budget |
| `search_services` | search the Orthogonal catalog (+ providers) by natural language |
| `get_service` | price + side-effect + input schema for one capability |
| `pay_and_run` | pay for and execute a capability under the wallet's controls |
| `get_spend_summary` | spent / remaining / overspend blocked |
| `approve` | approve / raise_cap / skip a gated payment |

## Run

```bash
export ORTHOGONAL_API_KEY=sk-ortho-...     # required for the Orthogonal tools
# optional: INTENDR_GLOBAL_CAP_CENTS, INTENDR_OPENING_BALANCE_CENTS, INTENDR_PER_CALL_WARN_CENTS
bun --cwd apps/mcp run start
```

Inspect it locally:

```bash
bun --cwd apps/mcp run inspect     # opens the MCP Inspector
```

## Add to an agent (example: Claude Desktop / Cursor `mcpServers`)

```json
{
  "mcpServers": {
    "intendr": {
      "command": "bun",
      "args": ["run", "C:/Users/conne/Desktop/Projects/intendr/apps/mcp/src/index.ts"],
      "env": { "ORTHOGONAL_API_KEY": "sk-ortho-...", "INTENDR_GLOBAL_CAP_CENTS": "4500" }
    }
  }
}
```

The wallet state persists for the life of the process, so spend accumulates across tool
calls and the caps actually bite. (Cross-restart / multi-user persistence is the Worker +
Durable Object path — see `apps/edge` and `docs/MONOREPO.md`.)
