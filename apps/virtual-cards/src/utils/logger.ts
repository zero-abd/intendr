import { pino } from "pino";
import { appConfig } from "../config/env";

/**
 * Structured logger.
 *
 * `redact` is a defense-in-depth guard: even if a caller accidentally passes a
 * sensitive field, pino will replace it with `[REDACTED]`. We still never
 * intentionally log PAN, CVV, expiration, auth headers, API keys, or raw
 * provider responses.
 */
export const logger = pino({
  level: appConfig.logLevel,
  redact: {
    paths: [
      "pan",
      "cvv",
      "cvc",
      "apiKey",
      "api_key",
      "lithicApiKey",
      "authorization",
      "Authorization",
      "headers.authorization",
      "*.pan",
      "*.cvv",
      "*.cvc",
      "*.apiKey",
      "*.api_key",
      "cardData",
      "*.cardData",
      "credentials",
      "*.credentials",
    ],
    censor: "[REDACTED]",
  },
});

export type Logger = typeof logger;
