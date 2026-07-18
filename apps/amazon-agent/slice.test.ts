// End-to-end vertical-slice test for the Amazon commerce capability.
//
// Exercises the REAL orchestration (buildTools → guardrails → budget → provider)
// with an in-memory wallet + the mock card issuer — no browser, no real money.
// Run from repo root: bun run test/amazon-slice.test.ts
import { createBudgetPolicy } from "@intendr/budget";
import { MockCardIssuer } from "@intendr/commerce";
import type { Cents, WorkspaceId } from "@intendr/contracts";
import { checkGuardrails } from "@intendr/guardrails";
import { buildTools } from "@intendr/mcp";
import { AmazonProvider, ProviderRegistry } from "@intendr/providers";
import { LocalWalletRail } from "@intendr/wallet";

let failures = 0;
function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) failures++;
}

const noService = (async () => { throw new Error("no service"); }) as never;

// In-memory wallet seeded with $50.00; global cap $50.00 so a confirmed purchase clears.
const rail = new LocalWalletRail(5000);
const ws = "test" as WorkspaceId;
const budget = createBudgetPolicy({ store: rail, settings: { sessionCapCents: 5000, monthlyCapCents: 100000, perCallWarnCents: 5000 } });
const registry = new ProviderRegistry().register(
  new AmazonProvider({ fetch: noService, issuer: new MockCardIssuer() }),
);
const guardrails = { globalCapCents: 5000 as Cents, categoryCapsCents: {}, merchantAllowlist: [] };
const state = { spentCents: 0 as Cents, spentByCategoryCents: {} as Record<string, Cents> };

const tools = new Map(buildTools({ workspaceId: ws, registry, budget, rail, guardrails, state }).map((t) => [t.spec.name, t.handler]));
const call = (name: string, input: Record<string, unknown>) => tools.get(name)!(input);

async function main() {
  // 1. search finds the amazon capability
  const found = (await call("search_services", { query: "buy batteries on amazon" })) as Array<{ id: string }>;
  assert(found.some((r) => r.id === "amazon:buy"), "search_services surfaces amazon:buy");

  // 2. get_service reports a write with dynamic pricing
  const svc = (await call("get_service", { id: "amazon:buy" })) as { sideEffect: string; dynamicPricing: boolean };
  assert(svc.sideEffect === "write" && svc.dynamicPricing, "get_service: write + dynamicPricing");

  // 3. pay_and_run WITHOUT confirm → BLOCKED + needsApproval + a live preview (no charge)
  const blocked = (await call("pay_and_run", { id: "amazon:buy", input: { body: { query: "batteries" } } })) as
    { status: string; needsApproval: boolean; preview?: { totalCents: number; preview?: boolean } };
  assert(blocked.status === "BLOCKED" && blocked.needsApproval, "unconfirmed purchase is BLOCKED/needsApproval");
  assert(!!blocked.preview && blocked.preview.preview === true && blocked.preview.totalCents > 0, "block carries a no-charge cart preview");
  assert(state.spentCents === 0, "nothing spent on a blocked/previewed purchase");

  // 4. confirmed purchase within cap → placed via mock card, wallet settled with actual total
  const ok = (await call("pay_and_run", { id: "amazon:buy", input: { body: { query: "batteries", confirm: true } } })) as
    { status: string; priceCents: number; balanceCents: number };
  assert(ok.status === "ok", "confirmed purchase completes");
  assert(ok.priceCents > 1000 && ok.priceCents < 2000, `settled the ACTUAL dynamic total ($${(ok.priceCents / 100).toFixed(2)}), not the estimate`);
  assert(ok.balanceCents === 5000 - ok.priceCents, "wallet debited by the actual total");
  assert(state.spentCents === ok.priceCents, "spend state reflects the purchase");

  // 5. nearest-address: no address supplied, geo near Seattle → picks the Seattle addr
  const seattle = new AmazonProvider({ fetch: noService, issuer: new MockCardIssuer(), geo: { lat: 47.6, lng: -122.33 } });
  const preview = (await seattle.preview("amazon:buy", { body: { query: "cable" } })) as { address: { city: string }; cardLast4?: string };
  assert(preview.address.city === "Seattle", "nearest-address picks Seattle for a Seattle geo");
  assert(preview.cardLast4 === undefined, "preview never issues a card");

  // 6. the mock card is a non-chargeable test PAN (no real money)
  const card = await new MockCardIssuer().issue({ amountCents: 1500, merchant: "amazon" });
  assert(card.mock === true && card.instrument.last4 === "4242", "issuer returns a mock test card (4242, no real money)");

  // 7. guardrail: a confirmed pricey write is still capped
  const overCap = checkGuardrails({ globalCapCents: 2500 as Cents, categoryCapsCents: {}, merchantAllowlist: [] },
    { spentCents: 2400 as Cents, spentByCategoryCents: {} },
    { provider: "amazon", category: "amazon", cents: 500 as Cents, sideEffect: "write", confirmed: true });
  assert(overCap.allow === false, "confirmed write still blocked when it would exceed the global cap");

  console.log(`\n${failures === 0 ? "ALL PASSED ✅" : `${failures} FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
