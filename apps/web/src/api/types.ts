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
