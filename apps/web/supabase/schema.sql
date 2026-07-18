-- intendr frontend — Supabase schema.
-- Run this once in the Supabase SQL editor (Dashboard → SQL editor → New query → Run).
-- Money is stored as INTEGER CENTS everywhere (never floats).
-- Every table is protected by Row-Level Security so each user only sees their own rows.

-- ── profiles ────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ── wallets ─────────────────────────────────────────────────
create table if not exists public.wallets (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  balance_cents     integer not null default 0,
  session_cap_cents integer not null default 4500,   -- $45.00 (matches the demo cap)
  monthly_cap_cents integer not null default 100000, -- $1,000.00
  category_caps     jsonb   not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);
alter table public.wallets enable row level security;

drop policy if exists "wallets: select own" on public.wallets;
create policy "wallets: select own" on public.wallets
  for select using (auth.uid() = user_id);

drop policy if exists "wallets: update own" on public.wallets;
create policy "wallets: update own" on public.wallets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No INSERT policy: wallet rows are seeded by the signup trigger (SECURITY DEFINER).

-- ── transactions ────────────────────────────────────────────
create table if not exists public.transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  service    text not null,
  cents      integer not null,
  status     text not null default 'settled', -- pending|approved|denied|settled|blocked
  created_at timestamptz not null default now()
);
alter table public.transactions enable row level security;
create index if not exists transactions_user_created_idx
  on public.transactions (user_id, created_at desc);

drop policy if exists "tx: select own" on public.transactions;
create policy "tx: select own" on public.transactions
  for select using (auth.uid() = user_id);

drop policy if exists "tx: insert own" on public.transactions;
create policy "tx: insert own" on public.transactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "tx: update own" on public.transactions;
create policy "tx: update own" on public.transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── auto-seed profile + wallet on signup ────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── atomic balance increment (avoids read-modify-write races) ─
create or replace function public.add_funds(amount_cents integer)
returns public.wallets
language plpgsql security definer set search_path = public
as $$
  declare w public.wallets;
begin
  if amount_cents <= 0 then
    raise exception 'amount must be positive';
  end if;
  update public.wallets
     set balance_cents = balance_cents + amount_cents,
         updated_at = now()
   where user_id = auth.uid()
  returning * into w;
  return w;
end;
$$;

-- ── (optional) live updates — enable Realtime for the two tables ─
-- Safe to run once; wrapped so re-runs don't error if already added.
do $$
begin
  begin
    alter publication supabase_realtime add table public.wallets;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.transactions;
  exception when duplicate_object then null;
  end;
end $$;
