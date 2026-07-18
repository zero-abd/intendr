import { randomBytes } from "node:crypto";
import { appConfig } from "../config/env";

/**
 * Vault for sensitive card credentials.
 *
 * The vault issues an opaque, cryptographically random `secureToken` that can be
 * redeemed exactly once, by a trusted internal caller, before it expires. The
 * raw credentials themselves are never returned from a public endpoint, logged,
 * or placed in an LLM prompt.
 */
export interface StoreCredentialInput {
  orderId: string;
  lithicCardToken: string;
  cardData: unknown;
  expiresAt: Date;
}

export interface StoredCredential {
  orderId: string;
  lithicCardToken: string;
  cardData: unknown;
}

/** Outcome of a vault consume attempt (never includes credentials on failure). */
export type ConsumeResult =
  | { status: "ok"; credential: StoredCredential }
  | { status: "unknown" }
  | { status: "expired" }
  | { status: "already_consumed" };

export interface CardCredentialVault {
  /** Stores credentials and returns a one-time secure token. */
  store(input: StoreCredentialInput): Promise<string>;
  /**
   * Redeems a secure token exactly once. Distinguishes unknown / expired /
   * already-consumed so callers can map to typed errors without logging
   * credentials.
   */
  consume(secureToken: string): Promise<ConsumeResult>;
}

interface VaultEntry {
  orderId: string;
  lithicCardToken: string;
  /** Cleared immediately after a successful consume (tombstone remains). */
  cardData: unknown | null;
  expiresAt: number;
  consumed: boolean;
}

/**
 * In-memory vault for local development and tests.
 *
 * PRODUCTION: this MUST be replaced with an encrypted secrets store or a
 * PCI-compliant vault (e.g. AWS Secrets Manager / KMS-encrypted storage, HashiCorp
 * Vault, or the card processor's own secure element). Never persist raw card
 * credentials in application memory or an unencrypted database in production.
 */
export class InMemoryCardCredentialVault implements CardCredentialVault {
  private readonly entries = new Map<string, VaultEntry>();

  async store(input: StoreCredentialInput): Promise<string> {
    // 32 random bytes -> 256 bits of entropy, URL-safe.
    const secureToken = randomBytes(32).toString("base64url");
    this.entries.set(secureToken, {
      orderId: input.orderId,
      lithicCardToken: input.lithicCardToken,
      cardData: input.cardData,
      expiresAt: input.expiresAt.getTime(),
      consumed: false,
    });
    return secureToken;
  }

  async consume(secureToken: string): Promise<ConsumeResult> {
    const entry = this.entries.get(secureToken);
    if (!entry) return { status: "unknown" };

    if (entry.consumed) return { status: "already_consumed" };

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(secureToken);
      return { status: "expired" };
    }

    const cardData = entry.cardData;
    // Keep a tombstone so a second redeem returns already_consumed (not unknown),
    // but wipe credentials from memory immediately.
    entry.consumed = true;
    entry.cardData = null;

    return {
      status: "ok",
      credential: {
        orderId: entry.orderId,
        lithicCardToken: entry.lithicCardToken,
        cardData,
      },
    };
  }

  /** Test helper: clears all stored credentials. */
  clear(): void {
    this.entries.clear();
  }

  /** Test helper: inspects whether a token is still redeemable. */
  has(secureToken: string): boolean {
    return this.entries.has(secureToken);
  }
}

/** Default TTL applied when the service stores a credential. */
export const credentialTtlMs = appConfig.credentialTtlSeconds * 1_000;

/** Default singleton used by the service and internal credential endpoint. */
export const cardCredentialVault = new InMemoryCardCredentialVault();
