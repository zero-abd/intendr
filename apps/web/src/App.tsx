import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export function App() {
  const [health, setHealth] = useState("…");

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((r) => r.json())
      .then((d) => setHealth(JSON.stringify(d)))
      .catch((e) => setHealth(String(e)));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>intendr</h1>
      <p>Wallet control plane — scaffold. Balance, caps, MCP connection, activity, and approvals go here.</p>
      <pre style={{ background: "#f4f4f5", padding: "0.75rem", borderRadius: 8 }}>API health: {health}</pre>
    </main>
  );
}
