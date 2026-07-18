import { DuplicateOrderError } from "./virtualCard.errors";
import type { TransactionCardRecord } from "./virtualCard.types";

/**
 * Repository of non-sensitive card metadata. Implementations MUST enforce a
 * unique constraint on `orderId` so that at most one card can ever exist per
 * order (see migrations/0001_transaction_cards.sql for the SQL version).
 */
export interface TransactionCardRepository {
  findByOrderId(orderId: string): Promise<TransactionCardRecord | null>;
  /**
   * Inserts a new record. Throws {@link DuplicateOrderError} if a record with
   * the same `orderId` already exists (i.e. the unique constraint is violated).
   */
  insert(record: TransactionCardRecord): Promise<TransactionCardRecord>;
}

/**
 * In-memory repository for local development and tests.
 *
 * The Map key is `orderId`, which models the unique DB constraint. Because
 * Node runs our JS on a single thread, the read-then-write in `insert` is
 * atomic with respect to other in-process callers, so it faithfully rejects a
 * concurrent duplicate the way a real unique index would.
 *
 * PRODUCTION: replace with a real database repository (e.g. Postgres/D1) that
 * relies on a `UNIQUE(order_id)` constraint and translates the constraint
 * violation into a DuplicateOrderError.
 */
export class InMemoryTransactionCardRepository implements TransactionCardRepository {
  private readonly byOrderId = new Map<string, TransactionCardRecord>();

  async findByOrderId(orderId: string): Promise<TransactionCardRecord | null> {
    return this.byOrderId.get(orderId) ?? null;
  }

  async insert(record: TransactionCardRecord): Promise<TransactionCardRecord> {
    if (this.byOrderId.has(record.orderId)) {
      throw new DuplicateOrderError(record.orderId);
    }
    this.byOrderId.set(record.orderId, record);
    return record;
  }

  /** Test helper: clears all stored records. */
  clear(): void {
    this.byOrderId.clear();
  }
}

/** Default singleton used by the service and HTTP layer. */
export const transactionCardRepository: TransactionCardRepository & { clear?: () => void } =
  new InMemoryTransactionCardRepository();
