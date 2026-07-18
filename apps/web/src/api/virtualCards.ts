import { supabase } from "../lib/supabase";
import { randomLast4 } from "../lib/card";
import type { VirtualCard, VirtualCardColor, VirtualCardStatus } from "./types";

export async function listVirtualCards(userId: string): Promise<VirtualCard[]> {
  const { data, error } = await supabase
    .from("virtual_cards")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as VirtualCard[];
}

export async function issueVirtualCard(
  userId: string,
  input: {
    nickname: string;
    fundingCardId: string | null;
    spendLimitCents: number;
    merchantLock?: string | null;
    color?: VirtualCardColor;
    seed: number;
  },
): Promise<VirtualCard> {
  // Contract for a real issuer: POST /issue → { token, last4, exp }. Here we mint a fake one.
  const { data, error } = await supabase
    .from("virtual_cards")
    .insert({
      user_id: userId,
      funding_card_id: input.fundingCardId,
      nickname: input.nickname,
      brand: "visa",
      last4: randomLast4(input.seed),
      exp_month: ((input.seed % 12) + 1),
      exp_year: 2029,
      token: `vc_sandbox_${input.seed.toString(36)}`,
      status: "active",
      spend_limit_cents: input.spendLimitCents,
      spent_cents: 0,
      merchant_lock: input.merchantLock ?? null,
      color: input.color ?? "lime",
    })
    .select()
    .single();
  if (error) throw error;
  return data as VirtualCard;
}

export async function setVirtualCardStatus(id: string, status: VirtualCardStatus): Promise<VirtualCard> {
  const { data, error } = await supabase.from("virtual_cards").update({ status }).eq("id", id).select().single();
  if (error) throw error;
  return data as VirtualCard;
}

export async function setVirtualCardLimit(id: string, spendLimitCents: number): Promise<VirtualCard> {
  const { data, error } = await supabase
    .from("virtual_cards")
    .update({ spend_limit_cents: spendLimitCents })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as VirtualCard;
}
