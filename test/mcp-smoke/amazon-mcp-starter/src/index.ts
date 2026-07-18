#!/usr/bin/env node
/**
 * Amazon MCP — server entrypoint.
 *
 * COMPLETE: all 14 tool definitions, dispatch, the place-order confirm-gate, the
 * error classifier, and stdio wiring. It delegates every action to browser.ts —
 * so once you fill the browser.ts TODO(agent) scrapes, this file needs no changes.
 *
 * Uses the official @modelcontextprotocol/sdk. All logging -> stderr (stdout is
 * the MCP wire; a stray console.log corrupts the protocol). See RESEARCH §1/§5.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  checkLoginStatus, initiateLogin, searchProducts, getProductDetails,
  addToCart, viewCart, clearCart, previewOrder, placeOrder, trackOrder,
  getOrderHistory, checkPrimeMembership, setDeliveryAddress, closeBrowser,
} from "./browser.js";
import { loadSessionInfo, clearAuthData, getConfigDir } from "./auth.js";

const server = new Server(
  { name: "amazon-mcp", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

/** Wrap any JSON-serializable payload in the MCP text-content envelope. */
function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "amazon_status", description: "Check Amazon login status and session info. Verify auth before other actions.", inputSchema: { type: "object", properties: {} } },
    { name: "amazon_login", description: "Initiate Amazon login. Returns a URL + manual instructions; the human logs in. Then call amazon_status.", inputSchema: { type: "object", properties: {} } },
    { name: "amazon_logout", description: "Clear saved Amazon session and cookies.", inputSchema: { type: "object", properties: {} } },
    { name: "amazon_search", description: "Search products. Returns names, ASINs, prices, ratings, Prime availability.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Search query" }, maxResults: { type: "number", description: "Max results (default 10, cap 50)" } }, required: ["query"] } },
    { name: "amazon_get_product", description: "Product detail by ASIN or URL.", inputSchema: { type: "object", properties: { asinOrUrl: { type: "string", description: "10-char ASIN or full product URL" } }, required: ["asinOrUrl"] } },
    { name: "amazon_add_to_cart", description: "Add a product to cart by ASIN, URL, or search query (adds top hit for queries).", inputSchema: { type: "object", properties: { asinOrQuery: { type: "string" }, quantity: { type: "number", description: "Default 1" } }, required: ["asinOrQuery"] } },
    { name: "amazon_view_cart", description: "View cart items, quantities, prices, subtotal.", inputSchema: { type: "object", properties: {} } },
    { name: "amazon_clear_cart", description: "Remove all items from the cart.", inputSchema: { type: "object", properties: {} } },
    { name: "amazon_preview_order", description: "Dry-run checkout: cart, address, delivery, payment, and any blockers. No order placed.", inputSchema: { type: "object", properties: {} } },
    { name: "amazon_place_order", description: "Place the order. IMPORTANT: set confirm=true ONLY with explicit user confirmation; otherwise returns a preview. Spends real money.", inputSchema: { type: "object", properties: { confirm: { type: "boolean", description: "true = actually place. NEVER set true without explicit user confirmation." } } } },
    { name: "amazon_track_order", description: "Track an order by ID (format 123-1234567-1234567).", inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] } },
    { name: "amazon_get_orders", description: "Recent order history.", inputSchema: { type: "object", properties: { maxOrders: { type: "number", description: "Default 10" } } } },
    { name: "amazon_prime_check", description: "Prime membership status/benefits.", inputSchema: { type: "object", properties: {} } },
    { name: "amazon_set_address", description: "Set/update delivery address.", inputSchema: { type: "object", properties: { address: { type: "string", description: "Full address or ZIP" } }, required: ["address"] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const a = args as Record<string, any>;
  try {
    switch (name) {
      case "amazon_status": {
        const liveStatus = await checkLoginStatus();
        return ok({
          success: true, session: liveStatus, savedSession: loadSessionInfo(), configDir: getConfigDir(),
          message: liveStatus.isLoggedIn
            ? `Logged in${liveStatus.userName ? ` as ${liveStatus.userName}` : ""}${liveStatus.isPrime ? " (Prime)" : ""}`
            : "Not logged in. Use amazon_login.",
        });
      }
      case "amazon_login":
        return ok({ success: true, ...(await initiateLogin()) });
      case "amazon_logout":
        clearAuthData(); await closeBrowser();
        return ok({ success: true, message: "Logged out. Session and cookies cleared." });
      case "amazon_search": {
        const products = await searchProducts(a.query, Math.min(a.maxResults ?? 10, 50));
        return ok({ success: true, query: a.query, count: products.length, products });
      }
      case "amazon_get_product":
        return ok({ success: true, product: await getProductDetails(a.asinOrUrl) });
      case "amazon_add_to_cart": {
        const r = await addToCart(a.asinOrQuery, a.quantity ?? 1);
        return ok({ success: r.success, message: r.message, cartCount: r.cartCount });
      }
      case "amazon_view_cart":
        return ok({ success: true, cart: await viewCart() });
      case "amazon_clear_cart": {
        const r = await clearCart();
        return ok({ success: r.success, message: r.message });
      }
      case "amazon_preview_order": {
        const preview = await previewOrder();
        return ok({
          success: true, ...preview,
          note: preview.canPlace
            ? "Ready. Use amazon_place_order with confirm=true to complete."
            : "Cannot place order. See issues.",
        });
      }
      case "amazon_place_order": {
        // ── CONFIRM-GATE (RESEARCH §9). Preview unless confirm===true. ──
        if (a.confirm !== true) {
          return ok({
            success: true, requiresConfirmation: true, preview: await previewOrder(),
            message: "Order NOT placed. Call again with confirm=true — ONLY after explicit user confirmation.",
          });
        }
        const result = await placeOrder(true);
        if ("requiresConfirmation" in result) {
          return ok({ success: false, requiresConfirmation: true, preview: result.preview });
        }
        return ok({
          success: true, orderPlaced: true, orderId: result.orderId, total: result.total,
          estimatedDelivery: result.estimatedDelivery,
          message: `Order ${result.orderId} placed. ETA: ${result.estimatedDelivery}`,
        });
      }
      case "amazon_track_order":
        return ok({ success: true, tracking: await trackOrder(a.orderId) });
      case "amazon_get_orders": {
        const orders = await getOrderHistory(Math.min(a.maxOrders ?? 10, 50));
        return ok({ success: true, count: orders.length, orders });
      }
      case "amazon_prime_check": {
        const prime = await checkPrimeMembership();
        return ok({ success: true, prime, message: prime.isPrime ? "Prime active" : "No active Prime membership" });
      }
      case "amazon_set_address": {
        const r = await setDeliveryAddress(a.address);
        return ok({ success: r.success, message: r.message, addressSaved: r.addressSaved });
      }
      default:
        return { ...ok({ success: false, error: `Unknown tool: ${name}` }), isError: true };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const lc = msg.toLowerCase();
    const suggestion = lc.includes("captcha")
      ? "Amazon detected automation. Visit amazon.com, complete the CAPTCHA, then retry."
      : lc.includes("login") || lc.includes("auth") || lc.includes("sign in")
        ? "Use amazon_login to authenticate first, then retry."
        : lc.includes("timeout")
          ? "Page load timed out. Check your connection and retry."
          : undefined;
    return { ...ok({ success: false, error: msg, suggestion }), isError: true };
  }
});

server.onclose = async () => { await closeBrowser(); };

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Amazon MCP server running (stdio)");
  console.error(`Config directory: ${getConfigDir()}`);
}
main().catch((err) => { console.error("Failed to start:", err); process.exit(1); });
