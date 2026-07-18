import { supabase } from "../lib/supabase";
import { linkFundingCard } from "./cards";
import { issueVirtualCard } from "./virtualCards";
import { recordEvents, type NewEvent } from "./events";
import type { EventKind, EventStatus, EventType } from "./types";

const mins = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const days = (n: number) => n * 86_400_000;

/**
 * Seed a rich, demoable dataset for the current user ("Phong"). Creates a linked
 * funding card, three virtual cards, and ~30 ledger events spanning every event kind.
 * Idempotent-ish: safe to run once on a fresh account. Metadata only — no PAN/CVV.
 */
export async function seedDemoData(userId: string): Promise<{ events: number }> {
  const now = Date.now();
  const iso = (offset: number) => new Date(now - offset).toISOString();

  // Personalize the profile for the demo.
  await supabase.from("profiles").update({ display_name: "Phong" }).eq("id", userId);

  // 1) Funding card (metadata only — a real Visa test card's last4).
  const funding = await linkFundingCard(
    userId,
    { token: "tok_sandbox_seed42", brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 },
    "Phong Nguyen",
    true,
  );

  // 2) Three virtual cards.
  const food = await issueVirtualCard(userId, {
    nickname: "Food & Delivery",
    fundingCardId: funding.id,
    spendLimitCents: 3000,
    color: "lime",
    seed: 7412,
  });
  const rides = await issueVirtualCard(userId, {
    nickname: "Rides",
    fundingCardId: funding.id,
    spendLimitCents: 5000,
    color: "violet",
    seed: 3318,
  });
  const apis = await issueVirtualCard(userId, {
    nickname: "APIs & Data",
    fundingCardId: funding.id,
    spendLimitCents: 2000,
    merchantLock: "orthogonal",
    color: "amber",
    seed: 9051,
  });
  // Freeze one to show the state.
  await supabase.from("virtual_cards").update({ status: "frozen", spent_cents: 0 }).eq("id", apis.id);
  await supabase.from("virtual_cards").update({ spent_cents: 1853 }).eq("id", food.id);
  await supabase.from("virtual_cards").update({ spent_cents: 0 }).eq("id", rides.id);

  const e = (
    kind: EventKind,
    type: EventType,
    partial: Partial<NewEvent> & { offset: number },
  ): NewEvent => ({
    userId,
    kind,
    type,
    merchant: partial.merchant ?? null,
    amountCents: partial.amountCents ?? 0,
    status: partial.status ?? "settled",
    virtualCardId: partial.virtualCardId ?? null,
    meta: partial.meta ?? {},
    createdAt: iso(partial.offset),
  });

  const events: NewEvent[] = [
    // ── Issuing / funding setup (oldest) ──
    e("funding", "card_linked", { merchant: "Visa •4242", offset: days(9), status: "info", meta: { last4: "4242" } }),
    e("funding", "top_up", { merchant: "Wallet top-up", amountCents: 5000, offset: days(9) - hours(1) }),
    e("issuing", "card_issued", { merchant: "Food & Delivery", virtualCardId: food.id, offset: days(8), status: "info" }),
    e("issuing", "card_issued", { merchant: "Rides", virtualCardId: rides.id, offset: days(8) - mins(2), status: "info" }),
    e("issuing", "card_issued", { merchant: "APIs & Data", virtualCardId: apis.id, offset: days(8) - mins(4), status: "info" }),

    // ── Everyday spend (varied) ──
    e("spend", "capture", { merchant: "DoorDash", amountCents: 2340, virtualCardId: food.id, offset: days(7) }),
    e("spend", "capture", { merchant: "Uber", amountCents: 1875, virtualCardId: rides.id, offset: days(6) - hours(3) }),
    e("spend", "authorization", { merchant: "Instacart", amountCents: 640, virtualCardId: food.id, offset: days(6), status: "pending" }),
    e("spend", "capture", { merchant: "OpenAI API", amountCents: 1200, virtualCardId: apis.id, offset: days(5) }),
    e("spend", "decline", { merchant: "Sketchy Merchant", amountCents: 9900, virtualCardId: food.id, offset: days(5) - hours(2), status: "declined", meta: { reason: "merchant not on allowlist" } }),
    e("spend", "capture", { merchant: "Anthropic API", amountCents: 850, virtualCardId: apis.id, offset: days(4) }),
    e("spend", "refund", { merchant: "DoorDash", amountCents: 2340, virtualCardId: food.id, offset: days(4) - hours(5), status: "refunded", meta: { reason: "order canceled" } }),

    // ── Controls & approvals ──
    e("control", "cap_lowered", { merchant: "Food & Delivery", virtualCardId: food.id, offset: days(3), status: "info", meta: { from: 5000, to: 3000 } }),
    e("control", "approval_requested", { merchant: "Uber (surge)", amountCents: 4200, virtualCardId: rides.id, offset: days(3) - hours(1), status: "pending" }),
    e("control", "approval_granted", { merchant: "Uber (surge)", amountCents: 4200, virtualCardId: rides.id, offset: days(3) - mins(50) }),
    e("control", "merchant_blocked", { merchant: "Casino777", virtualCardId: food.id, offset: days(2), status: "blocked" }),

    // ── The SFO hero flow (recent, tells the story) ──
    e("spend", "capture", { merchant: "Orthogonal · enrich venue", amountCents: 3, virtualCardId: apis.id, offset: hours(6) }),
    e("spend", "authorization", { merchant: "DoorDash · burger", amountCents: 1850, virtualCardId: food.id, offset: hours(5) - mins(40), status: "pending" }),
    e("control", "approval_granted", { merchant: "DoorDash · burger", amountCents: 1850, virtualCardId: food.id, offset: hours(5) - mins(38) }),
    e("spend", "capture", { merchant: "DoorDash · burger", amountCents: 1850, virtualCardId: food.id, offset: hours(5) - mins(37) }),
    e("spend", "decline", { merchant: "Uber · SFO → downtown", amountCents: 2800, virtualCardId: rides.id, offset: hours(5) - mins(30), status: "blocked", meta: { reason: "$0.03 + $18.50 + $28 = $46.53 > $45 session cap" } }),
    e("control", "cap_raised", { merchant: "Session cap", offset: hours(5) - mins(20), status: "info", meta: { from: 4500, to: 6000 } }),
    e("spend", "capture", { merchant: "Uber · SFO → downtown", amountCents: 2800, virtualCardId: rides.id, offset: hours(5) - mins(19) }),

    // ── Latest ──
    e("funding", "top_up", { merchant: "Wallet top-up", amountCents: 2500, offset: hours(2) }),
    e("spend", "capture", { merchant: "AWS", amountCents: 430, virtualCardId: apis.id, offset: hours(1) }),
    e("spend", "reversal", { merchant: "Uber", amountCents: 500, virtualCardId: rides.id, offset: mins(30), status: "reversed", meta: { reason: "auth hold released" } }),
    e("issuing", "card_frozen", { merchant: "APIs & Data", virtualCardId: apis.id, offset: mins(10), status: "info" }),
  ];

  const count = await recordEvents(events);
  return { events: count };
}

/** Whether the user already has seeded cards (so the button can hide/relabel). */
export async function hasCards(userId: string): Promise<boolean> {
  const { count } = await supabase
    .from("virtual_cards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

const _statuses: EventStatus[] = ["settled", "pending", "declined", "blocked", "reversed", "refunded", "info"];
export const ALL_EVENT_STATUSES = _statuses;
