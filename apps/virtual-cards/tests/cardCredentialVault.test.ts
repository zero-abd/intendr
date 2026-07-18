import { afterEach, describe, expect, it } from "vitest";

import { InMemoryCardCredentialVault } from "../src/virtual-cards/cardCredentialVault";

describe("InMemoryCardCredentialVault", () => {
  const vault = new InMemoryCardCredentialVault();

  afterEach(() => {
    vault.clear();
  });

  it("stores credentials behind a cryptographically random opaque token", async () => {
    const token = await vault.store({
      orderId: "order_1",
      lithicCardToken: "card_tok_1",
      cardData: { pan: "4111111111111111", cvv: "123" },
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).not.toContain("4111");
    expect(token).not.toContain("123");
  });

  it("allows a credential token to be consumed only once", async () => {
    const token = await vault.store({
      orderId: "order_1",
      lithicCardToken: "card_tok_1",
      cardData: { pan: "4111111111111111", cvv: "999" },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await vault.consume(token);
    expect(first.status).toBe("ok");
    if (first.status === "ok") {
      expect(first.credential.orderId).toBe("order_1");
      expect(first.credential.cardData).toEqual({
        pan: "4111111111111111",
        cvv: "999",
      });
    }

    const second = await vault.consume(token);
    expect(second.status).toBe("already_consumed");
  });

  it("rejects an expired credential token", async () => {
    const token = await vault.store({
      orderId: "order_1",
      lithicCardToken: "card_tok_1",
      cardData: { pan: "4111111111111111" },
      expiresAt: new Date(Date.now() - 1),
    });

    const result = await vault.consume(token);
    expect(result.status).toBe("expired");
  });

  it("returns unknown for a token that was never issued", async () => {
    const result = await vault.consume("not-a-real-token");
    expect(result.status).toBe("unknown");
  });
});
