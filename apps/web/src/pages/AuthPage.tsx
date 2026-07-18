import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field } from "@intendr/ui";
import { useAuth } from "../auth/AuthProvider";
import { Logo } from "../components/Logo";

type Mode = "signin" | "signup";

const SELLING_POINTS = [
  "Spend-capped wallet any AI agent can pay with",
  "One MCP endpoint — works from any chatbot",
  "Guardrails that block overspend live",
];

export function AuthPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { needsConfirm } = await signUp(email, password, displayName || email.split("@")[0]);
        if (needsConfirm) {
          setNotice("Check your email to confirm your account, then sign in.");
          setMode("signin");
          return;
        }
      } else {
        await signIn(email, password);
      }
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      {/* Left — the pitch */}
      <div className="auth__hero">
        <div className="auth__herotop">
          <Logo size={30} />
        </div>
        <div className="auth__herobody">
          <h1 className="auth__headline">
            A wallet with a spending limit that <span className="accent-text">any AI agent</span> can pay with.
          </h1>
          <p className="auth__sub">
            Real money, real-world commerce, and guardrails that stop overspend the moment a purchase would break the
            budget — over MCP.
          </p>
          <ul className="auth__points">
            {SELLING_POINTS.map((p) => (
              <li key={p}>
                <CheckGlyph />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="auth__herofoot mono">$45.00 cap · $18.53 spent · 1 block saved</div>
      </div>

      {/* Right — the form */}
      <div className="auth__panel">
        <div className="auth__form">
          <div className="auth__tabs">
            <button className={mode === "signin" ? "is-active" : ""} onClick={() => setMode("signin")} type="button">
              Sign in
            </button>
            <button className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")} type="button">
              Create account
            </button>
          </div>

          <h2 className="auth__title">{mode === "signin" ? "Welcome back" : "Open your wallet"}</h2>
          <p className="auth__titlesub">
            {mode === "signin" ? "Sign in to your control plane." : "Spin up a spend-capped wallet in seconds."}
          </p>

          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>
            {mode === "signup" && (
              <Field
                label="Display name"
                placeholder="Ada Lovelace"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            )}
            <Field
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Field
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />

            {error && <div className="auth__alert auth__alert--error">{error}</div>}
            {notice && <div className="auth__alert auth__alert--notice">{notice}</div>}

            <Button type="submit" block disabled={busy} style={{ marginTop: 4, height: 46 }}>
              {busy ? "One sec…" : mode === "signin" ? "Sign in" : "Create wallet"}
            </Button>
          </form>

          <p className="auth__switch">
            {mode === "signin" ? "New here? " : "Already have a wallet? "}
            <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="var(--accent-wash)" />
      <path d="m7.5 12.5 3 3 6-7" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
