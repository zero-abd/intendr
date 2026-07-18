-- intendr — cards + virtual cards + event ledger (migration 002).
-- Run AFTER schema.sql in the Supabase SQL editor.
--
-- SECURITY: this schema stores NON-SENSITIVE metadata only. There is NO column for
-- a full card number (PAN) or CVV anywhere — by design. We keep brand, last 4,
-- expiry, a provider token id, status, and spend limits. Real card data must live in
-- a PCI-compliant issuer vault (Stripe/Ramp), never here. Money is integer cents.

-- ── funding_cards — a linked "real-world" card the wallet is topped up from ──
create table if not exists public.funding_cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  brand       text not null,                       -- visa | mastercard | amex | discover
  last4       text not null,                        -- last 4 digits only
  exp_month   int  not null,
  exp_year    int  not null,
  token       text not null,                        -- opaque provider token (fake in demo)
  holder_name text,
  is_default  boolean not null default false,
  status      text not null default 'active',       -- active | removed
  created_at  timestamptz not null default now()
);
alter table public.funding_cards enable row level security;
create index if not exists funding_cards_user_idx on public.funding_cards (user_id, created_at desc);

drop policy if exists "funding: select own" on public.funding_cards;
create policy "funding: select own" on public.funding_cards for select using (auth.uid() = user_id);
drop policy if exists "funding: insert own" on public.funding_cards;
create policy "funding: insert own" on public.funding_cards for insert with check (auth.uid() = user_id);
drop policy if exists "funding: update own" on public.funding_cards;
create policy "funding: update own" on public.funding_cards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "funding: delete own" on public.funding_cards;
create policy "funding: delete own" on public.funding_cards for delete using (auth.uid() = user_id);

-- ── virtual_cards — issued, spend-capped cards an agent pays with ────────────
create table if not exists public.virtual_cards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  funding_card_id  uuid references public.funding_cards (id) on delete set null,
  nickname         text not null,
  brand            text not null default 'visa',
  last4            text not null,
  exp_month        int  not null,
  exp_year         int  not null,
  token            text not null,                    -- opaque issuer token (fake in demo)
  status           text not null default 'active',   -- active | frozen | closed
  spend_limit_cents integer not null default 0,
  spent_cents      integer not null default 0,
  merchant_lock    text,                             -- optional single-merchant lock
  color            text not null default 'lime',     -- UI accent: lime | violet | amber | slate
  created_at       timestamptz not null default now()
);
alter table public.virtual_cards enable row level security;
create index if not exists virtual_cards_user_idx on public.virtual_cards (user_id, created_at desc);

drop policy if exists "vcard: select own" on public.virtual_cards;
create policy "vcard: select own" on public.virtual_cards for select using (auth.uid() = user_id);
drop policy if exists "vcard: insert own" on public.virtual_cards;
create policy "vcard: insert own" on public.virtual_cards for insert with check (auth.uid() = user_id);
drop policy if exists "vcard: update own" on public.virtual_cards;
create policy "vcard: update own" on public.virtual_cards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "vcard: delete own" on public.virtual_cards;
create policy "vcard: delete own" on public.virtual_cards for delete using (auth.uid() = user_id);

-- ── card_events — the comprehensive transaction / event ledger ───────────────
-- kind groups the taxonomy; type is the specific event. amount_cents may be 0 for
-- non-monetary events (freeze, cap change, approval).
create table if not exists public.card_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  virtual_card_id uuid references public.virtual_cards (id) on delete set null,
  kind            text not null,   -- spend | funding | issuing | control
  type            text not null,   -- authorization|capture|decline|reversal|refund|card_linked|top_up|card_issued|card_frozen|card_unfrozen|card_closed|limit_changed|cap_raised|cap_lowered|approval_requested|approval_granted|approval_skipped|merchant_blocked
  merchant        text,
  amount_cents    integer not null default 0,
  status          text not null default 'settled', -- settled|pending|declined|blocked|reversed|refunded|info
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
alter table public.card_events enable row level security;
create index if not exists card_events_user_idx on public.card_events (user_id, created_at desc);

drop policy if exists "evt: select own" on public.card_events;
create policy "evt: select own" on public.card_events for select using (auth.uid() = user_id);
drop policy if exists "evt: insert own" on public.card_events;
create policy "evt: insert own" on public.card_events for insert with check (auth.uid() = user_id);

-- ── realtime (optional) ─────────────────────────────────────────────────────
do $$
begin
  begin alter publication supabase_realtime add table public.funding_cards; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.virtual_cards; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.card_events; exception when duplicate_object then null; end;
end $$;
