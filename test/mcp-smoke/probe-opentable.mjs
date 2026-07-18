import { chromium } from "patchright";

const url = "https://www.opentable.com/s?term=San%20Francisco&cuisine=italian&covers=2";
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();
await page.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,mp4,webm}", (r) => r.abort());
try {
  await page.goto(url, { waitUntil: "commit", timeout: 45000 });
} catch (e) {
  console.log("goto warning:", e.message.split("\n")[0]);
}
await page.waitForTimeout(6000);

console.log("final URL:", page.url());
console.log("title:", await page.title());

const sels = {
  'data-test=search-result': '[data-test="search-result"]',
  'data-testid=restaurant-card': '[data-testid="restaurant-card"]',
  'data-restaurant-id': '[data-restaurant-id]',
  'a href*=/restaurant/': "a[href*='/restaurant/']",
  'h2': 'h2',
};
for (const [label, sel] of Object.entries(sels)) {
  console.log(`  count[${label}] =`, await page.locator(sel).count());
}

const body = (await page.textContent("body")) || "";
console.log("body length:", body.length);
console.log("captcha/blocked?:", /captcha|are you a robot|access denied|unusual traffic|verify you are human|px-captcha/i.test(body));
console.log("body snippet:", body.replace(/\s+/g, " ").slice(0, 400));
await browser.close();
