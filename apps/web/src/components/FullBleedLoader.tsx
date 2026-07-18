import { Logo } from "./Logo";

export function FullBleedLoader() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div style={{ animation: "spin 1.4s linear infinite", display: "grid", placeItems: "center" }}>
          <Logo size={34} withWord={false} />
        </div>
        <span className="ui-eyebrow">Loading wallet</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
