# @intendr/amazon-agent

The **checkout executor** for the Amazon commerce capability. A Cloudflare Worker
can't run a browser, so `AmazonProvider` (on the edge) calls this Node service to
do the actual purchasing. Mock-first; real browser + card behind `AMAZON_LIVE=1`.

## Flow (where the pieces meet)

```
agent → edge Worker
          AmazonProvider.run(confirm=true)
            ├─ issue a scoped card  → apps/virtual-cards  (returns a TOKEN, never a PAN)
            └─ POST /purchase {…, cardRef} → THIS SERVICE (executor)
                 └─ redeem PAN  → apps/virtual-cards /internal/card-credentials/consume
                 └─ drive browser: enter PAN at Amazon checkout → place order
```

**Security property (inherited from `apps/virtual-cards`):** the card PAN/CVV
never reaches the edge or the model. The edge only handles a one-time `cardToken`;
this executor redeems the real credentials server-side over an authenticated
internal channel, uses them once, and the single-use card self-closes.

## Endpoints

| Route | Body | Returns |
|-------|------|---------|
| `POST /search` | `{ query, maxResults? }` | `{ products }` |
| `POST /addresses` | `{}` | `{ addresses }` (for nearest-address selection) |
| `POST /purchase` | `{ asin\|query, quantity?, address, card?\|cardRef?, confirm }` | preview (confirm=false) or order |
| `GET /health` | — | `{ ok, live }` |

## Modes

- **MOCK (default).** No browser, no login, no real money. Uses the deterministic
  `amazonAgentMock` backend from `@intendr/commerce`. The whole vertical slice
  (search → preview → confirm → mock card → settle) runs here.
- **LIVE (`AMAZON_LIVE=1`).** On a *confirmed* purchase: redeems the real card
  credentials (via `cardRef`), then drives the browser to check out. Credential
  redemption is wired; the browser card-entry step is the remaining `TODO(agent)`
  — implement it from `test/mcp-smoke/AMAZON-MCP-RESEARCH.md` §6/§9 and the
  `amazon-mcp-starter` skeleton. Previews stay mock-cheap even in LIVE mode.

## Env

| Var | Purpose |
|-----|---------|
| `PORT` | listen port (default 8899) |
| `AMAZON_LIVE` | `1` to enable the real browser/card path |
| `VIRTUAL_CARDS_URL` | base URL of `apps/virtual-cards` (for PAN redemption) |
| `INTERNAL_SERVICE_TOKEN` | shared bearer for the internal consume endpoint |
| `CHECKOUT_EXECUTOR_ID` | executor id recorded in the card service audit log |

On the **edge** side, set `VIRTUAL_CARDS_URL` (and optionally `CARD_ISSUER=virtualcards`,
`VIRTUAL_CARDS_ACCOUNT_TOKEN`) to switch `AmazonProvider` from the mock test-card
to real single-use cards. With nothing set, everything defaults to the safe mock.

## Run

```bash
bun --cwd apps/amazon-agent run start     # mock mode
bun run apps/amazon-agent/slice.test.ts   # end-to-end slice test (no browser, no money)
```
