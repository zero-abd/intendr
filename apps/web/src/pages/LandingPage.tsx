import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CreditCard, Eyebrow, SpendMeter } from "@intendr/ui";
import { Logo } from "../components/Logo";
import { SERVICES, type ServiceGroup } from "../components/ServiceLogo";

const MCP_COMMAND = "claude mcp add intendr -- npx -y intendr";
const SERVICE_GROUPS: ServiceGroup[] = ["Commerce", "Data & APIs"];

/** How the product works — three-step narrative. */
const STEPS = [
  {
    n: "01",
    title: "Connect one URL",
    body: "Paste the intendr MCP endpoint into any chatbot — Claude, ChatGPT, Cursor. No key, no config. Your agent instantly gets a wallet and a catalog of paid capabilities.",
  },
  {
    n: "02",
    title: "Set a spending cap",
    body: "Fund a spend-capped wallet with a hard limit. Add per-category and per-merchant rules, and approval gates for anything expensive or real-world.",
  },
  {
    n: "03",
    title: "Let the agent pay — safely",
    body: "The agent pays for data APIs and real-world commerce over MCP. The budget engine reserves, settles, and blocks the moment a purchase would break the cap.",
  },
];

/** What makes it stand out — feature grid. */
const FEATURES = [
  {
    title: "Portable MCP surface",
    body: "One endpoint that works from any chatbot — not a bespoke app you have to rebuild everywhere.",
  },
  {
    title: "Real money",
    body: "The balance is a real spendable wallet behind a pluggable payment rail, not a mock.",
  },
  {
    title: "Data + real-world commerce",
    body: "One wallet enriches a company for 3¢, orders a burger, and books a ride — all metered.",
  },
  {
    title: "Guardrails that visibly work",
    body: "The agent gets blocked live the instant it tries to overspend. You watch the cap hold.",
  },
];

export function LandingPage() {
  const [copied, setCopied] = useState(false);

  function copyCommand() {
    void navigator.clipboard
      ?.writeText(MCP_COMMAND)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        /* clipboard blocked — no-op */
      });
  }

  return (
    <div className="lp">
      {/* ── Top nav ─────────────────────────────────────────── */}
      <header className="lp__nav">
        <Logo size={28} />
        <nav className="lp__navlinks">
          <a className="lp__navlink" href="#how">
            How it works
          </a>
          <a className="lp__navlink" href="#features">
            Features
          </a>
          <Link to="/login" className="ui-btn ui-btn--ghost ui-btn--sm">
            Log in
          </Link>
        </nav>
      </header>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="lp__hero">
        <div className="lp__herocopy">
          <Badge tone="accent" dot>
            One MCP endpoint · spend-capped
          </Badge>
          <h1 className="lp__headline">
            A wallet with a spending limit that <span className="accent-text">any AI agent</span> can pay with.
          </h1>
          <p className="lp__sub">
            Real money, real-world commerce, and guardrails that stop overspend the moment a purchase would break the
            budget — all over MCP. Point any chatbot at one URL and your agent gets a budget it can&apos;t blow.
          </p>
          <div className="lp__cta">
            <Link to="/login" className="ui-btn ui-btn--primary">
              Get started
            </Link>
            <Link to="/login" className="ui-btn ui-btn--ghost">
              Log in
            </Link>
          </div>
          <button className="lp__cmd" onClick={copyCommand} type="button" aria-label="Copy install command">
            <span className="lp__cmd-prompt mono">$</span>
            <code className="lp__cmd-text mono">{MCP_COMMAND}</code>
            <span className="lp__cmd-copy mono">{copied ? "Copied ✓" : "Copy"}</span>
          </button>
          <div className="lp__herofoot mono">$45.00 cap · $18.53 spent · 1 block saved</div>
        </div>

        {/* Live product visual */}
        <div className="lp__herovisual">
          <div className="lp__card-float">
            <CreditCard
              nickname="Agent wallet"
              brand="visa"
              last4="4921"
              expMonth={8}
              expYear={28}
              color="lime"
              spentCents={1853}
              limitCents={4500}
            />
          </div>
          <Card glow className="lp__metercard">
            <SpendMeter spent={1853} cap={4500} label="Session spend" />
          </Card>
        </div>
      </section>

      {/* ── "Works with" logo strip ─────────────────────────── */}
      <section className="lp__strip" aria-label="Works with">
        <span className="lp__striplabel">Works with</span>
        <div className="lp__striprow">
          {SERVICES.map(({ name, Glyph }) => (
            <span className="lp__logo" key={name} title={name}>
              <span className="lp__logomark">
                <Glyph />
              </span>
              <span className="lp__logoname">{name}</span>
            </span>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────── */}
      <section className="lp__section" id="how">
        <div className="lp__sectionhead">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="lp__h2">From a URL to a spending agent in three steps.</h2>
        </div>
        <div className="lp__steps">
          {STEPS.map((s) => (
            <Card key={s.n} className="lp__step">
              <span className="lp__stepnum mono">{s.n}</span>
              <h3 className="lp__steptitle">{s.title}</h3>
              <p className="lp__stepbody">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Supported services ──────────────────────────────── */}
      <section className="lp__section" id="services">
        <div className="lp__sectionhead">
          <Eyebrow>Supported services</Eyebrow>
          <h2 className="lp__h2">One wallet. Data APIs and real-world commerce.</h2>
        </div>
        <div className="lp__servicegroups">
          {SERVICE_GROUPS.map((group) => (
            <div className="lp__servicegroup" key={group}>
              <span className="lp__grouplabel">{group}</span>
              <div className="lp__servicegrid">
                {SERVICES.filter((s) => s.group === group).map(({ name, tag, Glyph }) => (
                  <Card key={name} className="lp__service">
                    <span className="lp__logomark lp__logomark--lg">
                      <Glyph />
                    </span>
                    <span className="lp__servicemeta">
                      <span className="lp__servicename">{name}</span>
                      <span className="lp__servicetag">{tag}</span>
                    </span>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="lp__servicenote">
          <span className="accent-text">+ 1,000&#8202;s more</span> data APIs discovered live through the Orthogonal
          catalog — company &amp; people enrichment, lead search, funding, news — all metered through the same
          spend-capped wallet.
        </p>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section className="lp__section" id="features">
        <div className="lp__sectionhead">
          <Eyebrow>Why intendr</Eyebrow>
          <h2 className="lp__h2">The missing layer between an agent and a budget.</h2>
        </div>
        <div className="lp__features">
          {FEATURES.map((f) => (
            <Card key={f.title} className="lp__feature">
              <span className="lp__featuredot" aria-hidden />
              <h3 className="lp__featuretitle">{f.title}</h3>
              <p className="lp__stepbody">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Closing CTA ─────────────────────────────────────── */}
      <section className="lp__closing">
        <Card glow className="lp__closingcard">
          <h2 className="lp__h2">Give your agent money it can&apos;t overspend.</h2>
          <p className="lp__sub" style={{ maxWidth: 520 }}>
            Spin up a spend-capped wallet in seconds and connect it to any MCP-capable chatbot.
          </p>
          <div className="lp__cta">
            <Link to="/login" className="ui-btn ui-btn--primary">
              Get started
            </Link>
            <Link to="/login" className="ui-btn ui-btn--ghost">
              Log in
            </Link>
          </div>
        </Card>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="lp__footer">
        <Logo size={22} />
        <span className="lp__footnote">Spend-capped wallets for AI agents, over MCP.</span>
      </footer>
    </div>
  );
}
