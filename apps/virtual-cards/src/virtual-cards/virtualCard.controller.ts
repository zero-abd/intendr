import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { consumeCardCredentials } from "./consumeCardCredentials";
import { InvalidInputError, VirtualCardError } from "./virtualCard.errors";
import { createTransactionCard } from "./virtualCard.service";

/**
 * Public REST response. Never includes PAN, CVV, expiration combined with PAN,
 * Lithic API keys, or raw provider payloads.
 *
 * `cardToken` is the opaque one-time vault token when the card was just
 * created (redeemable only by a trusted checkout executor via the internal
 * consume endpoint). On idempotent replay it falls back to the Lithic card
 * token, which is safe to store as a payment reference but cannot retrieve
 * credentials by itself.
 */
export interface VirtualCardApiResponse {
  success: true;
  card: {
    orderId: string;
    cardToken: string;
    lastFour: string;
    state: string;
    type: string;
    maximumAmount: number;
    currency: string;
  };
}

export async function createVirtualCardHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const created = await createTransactionCard(req.body);

    // Prefer the opaque vault token for the public `cardToken` field so the
    // checkout executor can redeem credentials once. Never put PAN/CVV here.
    const cardToken = created.secureCardCredentialToken ?? created.cardToken;

    const body: VirtualCardApiResponse = {
      success: true,
      card: {
        orderId: created.orderId,
        cardToken,
        lastFour: created.lastFour,
        state: created.state,
        type: created.type,
        maximumAmount: created.maximumAmount,
        currency: created.currency,
      },
    };

    res.status(created.idempotentReplay ? 200 : 201).json(body);
  } catch (error) {
    next(error);
  }
}

const consumeBodySchema = z.object({
  secureCredentialToken: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  checkoutExecutorId: z.string().trim().min(1),
});

/**
 * Internal-only: redeem one-time credentials for the trusted checkout executor.
 * Guarded by {@link internalServiceAuth}. Credentials are returned only here
 * and must never be forwarded to an LLM prompt or a public client.
 */
export async function consumeCardCredentialsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = consumeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InvalidInputError("secureCredentialToken, orderId, and checkoutExecutorId are required.");
    }

    const credentials = await consumeCardCredentials(parsed.data);

    // PRODUCTION / PCI: this response may contain PAN/CVV when Lithic returns
    // them (sandbox always; production only for PCI-verified programs).
    // Transport must be mTLS or equivalent private network; never log `cardData`.
    res.status(200).json({
      success: true,
      orderId: credentials.orderId,
      lithicCardToken: credentials.lithicCardToken,
      cardData: credentials.cardData,
    });
  } catch (error) {
    next(error);
  }
}

/** Maps typed domain errors to sanitized HTTP responses. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof VirtualCardError) {
    res.status(error.status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  });
}
