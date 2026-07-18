import { auditEvent } from "../utils/audit";
import { cardCredentialVault } from "./cardCredentialVault";
import {
  CredentialAlreadyConsumedError,
  CredentialTokenExpiredError,
  CredentialTokenInvalidError,
} from "./virtualCard.errors";

/**
 * Internal-only credential retrieval.
 *
 * This function must be reachable ONLY through a service-to-service authenticated
 * path (see middleware/internalServiceAuth). It is never exposed to a public
 * REST route, the frontend, or the language model.
 */
export interface ConsumeCardCredentialsInput {
  secureCredentialToken: string;
  orderId: string;
  checkoutExecutorId: string;
}

export interface ConsumedCardCredentials {
  orderId: string;
  lithicCardToken: string;
  /**
   * Raw card credentials (PAN/CVV/expiry) IF the Lithic program returns them
   * (PCI-enabled programs only — see https://docs.lithic.com/docs/cards).
   * In Sandbox, Lithic returns `pan`/`cvv` for all clients. In Production,
   * those fields are only available to programs that have verified PCI
   * compliance.
   *
   * For non-PCI programs these fields will be undefined/absent and the
   * executor must obtain credentials via Lithic's supported secure mechanism
   * (e.g. `cards.getEmbedURL` / embed iframe) using `lithicCardToken`.
   *
   * PRODUCTION: returning raw PAN/CVV from your own service requires PCI-DSS
   * compliance. Prefer Lithic's client-side secure card element so credentials
   * never touch your servers.
   */
  cardData: unknown;
}

/**
 * Redeems a one-time secure credential token for the trusted checkout executor.
 *
 * Guarantees:
 *  - one successful retrieval only (enforced by the vault),
 *  - token must belong to the same order,
 *  - expired/consumed tokens are rejected,
 *  - an audit event is recorded,
 *  - credentials are only returned here and never logged.
 */
export async function consumeCardCredentials(
  input: ConsumeCardCredentialsInput,
): Promise<ConsumedCardCredentials> {
  const result = await cardCredentialVault.consume(input.secureCredentialToken);

  if (result.status === "unknown") {
    auditEvent("credentials_consumed", {
      orderId: input.orderId,
      checkoutExecutorId: input.checkoutExecutorId,
      reason: "rejected_unknown",
    });
    throw new CredentialTokenInvalidError();
  }

  if (result.status === "expired") {
    auditEvent("credentials_consumed", {
      orderId: input.orderId,
      checkoutExecutorId: input.checkoutExecutorId,
      reason: "rejected_expired",
    });
    throw new CredentialTokenExpiredError();
  }

  if (result.status === "already_consumed") {
    auditEvent("credentials_consumed", {
      orderId: input.orderId,
      checkoutExecutorId: input.checkoutExecutorId,
      reason: "rejected_already_consumed",
    });
    throw new CredentialAlreadyConsumedError();
  }

  const stored = result.credential;

  if (stored.orderId !== input.orderId) {
    auditEvent("credentials_consumed", {
      orderId: input.orderId,
      checkoutExecutorId: input.checkoutExecutorId,
      reason: "rejected_order_mismatch",
    });
    throw new CredentialTokenInvalidError();
  }

  auditEvent("credentials_consumed", {
    orderId: stored.orderId,
    checkoutExecutorId: input.checkoutExecutorId,
    lithicCardToken: stored.lithicCardToken,
    reason: "success",
  });

  return {
    orderId: stored.orderId,
    lithicCardToken: stored.lithicCardToken,
    cardData: stored.cardData,
  };
}
