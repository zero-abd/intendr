import { config as loadDotenv } from "dotenv";
import { MissingApiKeyError } from "../virtual-cards/virtualCard.errors";

loadDotenv();

export type LithicEnvironment = "sandbox" | "production";

export interface AppConfig {
  /**
   * When true, skip live Lithic card creation and use DEMO_CARD_* credentials.
   * Order verification, vault, consume path, and audit events still run.
   */
  demoMode: boolean;
  lithicApiKey: string;
  lithicEnvironment: LithicEnvironment;
  maxVirtualCardAmountCents: number;
  port: number;
  internalServiceToken: string | undefined;
  credentialTtlSeconds: number;
  logLevel: string;
}

function readInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${value}".`);
  }
  return parsed;
}

/**
 * Loads and validates configuration from the environment.
 *
 * - Live mode: fails fast when LITHIC_API_KEY is missing.
 * - Demo mode: LITHIC_API_KEY is optional (a placeholder is used so the SDK
 *   client module can still load); DEMO_CARD_* must be set.
 */
export function loadConfig(): AppConfig {
  const demoMode = process.env.DEMO_MODE === "true";

  const lithicApiKey = process.env.LITHIC_API_KEY?.trim() ?? "";
  if (!demoMode && lithicApiKey === "") {
    throw new MissingApiKeyError();
  }

  const lithicEnvironment: LithicEnvironment =
    process.env.LITHIC_ENVIRONMENT === "production" ? "production" : "sandbox";

  return {
    demoMode,
    // Placeholder keeps the Lithic client constructible in demo mode; it is
    // never used for API calls when demoMode is true.
    lithicApiKey: lithicApiKey || "demo-mode-unused-key",
    lithicEnvironment,
    maxVirtualCardAmountCents: readInt(
      "MAX_VIRTUAL_CARD_AMOUNT_CENTS",
      process.env.MAX_VIRTUAL_CARD_AMOUNT_CENTS,
      100_000,
    ),
    port: readInt("PORT", process.env.PORT, 8790),
    internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN?.trim() || undefined,
    credentialTtlSeconds: readInt(
      "CREDENTIAL_TTL_SECONDS",
      process.env.CREDENTIAL_TTL_SECONDS,
      900,
    ),
    logLevel: process.env.LOG_LEVEL?.trim() || "info",
  };
}

/**
 * Singleton config. Importing this validates the environment at module load
 * time, which is what makes the application fail during startup on a missing
 * API key (unless DEMO_MODE=true).
 */
export const appConfig: AppConfig = loadConfig();
