import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { approvedOrderRepository } from "../src/virtual-cards/approvedOrder.repository";
import { cardCredentialVault } from "../src/virtual-cards/cardCredentialVault";
import {
  AmountMismatchError,
  InvalidInputError,
  MaxAmountExceededError,
  MerchantMismatchError,
  OrderNotApprovedError,
  OrderNotFoundError,
  ProviderAuthError,
  ProviderValidationError,
  UserMismatchError,
} from "../src/virtual-cards/virtualCard.errors";
import { transactionCardRepository } from "../src/virtual-cards/virtualCard.repository";
import type { ApprovedOrder } from "../src/virtual-cards/virtualCard.types";

const createMock = vi.fn();

vi.mock("../src/providers/lithicClient", () => ({
  lithic: {
    cards: {
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

// Lithic error classes used by the service mapper. Keep constructors lightweight.
vi.mock("lithic", () => {
  class LithicError extends Error {
    constructor(message = "lithic error") {
      super(message);
      this.name = new.target.name;
    }
  }
  class AuthenticationError extends LithicError {}
  class PermissionDeniedError extends LithicError {}
  class NotFoundError extends LithicError {}
  class RateLimitError extends LithicError {}
  class BadRequestError extends LithicError {}
  class UnprocessableEntityError extends LithicError {}
  class ConflictError extends LithicError {}
  class InternalServerError extends LithicError {}
  class APIConnectionError extends LithicError {}

  return {
    default: {
      AuthenticationError,
      PermissionDeniedError,
      NotFoundError,
      RateLimitError,
      BadRequestError,
      UnprocessableEntityError,
      ConflictError,
      InternalServerError,
      APIConnectionError,
    },
  };
});

const { createTransactionCard } = await import("../src/virtual-cards/virtualCard.service");
const Lithic = (await import("lithic")).default;

/** Construct mocked Lithic errors without fighting the real SDK constructor arity. */
function lithicErr(
  Ctor: new (...args: never[]) => Error,
  message: string,
): Error {
  return new (Ctor as unknown as new (message: string) => Error)(message);
}

function seedApproved(overrides: Partial<ApprovedOrder> = {}): ApprovedOrder {
  const order: ApprovedOrder = {
    orderId: "order_456",
    userId: "user_123",
    merchantName: "DoorDash",
    expectedAmount: 4287,
    approvedMaximumAmount: 5000,
    currency: "USD",
    status: "APPROVED",
    ...overrides,
  };
  approvedOrderRepository.upsert(order);
  return order;
}

function baseInput() {
  return {
    userId: "user_123",
    orderId: "order_456",
    accountToken: "acct_token_abc",
    merchantName: "DoorDash",
    expectedAmount: 4287,
    maximumAmount: 5000,
    currency: "USD",
  };
}

function mockLithicCard(overrides: Record<string, unknown> = {}) {
  return {
    token: "card_tok_lithic_1",
    state: "OPEN",
    type: "SINGLE_USE",
    last_four: "1234",
    exp_month: "12",
    exp_year: "2030",
    pan: "4111111111111111",
    cvv: "737",
    spend_limit: 5000,
    spend_limit_duration: "FOREVER",
    ...overrides,
  };
}

describe("createTransactionCard", () => {
  beforeEach(() => {
    createMock.mockReset();
    approvedOrderRepository.clear();
    transactionCardRepository.clear?.();
    cardCredentialVault.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("successfully creates a SINGLE_USE card with the correct Lithic payload", async () => {
    seedApproved();
    createMock.mockResolvedValue(mockLithicCard());

    const result = await createTransactionCard(baseInput());

    expect(result.type).toBe("SINGLE_USE");
    expect(result.state).toBe("OPEN");
    expect(result.lastFour).toBe("1234");
    expect(result.orderId).toBe("order_456");
    expect(result.cardToken).toBe("card_tok_lithic_1");
    expect(result.secureCardCredentialToken).toBeTruthy();
    expect(result.idempotentReplay).toBe(false);

    expect(createMock).toHaveBeenCalledTimes(1);
    const [payload, options] = createMock.mock.calls[0]!;
    expect(payload).toEqual({
      type: "SINGLE_USE",
      account_token: "acct_token_abc",
      state: "OPEN",
      spend_limit: 5000,
      spend_limit_duration: "FOREVER",
      memo: "MCP purchase: DoorDash - order_456",
    });
    expect(payload.spend_limit).toBe(5000);
    expect(payload.spend_limit_duration).toBe("FOREVER");
    expect(options.headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("does not create another card for a duplicate orderId", async () => {
    seedApproved();
    createMock.mockResolvedValue(mockLithicCard());

    const first = await createTransactionCard(baseInput());
    const second = await createTransactionCard(baseInput());

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(second.idempotentReplay).toBe(true);
    expect(second.cardToken).toBe(first.cardToken);
    expect(second.secureCardCredentialToken).toBeUndefined();
  });

  it("reuses the same Idempotency-Key across Lithic retries", async () => {
    seedApproved();
    createMock
      .mockRejectedValueOnce(lithicErr(Lithic.RateLimitError, "slow down"))
      .mockResolvedValueOnce(mockLithicCard());

    await createTransactionCard(baseInput());

    expect(createMock).toHaveBeenCalledTimes(2);
    const key1 = createMock.mock.calls[0]![1].headers["Idempotency-Key"];
    const key2 = createMock.mock.calls[1]![1].headers["Idempotency-Key"];
    expect(key1).toBe(key2);
  });

  it("rejects an unapproved order", async () => {
    seedApproved({ status: "PENDING" });
    await expect(createTransactionCard(baseInput())).rejects.toBeInstanceOf(OrderNotApprovedError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched user", async () => {
    seedApproved();
    await expect(
      createTransactionCard({ ...baseInput(), userId: "someone_else" }),
    ).rejects.toBeInstanceOf(UserMismatchError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched merchant", async () => {
    seedApproved();
    await expect(
      createTransactionCard({ ...baseInput(), merchantName: "Uber Eats" }),
    ).rejects.toBeInstanceOf(MerchantMismatchError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched expected amount", async () => {
    seedApproved();
    // Keep maximumAmount >= expectedAmount so input validation passes and the
    // approved-order check is what rejects the mismatch.
    await expect(
      createTransactionCard({
        ...baseInput(),
        expectedAmount: 4300,
        maximumAmount: 5000,
      }),
    ).rejects.toBeInstanceOf(AmountMismatchError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects when maximumAmount exceeds the approved maximum", async () => {
    seedApproved({ approvedMaximumAmount: 4500 });
    await expect(createTransactionCard(baseInput())).rejects.toBeInstanceOf(AmountMismatchError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an unreasonably large maximumAmount against the configured ceiling", async () => {
    seedApproved({ approvedMaximumAmount: 999_999 });
    await expect(
      createTransactionCard({ ...baseInput(), maximumAmount: 250_000 }),
    ).rejects.toBeInstanceOf(MaxAmountExceededError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a missing account token", async () => {
    seedApproved();
    await expect(
      createTransactionCard({ ...baseInput(), accountToken: "" }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects when maximumAmount is less than expectedAmount", async () => {
    seedApproved();
    await expect(
      createTransactionCard({ ...baseInput(), expectedAmount: 5000, maximumAmount: 4000 }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it("rejects when the order is not found", async () => {
    await expect(createTransactionCard(baseInput())).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it("sanitizes Lithic API errors (no raw provider payload)", async () => {
    seedApproved();
    const raw = lithicErr(
      Lithic.BadRequestError,
      "secret pan=4111111111111111 cvv=123 api_key=sk_live",
    );
    createMock.mockRejectedValue(raw);

    try {
      await createTransactionCard(baseInput());
      expect.fail("expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderValidationError);
      const message = (error as Error).message;
      expect(message).not.toContain("4111");
      expect(message).not.toContain("cvv");
      expect(message).not.toContain("sk_live");
      expect(message).not.toContain("api_key");
      expect(JSON.stringify(error)).not.toContain("test-lithic-key");
    }
  });

  it("maps Lithic authentication failures without leaking the API key", async () => {
    seedApproved();
    createMock.mockRejectedValue(lithicErr(Lithic.AuthenticationError, "invalid key test-lithic-key"));

    try {
      await createTransactionCard(baseInput());
      expect.fail("expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderAuthError);
      expect((error as Error).message).not.toContain("test-lithic-key");
    }
  });

  it("never returns API keys or full PAN/CVV from the service result", async () => {
    seedApproved();
    createMock.mockResolvedValue(mockLithicCard());

    const result = await createTransactionCard(baseInput());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("test-lithic-key");
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain("737");
    expect(result).not.toHaveProperty("pan");
    expect(result).not.toHaveProperty("cvv");
    expect(result).not.toHaveProperty("apiKey");
  });

  it("creates only one card under concurrent requests for the same order", async () => {
    seedApproved();
    createMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(mockLithicCard()), 30);
        }),
    );

    const [a, b] = await Promise.all([
      createTransactionCard(baseInput()),
      createTransactionCard(baseInput()),
    ]);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(a.cardToken).toBe(b.cardToken);
    expect([a.idempotentReplay, b.idempotentReplay].filter(Boolean).length).toBe(1);
  });

  it("does not invent PAN/CVV when Lithic omits them", async () => {
    seedApproved();
    createMock.mockResolvedValue(
      mockLithicCard({ pan: undefined, cvv: undefined, exp_month: "01", exp_year: "2029" }),
    );

    const result = await createTransactionCard(baseInput());
    expect(result.secureCardCredentialToken).toBeTruthy();

    const consumed = await cardCredentialVault.consume(result.secureCardCredentialToken!);
    expect(consumed.status).toBe("ok");
    if (consumed.status === "ok") {
      expect(consumed.credential.cardData).toEqual({
        expMonth: "01",
        expYear: "2029",
      });
      expect(consumed.credential.cardData).not.toHaveProperty("pan");
      expect(consumed.credential.cardData).not.toHaveProperty("cvv");
    }
  });
});
