/** Money + time helpers. Money is always integer cents until display. */

export const fmtCents = (c: number): string => {
  const sign = c < 0 ? "-" : "";
  return `${sign}$${(Math.abs(c) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/** Parse a user-typed dollar string ("12.50", "$3", "1,000") to integer cents. */
export const dollarsToCents = (s: string): number | null => {
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

export const centsToDollarInput = (c: number): string => (c / 100).toFixed(2);

/**
 * Condense a raw capability id into the part worth reading in the activity feed.
 * Real transactions store the machine id the agent paid against, e.g.
 *   "orthogonal:company-enrich::GET::/companies/enrich"  ->  "orthogonal · company enrich"
 *   "uber:ride"                                          ->  "uber · ride"
 * Strings that are already human-friendly (the demo rows, anything without a
 * "provider:slug" head) pass through untouched.
 */
export const formatService = (service: string): string => {
  // The head before "::" holds "provider:slug"; drop the METHOD::/path tail.
  const head = service.split("::")[0];
  const colon = head.indexOf(":");
  if (colon === -1) return service; // already a friendly label
  const provider = head.slice(0, colon);
  const slug = head.slice(colon + 1);
  if (!provider || !slug) return service;
  return `${provider} · ${slug.replace(/[-_]+/g, " ")}`;
};

export const relativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
