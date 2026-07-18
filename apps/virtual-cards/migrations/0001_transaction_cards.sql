-- Non-sensitive metadata for Lithic single-use cards issued per approved order.
-- NEVER store PAN or CVV in this table (or any application database).
--
-- Apply with your preferred migrator (wrangler D1, drizzle, etc.).
-- The UNIQUE(order_id) constraint is load-bearing: it is the cross-process
-- backstop that prevents two concurrent workers from recording two cards for
-- the same order.

CREATE TABLE IF NOT EXISTS transaction_cards (
  id                     TEXT    PRIMARY KEY,
  user_id                TEXT    NOT NULL,
  order_id               TEXT    NOT NULL,
  merchant_name          TEXT    NOT NULL,
  expected_amount        INTEGER NOT NULL,
  maximum_amount         INTEGER NOT NULL,
  currency               TEXT    NOT NULL,
  lithic_card_token      TEXT    NOT NULL,
  lithic_account_token   TEXT    NOT NULL,
  card_type              TEXT    NOT NULL CHECK (card_type = 'SINGLE_USE'),
  state                  TEXT    NOT NULL,
  last_four              TEXT    NOT NULL,
  idempotency_key        TEXT    NOT NULL,
  created_at             INTEGER NOT NULL,

  -- At most one card per approved order.
  CONSTRAINT transaction_cards_order_id_unique UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS transaction_cards_user_id_idx
  ON transaction_cards (user_id);

CREATE INDEX IF NOT EXISTS transaction_cards_lithic_card_token_idx
  ON transaction_cards (lithic_card_token);

-- Optional: approved-order read model used by this service to independently
-- verify MCP-supplied claims before issuing a card. In production, prefer
-- reading from the existing MCP/budget approvals store instead of duplicating
-- approval logic here.
CREATE TABLE IF NOT EXISTS approved_orders (
  order_id                 TEXT    PRIMARY KEY,
  user_id                  TEXT    NOT NULL,
  merchant_name            TEXT    NOT NULL,
  expected_amount          INTEGER NOT NULL,
  approved_maximum_amount  INTEGER NOT NULL,
  currency                 TEXT    NOT NULL,
  status                   TEXT    NOT NULL CHECK (status IN ('APPROVED', 'PENDING', 'REJECTED', 'CANCELLED')),
  created_at               INTEGER NOT NULL
);
