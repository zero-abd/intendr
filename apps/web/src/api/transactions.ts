import { supabase } from "../lib/supabase";
import type { Transaction, TxStatus } from "./types";

export async function listTransactions(limit = 50): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Transaction[];
}

/** Record a transaction (used to seed demo activity and by future MCP wiring). */
export async function addTransaction(input: {
  userId: string;
  service: string;
  cents: number;
  status?: TxStatus;
}): Promise<Transaction> {
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      user_id: input.userId,
      service: input.service,
      cents: input.cents,
      status: input.status ?? "settled",
    })
    .select()
    .single();
  if (error) throw error;
  return data as Transaction;
}

/** Sum of settled/approved spend — the "spent" figure for the meter. */
export function totalSpent(txns: Transaction[]): number {
  return txns
    .filter((t) => t.status === "settled" || t.status === "approved")
    .reduce((sum, t) => sum + t.cents, 0);
}
