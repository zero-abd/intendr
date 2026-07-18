-- intendr — MCP wallet + charge RPCs (migration 003).
-- Run AFTER schema.sql (+ 002_cards.sql) in the Supabase SQL editor, or apply via the
-- Management API. Fully idempotent: re-running is a no-op.
--
-- These are the two RPCs the Cloudflare edge Worker (apps/edge) calls with the
-- service_role key to read and debit a user's wallet on every MCP `pay_and_run`:
--
--   mcp_wallet(uid)                      -> ensure a wallet row exists, return it
--   mcp_charge(uid, amount_cents, svc)   -> ATOMICALLY debit balance_cents AND write a
--                                           row to the `transactions` ledger, so every
--                                           MCP purchase deterministically appears in the
--                                           dashboard's transactions view.
--
-- Previously these lived ONLY in the live database (never checked in). This migration
-- makes the schema reproducible and hardens mcp_charge into a single atomic UPDATE.

-- ── transactions ledger (defensive: created by schema.sql; ensure it + its index exist) ─
create table if not exists public.transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  service    text not null,
  cents      integer not null,
  status     text not null default 'settled', -- pending|approved|denied|settled|blocked
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_created_idx
  on public.transactions (user_id, created_at desc);

-- ── mcp_wallet(uid) — ensure the caller has a wallet row, return it ──────────────
-- SECURITY DEFINER because the edge Worker calls this with the service_role key on
-- behalf of an authenticated user (auth.uid() is not set in that server-to-server call).
-- Kept idempotent so a first-ever MCP call auto-provisions the wallet.
create or replace function public.mcp_wallet(uid uuid)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
  declare w public.wallets;
begin
  insert into public.wallets (user_id) values (uid)
  on conflict (user_id) do nothing;
  select * into w from public.wallets where user_id = uid;
  return w;
end;
$$;

-- ── mcp_charge(uid, amount_cents, svc) — atomic debit + ledger insert ────────────
-- Debits the wallet AND records the ledger row so every MCP purchase shows up in the
-- dashboard's transactions view. The debit + settled-ledger insert happen in a single
-- statement (a CTE-driven UPDATE ... then INSERT ... SELECT from that CTE) inside one
-- function/transaction, so they cannot diverge: either both land or neither does.
--
--   * Sufficient funds  → balance debited, one 'settled' transactions row, wallet returned.
--   * Insufficient funds → no debit, one 'blocked' transactions row, NULL returned
--                          (the caller surfaces "insufficient balance").
create or replace function public.mcp_charge(uid uuid, amount_cents integer, svc text)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
  declare w public.wallets;
begin
  if amount_cents is null or amount_cents < 0 then
    raise exception 'amount_cents must be >= 0';
  end if;

  -- Make sure the wallet exists before we try to debit it.
  perform public.mcp_wallet(uid);

  -- Single atomic statement: conditionally debit the wallet, then write exactly one
  -- ledger row whose status reflects whether the debit succeeded. Because the INSERT
  -- selects from the debit CTE, the ledger row and the balance change are inseparable.
  with debited as (
    update public.wallets
       set balance_cents = balance_cents - amount_cents,
           updated_at = now()
     where user_id = uid
       and balance_cents >= amount_cents
    returning *
  ),
  logged as (
    insert into public.transactions (user_id, service, cents, status)
    values (
      uid,
      svc,
      amount_cents,
      case when exists (select 1 from debited) then 'settled' else 'blocked' end
    )
    returning 1
  )
  select * into w from debited;

  -- w is NULL when the debit was skipped for insufficient funds; the 'blocked' ledger
  -- row was still written above. Return the (possibly NULL) wallet either way.
  return w;
end;
$$;

-- The edge Worker authenticates as service_role; make sure it can execute both.
grant execute on function public.mcp_wallet(uuid) to service_role;
grant execute on function public.mcp_charge(uuid, integer, text) to service_role;
