/**
 * Amazon MCP — Browser automation layer.
 *
 * The bootstrap (singleton browser, stealth context, init scripts), the
 * CAPTCHA check, and every navigation are REAL. The DOM-scraping inside each
 * operation is left as `TODO(agent)` because Amazon's markup rotates and MUST
 * be validated against a live page. Selectors to start from are in RESEARCH §6.
 *
 * Contract for every exported op: initBrowser() -> page.goto -> randomDelay ->
 * checkForCaptcha -> scrape -> saveCookies -> return plain data. THROW on failure;
 * index.ts turns throws into structured MCP errors.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "patchright";
import { saveCookies, loadCookies, saveSessionInfo, type SessionInfo } from "./auth.js";

const AMAZON_BASE_URL = "https://www.amazon.com";
const DEFAULT_TIMEOUT = 30_000;

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

/** Human-ish jitter. Keep between navigation/click/scrape steps (RESEARCH §4). */
function randomDelay(min = 500, max = 2000): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((r) => setTimeout(r, ms));
}

async function initBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  if (browser && context && page) return { browser, context, page };

  browser = await chromium.launch({
    // RESEARCH §8: headful + patchright's own Chromium is the strongest stealth.
    // Flip to false / add `channel: "chrome"` only per that section's guidance.
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1366,768",
      // NOTE: reference also used --disable-web-security; omitted here (RESEARCH §10.7).
    ],
  });

  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  context = await browser.newContext({
    userAgent,
    viewport: { width: 1366, height: 768 },
    screen: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "America/New_York",
    colorScheme: "light",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
  });

  if (await loadCookies(context)) console.error("Loaded saved Amazon cookies");

  page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    // @ts-ignore
    if (window.chrome) window.chrome.runtime = {};
  });

  return { browser, context, page };
}

export async function closeBrowser(): Promise<void> {
  if (context) await saveCookies(context);
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
  }
}

/** RESEARCH §7. Returns true if the current page is a CAPTCHA/robot wall. */
async function checkForCaptcha(p: Page): Promise<boolean> {
  const sels = [
    'form[action*="validateCaptcha"]',
    "#captchacharacters",
    'input[id="captchacharacters"]',
  ];
  for (const s of sels) if (await p.$(s)) return true;
  const url = p.url();
  return url.includes("captcha") || url.includes("validateCaptcha");
}

/** Shared preamble: navigate, settle, fail loudly on a bot wall. */
async function gotoAndGuard(p: Page, url: string): Promise<void> {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT });
  await randomDelay(600, 1200);
  if (await checkForCaptcha(p)) {
    throw new Error("CAPTCHA detected. Complete it at amazon.com in a browser, then retry.");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Result types (fill fields as you implement each scrape).
// ────────────────────────────────────────────────────────────────────────────
export interface Product { name: string; asin?: string; price: string; rating?: string; url?: string; isPrime?: boolean; inStock?: boolean; badge?: string }
export interface CartItem { name: string; asin?: string; quantity: number; price: string; seller?: string }
export interface Cart { items: CartItem[]; subtotal: string; estimatedTax?: string; itemCount: number }
export interface OrderPreview { canPlace: boolean; cart: Cart; deliveryAddress?: string; deliveryEstimate?: string; paymentMethod?: string; issues?: string[] }

// ────────────────────────────────────────────────────────────────────────────
// Operations. Bootstrap/nav are done; fill each TODO(agent) using RESEARCH §6.
// ────────────────────────────────────────────────────────────────────────────

export async function checkLoginStatus(): Promise<SessionInfo> {
  const { page, context } = await initBrowser();
  await gotoAndGuard(page, AMAZON_BASE_URL);
  // TODO(agent): scrape account nav (RESEARCH §3).
  //   accountText = "#nav-link-accountList-nav-line-1, #nav-item-signout, [data-nav-role='signin'] span.nav-line-1"
  //   isLoggedIn  = text && !text.toLowerCase().includes("sign in")
  //   userName    = /Hello,\s+(.+)/i ; isPrime = "#nav-prime-btn,.nav-prime-badge" present
  //   defaultAddress = "#nav-global-location-popover-link" text
  const info: SessionInfo = {
    isLoggedIn: false, // TODO(agent)
    userName: undefined, // TODO(agent)
    isPrime: false, // TODO(agent)
    defaultAddress: undefined, // TODO(agent)
    lastUpdated: new Date().toISOString(),
  };
  saveSessionInfo(info);
  await saveCookies(context);
  return info;
}

export async function initiateLogin(): Promise<{ loginUrl: string; instructions: string }> {
  const { page, context } = await initBrowser();
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/ap/signin`);
  await saveCookies(context);
  // Login is HUMAN-driven — we only hand back the URL + instructions (RESEARCH §3).
  return {
    loginUrl: `${AMAZON_BASE_URL}/ap/signin`,
    instructions:
      "Log in to Amazon manually:\n1. Open the URL in a browser\n2. Sign in (complete 2FA if prompted)\n" +
      "3. Run amazon_status to verify + save the session.\n" +
      "Tip: first login is most reliable in a VISIBLE (headful) browser.",
  };
}

export async function searchProducts(query: string, maxResults = 10): Promise<Product[]> {
  const { page, context } = await initBrowser();
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/s?k=${encodeURIComponent(query)}`);
  await page
    .waitForSelector('[data-component-type="s-search-result"], .s-result-item[data-asin]', { timeout: 10_000 })
    .catch(() => {});
  // TODO(agent): page.evaluate over
  //   '[data-component-type="s-search-result"][data-asin]:not([data-asin=""])'
  //   name "h2 a span"; price ".a-price-whole"+".a-price-fraction" | ".a-offscreen";
  //   rating ".a-icon-alt"; prime ".a-icon-prime"; link "h2 a".
  //   RESEARCH §10.1/§10.2: return a DISTINCT error if the results container is
  //   missing/blocked (don't return [] as success), and filter Sponsored cards.
  const products: Product[] = []; // TODO(agent)
  await saveCookies(context);
  return products;
}

export async function getProductDetails(asinOrUrl: string): Promise<Product> {
  const { page, context } = await initBrowser();
  const url = asinOrUrl.startsWith("http") ? asinOrUrl : `${AMAZON_BASE_URL}/dp/${asinOrUrl}`;
  await gotoAndGuard(page, url);
  // TODO(agent): title "#productTitle"; price ".a-price .a-offscreen";
  //   features "#feature-bullets li span.a-list-item"; seller "#merchant-info a";
  //   delivery "#mir-layout-DELIVERY_BLOCK .a-text-bold"; asin from /dp/([A-Z0-9]{10})/.
  const detail: Product = { name: "TODO(agent)", price: "TODO(agent)" };
  await saveCookies(context);
  return detail;
}

export async function addToCart(asinOrQuery: string, quantity = 1): Promise<{ success: boolean; message: string; cartCount?: number }> {
  const { page, context } = await initBrowser();
  let productUrl: string;
  if (/^[A-Z0-9]{10}$/i.test(asinOrQuery)) productUrl = `${AMAZON_BASE_URL}/dp/${asinOrQuery}`;
  else if (asinOrQuery.startsWith("http")) productUrl = asinOrQuery;
  else {
    const hits = await searchProducts(asinOrQuery, 1);
    if (!hits.length || !hits[0].asin) throw new Error(`No products found for: ${asinOrQuery}`);
    productUrl = `${AMAZON_BASE_URL}/dp/${hits[0].asin}`;
  }
  await gotoAndGuard(page, productUrl);
  // TODO(agent):
  //   if (quantity>1) select "select#quantity".
  //   click add: "#add-to-cart-button, input[name='submit.add-to-cart'], button[name='submit.add-to-cart']"
  //   DISMISS upsell: "#attachSiNoCoverage, #siNoCoverage, [data-action='siNoCoverage'], #attachDisplayAddAccessories-skip-btn"
  //   cartCount "#nav-cart-count"; success "#NATC_SMART_WAGON_CONF_MSG_SUCCESS, .a-alert-success"
  await saveCookies(context);
  return { success: false, message: "TODO(agent): implement add-to-cart", cartCount: undefined };
}

export async function viewCart(): Promise<Cart> {
  const { page, context } = await initBrowser();
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/cart`);
  // TODO(agent): empty ".sc-empty-cart"; items ".sc-list-item[data-asin]";
  //   subtotal "#sc-subtotal-amount-activecart .sc-price".
  const cart: Cart = { items: [], subtotal: "$0.00", itemCount: 0 }; // TODO(agent)
  await saveCookies(context);
  return cart;
}

export async function clearCart(): Promise<{ success: boolean; message: string }> {
  const { page, context } = await initBrowser();
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/cart`);
  let removed = 0;
  // TODO(agent): loop-click "input[value='Delete'], [data-action='delete'], .sc-action-delete input"
  //   until none remain (hard cap 100). Increment `removed`.
  await saveCookies(context);
  return { success: true, message: removed > 0 ? `Removed ${removed} items` : "Cart was already empty" };
}

export async function previewOrder(): Promise<OrderPreview> {
  const { page, context } = await initBrowser();
  const cart = await viewCart();
  const issues: string[] = [];
  if (cart.itemCount === 0) issues.push("Cart is empty");
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/gp/buy/spc/handlers/display.html`);
  // TODO(agent): sign-in blocker "#ap_email,#signInSubmit" -> push "Must be logged in".
  //   scrape address "#address-book-entry-0,.displayAddressDiv"; delivery ".delivery-date-display";
  //   payment ".pmts-instrument-name-use". canPlace = issues.length===0.
  await saveCookies(context);
  return { canPlace: issues.length === 0, cart, issues: issues.length ? issues : undefined };
}

/**
 * ⚠️ SPENDS REAL MONEY. RESEARCH §9. Must only run with confirmPlacement===true,
 * and index.ts must only pass true after explicit human confirmation.
 */
export async function placeOrder(
  confirmPlacement: boolean,
): Promise<{ orderId: string; total: string; estimatedDelivery: string } | { requiresConfirmation: true; preview: OrderPreview }> {
  if (!confirmPlacement) return { requiresConfirmation: true, preview: await previewOrder() };

  const { page } = await initBrowser();
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/gp/buy/spc/handlers/display.html`);
  // TODO(agent):
  //   click "#submitOrderButtonId input, #placeYourOrder input, input[name='placeYourOrder1']"
  //   waitForURL(/\/gp\/buy\/thankyou\/|\/order\//i).
  //   orderId via body match \b\d{3}-\d{7}-\d{7}\b.
  //   RESEARCH §9.5: if NO orderId and NOT on a thankyou URL -> THROW
  //   "Could not confirm the order completed" — DO NOT fabricate an id.
  //   On success: await saveCookies(context) then return {orderId,total,estimatedDelivery}.
  throw new Error("TODO(agent): implement place-order with the §9 confirm/verify invariants");
}

export async function trackOrder(orderId: string): Promise<Record<string, unknown>> {
  const { page, context } = await initBrowser();
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/gp/your-account/order-details?orderID=${encodeURIComponent(orderId)}`);
  // TODO(agent): status ".order-status-widget .a-alert-heading";
  //   tracking ".carrier-tracking-number,[data-tracking-id]".
  const tracking: Record<string, unknown> = {}; // TODO(agent)
  await saveCookies(context);
  return tracking;
}

export async function getOrderHistory(maxOrders = 10): Promise<Array<Record<string, unknown>>> {
  const { page, context } = await initBrowser();
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/gp/your-account/order-history`);
  // TODO(agent): sign-in guard "#ap_email,#signInSubmit" -> throw "Not logged in".
  //   cards ".order,[class*='order-card']"; orderId ".order-id span"; total ".a-color-price".
  const orders: Array<Record<string, unknown>> = []; // TODO(agent) (respect maxOrders)
  await saveCookies(context);
  return orders;
}

export async function checkPrimeMembership(): Promise<{ isPrime: boolean; memberSince?: string; expiresOn?: string; benefits?: string[] }> {
  const { page, context } = await initBrowser();
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/gp/primecentral`);
  // TODO(agent): isPrime if prime heading present / title contains "prime".
  const prime = { isPrime: false }; // TODO(agent)
  await saveCookies(context);
  return prime;
}

export async function setDeliveryAddress(address: string): Promise<{ success: boolean; message: string; addressSaved?: string }> {
  const { page, context } = await initBrowser();
  await gotoAndGuard(page, `${AMAZON_BASE_URL}/gp/ship-to/handlers/display.html`);
  // TODO(agent): fill "#address-ui-widgets-enterAddressLine1" (or zip input);
  //   pick autocomplete ".pac-item,[role='option']"; submit "#address-ui-widgets-form-submit-btn".
  await saveCookies(context);
  return { success: false, message: "TODO(agent): implement set-address", addressSaved: address };
}

// Cleanup on process exit.
process.on("exit", () => { if (browser) browser.close().catch(() => {}); });
process.on("SIGINT", async () => { await closeBrowser(); process.exit(0); });
process.on("SIGTERM", async () => { await closeBrowser(); process.exit(0); });
