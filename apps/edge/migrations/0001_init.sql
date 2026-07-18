-- intendr D1 schema (mirrors packages/db SCHEMA_SQL). Apply with:
--   wrangler d1 migrations apply intendr
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
