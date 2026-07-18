import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("lithic", () => ({
  default: {
    AuthenticationError: class extends Error {},
    PermissionDeniedError: class extends Error {},
    NotFoundError: class extends Error {},
    RateLimitError: class extends Error {},
    BadRequestError: class extends Error {},
    UnprocessableEntityError: class extends Error {},
    ConflictError: class extends Error {},
    InternalServerError: class extends Error {},
    APIConnectionError: class extends Error {},
  },
}));

const { createTransactionCard } = await import("../src/virtual-cards/virtualCard.service");

describe("demo mode hardcoded card", () => {
  const previousDemoMode = appConfig.demoMode;

  beforeEach(() => {
    createMock.mockReset();
    approvedOrderRepository.clear();
    transactionCardRepository.clear?.();
    cardCredentialVault.clear();

    appConfig.demoMode = true;
    process.env.DEMO_CARD_PAN = "4111111111111111";
    process.env.DEMO_CARD_CVV = "123";
    process.env.DEMO_CARD_EXP_MONTH = "12";
    process.env.DEMO_CARD_EXP_YEAR = "2030";

    approvedOrderRepository.upsert({
      orderId: "order_demo",
      userId: "user_demo",
      merchantName: "DoorDash",
      expectedAmount: 1000,
      approvedMaximumAmount: 1500,
      currency: "USD",
      status: "APPROVED",
    });
  });

  afterEach(() => {
    appConfig.demoMode = previousDemoMode;
    vi.clearAllMocks();
  });

  it("issues via vault without calling Lithic, and consume returns the hardcoded card", async () => {
    const created = await createTransactionCard({
      userId: "user_demo",
      orderId: "order_demo",
      accountToken: "demo-account",
      merchantName: "DoorDash",
      expectedAmount: 1000,
      maximumAmount: 1500,
      currency: "USD",
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(created.type).toBe("SINGLE_USE");
    expect(created.lastFour).toBe("1111");
    expect(created.secureCardCredentialToken).toBeTruthy();

    const { consumeCardCredentials } = await import(
      "../src/virtual-cards/consumeCardCredentials"
    );
    const credentials = await consumeCardCredentials({
      secureCredentialToken: created.secureCardCredentialToken!,
      orderId: "order_demo",
      checkoutExecutorId: "demo-checkout",
    });

    expect(credentials.cardData).toEqual({
      pan: "4111111111111111",
      cvv: "123",
      expMonth: "12",
      expYear: "2030",
    });
  });
});
