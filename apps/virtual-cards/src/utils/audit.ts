import { logger } from "./logger";

/**
 * Audit events for security-relevant actions. These are emitted as structured
 * logs at `info` level with a stable `audit: true` marker so they can be routed
 * to a dedicated, tamper-evident sink in production (e.g. an append-only store).
 *
 * Audit payloads must only ever contain non-sensitive metadata.
 */
export type AuditEventType =
  | "card_requested"
  | "order_rejected"
  | "transaction_card_created"
  | "duplicate_request_detected"
  | "credentials_consumed"
  | "provider_error";

export interface AuditFields {
  userId?: string;
  orderId?: string;
  merchantName?: string;
  maximumAmount?: number;
  currency?: string;
  lithicCardToken?: string;
  lastFour?: string;
  reason?: string;
  errorCode?: string;
  checkoutExecutorId?: string;
  [key: string]: unknown;
}

export function auditEvent(event: AuditEventType, fields: AuditFields = {}): void {
  logger.info({ audit: true, event, ...fields }, `audit:${event}`);
}
