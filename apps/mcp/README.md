# intendr

The **MCP connector** for [intendr](https://github.com/zero-abd/intendr) — give any AI agent a
spend-capped wallet that can pay for the **Orthogonal** API catalog (company enrichment,
people/lead search, funding, news, email verification, …) plus commerce providers, all under
budget guardrails.

On first run it opens a browser to **sign in / sign up** (Supabase); after that your agent
spends against **your own** wallet. The Orthogonal key stays server-side — you never handle a
key. The token is cached at `~/.intendr/auth.json` and refreshed silently.

## Install

```bash
claude mcp add intendr -- npx -y intendr
```

Or in any MCP client (Cursor, ChatGPT desktop, …), add a stdio server:

```json
{
  "mcpServers": {
    "intendr": { "command": "npx", "args": ["-y", "intendr"] }
  }
}
```

Then ask your agent to `search_services`, `get_service`, and `pay_and_run`.

## Tools

| Tool | What it does |
|---|---|
| `search_services` | search the Orthogonal catalog (+ commerce) by natural language |
| `get_service` | price + side-effect + input schema (query/body/path) for a capability |
| `pay_and_run` | pay for and execute a capability under the wallet's spend controls |
| `get_wallet` / `get_spend_summary` | balance, caps, spend, remaining |
| `approve` | approve / raise_cap / skip a gated payment |

## Config

- `INTENDR_URL` — override the hosted endpoint (defaults to the public intendr Worker).

> Per-user identity & billing via OAuth is on the roadmap; today all traffic shares one
> server-side Orthogonal key + wallet.
