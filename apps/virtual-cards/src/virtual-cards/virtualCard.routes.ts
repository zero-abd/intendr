import { Router } from "express";

import { internalServiceAuth } from "../middleware/internalServiceAuth";
import {
  consumeCardCredentialsHandler,
  createVirtualCardHandler,
} from "./virtualCard.controller";

export const virtualCardRouter = Router();

/**
 * POST /api/virtual-cards
 *
 * Creates exactly one Lithic SINGLE_USE card for an already-approved order.
 * Response never includes PAN/CVV or the Lithic API key.
 */
virtualCardRouter.post("/", createVirtualCardHandler);

/**
 * POST /internal/card-credentials/consume
 *
 * Service-to-service only. Redeems a one-time vault token for the trusted
 * MCP checkout executor. Never expose this route to the language model or
 * browser clients.
 */
export const internalCredentialRouter = Router();
internalCredentialRouter.post(
  "/card-credentials/consume",
  internalServiceAuth,
  consumeCardCredentialsHandler,
);
