import type { ApprovedOrder } from "./virtualCard.types";

/**
 * Read-only view of approved orders.
 *
 * IMPORTANT: This service does NOT create, approve, or modify orders. Ordering,
 * cart, checkout, and approval logic all live in the existing MCP/budget flow.
 * This repository exists solely so the card service can INDEPENDENTLY verify an
 * order's approval and terms before issuing a card — it must never trust the
 * order details supplied by the (LLM-driven) caller.
 *
 * PRODUCTION: back this with the same store the MCP/budget flow writes approved
 * orders to (e.g. the D1 `transactions`/approvals table). Do not re-implement
 * approval here.
 */
export interface ApprovedOrderRepository {
  findByOrderId(orderId: string): Promise<ApprovedOrder | null>;
}

/**
 * In-memory implementation for local development and tests. Seed it via
 * {@link InMemoryApprovedOrderRepository.upsert} to simulate orders the MCP has
 * already approved.
 */
export class InMemoryApprovedOrderRepository implements ApprovedOrderRepository {
  private readonly byOrderId = new Map<string, ApprovedOrder>();

  async findByOrderId(orderId: string): Promise<ApprovedOrder | null> {
    return this.byOrderId.get(orderId) ?? null;
  }

  /** Test/dev helper to register an approved order. */
  upsert(order: ApprovedOrder): void {
    this.byOrderId.set(order.orderId, order);
  }

  /** Test helper: clears all stored orders. */
  clear(): void {
    this.byOrderId.clear();
  }
}

/** Default singleton used by the service and MCP tool. */
export const approvedOrderRepository = new InMemoryApprovedOrderRepository();
