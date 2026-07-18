import Lithic from "lithic";
import { appConfig } from "../config/env";

/**
 * Reusable Lithic client, configured entirely from validated environment
 * variables.
 *
 * SECURITY: `appConfig.lithicApiKey` is passed here and nowhere else. The key
 * must never be logged, returned in an API response, placed in an LLM prompt,
 * or exposed to the browser/MCP model context.
 */
export const lithic = new Lithic({
  apiKey: appConfig.lithicApiKey,
  environment: appConfig.lithicEnvironment === "production" ? "production" : "sandbox",
  // Card creation retries are handled explicitly in the service (with a single,
  // reused idempotency key), so disable the SDK's own automatic retries to
  // avoid interacting with our backoff logic.
  maxRetries: 0,
});

export type LithicClient = typeof lithic;
