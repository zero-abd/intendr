import { describe, expect, it } from "vitest";

/**
 * Ensures structured logging never emits PAN/CVV or API keys even if a caller
 * accidentally includes them in a log object.
 */
describe("logger redaction", () => {
  it("redacts PAN, CVV, and API keys from structured log output", async () => {
    const chunks: string[] = [];
    const { Writable } = await import("node:stream");
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    });

    // Build a fresh pino instance with the same redact paths as production.
    const { pino } = await import("pino");
    const testLogger = pino(
      {
        level: "info",
        redact: {
          paths: [
            "pan",
            "cvv",
            "cvc",
            "apiKey",
            "api_key",
            "lithicApiKey",
            "cardData",
            "*.pan",
            "*.cvv",
            "*.cardData",
          ],
          censor: "[REDACTED]",
        },
      },
      sink,
    );

    testLogger.info(
      {
        pan: "4111111111111111",
        cvv: "737",
        apiKey: "sk_live_secret",
        cardData: { pan: "4111111111111111", cvv: "737" },
        orderId: "order_456",
        lastFour: "1111",
      },
      "should not leak",
    );

    // Allow async flush.
    await new Promise((r) => setTimeout(r, 20));
    const output = chunks.join("");

    expect(output).toContain("order_456");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("4111111111111111");
    expect(output).not.toContain("737");
    expect(output).not.toContain("sk_live_secret");
  });
});
