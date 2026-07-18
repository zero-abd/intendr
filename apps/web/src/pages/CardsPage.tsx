import { useState } from "react";
import { Badge, Button, Card, CreditCard, Eyebrow } from "@intendr/ui";
import type { CardColor } from "@intendr/ui";
import { useCards } from "../hooks/useCards";
import { CardInput } from "../components/CardInput";
import { linkFundingCard, removeFundingCard } from "../api/cards";
import { issueVirtualCard, setVirtualCardLimit, setVirtualCardStatus } from "../api/virtualCards";
import { recordEvent } from "../api/events";
import { seedDemoData } from "../api/seed";
import { fmtCents, dollarsToCents, centsToDollarInput } from "../lib/format";
import type { CardTokenResult } from "../lib/card";
import type { VirtualCard } from "../api/types";

const COLORS: CardColor[] = ["lime", "violet", "amber", "slate"];

export function CardsPage() {
  const { user, fundingCards, virtualCards, loading, needsMigration, refresh } = useCards();
  const [adding, setAdding] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [busy, setBusy] = useState(false);

  if (needsMigration) return <MigrationNeeded />;

  async function onToken(tok: CardTokenResult, holder: string, makeDefault: boolean) {
    if (!user) return;
    setBusy(true);
    try {
      const fc = await linkFundingCard(user.id, tok, holder, makeDefault);
      await recordEvent({
        userId: user.id,
        kind: "funding",
        type: "card_linked",
        merchant: `${tok.brand} •${tok.last4}`,
        status: "info",
        meta: { last4: tok.last4 },
      });
      void fc;
      setAdding(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <div className="page" style={{ display: "grid", gap: 20 }}>
      {/* Funding sources */}
      <Card style={{ animation: "rise 0.5s var(--ease) both" }}>
        <div className="rowhead">
          <div>
            <Eyebrow>Funding source</Eyebrow>
            <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              The real-world card your wallet tops up from. We store brand + last 4 only.
            </p>
          </div>
          {!adding && (
            <Button sm variant="ghost" onClick={() => setAdding(true)}>
              + Add card
            </Button>
          )}
        </div>

        {adding && (
          <div style={{ marginTop: 18, maxWidth: 440 }}>
            <CardInput onToken={onToken} submitting={busy} />
            <button className="link-quiet" style={{ marginTop: 10 }} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        )}

        {!adding && (
          <div className="fundlist" style={{ marginTop: 16 }}>
            {fundingCards.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No funding card linked yet.
              </p>
            ) : (
              fundingCards.map((f) => (
                <div key={f.id} className="fundrow">
                  <div className={`fundrow__brand fundrow__brand--${f.brand}`}>{f.brand.toUpperCase()}</div>
                  <div className="fundrow__main">
                    <span className="mono">•••• {f.last4}</span>
                    <span className="tx__time">
                      {f.holder_name} · exp {String(f.exp_month).padStart(2, "0")}/{String(f.exp_year).slice(-2)}
                    </span>
                  </div>
                  {f.is_default && <Badge tone="accent">Default</Badge>}
                  <button className="link-quiet" onClick={() => removeFundingCard(f.id).then(refresh)}>
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      {/* Virtual cards */}
      <div style={{ animation: "rise 0.5s var(--ease) 0.06s both" }}>
        <div className="rowhead" style={{ marginBottom: 14 }}>
          <div>
            <Eyebrow>Virtual cards</Eyebrow>
            <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              Spend-capped cards an agent pays with. Freeze, re-limit, or close any time.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {virtualCards.length === 0 && !loading && (
              <Button sm variant="ghost" onClick={seed} disabled={seeding}>
                {seeding ? "Loading…" : "Load demo data"}
              </Button>
            )}
            <Button sm onClick={() => setIssuing(true)} disabled={fundingCards.length === 0}>
              + Issue card
            </Button>
          </div>
        </div>

        {issuing && user && (
          <IssueForm
            userId={user.id}
            fundingId={fundingCards[0]?.id ?? null}
            onCancel={() => setIssuing(false)}
            onIssued={async () => {
              setIssuing(false);
              await refresh();
            }}
          />
        )}

        {virtualCards.length === 0 && !issuing && !loading ? (
          <Card style={{ textAlign: "center", padding: 40 }}>
            <p className="muted">No virtual cards yet.</p>
            <p style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 6 }}>
              {fundingCards.length === 0
                ? "Link a funding card first, then issue a virtual card — or load demo data."
                : "Issue your first virtual card, or load a full demo dataset."}
            </p>
          </Card>
        ) : (
          <div className="vcgrid">
            {virtualCards.map((vc) => (
              <VirtualCardTile key={vc.id} vc={vc} onChange={refresh} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Virtual card tile with controls ───────────────────────── */
function VirtualCardTile({ vc, onChange }: { vc: VirtualCard; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(centsToDollarInput(vc.spend_limit_cents));

  async function toggleFreeze() {
    setBusy(true);
    try {
      const next = vc.status === "frozen" ? "active" : "frozen";
      await setVirtualCardStatus(vc.id, next);
      await recordEvent({
        userId: vc.user_id,
        kind: "issuing",
        type: next === "frozen" ? "card_frozen" : "card_unfrozen",
        merchant: vc.nickname,
        status: "info",
        virtualCardId: vc.id,
      });
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    try {
      await setVirtualCardStatus(vc.id, "closed");
      await recordEvent({ userId: vc.user_id, kind: "issuing", type: "card_closed", merchant: vc.nickname, status: "info", virtualCardId: vc.id });
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  async function saveLimit() {
    const cents = dollarsToCents(limit);
    if (cents == null) return;
    setBusy(true);
    try {
      await setVirtualCardLimit(vc.id, cents);
      await recordEvent({
        userId: vc.user_id,
        kind: "control",
        type: cents >= vc.spend_limit_cents ? "cap_raised" : "cap_lowered",
        merchant: vc.nickname,
        status: "info",
        virtualCardId: vc.id,
        meta: { from: vc.spend_limit_cents, to: cents },
      });
      setEditing(false);
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  const closed = vc.status === "closed";

  return (
    <div className="vctile">
      <CreditCard
        nickname={vc.nickname}
        brand={vc.brand}
        last4={vc.last4}
        expMonth={vc.exp_month}
        expYear={vc.exp_year}
        color={vc.color}
        status={vc.status}
        spentCents={vc.spent_cents}
        limitCents={vc.spend_limit_cents}
      />
      <div className="vctile__stats">
        <span className="mono">{fmtCents(vc.spent_cents)} spent</span>
        <span className="mono" style={{ color: "var(--ink-faint)" }}>
          of {fmtCents(vc.spend_limit_cents)}
        </span>
      </div>

      {editing ? (
        <div className="vctile__edit">
          <div className="moneyinput" style={{ flex: 1 }}>
            <span className="moneyinput__sign">$</span>
            <input
              className="ui-input ui-input--money"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              style={{ paddingLeft: 26, height: 38 }}
            />
          </div>
          <Button sm onClick={saveLimit} disabled={busy}>
            Save
          </Button>
          <Button sm variant="quiet" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="vctile__actions">
          <Button sm variant="ghost" onClick={toggleFreeze} disabled={busy || closed}>
            {vc.status === "frozen" ? "Unfreeze" : "Freeze"}
          </Button>
          <Button sm variant="ghost" onClick={() => setEditing(true)} disabled={busy || closed}>
            Limit
          </Button>
          <Button sm variant="danger" onClick={close} disabled={busy || closed}>
            {closed ? "Closed" : "Close"}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Issue form ────────────────────────────────────────────── */
function IssueForm({
  userId,
  fundingId,
  onCancel,
  onIssued,
}: {
  userId: string;
  fundingId: string | null;
  onCancel: () => void;
  onIssued: () => Promise<void>;
}) {
  const [nickname, setNickname] = useState("");
  const [limit, setLimit] = useState("25.00");
  const [color, setColor] = useState<CardColor>("lime");
  const [busy, setBusy] = useState(false);

  async function issue() {
    const cents = dollarsToCents(limit);
    if (!nickname.trim() || cents == null) return;
    setBusy(true);
    try {
      const seed = Math.floor(Math.random() * 1_000_000);
      const vc = await issueVirtualCard(userId, {
        nickname: nickname.trim(),
        fundingCardId: fundingId,
        spendLimitCents: cents,
        color,
        seed,
      });
      await recordEvent({
        userId: vc.user_id,
        kind: "issuing",
        type: "card_issued",
        merchant: nickname.trim(),
        status: "info",
        virtualCardId: vc.id,
        meta: { limit_cents: cents },
      });
      await onIssued();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card glow style={{ marginBottom: 14 }}>
      <Eyebrow>Issue a virtual card</Eyebrow>
      <div className="issueform">
        <label className="ui-field">
          <span>Nickname</span>
          <input className="ui-input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Food & Delivery" />
        </label>
        <label className="ui-field">
          <span>Spend limit</span>
          <div className="moneyinput">
            <span className="moneyinput__sign">$</span>
            <input className="ui-input ui-input--money" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ paddingLeft: 26 }} />
          </div>
        </label>
        <div className="ui-field">
          <span>Color</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch swatch--${c} ${color === c ? "is-active" : ""}`}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={issue} disabled={busy || !nickname.trim()}>
          {busy ? "Issuing…" : "Issue card"}
        </Button>
      </div>
    </Card>
  );
}

function MigrationNeeded() {
  return (
    <div className="page page--narrow">
      <Card glow style={{ padding: 32 }}>
        <Eyebrow>One step to enable cards</Eyebrow>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, marginTop: 8 }}>Run the cards migration</h2>
        <p className="muted" style={{ marginTop: 10, fontSize: 14, lineHeight: 1.6 }}>
          The card tables don't exist yet. Paste <span className="mono">apps/web/supabase/002_cards.sql</span> into the
          Supabase SQL editor and run it — it creates <span className="mono">funding_cards</span>,{" "}
          <span className="mono">virtual_cards</span>, and <span className="mono">card_events</span> with per-user
          row-level security. Then reload.
        </p>
      </Card>
    </div>
  );
}
