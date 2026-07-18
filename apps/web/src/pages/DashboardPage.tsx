import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Eyebrow, Skeleton, SpendMeter, StatTile } from "@intendr/ui";
import { useData } from "../hooks/DataProvider";
import { addFunds, updateCaps } from "../api/wallet";
import { totalSpent } from "../api/transactions";
import { fmtCents, dollarsToCents, centsToDollarInput, relativeTime } from "../lib/format";
import { useAuth } from "../auth/AuthProvider";

const QUICK = [1000, 2500, 5000, 10000]; // cents

export function DashboardPage() {
  const { user } = useAuth();
  const { wallet, transactions, loading, setWallet } = useData();
  const spent = useMemo(() => totalSpent(transactions), [transactions]);

  if (loading && !wallet) return <DashboardSkeleton />;
  if (!wallet) return <EmptyWallet />;

  const remaining = Math.max(wallet.balance_cents - spent, 0);

  return (
    <div className="page" style={{ display: "grid", gap: 20 }}>
      {/* Hero balance */}
      <Card glow className="hero" style={{ animation: "rise 0.5s var(--ease) both" }}>
        <div className="hero__top">
          <div>
            <Eyebrow>Available balance</Eyebrow>
            <div className="hero__balance mono">{fmtCents(wallet.balance_cents)}</div>
            <div className="hero__meta">
              <Badge tone="accent" dot>
                MCP connected
              </Badge>
              <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
                {fmtCents(remaining)} spendable now
              </span>
            </div>
          </div>
          <div className="hero__glyphwrap" aria-hidden>
            <div className="hero__ring" />
          </div>
        </div>
        <div className="hero__meter">
          <SpendMeter spent={spent} cap={wallet.session_cap_cents} label="Session spend vs cap" />
        </div>
      </Card>

      {/* Stat row */}
      <div className="statrow" style={{ animation: "rise 0.5s var(--ease) 0.06s both" }}>
        <StatTile label="Session cap" value={fmtCents(wallet.session_cap_cents)} />
        <StatTile label="Monthly cap" value={fmtCents(wallet.monthly_cap_cents)} />
        <StatTile label="Spent" value={fmtCents(spent)} accent={spent > 0 ? "var(--warn)" : undefined} />
        <StatTile label="Remaining" value={fmtCents(remaining)} accent="var(--accent)" />
      </div>

      <div className="cols" style={{ animation: "rise 0.5s var(--ease) 0.12s both" }}>
        <AddFundsCard onFunded={(w) => setWallet(w)} />
        <CapsCard
          userId={user!.id}
          session={wallet.session_cap_cents}
          monthly={wallet.monthly_cap_cents}
          onSaved={(w) => setWallet(w)}
        />
      </div>

      {/* Recent activity preview */}
      <Card style={{ animation: "rise 0.5s var(--ease) 0.18s both" }}>
        <div className="rowhead">
          <Eyebrow>Recent activity</Eyebrow>
          <Link to="/activity" className="link-quiet">
            View all →
          </Link>
        </div>
        {transactions.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            No spend yet. When an agent pays through your MCP wallet, it shows up here.
          </p>
        ) : (
          <ul className="txlist" style={{ marginTop: 8 }}>
            {transactions.slice(0, 5).map((t) => (
              <li key={t.id} className="tx">
                <div className="tx__dot" data-status={t.status} />
                <div className="tx__main">
                  <span className="tx__service">{t.service}</span>
                  <span className="tx__time">{relativeTime(t.created_at)}</span>
                </div>
                <span className="tx__amt mono">{fmtCents(t.cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ── Add funds ─────────────────────────────────────────────── */
function AddFundsCard({ onFunded }: { onFunded: (w: import("../api/types").Wallet) => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function fund(cents: number) {
    if (cents <= 0) return;
    setBusy(true);
    setErr(null);
    try {
      const w = await addFunds(cents);
      onFunded(w);
      setAmount("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const custom = dollarsToCents(amount);

  return (
    <Card>
      <Eyebrow>Add money</Eyebrow>
      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        Top up the wallet the agent draws from.
      </p>
      <div className="chips" style={{ marginTop: 16 }}>
        {QUICK.map((c) => (
          <button key={c} className="chip" disabled={busy} onClick={() => fund(c)}>
            +{fmtCents(c)}
          </button>
        ))}
      </div>
      <div className="addrow" style={{ marginTop: 14 }}>
        <div className="moneyinput">
          <span className="moneyinput__sign">$</span>
          <input
            className="ui-input ui-input--money"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ paddingLeft: 26 }}
          />
        </div>
        <Button disabled={busy || !custom || custom <= 0} onClick={() => custom && fund(custom)}>
          {busy ? "Adding…" : "Add funds"}
        </Button>
      </div>
      {err && <div className="auth__alert auth__alert--error" style={{ marginTop: 12 }}>{err}</div>}
    </Card>
  );
}

/* ── Caps editor ───────────────────────────────────────────── */
function CapsCard({
  userId,
  session,
  monthly,
  onSaved,
}: {
  userId: string;
  session: number;
  monthly: number;
  onSaved: (w: import("../api/types").Wallet) => void;
}) {
  const [s, setS] = useState(centsToDollarInput(session));
  const [m, setM] = useState(centsToDollarInput(monthly));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sc = dollarsToCents(s);
  const mc = dollarsToCents(m);
  const dirty = sc !== session || mc !== monthly;

  async function save() {
    if (sc == null || mc == null) return;
    setBusy(true);
    setErr(null);
    try {
      const w = await updateCaps(userId, { session_cap_cents: sc, monthly_cap_cents: mc });
      onSaved(w);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Eyebrow>Spend caps</Eyebrow>
      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        The agent is blocked the moment a purchase would cross these.
      </p>
      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <CapField label="Per-session cap" value={s} onChange={setS} />
        <CapField label="Monthly cap" value={m} onChange={setM} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Button variant={dirty ? "primary" : "ghost"} disabled={!dirty || busy || sc == null || mc == null} onClick={save}>
          {busy ? "Saving…" : dirty ? "Save caps" : "Saved"}
        </Button>
      </div>
      {err && <div className="auth__alert auth__alert--error" style={{ marginTop: 12 }}>{err}</div>}
    </Card>
  );
}

function CapField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="ui-field">
      <span>{label}</span>
      <div className="moneyinput">
        <span className="moneyinput__sign">$</span>
        <input
          className="ui-input ui-input--money"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ paddingLeft: 26 }}
        />
      </div>
    </label>
  );
}

/* ── States ────────────────────────────────────────────────── */
function EmptyWallet() {
  return (
    <Card style={{ textAlign: "center", padding: 48 }}>
      <Eyebrow>No wallet yet</Eyebrow>
      <p className="muted" style={{ marginTop: 10 }}>
        Your wallet row hasn't been provisioned. It's created automatically on signup — try signing out and back in.
      </p>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="page" style={{ display: "grid", gap: 20 }}>
      <Card glow style={{ height: 190 }}>
        <Skeleton w={120} h={12} />
        <Skeleton w={240} h={48} style={{ marginTop: 16 }} />
        <Skeleton w="100%" h={12} style={{ marginTop: 40 }} />
      </Card>
      <div className="statrow">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} style={{ height: 84 }}>
            <Skeleton w={70} h={11} />
            <Skeleton w={100} h={22} style={{ marginTop: 12 }} />
          </Card>
        ))}
      </div>
    </div>
  );
}
