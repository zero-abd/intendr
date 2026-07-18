// Amazon automation service.
//
// A tiny Node HTTP service the edge Worker's AmazonProvider calls, because a
// Worker can't run Playwright. Endpoints mirror @intendr/commerce's contract:
//   POST /search     { query, maxResults? }        -> { products }
//   POST /addresses  {}                            -> { addresses }
//   POST /purchase   { asin|query, address, card?, confirm } -> purchase/preview
//
// MOCK by default (no browser, no login, no real money). Set AMAZON_LIVE=1 to use
// the real browser path (apps below), which requires patchright + a logged-in
// Amazon session (see test/mcp-smoke/amazon-mcp-starter). The live card-entry +
// place-order steps are the sensitive part and are gated behind confirm=true AND
// AMAZON_LIVE=1; until fully wired they throw rather than silently no-op.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  amazonAgentMock,
  consumeCardCredentials,
  type AmazonPurchaseRequest,
  type AmazonPurchaseResponse,
  type AmazonSearchRequest,
  type FetchLike,
} from "@intendr/commerce";

const PORT = Number(process.env.PORT ?? 8899);
const LIVE = process.env.AMAZON_LIVE === "1";
// Executor config for redeeming real card credentials from apps/virtual-cards.
const VIRTUAL_CARDS_URL = process.env.VIRTUAL_CARDS_URL;
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;
const EXECUTOR_ID = process.env.CHECKOUT_EXECUTOR_ID ?? "amazon-agent";
const nodeFetch: FetchLike = (url, init) => globalThis.fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
};

// ── Live browser path (guarded) ───────────────────────────────────────────────
// Kept isolated so mock mode never imports patchright. Fully wiring the browser
// automation (selectors, login, card entry, place-order) is the work described in
// test/mcp-smoke/AMAZON-MCP-RESEARCH.md — this is the integration seam for it.
async function livePurchase(req: AmazonPurchaseRequest): Promise<AmazonPurchaseResponse> {
  // 1. Obtain the card credentials to enter at checkout.
  //    - Real flow: redeem the one-time PAN from apps/virtual-cards (PAN stays server-side here).
  //    - Mock instrument: use it directly.
  let pan: string | undefined;
  let cvv: string | undefined;
  if (req.cardRef) {
    if (!VIRTUAL_CARDS_URL || !INTERNAL_SERVICE_TOKEN) {
      throw new Error("cardRef supplied but VIRTUAL_CARDS_URL / INTERNAL_SERVICE_TOKEN are unset (executor can't redeem the PAN)");
    }
    const creds = await consumeCardCredentials(
      { fetch: nodeFetch, baseUrl: VIRTUAL_CARDS_URL, internalServiceToken: INTERNAL_SERVICE_TOKEN, executorId: EXECUTOR_ID },
      req.cardRef,
    );
    const data = creds.cardData as { pan?: string; cvv?: string } | undefined;
    pan = data?.pan;
    cvv = data?.cvv;
    if (!pan) throw new Error("virtual-cards returned no PAN for this program — use Lithic's secure card element (getEmbedURL) with lithicCardToken");
  } else if (req.card) {
    pan = req.card.pan;
    cvv = req.card.cvv;
  } else {
    throw new Error("no card supplied for a confirmed live purchase");
  }

  // 2. Drive the browser to purchase, entering the PAN at checkout.
  try {
    await import("patchright");
  } catch {
    throw new Error("AMAZON_LIVE=1 but 'patchright' is not installed. Run: npm i patchright && npx patchright install chromium");
  }
  // TODO(agent): drive the browser per AMAZON-MCP-RESEARCH.md §6/§9 —
  //   1. ensure logged-in session, 2. search/select product, 3. set delivery address,
  //   4. add to cart -> checkout, 5. enter pan/cvv at the payment step and click Place Order,
  //      verify the order id (never fabricate), 6. return the real total.
  void pan; void cvv;
  throw new Error("live checkout not yet wired — credential redemption is in place; browser card-entry is the remaining TODO (see test/mcp-smoke/amazon-mcp-starter).");
}

async function handle(op: string, payload: Record<string, unknown>): Promise<unknown> {
  switch (op) {
    case "search":
      return amazonAgentMock.search(payload as unknown as AmazonSearchRequest);
    case "addresses":
      return amazonAgentMock.addresses();
    case "purchase": {
      const req = payload as unknown as AmazonPurchaseRequest;
      // Live mode only touches a real browser/card on a CONFIRMED purchase; previews stay mock-cheap.
      if (LIVE && req.confirm) return livePurchase(req);
      return amazonAgentMock.purchase(req);
    }
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === "GET" && req.url === "/health") return sendJson(res, 200, { ok: true, live: LIVE });
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
    const op = (req.url ?? "").replace(/^\/+/, "").split("?")[0];
    try {
      const payload = await readBody(req);
      sendJson(res, 200, await handle(op, payload));
    } catch (e) {
      sendJson(res, op === "purchase" ? 502 : 400, { error: e instanceof Error ? e.message : String(e) });
    }
  })();
});

server.listen(PORT, () => {
  console.error(`[amazon-agent] listening on :${PORT} (mode: ${LIVE ? "LIVE browser" : "MOCK"})`);
});
