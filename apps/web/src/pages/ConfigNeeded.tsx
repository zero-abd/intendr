import { Card, Eyebrow } from "@intendr/ui";
import { Logo } from "../components/Logo";

/** Shown when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent, so the app
 *  never white-screens before credentials are wired in. */
export function ConfigNeeded() {
  return (
    <div className="config">
      <div className="config__inner">
        <Logo size={30} />
        <h1 className="config__title">Connect your Supabase project</h1>
        <p className="config__sub">
          intendr stores auth, wallet, and profile data in Supabase. Add two env vars and restart the dev server.
        </p>

        <Card className="config__card">
          <Eyebrow>1 · apps/web/.env.local</Eyebrow>
          <pre className="config__code mono">{`VITE_SUPABASE_URL=https://YOUR_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}</pre>
          <p className="config__hint">
            Find both in Supabase → Project Settings → API. Use the <strong>anon / publishable</strong> key (safe in the
            browser — RLS protects the data). Never the service_role key.
          </p>
        </Card>

        <Card className="config__card">
          <Eyebrow>2 · Run the schema</Eyebrow>
          <p className="config__hint" style={{ marginTop: 10 }}>
            Paste <span className="mono">apps/web/supabase/schema.sql</span> into the Supabase SQL editor and run it.
            It creates the <span className="mono">profiles</span>, <span className="mono">wallets</span>, and{" "}
            <span className="mono">transactions</span> tables with per-user row-level security, plus the signup trigger.
          </p>
        </Card>

        <p className="config__foot mono">restart · bun --cwd apps/web run dev</p>
      </div>
    </div>
  );
}
