import { supabase } from "../lib/supabase";
import type { CardTokenResult } from "../lib/card";
import type { FundingCard } from "./types";

export async function listFundingCards(userId: string): Promise<FundingCard[]> {
  const { data, error } = await supabase
    .from("funding_cards")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FundingCard[];
}

/**
 * Link a funding card. Accepts ONLY the tokenized result — the caller (CardInput)
 * has already discarded the PAN/CVV. We persist metadata only.
 */
export async function linkFundingCard(
  userId: string,
  tok: CardTokenResult,
  holderName: string,
  makeDefault: boolean,
): Promise<FundingCard> {
  const { data, error } = await supabase
    .from("funding_cards")
    .insert({
      user_id: userId,
      brand: tok.brand,
      last4: tok.last4,
      exp_month: tok.expMonth,
      exp_year: tok.expYear,
      token: tok.token,
      holder_name: holderName,
      is_default: makeDefault,
    })
    .select()
    .single();
  if (error) throw error;
  return data as FundingCard;
}

export async function removeFundingCard(id: string): Promise<void> {
  const { error } = await supabase.from("funding_cards").update({ status: "removed" }).eq("id", id);
  if (error) throw error;
}
