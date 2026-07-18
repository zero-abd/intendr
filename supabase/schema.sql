-- intendr wallet schema — lives in the shared Supabase project (same one the frontend uses).
-- The Cloudflare Worker (apps/edge) talks to these over PostgREST RPC with the service_role key.
-- Atomicity lives in the SECURITY DEFINER functions (single-statement UPDATEs are atomic in
-- Postgres), so concurrent pay_and_run calls can't lose an update or exceed the cap.
--
-- Apply with the Supabase SQL editor, `supabase db execute`, or the Management API.

create table if not exists public.wallets (
  workspace_id   text primary key,
  opening_cents  numeric not null default 2000,
  spent_cents    numeric not null default 0,
  reserved_cents numeric not null default 0,
  cap_cents      numeric not null default 2000,
  updated_at     timestamptz not null default now()
);

create table if not exists public.transactions (
  id           text primary key,
  workspace_id text not null,
  service      text not null,
  price_cents  numeric not null,
  status       text not null,
  data         jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists transactions_workspace_idx on public.transactions (workspace_id, created_at desc);

alter table public.wallets enable row level security;
alter table public.transactions enable row level security;

-- Frontend (anon / authenticated) may READ; all writes go through the service_role key
-- and the SECURITY DEFINER functions below.
drop policy if exists wallets_read on public.wallets;
create policy wallets_read on public.wallets for select using (true);
drop policy if exists transactions_read on public.transactions;
create policy transactions_read on public.transactions for select using (true);

create or replace function public.wallet_get(ws text, default_cap numeric default 2000, default_open numeric default 2000)
returns public.wallets language plpgsql security definer as $$
declare w public.wallets;
begin
  insert into public.wallets (workspace_id, opening_cents, cap_cents)
    values (ws, default_open, default_cap)
    on conflict (workspace_id) do nothing;
  select * into w from public.wallets where workspace_id = ws;
  return w;
end; $$;

create or replace function public.wallet_reserve(ws text, cents numeric, cap numeric)
returns boolean language plpgsql security definer as $$
declare cnt int;
begin
  perform public.wallet_get(ws, cap);
  update public.wallets
    set reserved_cents = reserved_cents + cents, updated_at = now()
    where workspace_id = ws and spent_cents + reserved_cents + cents <= cap;
  get diagnostics cnt = row_count;
  return cnt > 0;
end; $$;

create or replace function public.wallet_settle(ws text, reservation_cents numeric, actual_cents numeric)
returns public.wallets language plpgsql security definer as $$
declare w public.wallets;
begin
  update public.wallets
    set reserved_cents = greatest(0, reserved_cents - reservation_cents),
        spent_cents    = spent_cents + actual_cents,
        updated_at     = now()
    where workspace_id = ws;
  select * into w from public.wallets where workspace_id = ws;
  return w;
end; $$;

create or replace function public.wallet_refund(ws text, cents numeric)
returns void language plpgsql security definer as $$
begin
  update public.wallets set reserved_cents = greatest(0, reserved_cents - cents), updated_at = now()
    where workspace_id = ws;
end; $$;

create or replace function public.wallet_set_cap(ws text, new_cap numeric)
returns public.wallets language plpgsql security definer as $$
declare w public.wallets;
begin
  perform public.wallet_get(ws, new_cap);
  update public.wallets set cap_cents = new_cap, updated_at = now() where workspace_id = ws;
  select * into w from public.wallets where workspace_id = ws;
  return w;
end; $$;
