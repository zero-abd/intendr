// D1/SQLite schema + the atomic spend reservation (cap check lives in the WHERE clause).
import type { Cents, WorkspaceId } from "@intendr/contracts";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspace_spend (
  workspace_id   TEXT    NOT NULL,
  period         TEXT    NOT NULL,
  reserved_cents INTEGER NOT NULL DEFAULT 0,
  settled_cents  INTEGER NOT NULL DEFAULT 0,
  cap_cents      INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, period)
);

CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT    PRIMARY KEY,
  workspace_id TEXT    NOT NULL,
  service      TEXT    NOT NULL,
  cents        INTEGER NOT NULL,
  status       TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);
`;

/** Minimal subset of Cloudflare's D1Database we depend on. */
export interface SqlDb {
  prepare(query: string): {
    bind(...values: unknown[]): { run(): Promise<{ meta: { changes: number } }> };
  };
}

/**
 * Atomic reserve: the conditional UPDATE only changes a row when the cap holds,
 * so concurrent reservations can't overspend without any app-level lock.
 */
export async function tryReserveSpend(
  db: SqlDb,
  workspaceId: WorkspaceId,
  period: string,
  cents: Cents,
  capCents: Cents,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE workspace_spend
         SET reserved_cents = reserved_cents + ?1
       WHERE workspace_id = ?2
         AND period = ?3
         AND reserved_cents + settled_cents + ?1 <= ?4`,
    )
    .bind(cents, workspaceId, period, capCents)
    .run();
  return res.meta.changes > 0;
}
