import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { appConfig } from "../src/config/env";
import { approvedOrderRepository } from "../src/virtual-cards/approvedOrder.repository";
import { cardCredentialVault } from "../src/virtual-cards/cardCredentialVault";
import { transactionCardRepository } from "../src/virtual-cards/virtualCard.repository";

const createMock = vi.fn();

vi.mock("../src/providers/lithicClient", () => ({
  lithic: {
    cards: {
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

vi.mock("lithic", () => {
  class LithicError extends Error {
    constructor(message = "lithic error") {
      super(message);
      this.name = new.target.name;
    }
  }
  return {
    default: {
      AuthenticationError: class extends LithicError {},
      PermissionDeniedError: class extends LithicError {},
      NotFoundError: class extends LithicError {},
      RateLimitError: class extends LithicError {},
      BadRequestError: class extends LithicError {},
      UnprocessableEntityError: class extends LithicError {},
      ConflictError: class extends LithicError {},
      InternalServerError: class extends LithicError {},
      APIConnectionError: class extends LithicError {},
    },
  };
});

const { createApp } = await import("../src/app");

function seedApproved() {
  approvedOrderRepository.upsert({
    orderId: "order_456",
    userId: "user_123",
    merchantName: "DoorDash",
    expectedAmount: 4287,
    approvedMaximumAmount: 5000,
    currency: "USD",
    status: "APPROVED",
  });
}

const body = {
  userId: "user_123",
  orderId: "order_456",
  accountToken: "acct_token_abc",
  merchantName: "DoorDash",
  expectedAmount: 4287,
  maximumAmount: 5000,
  currency: "USD",
};

describe("POST /api/virtual-cards", () => {
  const app = createApp();

  beforeEach(() => {
    createMock.mockReset();
    approvedOrderRepository.clear();
    transactionCardRepository.clear?.();
    cardCredentialVault.clear();
    seedApproved();
    createMock.mockResolvedValue({
      token: "card_tok_lithic_1",
      state: "OPEN",
      type: "SINGLE_USE",
      last_four: "1234",
      exp_month: "12",
      exp_year: "2030",
      pan: "4111111111111111",
      cvv: "737",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a sanitized success payload without credentials or API keys", async () => {
    const res = await request(app).post("/api/virtual-cards").send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.card).toMatchObject({
      orderId: "order_456",
      lastFour: "1234",
      state: "OPEN",
      type: "SINGLE_USE",
      maximumAmount: 5000,
      currency: "USD",
    });
    expect(typeof res.body.card.cardToken).toBe("string");
    expect(res.body.card.cardToken).not.toBe("card_tok_lithic_1"); // opaque vault token
    expect(JSON.stringify(res.body)).not.toContain("4111111111111111");
    expect(JSON.stringify(res.body)).not.toContain("737");
    expect(JSON.stringify(res.body)).not.toContain("test-lithic-key");
    expect(res.body.card).not.toHaveProperty("pan");
    expect(res.body.card).not.toHaveProperty("cvv");
    expect(res.body).not.toHaveProperty("apiKey");
  });

  it("maps validation failures to 400 without leaking provider details", async () => {
    const res = await request(app)
      .post("/api/virtual-cards")
      .send({ ...body, accountToken: "" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INVALID_INPUT");
    expect(JSON.stringify(res.body)).not.toContain("test-lithic-key");
  });

  it("rejects unapproved orders with a typed error", async () => {
    approvedOrderRepository.upsert({
      orderId: "order_456",
      userId: "user_123",
      merchantName: "DoorDash",
      expectedAmount: 4287,
      approvedMaximumAmount: 5000,
      currency: "USD",
      status: "REJECTED",
    });

    const res = await request(app).post("/api/virtual-cards").send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_NOT_APPROVED");
  });
});

describe("POST /internal/card-credentials/consume", () => {
  const app = createApp();

  beforeEach(() => {
    createMock.mockReset();
    approvedOrderRepository.clear();
    transactionCardRepository.clear?.();
    cardCredentialVault.clear();
    seedApproved();
    createMock.mockResolvedValue({
      token: "card_tok_lithic_1",
      state: "OPEN",
      type: "SINGLE_USE",
      last_four: "1234",
      pan: "4111111111111111",
      cvv: "737",
      exp_month: "12",
      exp_year: "2030",
    });
  });

  it("requires service-to-service auth", async () => {
    const res = await request(app)
      .post("/internal/card-credentials/consume")
      .send({
        secureCredentialToken: "x",
        orderId: "order_456",
        checkoutExecutorId: "executor_1",
      });
    expect(res.status).toBe(401);
  });

  it("redeems credentials once for an authenticated checkout executor", async () => {
    const createRes = await request(app).post("/api/virtual-cards").send(body);
    const secureToken = createRes.body.card.cardToken as string;

    const serviceToken = appConfig.internalServiceToken;
    expect(serviceToken).toBeTruthy();

    const first = await request(app)
      .post("/internal/card-credentials/consume")
      .set("Authorization", `Bearer ${serviceToken}`)
      .send({
        secureCredentialToken: secureToken,
        orderId: "order_456",
        checkoutExecutorId: "executor_1",
      });

    expect(first.status).toBe(200);
    expect(first.body.cardData.pan).toBe("4111111111111111");
    expect(first.body.cardData.cvv).toBe("737");

    const second = await request(app)
      .post("/internal/card-credentials/consume")
      .set("Authorization", `Bearer ${serviceToken}`)
      .send({
        secureCredentialToken: secureToken,
        orderId: "order_456",
        checkoutExecutorId: "executor_1",
      });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CREDENTIAL_ALREADY_CONSUMED");
  });
});
