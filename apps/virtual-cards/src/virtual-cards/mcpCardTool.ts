import { auditEvent } from "../utils/audit";
import { createTransactionCard } from "./virtualCard.service";

/**
 * MCP-facing input. `currency` is optional and defaults to USD. The language
 * model may populate these fields, but the backend NEVER trusts them: the
 * service independently loads the approved order and re-verifies the user,
 * merchant, expected amount, and approved maximum before issuing a card. The
 * model cannot pick an arbitrary spend limit that exceeds the approved maximum.
 */
export interface RequestTransactionCardInput {
  userId: string;
  orderId: string;
  accountToken: string;
  merchantName: string;
  expectedAmount: number;
  maximumAmount: number;
  currency?: string;
}

/**
 * Minimal, model-safe result. Contains NO card credentials (PAN/CVV/expiry) and
 * NO one-time secure credential token — those never enter the model context.
 * The `cardToken` is Lithic's opaque card identifier, which is safe to surface.
 */
export interface RequestTransactionCardResult {
  orderId: string;
  cardToken: string;
  lastFour: string;
  state: string;
  type: string;
  maximumAmount: number;
  currency: string;
}

/**
 * MCP tool handler: after a transaction has already been approved, create
 * exactly one Lithic SINGLE_USE card for it and return only what the checkout
 * executor needs to proceed.
 *
 * This is intentionally NOT a general-purpose card-creation tool — it can only
 * issue a card that exactly matches an independently-approved order.
 */
export async function requestTransactionCard(
  input: RequestTransactionCardInput,
): Promise<RequestTransactionCardResult> {
  const created = await createTransactionCard({
    userId: input.userId,
    orderId: input.orderId,
    accountToken: input.accountToken,
    merchantName: input.merchantName,
    expectedAmount: input.expectedAmount,
    maximumAmount: input.maximumAmount,
    currency: input.currency ?? "USD",
  });

  auditEvent("card_requested", {
    orderId: created.orderId,
    reason: created.idempotentReplay ? "mcp_replay" : "mcp_new",
  });

  return {
    orderId: created.orderId,
    cardToken: created.cardToken,
    lastFour: created.lastFour,
    state: created.state,
    type: created.type,
    maximumAmount: created.maximumAmount,
    currency: created.currency,
  };
}
