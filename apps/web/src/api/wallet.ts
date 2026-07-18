import { supabase } from "../lib/supabase";
import type { Wallet } from "./types";

/** Read the current user's wallet. RLS scopes it to auth.uid(); the trigger
 *  guarantees a row exists after signup. Returns null if not yet provisioned. */
export async function getWallet(userId: string): Promise<Wallet | null> {
  const { data, error } = await supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as Wallet | null;
}

/** Atomic balance increment via RPC (avoids read-modify-write races). */
export async function addFunds(amountCents: number): Promise<Wallet> {
  const { data, error } = await supabase.rpc("add_funds", { amount_cents: amountCents });
  if (error) throw error;
  return data as Wallet;
}

/** Update caps. Only pass the fields you're changing. */
export async function updateCaps(
  userId: string,
  caps: Partial<Pick<Wallet, "session_cap_cents" | "monthly_cap_cents">>,
): Promise<Wallet> {
  const { data, error } = await supabase
    .from("wallets")
    .update({ ...caps, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data as Wallet;
}
