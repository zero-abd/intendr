import { useMemo, useState } from "react";
import { Badge, Button, Card, Eyebrow } from "@intendr/ui";
import { useData } from "../hooks/DataProvider";
import { useAuth } from "../auth/AuthProvider";
import { addTransaction, totalSpent } from "../api/transactions";
import { fmtCents, relativeTime } from "../lib/format";
import type { TxStatus } from "../api/types";

const STATUS_TONE: Record<TxStatus, "good" | "warn" | "danger" | "neutral" | "accent"> = {
  settled: "good",
  approved: "accent",
  pending: "warn",
  denied: "danger",
  blocked: "danger",
};

// Seed rows mirror the PLAN.md hero demo — so a fresh account isn't empty.
const DEMO_ROWS = [
  { service: "orthogonal · enrich venue", cents: 3, status: "settled" as TxStatus },
  { service: "doordash · burger", cents: 1850, status: "settled" as TxStatus },
  { service: "uber · SFO → downtown", cents: 2800, status: "blocked" as TxStatus },
];

export function ActivityPage() {
  const { user } = useAuth();
  const { transactions, setTransactions } = useData();
  const [busy, setBusy] = useState(false);
  const spent = useMemo(() => totalSpent(transactions), [transactions]);
  const blocked = useMemo(
    () => transactions.filter((t) => t.status === "blocked" || t.status === "denied").reduce((s, t) => s + t.cents, 0),
    [transactions],
  );

  async function seedDemo() {
    if (!user) return;
    setBusy(true);
    try {
      for (const r of DEMO_ROWS) {
        const tx = await addTransaction({ userId: user.id, service: r.service, cents: r.cents, status: r.status });
        // Realtime will also push it; de-dupe by id.
        setTransactions((prev) => (prev.some((p) => p.id === tx.id) ? prev : [tx, ...prev]));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ display: "grid", gap: 20 }}>
      <div className="statrow statrow--3" style={{ animation: "rise 0.5s var(--ease) both" }}>
        <Card>
          <Eyebrow>Total spent</Eyebrow>
          <div className="mono bignum" style={{ color: "var(--warn)" }}>{fmtCents(spent)}</div>
        </Card>
        <Card>
          <Eyebrow>Overspend blocked</Eyebrow>
          <div className="mono bignum" style={{ color: "var(--accent)" }}>{fmtCents(blocked)}</div>
        </Card>
        <Card>
          <Eyebrow>Transactions</Eyebrow>
          <div className="mono bignum">{transactions.length}</div>
        </Card>
      </div>

      <Card style={{ animation: "rise 0.5s var(--ease) 0.08s both" }}>
        <div className="rowhead">
          <Eyebrow>All activity</Eyebrow>
          {transactions.length === 0 && (
            <Button sm variant="ghost" onClick={seedDemo} disabled={busy}>
              {busy ? "Seeding…" : "Load demo activity"}
            </Button>
          )}
        </div>

        {transactions.length === 0 ? (
          <div className="empty">
            <div className="empty__glyph" aria-hidden>◎</div>
            <p className="muted">No transactions yet.</p>
            <p style={{ fontSize: 13, color: "var(--ink-faint)" }}>
              Load the demo to preview the SFO hero flow — a 3¢ enrich, an $18.50 burger, and a $28 ride blocked at the cap.
            </p>
          </div>
        ) : (
          <ul className="txlist txlist--full" style={{ marginTop: 8 }}>
            {transactions.map((t) => (
              <li key={t.id} className="tx tx--full">
                <div className="tx__dot" data-status={t.status} />
                <div className="tx__main">
                  <span className="tx__service">{t.service}</span>
                  <span className="tx__time">{relativeTime(t.created_at)}</span>
                </div>
                <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                <span
                  className="tx__amt mono"
                  style={{ color: t.status === "blocked" || t.status === "denied" ? "var(--ink-faint)" : undefined }}
                >
                  {t.status === "blocked" || t.status === "denied" ? "—" : fmtCents(t.cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
