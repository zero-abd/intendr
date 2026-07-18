/**
 * Typed domain errors for the virtual-card service.
 *
 * Every error carries a stable `code` and an HTTP `status`. The `message` is
 * safe to expose to callers: it NEVER contains card credentials, API keys, or
 * raw Lithic response bodies. Provider details are logged separately (sanitized)
 * and not surfaced to the client.
 */
export type VirtualCardErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_INPUT"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_APPROVED"
  | "USER_MISMATCH"
  | "MERCHANT_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "MAX_AMOUNT_EXCEEDED"
  | "DUPLICATE_ORDER"
  | "INVALID_ACCOUNT_TOKEN"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_FORBIDDEN"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_VALIDATION_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "CREDENTIAL_TOKEN_INVALID"
  | "CREDENTIAL_TOKEN_EXPIRED"
  | "CREDENTIAL_ALREADY_CONSUMED"
  | "UNAUTHORIZED";

export class VirtualCardError extends Error {
  readonly code: VirtualCardErrorCode;
  readonly status: number;
  /** Optional machine-readable details that are safe to expose. */
  readonly details?: Record<string, unknown>;

  constructor(
    code: VirtualCardErrorCode,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class MissingApiKeyError extends VirtualCardError {
  constructor() {
    super("MISSING_API_KEY", 500, "Lithic API key is not configured.");
  }
}

export class InvalidInputError extends VirtualCardError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INVALID_INPUT", 400, message, details);
  }
}

export class OrderNotFoundError extends VirtualCardError {
  constructor(orderId: string) {
    super("ORDER_NOT_FOUND", 404, `No approved order found for orderId "${orderId}".`, {
      orderId,
    });
  }
}

export class OrderNotApprovedError extends VirtualCardError {
  constructor(orderId: string) {
    super("ORDER_NOT_APPROVED", 409, `Order "${orderId}" is not in an APPROVED state.`, {
      orderId,
    });
  }
}

export class UserMismatchError extends VirtualCardError {
  constructor(orderId: string) {
    super(
      "USER_MISMATCH",
      403,
      `Requesting user does not match the owner of order "${orderId}".`,
      { orderId },
    );
  }
}

export class MerchantMismatchError extends VirtualCardError {
  constructor(orderId: string) {
    super(
      "MERCHANT_MISMATCH",
      422,
      `Merchant does not match the approved merchant for order "${orderId}".`,
      { orderId },
    );
  }
}

export class AmountMismatchError extends VirtualCardError {
  constructor(message: string) {
    super("AMOUNT_MISMATCH", 422, message);
  }
}

export class MaxAmountExceededError extends VirtualCardError {
  constructor(requested: number, ceiling: number) {
    super(
      "MAX_AMOUNT_EXCEEDED",
      422,
      "Requested maximum amount exceeds the allowed ceiling.",
      { requested, ceiling },
    );
  }
}

export class DuplicateOrderError extends VirtualCardError {
  constructor(orderId: string) {
    super("DUPLICATE_ORDER", 409, `A card already exists for orderId "${orderId}".`, {
      orderId,
    });
  }
}

export class InvalidAccountTokenError extends VirtualCardError {
  constructor(message = "The provided Lithic account token is invalid.") {
    super("INVALID_ACCOUNT_TOKEN", 422, message);
  }
}

export class ProviderAuthError extends VirtualCardError {
  constructor() {
    super("PROVIDER_AUTH_FAILED", 502, "Payment provider authentication failed.");
  }
}

export class ProviderForbiddenError extends VirtualCardError {
  constructor() {
    super("PROVIDER_FORBIDDEN", 502, "Payment provider rejected the request (forbidden).");
  }
}

export class ProviderRateLimitError extends VirtualCardError {
  constructor() {
    super("PROVIDER_RATE_LIMITED", 503, "Payment provider is rate limiting requests.");
  }
}

export class ProviderValidationError extends VirtualCardError {
  constructor(message = "Payment provider rejected the card parameters.") {
    super("PROVIDER_VALIDATION_ERROR", 422, message);
  }
}

export class ProviderUnavailableError extends VirtualCardError {
  constructor() {
    super("PROVIDER_UNAVAILABLE", 502, "Payment provider is temporarily unavailable.");
  }
}

export class CredentialTokenInvalidError extends VirtualCardError {
  constructor() {
    super("CREDENTIAL_TOKEN_INVALID", 404, "Credential token is invalid or unknown.");
  }
}

export class CredentialTokenExpiredError extends VirtualCardError {
  constructor() {
    super("CREDENTIAL_TOKEN_EXPIRED", 410, "Credential token has expired.");
  }
}

export class CredentialAlreadyConsumedError extends VirtualCardError {
  constructor() {
    super("CREDENTIAL_ALREADY_CONSUMED", 409, "Credential token has already been consumed.");
  }
}

export class UnauthorizedError extends VirtualCardError {
  constructor(message = "Unauthorized.") {
    super("UNAUTHORIZED", 401, message);
  }
}
