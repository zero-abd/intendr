import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@intendr/ui/theme.css";
import "./app.css";
import { App } from "./App";
import { ConfigNeeded } from "./pages/ConfigNeeded";
import { isSupabaseConfigured } from "./lib/supabase";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isSupabaseConfigured ? <App /> : <ConfigNeeded />}</StrictMode>,
);
