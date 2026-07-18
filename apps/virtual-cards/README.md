# @intendr/virtual-cards

Backend service that issues **exactly one** Lithic `SINGLE_USE` virtual card for an already-approved MCP purchase.

This package does **not** implement ordering, carts, checkout automation, product search, deposits, or funding. It only creates a spend-capped Lithic card after independent order verification.

Verified against Lithic docs:

- [Cards](https://docs.lithic.com/docs/cards) — `SINGLE_USE` closes after the first successful authorization
- [Spend limits](https://docs.lithic.com/docs/spend-limits) — use `FOREVER` (not `TRANSACTION`) so lifetime approved spend is capped
- [Idempotent requests](https://docs.lithic.com/docs/idempotent-requests) — UUID `Idempotency-Key` on `POST /v1/cards`

## Install

From the monorepo root:

```bash
bun install
```

Or in this package:

```bash
cd apps/virtual-cards
bun install
```

## Configure

```bash
cp .env.example .env
# set DEMO_CARD_* (demo) or LITHIC_API_KEY (live), plus INTERNAL_SERVICE_TOKEN
```

### Demo mode (default for pitch demos)

Set `DEMO_MODE=true` and fill in a hardcoded card:

```env
DEMO_MODE=true
DEMO_CARD_PAN=4111111111111111
DEMO_CARD_CVV=123
DEMO_CARD_EXP_MONTH=12
DEMO_CARD_EXP_YEAR=2030
```

In demo mode the service **still runs the full infrastructure** (approved-order verification, one card per `orderId`, opaque vault token, `/internal/card-credentials/consume`, audit logs) but **skips** the live Lithic `cards.create` call and vaults your hardcoded card instead.

The real Lithic `SINGLE_USE` issuance path stays in the repo — set `DEMO_MODE=false` and provide `LITHIC_API_KEY` to use it.

### Live Lithic mode

When `DEMO_MODE=false`, the process **fails at startup** if `LITHIC_API_KEY` is missing.

## Run

```bash
bun run dev      # http://localhost:8790
bun run test
bun run typecheck
```

## How the existing MCP calls this

After the MCP/budget flow has **already approved** an order (and written it to the approved-order store), the trusted MCP tool handler should call `requestTransactionCard` — not a general-purpose “create card” tool exposed to the model:

```ts
import { requestTransactionCard } from "@intendr/virtual-cards";
// or: import { requestTransactionCard } from "./virtual-cards/mcpCardTool";

const card = await requestTransactionCard({
  userId: "user_123",
  orderId: "order_456",
  accountToken: process.env.LITHIC_ACCOUNT_TOKEN!, // from your wallet/account binding — not chosen by the model
  merchantName: "DoorDash",
  expectedAmount: 4287, // cents
  maximumAmount: 5000,  // cents; must be <= approvedMaximumAmount
  currency: "USD",
});

// Safe for model context / checkout orchestration metadata:
// { orderId, cardToken, lastFour, state, type, maximumAmount, currency }
//
// Never put PAN/CVV into the LLM prompt. If the checkout executor needs
// credentials, redeem the one-time vault token via the internal endpoint
// (service-to-service auth only).
```

The service independently loads the approved order and verifies:

- `userId`, `orderId`, `merchantName`, `expectedAmount` match
- `maximumAmount <= approvedMaximumAmount`
- `status === "APPROVED"`

## Sample request / sanitized response

```bash
curl -s -X POST http://localhost:8790/api/virtual-cards \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "orderId": "order_456",
    "accountToken": "lithic-account-token",
    "merchantName": "DoorDash",
    "expectedAmount": 4287,
    "maximumAmount": 5000,
    "currency": "USD"
  }'
```

Sanitized response (no PAN/CVV, no API key):

```json
{
  "success": true,
  "card": {
    "orderId": "order_456",
    "cardToken": "opaque-one-time-vault-token",
    "lastFour": "1234",
    "state": "OPEN",
    "type": "SINGLE_USE",
    "maximumAmount": 5000,
    "currency": "USD"
  }
}
```

Lithic create payload used by the service:

```ts
{
  type: "SINGLE_USE",
  account_token: accountToken,
  state: "OPEN",
  spend_limit: maximumAmount,       // cents
  spend_limit_duration: "FOREVER",  // lifetime cap — not TRANSACTION
  memo: `MCP purchase: ${merchantName} - ${orderId}`,
}
```

## Internal credential redeem (trusted checkout executor only)

```bash
curl -s -X POST http://localhost:8790/internal/card-credentials/consume \
  -H "Authorization: Bearer $INTERNAL_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "secureCredentialToken": "opaque-one-time-vault-token",
    "orderId": "order_456",
    "checkoutExecutorId": "checkout-executor-1"
  }'
```

**PRODUCTION / PCI:** Lithic only returns raw `pan`/`cvv` in production for PCI-verified programs. Prefer Lithic’s secure embed (`cards.getEmbedURL`) so credentials never touch your servers. The in-memory vault is for local development — replace it with an encrypted PCI-compliant secrets store before production.

## Database

See [`migrations/0001_transaction_cards.sql`](./migrations/0001_transaction_cards.sql). The unique constraint on `order_id` prevents issuing two cards for the same order.

## Sandbox integration test

```bash
RUN_LITHIC_SANDBOX_TESTS=true \
LITHIC_API_KEY=... \
LITHIC_SANDBOX_ACCOUNT_TOKEN=... \
bun run test
```
