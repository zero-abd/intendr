/**
 * Amazon MCP — Auth / session persistence.
 *
 * COMPLETE as-is. Pure filesystem, no browser. Stores the Playwright cookie jar
 * and a small cached session summary under ~/.<NS>/amazon/. See RESEARCH §3.
 *
 * You normally do not need to change this file.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { BrowserContext, Cookie } from "patchright";

// Namespace for the on-disk config dir. Change "amazon-mcp" if you want isolation
// from other tools that also write under ~/.<ns>/.
const CONFIG_DIR = path.join(os.homedir(), ".amazon-mcp", "amazon");
const COOKIES_FILE = path.join(CONFIG_DIR, "cookies.json");
const SESSION_FILE = path.join(CONFIG_DIR, "session.json");

export interface SessionInfo {
  isLoggedIn: boolean;
  userName?: string;
  isPrime: boolean;
  lastUpdated: string;
  defaultAddress?: string;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

/** Persist ALL context cookies to disk. Call at the end of every browser op. */
export async function saveCookies(context: BrowserContext): Promise<void> {
  ensureConfigDir();
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
}

/** Load non-expired cookies from disk into a fresh context. Returns true if any applied. */
export async function loadCookies(context: BrowserContext): Promise<boolean> {
  if (!fs.existsSync(COOKIES_FILE)) return false;
  try {
    const cookies: Cookie[] = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf-8"));
    const now = Date.now() / 1000;
    const valid = cookies.filter((c) => !c.expires || c.expires > now);
    if (valid.length > 0) {
      await context.addCookies(valid);
      return true;
    }
  } catch (err) {
    console.error("Failed to load cookies:", err);
  }
  return false;
}

export function saveSessionInfo(info: SessionInfo): void {
  ensureConfigDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(info, null, 2));
}

export function loadSessionInfo(): SessionInfo | null {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  } catch (err) {
    console.error("Failed to load session info:", err);
    return null;
  }
}

/** Delete cookies + session (used by amazon_logout). */
export function clearAuthData(): void {
  if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
}

export function hasSavedCookies(): boolean {
  return fs.existsSync(COOKIES_FILE);
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
