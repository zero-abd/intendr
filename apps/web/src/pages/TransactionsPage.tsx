import { useMemo, useState } from "react";
import { Badge, Button, Card, Eyebrow } from "@intendr/ui";
import { useCards } from "../hooks/useCards";
import { seedDemoData } from "../api/seed";
import { fmtCents, relativeTime } from "../lib/format";
import type { CardEvent, EventKind, EventStatus } from "../api/types";

const KIND_FILTERS: Array<{ key: EventKind | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "spend", label: "Spend" },
  { key: "funding", label: "Funding" },
  { key: "issuing", label: "Issuing" },
  { key: "control", label: "Controls" },
];

const STATUS_TONE: Record<EventStatus, "good" | "warn" | "danger" | "neutral" | "accent"> = {
  settled: "good",
  pending: "warn",
  declined: "danger",
  blocked: "danger",
  reversed: "warn",
  refunded: "accent",
  info: "neutral",
};

const KIND_TONE: Record<EventKind, "good" | "warn" | "danger" | "accent"> = {
  spend: "good",
  funding: "accent",
  issuing: "warn",
  control: "danger",
};

const humanType = (t: string) => t.replace(/_/g, " ");

export function TransactionsPage() {
  const { events, virtualCards, loading, needsMigration, user, refresh } = useCards();
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const [seeding, setSeeding] = useState(false);

  const cardName = useMemo(() => {
    const m = new Map(virtualCards.map((v) => [v.id, v.nickname]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [virtualCards]);

  const filtered = filter === "all" ? events : events.filter((e) => e.kind === filter);

  const totals = useMemo(() => {
    let spent = 0;
    let saved = 0;
    let refunded = 0;
    for (const e of events) {
      if (e.kind === "spend" && (e.status === "settled" || e.status === "pending")) spent += e.amount_cents;
      if (e.status === "blocked" || e.status === "declined") saved += e.amount_cents;
      if (e.status === "refunded") refunded += e.amount_cents;
    }
    return { spent, saved, refunded };
  }, [events]);

  async function seed() {
    if (!user) return;
    setSeeding(true);
    try {
      await seedDemoData(user.id);
      await refresh();
    } finally {
      setSeeding(false);
    }
  }

  if (needsMigration) {
    return (
      <div className="page page--narrow">
        <Card glow style={{ padding: 32 }}>
          <Eyebrow>Enable the ledger</Eyebrow>
          <p className="muted" style={{ marginTop: 10, fontSize: 14, lineHeight: 1.6 }}>
            Run <span className="mono">apps/web/supabase/002_cards.sql</span> in the Supabase SQL editor to create the{" "}
            <span className="mono">card_events</span> ledger, then reload.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="page" style={{ display: "grid", gap: 20 }}>
      <div className="statrow statrow--3" style={{ animation: "rise 0.5s var(--ease) both" }}>
        <Card>
          <Eyebrow>Total spent</Eyebrow>
          <div className="mono bignum" style={{ color: "var(--warn)" }}>{fmtCents(totals.spent)}</div>
        </Card>
        <Card>
          <Eyebrow>Blocked / declined</Eyebrow>
          <div className="mono bignum" style={{ color: "var(--accent)" }}>{fmtCents(totals.saved)}</div>
        </Card>
        <Card>
          <Eyebrow>Refunded</Eyebrow>
          <div className="mono bignum" style={{ color: "var(--info)" }}>{fmtCents(totals.refunded)}</div>
        </Card>
      </div>

      <Card style={{ animation: "rise 0.5s var(--ease) 0.06s both" }}>
        <div className="rowhead">
          <div className="segmented">
            {KIND_FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? "is-active" : ""} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          {events.length === 0 && !loading && (
            <Button sm variant="ghost" onClick={seed} disabled={seeding}>
              {seeding ? "Loading…" : "Load demo data"}
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty__glyph" aria-hidden>◎</div>
            <p className="muted">{events.length === 0 ? "No activity yet." : "Nothing in this filter."}</p>
            {events.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--ink-faint)" }}>
                Load demo data to see the full lifecycle — authorizations, captures, declines, refunds, freezes, and
                cap changes.
              </p>
            )}
          </div>
        ) : (
          <ul className="txlist txlist--full" style={{ marginTop: 10 }}>
            {filtered.map((e) => (
              <EventRow key={e.id} event={e} cardName={cardName(e.virtual_card_id)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function EventRow({ event: e, cardName }: { event: CardEvent; cardName: string | null }) {
  const noAmount = e.status === "blocked" || e.status === "declined";
  const signed =
    e.status === "refunded" || e.status === "reversed"
      ? `+${fmtCents(e.amount_cents)}`
      : e.amount_cents > 0
        ? `−${fmtCents(e.amount_cents)}`
        : "—";
  const reason = typeof e.meta?.reason === "string" ? (e.meta.reason as string) : null;

  return (
    <li className="tx tx--full evt">
      <span className={`evt__glyph evt__glyph--${e.kind}`}>{EVENT_ICON[e.kind]}</span>
      <div className="tx__main">
        <span className="tx__service">
          {e.merchant ?? humanType(e.type)}
          <span className="evt__type"> · {humanType(e.type)}</span>
        </span>
        <span className="tx__time">
          {cardName ? `${cardName} · ` : ""}
          {relativeTime(e.created_at)}
          {reason ? ` · ${reason}` : ""}
        </span>
      </div>
      <Badge tone={KIND_TONE[e.kind]}>{e.kind}</Badge>
      <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
      <span
        className="tx__amt mono"
        style={{
          minWidth: 92,
          textAlign: "right",
          color: noAmount ? "var(--ink-faint)" : e.status === "refunded" || e.status === "reversed" ? "var(--good)" : undefined,
        }}
      >
        {noAmount ? "blocked" : signed}
      </span>
    </li>
  );
}

const EVENT_ICON: Record<EventKind, string> = {
  spend: "↑",
  funding: "＋",
  issuing: "▢",
  control: "⚙",
};
