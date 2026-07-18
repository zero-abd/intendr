import Lithic from "lithic";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { appConfig } from "../config/env";
import { lithic } from "../providers/lithicClient";
import { auditEvent } from "../utils/audit";
import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";
import { approvedOrderRepository } from "./approvedOrder.repository";
import { cardCredentialVault, credentialTtlMs } from "./cardCredentialVault";
import { loadDemoCardCredentials } from "./demoCard";
import {
  AmountMismatchError,
  InvalidAccountTokenError,
  InvalidInputError,
  MaxAmountExceededError,
  MerchantMismatchError,
  OrderNotApprovedError,
  OrderNotFoundError,
  ProviderAuthError,
  ProviderForbiddenError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  ProviderValidationError,
  UserMismatchError,
  VirtualCardError,
  DuplicateOrderError,
} from "./virtualCard.errors";
import { transactionCardRepository } from "./virtualCard.repository";
import type {
  CreateTransactionCardInput,
  CreatedTransactionCard,
  TransactionCardRecord,
} from "./virtualCard.types";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const positiveIntNote = "must be a positive integer in the currency's smallest unit (cents)";

export const createTransactionCardSchema = z.object({
  userId: z.string().trim().min(1, "userId is required"),
  orderId: z.string().trim().min(1, "orderId is required"),
  accountToken: z.string().trim().min(1, "accountToken is required"),
  merchantName: z.string().trim().min(1, "merchantName is required"),
  expectedAmount: z.number().int(`expectedAmount ${positiveIntNote}`).positive(`expectedAmount ${positiveIntNote}`),
  maximumAmount: z.number().int(`maximumAmount ${positiveIntNote}`).positive(`maximumAmount ${positiveIntNote}`),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "currency must be a 3-letter ISO code")
    .transform((c) => c.toUpperCase()),
});

/**
 * Validates and normalizes raw input. Throws {@link InvalidInputError} with a
 * safe message on any failure. Also enforces the cross-field and ceiling rules.
 */
export function validateCreateInput(input: unknown): CreateTransactionCardInput {
  const parsed = createTransactionCardSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const message = first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.";
    throw new InvalidInputError(message);
  }

  const value = parsed.data;

  if (value.maximumAmount < value.expectedAmount) {
    throw new InvalidInputError("maximumAmount must be greater than or equal to expectedAmount.");
  }

  if (value.maximumAmount > appConfig.maxVirtualCardAmountCents) {
    throw new MaxAmountExceededError(value.maximumAmount, appConfig.maxVirtualCardAmountCents);
  }

  return value;
}

// ---------------------------------------------------------------------------
// Approved-order verification (independent of caller-supplied claims)
// ---------------------------------------------------------------------------

/**
 * Loads the approved order from the trusted store and verifies every field
 * against the request. This is the guard that prevents a compromised or
 * hallucinating caller from issuing a card with arbitrary terms.
 */
async function verifyApprovedOrder(input: CreateTransactionCardInput): Promise<void> {
  const order = await approvedOrderRepository.findByOrderId(input.orderId);
  if (!order) {
    auditEvent("order_rejected", { orderId: input.orderId, reason: "order_not_found" });
    throw new OrderNotFoundError(input.orderId);
  }

  if (order.status !== "APPROVED") {
    auditEvent("order_rejected", { orderId: input.orderId, reason: "order_not_approved" });
    throw new OrderNotApprovedError(input.orderId);
  }

  if (order.userId !== input.userId) {
    auditEvent("order_rejected", { orderId: input.orderId, reason: "user_mismatch" });
    throw new UserMismatchError(input.orderId);
  }

  if (order.merchantName !== input.merchantName) {
    auditEvent("order_rejected", { orderId: input.orderId, reason: "merchant_mismatch" });
    throw new MerchantMismatchError(input.orderId);
  }

  if (order.expectedAmount !== input.expectedAmount) {
    auditEvent("order_rejected", { orderId: input.orderId, reason: "expected_amount_mismatch" });
    throw new AmountMismatchError("expectedAmount does not match the approved order.");
  }

  if (input.maximumAmount > order.approvedMaximumAmount) {
    auditEvent("order_rejected", { orderId: input.orderId, reason: "maximum_amount_exceeds_approved" });
    throw new AmountMismatchError("maximumAmount exceeds the approved maximum for this order.");
  }
}

// ---------------------------------------------------------------------------
// Lithic error mapping
// ---------------------------------------------------------------------------

/** Transient failures that are safe to retry with the same idempotency key. */
function isRetryableLithicError(error: unknown): boolean {
  return (
    error instanceof Lithic.RateLimitError ||
    error instanceof Lithic.InternalServerError ||
    error instanceof Lithic.APIConnectionError
  );
}

/**
 * Maps a raw Lithic/provider error to a sanitized typed error. The raw message
 * and response body are never propagated to the caller — only a generic,
 * safe message per class.
 */
function mapLithicError(error: unknown): VirtualCardError {
  if (error instanceof VirtualCardError) return error;

  if (error instanceof Lithic.AuthenticationError) return new ProviderAuthError();
  if (error instanceof Lithic.PermissionDeniedError) return new ProviderForbiddenError();
  if (error instanceof Lithic.NotFoundError) return new InvalidAccountTokenError();
  if (error instanceof Lithic.RateLimitError) return new ProviderRateLimitError();
  if (
    error instanceof Lithic.BadRequestError ||
    error instanceof Lithic.UnprocessableEntityError ||
    error instanceof Lithic.ConflictError
  ) {
    return new ProviderValidationError();
  }
  if (error instanceof Lithic.InternalServerError || error instanceof Lithic.APIConnectionError) {
    return new ProviderUnavailableError();
  }
  return new ProviderUnavailableError();
}

// ---------------------------------------------------------------------------
// Card issuance
// ---------------------------------------------------------------------------

function toResult(record: TransactionCardRecord, idempotentReplay: boolean): CreatedTransactionCard {
  return {
    cardToken: record.lithicCardToken,
    orderId: record.orderId,
    state: record.state,
    type: record.cardType,
    lastFour: record.lastFour,
    maximumAmount: record.maximumAmount,
    currency: record.currency,
    idempotentReplay,
  };
}

// Guards against two concurrent in-process requests for the same order both
// calling Lithic. The DB unique constraint (DuplicateOrderError) is the
// cross-process backstop.
const inFlight = new Map<string, Promise<CreatedTransactionCard>>();

/**
 * Persists non-sensitive metadata + vaults credentials. Shared by the live
 * Lithic path and the demo hardcoded-card path so demos still exercise the
 * full issuance infrastructure.
 */
async function persistIssuedCard(args: {
  createInput: CreateTransactionCardInput;
  lithicCardToken: string;
  state: string;
  lastFour: string;
  idempotencyKey: string;
  cardData: Record<string, string>;
}): Promise<CreatedTransactionCard> {
  const { createInput, lithicCardToken, state, lastFour, idempotencyKey, cardData } = args;

  const secureCardCredentialToken = await cardCredentialVault.store({
    orderId: createInput.orderId,
    lithicCardToken,
    cardData,
    expiresAt: new Date(Date.now() + credentialTtlMs),
  });

  const record: TransactionCardRecord = {
    id: uuidv4(),
    userId: createInput.userId,
    orderId: createInput.orderId,
    merchantName: createInput.merchantName,
    expectedAmount: createInput.expectedAmount,
    maximumAmount: createInput.maximumAmount,
    currency: createInput.currency,
    lithicCardToken,
    lithicAccountToken: createInput.accountToken,
    cardType: "SINGLE_USE",
    state,
    lastFour,
    idempotencyKey,
    createdAt: new Date(),
  };

  let stored: TransactionCardRecord;
  try {
    stored = await transactionCardRepository.insert(record);
  } catch (error) {
    // Cross-process race: another worker persisted the card first. Return the
    // existing card instead of issuing a duplicate.
    if (error instanceof DuplicateOrderError) {
      const existing = await transactionCardRepository.findByOrderId(createInput.orderId);
      if (existing) {
        auditEvent("duplicate_request_detected", { orderId: createInput.orderId });
        return toResult(existing, true);
      }
    }
    throw error;
  }

  auditEvent("transaction_card_created", {
    userId: stored.userId,
    orderId: stored.orderId,
    merchantName: stored.merchantName,
    maximumAmount: stored.maximumAmount,
    currency: stored.currency,
    lithicCardToken: stored.lithicCardToken,
    lastFour: stored.lastFour,
    reason: appConfig.demoMode ? "demo_hardcoded_card" : "lithic_issued",
  });

  return { ...toResult(stored, false), secureCardCredentialToken };
}

/**
 * DEMO ONLY: skip Lithic and vault a hardcoded card from DEMO_CARD_* env vars.
 * Still enforces approved-order checks and one-card-per-order idempotency.
 */
async function issueDemoCard(input: CreateTransactionCardInput): Promise<CreatedTransactionCard> {
  const demo = loadDemoCardCredentials();
  logger.info(
    { orderId: input.orderId, lastFour: demo.lastFour, demoMode: true },
    "issuing demo hardcoded card (Lithic create skipped)",
  );

  return persistIssuedCard({
    createInput: input,
    lithicCardToken: demo.lithicCardToken,
    state: "OPEN",
    lastFour: demo.lastFour,
    idempotencyKey: uuidv4(),
    cardData: {
      pan: demo.pan,
      cvv: demo.cvv,
      expMonth: demo.expMonth,
      expYear: demo.expYear,
    },
  });
}

async function issueCard(input: CreateTransactionCardInput): Promise<CreatedTransactionCard> {
  // Demo path: full infra, no live Lithic call.
  if (appConfig.demoMode) {
    return issueDemoCard(input);
  }

  const idempotencyKey = uuidv4();

  // Create the Lithic SINGLE_USE card. Retries reuse the SAME idempotency key,
  // so a retried request never issues a second card.
  const card = await withRetry(
    () =>
      lithic.cards.create(
        {
          type: "SINGLE_USE",
          account_token: input.accountToken,
          state: "OPEN",
          spend_limit: input.maximumAmount,
          spend_limit_duration: "FOREVER",
          memo: `MCP purchase: ${input.merchantName} - ${input.orderId}`,
        },
        { headers: { "Idempotency-Key": idempotencyKey } },
      ),
    {
      maxAttempts: 3,
      isRetryable: isRetryableLithicError,
      onRetry: (_error, attempt, delayMs) => {
        logger.warn({ orderId: input.orderId, attempt, delayMs }, "retrying Lithic card creation");
      },
    },
  ).catch((error) => {
    auditEvent("provider_error", {
      orderId: input.orderId,
      merchantName: input.merchantName,
      errorCode: error instanceof VirtualCardError ? error.code : "PROVIDER_UNKNOWN",
    });
    // Log a sanitized marker only — never the raw provider response.
    logger.error(
      { orderId: input.orderId, providerError: error?.constructor?.name ?? "unknown" },
      "Lithic card creation failed",
    );
    throw mapLithicError(error);
  });

  // Lithic docs (https://docs.lithic.com/docs/cards):
  // - Sandbox always returns `pan` / `cvv`.
  // - Production returns them ONLY for PCI-verified programs.
  // Never invent PAN/CVV. When absent, the checkout executor must use Lithic's
  // secure embed (`cards.getEmbedURL` / iframe) with `card.token`.
  //
  // PRODUCTION / PCI: prefer Lithic's embed so raw credentials never touch
  // this service. If you must handle PAN/CVV server-side, replace the
  // in-memory vault with a PCI-compliant encrypted secrets store.
  const cardData: Record<string, string> = {};
  if (typeof card.pan === "string" && card.pan.length > 0) cardData.pan = card.pan;
  if (typeof card.cvv === "string" && card.cvv.length > 0) cardData.cvv = card.cvv;
  if (typeof card.exp_month === "string" && card.exp_month.length > 0) {
    cardData.expMonth = card.exp_month;
  }
  if (typeof card.exp_year === "string" && card.exp_year.length > 0) {
    cardData.expYear = card.exp_year;
  }

  return persistIssuedCard({
    createInput: input,
    lithicCardToken: card.token,
    state: card.state,
    lastFour: card.last_four,
    idempotencyKey,
    cardData,
  });
}

/**
 * Creates exactly one Lithic SINGLE_USE virtual card for an already-approved
 * transaction. Framework-independent so it can be called directly by an MCP
 * tool handler or by the Express controller.
 *
 * Idempotent: a repeated request for the same orderId returns the existing card
 * without issuing another one.
 */
export async function createTransactionCard(
  input: CreateTransactionCardInput,
): Promise<CreatedTransactionCard> {
  const validated = validateCreateInput(input);

  auditEvent("card_requested", {
    userId: validated.userId,
    orderId: validated.orderId,
    merchantName: validated.merchantName,
    maximumAmount: validated.maximumAmount,
    currency: validated.currency,
  });

  await verifyApprovedOrder(validated);

  // Fast path: card already exists.
  const existing = await transactionCardRepository.findByOrderId(validated.orderId);
  if (existing) {
    auditEvent("duplicate_request_detected", { orderId: validated.orderId });
    return toResult(existing, true);
  }

  // Concurrency guard: coalesce simultaneous requests for the same order.
  const pending = inFlight.get(validated.orderId);
  if (pending) {
    const result = await pending;
    return { ...result, idempotentReplay: true, secureCardCredentialToken: undefined };
  }

  const promise = issueCard(validated).finally(() => inFlight.delete(validated.orderId));
  inFlight.set(validated.orderId, promise);
  return promise;
}
