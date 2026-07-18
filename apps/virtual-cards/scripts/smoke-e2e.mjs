/**
 * Local smoke test: seed an approved order, start the app, POST /api/virtual-cards.
 * Run: node scripts/smoke-e2e.mjs
 */
import { createServer } from "node:http";

process.env.LOG_LEVEL ??= "silent";

const { createApp } = await import("../src/app.ts");
const { approvedOrderRepository } = await import(
  "../src/virtual-cards/approvedOrder.repository.ts"
);

const accountToken = process.env.LITHIC_SANDBOX_ACCOUNT_TOKEN;
if (!accountToken) {
  console.error("LITHIC_SANDBOX_ACCOUNT_TOKEN missing from env");
  process.exit(1);
}

approvedOrderRepository.upsert({
  orderId: "order_smoke_001",
  userId: "user_smoke",
  merchantName: "DoorDash",
  expectedAmount: 4287,
  approvedMaximumAmount: 5000,
  currency: "USD",
  status: "APPROVED",
});

const app = createApp();
const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const res = await fetch(`http://127.0.0.1:${port}/api/virtual-cards`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: "user_smoke",
    orderId: "order_smoke_001",
    accountToken,
    merchantName: "DoorDash",
    expectedAmount: 4287,
    maximumAmount: 5000,
    currency: "USD",
  }),
});

const body = await res.json();
server.close();

// Never print credential material.
const safe = {
  httpStatus: res.status,
  success: body.success,
  card: body.card
    ? {
        orderId: body.card.orderId,
        cardToken: body.card.cardToken,
        lastFour: body.card.lastFour,
        state: body.card.state,
        type: body.card.type,
        maximumAmount: body.card.maximumAmount,
        currency: body.card.currency,
      }
    : undefined,
  error: body.error,
};

console.log(JSON.stringify(safe, null, 2));
if (!body.success || !body.card?.cardToken) process.exit(1);
