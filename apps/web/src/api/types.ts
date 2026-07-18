/** Row shapes mirroring the Supabase schema (apps/web/supabase/schema.sql). */

export interface Wallet {
  user_id: string;
  balance_cents: number;
  session_cap_cents: number;
  monthly_cap_cents: number;
  category_caps: Record<string, number>;
  updated_at: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export type TxStatus = "pending" | "approved" | "denied" | "settled" | "blocked";

export interface Transaction {
  id: string;
  user_id: string;
  service: string;
  cents: number;
  status: TxStatus;
  created_at: string;
}

/* ── Cards + virtual cards + event ledger (migration 002) ──────────────────── */

export type FundingStatus = "active" | "removed";

export interface FundingCard {
  id: string;
  user_id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  token: string;
  holder_name: string | null;
  is_default: boolean;
  status: FundingStatus;
  created_at: string;
}

export type VirtualCardStatus = "active" | "frozen" | "closed";
export type VirtualCardColor = "lime" | "violet" | "amber" | "slate";

export interface VirtualCard {
  id: string;
  user_id: string;
  funding_card_id: string | null;
  nickname: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  token: string;
  status: VirtualCardStatus;
  spend_limit_cents: number;
  spent_cents: number;
  merchant_lock: string | null;
  color: VirtualCardColor;
  created_at: string;
}

export type EventKind = "spend" | "funding" | "issuing" | "control";

export type EventType =
  | "authorization"
  | "capture"
  | "decline"
  | "reversal"
  | "refund"
  | "card_linked"
  | "top_up"
  | "card_issued"
  | "card_frozen"
  | "card_unfrozen"
  | "card_closed"
  | "limit_changed"
  | "cap_raised"
  | "cap_lowered"
  | "approval_requested"
  | "approval_granted"
  | "approval_skipped"
  | "merchant_blocked";

export type EventStatus = "settled" | "pending" | "declined" | "blocked" | "reversed" | "refunded" | "info";

export interface CardEvent {
  id: string;
  user_id: string;
  virtual_card_id: string | null;
  kind: EventKind;
  type: EventType;
  merchant: string | null;
  amount_cents: number;
  status: EventStatus;
  meta: Record<string, unknown>;
  created_at: string;
}
