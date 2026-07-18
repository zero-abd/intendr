import { describe, expect, it } from "vitest";

/**
 * Live Lithic sandbox integration test.
 *
 * Disabled unless:
 *   RUN_LITHIC_SANDBOX_TESTS=true
 *   LITHIC_API_KEY=<sandbox key>
 *   LITHIC_SANDBOX_ACCOUNT_TOKEN=<sandbox account token>
 *
 * Verifies against the real Lithic Create Card API that we create a
 * SINGLE_USE card with spend_limit_duration FOREVER.
 * See: https://docs.lithic.com/docs/cards
 *      https://docs.lithic.com/docs/spend-limits
 *      https://docs.lithic.com/docs/idempotent-requests
 */
const runSandbox = process.env.RUN_LITHIC_SANDBOX_TESTS === "true";

describe.runIf(runSandbox)("Lithic sandbox card creation", () => {
  it("creates a SINGLE_USE card with FOREVER spend limit", async () => {
    const accountToken = process.env.LITHIC_SANDBOX_ACCOUNT_TOKEN;
    if (!accountToken) {
      throw new Error("LITHIC_SANDBOX_ACCOUNT_TOKEN is required for sandbox tests.");
    }

    // Import after env is confirmed so the real client is constructed with the
    // sandbox key (tests/setup.ts may have set a placeholder).
    const { default: Lithic } = await import("lithic");
    const client = new Lithic({
      apiKey: process.env.LITHIC_API_KEY!,
      environment: "sandbox",
      maxRetries: 0,
    });

    const { v4: uuidv4 } = await import("uuid");
    const idempotencyKey = uuidv4();

    const card = await client.cards.create(
      {
        type: "SINGLE_USE",
        account_token: accountToken,
        state: "OPEN",
        spend_limit: 5000,
        spend_limit_duration: "FOREVER",
        memo: "MCP sandbox test",
      },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );

    expect(card.type).toBe("SINGLE_USE");
    expect(card.state).toBe("OPEN");
    expect(card.spend_limit).toBe(5000);
    expect(card.spend_limit_duration).toBe("FOREVER");
    expect(card.token).toBeTruthy();
    expect(card.last_four).toMatch(/^\d{4}$/);

    // Sandbox returns PAN/CVV for all clients (PCI production restriction
    // does not apply in sandbox). We assert presence but do not log values.
    expect(typeof card.pan === "string" || card.pan === undefined).toBe(true);
    expect(typeof card.cvv === "string" || card.cvv === undefined).toBe(true);

    // Close the card so the sandbox does not accumulate open test cards.
    await client.cards.update(card.token, { state: "CLOSED" });
  });
});
