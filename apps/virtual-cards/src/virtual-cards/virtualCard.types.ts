/**
 * Public and internal types for the virtual-card service.
 *
 * All monetary amounts are integers in the currency's smallest unit
 * (cents for USD).
 */

export type CardType = "SINGLE_USE";

/** Input accepted by the core service (framework-independent). */
export interface CreateTransactionCardInput {
  userId: string;
  orderId: string;
  accountToken: string;
  merchantName: string;
  expectedAmount: number;
  maximumAmount: number;
  currency: string;
}

/**
 * Result returned by the core service. `secureCardCredentialToken` is a
 * one-time, opaque handle to any sensitive credentials stored in the vault; it
 * is only ever handed to trusted internal callers, never to a public REST
 * response or the language model.
 */
export interface CreatedTransactionCard {
  cardToken: string;
  orderId: string;
  state: string;
  type: string;
  lastFour: string;
  maximumAmount: number;
  currency: string;
  expirationMonth?: string;
  expirationYear?: string;
  secureCardCredentialToken?: string;
  /** True when this call returned a pre-existing card (idempotent replay). */
  idempotentReplay: boolean;
}

/**
 * An order that has already been approved elsewhere (by the MCP/budget flow).
 * The virtual-card service treats this as a read-only source of truth and does
 * NOT create or approve orders itself.
 */
export interface ApprovedOrder {
  orderId: string;
  userId: string;
  merchantName: string;
  expectedAmount: number;
  approvedMaximumAmount: number;
  currency: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "CANCELLED";
}

/**
 * Non-sensitive card metadata persisted by the repository.
 * NOTE: never contains PAN or CVV.
 */
export interface TransactionCardRecord {
  id: string;
  userId: string;
  orderId: string;
  merchantName: string;
  expectedAmount: number;
  maximumAmount: number;
  currency: string;
  lithicCardToken: string;
  lithicAccountToken: string;
  cardType: CardType;
  state: string;
  lastFour: string;
  idempotencyKey: string;
  createdAt: Date;
}
