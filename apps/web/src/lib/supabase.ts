import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Whether real Supabase credentials are present. When false, the app shows a
 *  "connect Supabase" onboarding screen instead of mounting the authed UI. */
export const isSupabaseConfigured = Boolean(url && anon);

// One client for the whole app (multiple clients cause duplicate auth events +
// token-refresh races). Placeholder values keep the module import-safe when
// unconfigured — the client is never *used* until credentials exist.
export const supabase: SupabaseClient = createClient(
  url || "https://placeholder.supabase.co",
  anon || "placeholder-anon-key",
  {
    auth: {
      persistSession: true, // survives refresh (localStorage)
      autoRefreshToken: true, // silent JWT refresh before expiry
      detectSessionInUrl: true, // OAuth / email-confirm redirects
    },
  },
);
