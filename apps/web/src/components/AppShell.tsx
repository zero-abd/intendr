import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Avatar, Badge } from "@intendr/ui";
import { useAuth } from "../auth/AuthProvider";
import { useProfile } from "../hooks/DataProvider";
import { Logo } from "./Logo";

const NAV = [
  { to: "/dashboard", label: "Wallet", icon: WalletIcon },
  { to: "/activity", label: "Activity", icon: ActivityIcon },
  { to: "/profile", label: "Profile", icon: UserIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setNavOpen(false), [location.pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const name = profile?.display_name ?? user?.email?.split("@")[0] ?? "You";

  return (
    <div className="shell">
      <aside className={`shell__nav ${navOpen ? "is-open" : ""}`}>
        <div className="shell__brand">
          <Logo size={26} />
        </div>

        <nav className="shell__links">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `navlink ${isActive ? "is-active" : ""}`}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="shell__navfoot">
          <div className="shell__mcp">
            <Badge tone="accent" dot>
              MCP live
            </Badge>
            <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>agents can pay</span>
          </div>
        </div>
      </aside>

      <div className="shell__main">
        <header className="shell__header">
          <button className="shell__burger" onClick={() => setNavOpen((v) => !v)} aria-label="Menu">
            <BurgerIcon />
          </button>
          <div className="shell__crumb">
            <span className="ui-eyebrow">intendr</span>
            <span style={{ color: "var(--ink-ghost)" }}>/</span>
            <span style={{ fontWeight: 560 }}>{NAV.find((n) => location.pathname.startsWith(n.to))?.label ?? "Wallet"}</span>
          </div>

          <div className="shell__usermenu" ref={menuRef}>
            <button className="shell__usertrigger" onClick={() => setMenuOpen((v) => !v)}>
              <Avatar name={name} src={profile?.avatar_url} size={32} />
              <div className="shell__userinfo">
                <span className="shell__username">{name}</span>
                <span className="shell__useremail">{user?.email}</span>
              </div>
              <ChevronIcon />
            </button>
            {menuOpen && (
              <div className="menu">
                <NavLink to="/profile" className="menu__item" onClick={() => setMenuOpen(false)}>
                  <UserIcon /> Profile & settings
                </NavLink>
                <button className="menu__item menu__item--danger" onClick={() => signOut()}>
                  <SignOutIcon /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="shell__content">{children}</main>
      </div>

      {navOpen && <div className="shell__scrim" onClick={() => setNavOpen(false)} />}
    </div>
  );
}

/* ── Inline icons (stroke = currentColor) ──────────────────── */
const ico = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function WalletIcon() { return <svg {...ico}><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0H5a2 2 0 0 0-2 2z" /><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M16 12h.01" /></svg>; }
function ActivityIcon() { return <svg {...ico}><path d="M3 12h4l2 6 4-14 2 8h6" /></svg>; }
function UserIcon() { return <svg {...ico}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>; }
function ChevronIcon() { return <svg {...ico} width={16} height={16}><path d="m6 9 6 6 6-6" /></svg>; }
function SignOutIcon() { return <svg {...ico}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>; }
function BurgerIcon() { return <svg {...ico} width={22} height={22}><path d="M4 6h16M4 12h16M4 18h16" /></svg>; }
