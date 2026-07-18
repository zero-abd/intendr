import { supabase } from "../lib/supabase";
import type { CardEvent, EventKind, EventStatus, EventType } from "./types";

export async function listCardEvents(limit = 200): Promise<CardEvent[]> {
  const { data, error } = await supabase
    .from("card_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CardEvent[];
}

export interface NewEvent {
  userId: string;
  kind: EventKind;
  type: EventType;
  merchant?: string | null;
  amountCents?: number;
  status?: EventStatus;
  virtualCardId?: string | null;
  meta?: Record<string, unknown>;
  createdAt?: string; // allow back-dating for demo seeds
}

export async function recordEvent(e: NewEvent): Promise<CardEvent> {
  const row: Record<string, unknown> = {
    user_id: e.userId,
    kind: e.kind,
    type: e.type,
    merchant: e.merchant ?? null,
    amount_cents: e.amountCents ?? 0,
    status: e.status ?? "settled",
    virtual_card_id: e.virtualCardId ?? null,
    meta: e.meta ?? {},
  };
  if (e.createdAt) row.created_at = e.createdAt;
  const { data, error } = await supabase.from("card_events").insert(row).select().single();
  if (error) throw error;
  return data as CardEvent;
}

/** Bulk insert (demo seeding). Returns count inserted. */
export async function recordEvents(rows: NewEvent[]): Promise<number> {
  const payload = rows.map((e) => ({
    user_id: e.userId,
    kind: e.kind,
    type: e.type,
    merchant: e.merchant ?? null,
    amount_cents: e.amountCents ?? 0,
    status: e.status ?? "settled",
    virtual_card_id: e.virtualCardId ?? null,
    meta: e.meta ?? {},
    ...(e.createdAt ? { created_at: e.createdAt } : {}),
  }));
  const { error, count } = await supabase.from("card_events").insert(payload, { count: "exact" });
  if (error) throw error;
  return count ?? payload.length;
}
