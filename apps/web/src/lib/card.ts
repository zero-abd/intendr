// Card helpers for the SANDBOX card form.
//
// SECURITY: this module never persists or transmits a full card number. It validates
// and formats input purely in-memory, then `sandboxTokenize()` throws the PAN away and
// returns only { token, brand, last4, expMonth, expYear }. In production this whole step
// is replaced by a PCI-compliant provider iframe (Stripe Elements) that we never see the
// number through — the return shape is intentionally identical so the swap is trivial.

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "unknown";

export interface CardTokenResult {
  token: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
}

const BRAND_PREFIXES: Array<{ brand: CardBrand; test: RegExp; lengths: number[]; cvcLen: number }> = [
  { brand: "amex", test: /^3[47]/, lengths: [15], cvcLen: 4 },
  { brand: "visa", test: /^4/, lengths: [16], cvcLen: 3 },
  { brand: "mastercard", test: /^(5[1-5]|2[2-7])/, lengths: [16], cvcLen: 3 },
  { brand: "discover", test: /^(6011|64[4-9]|65)/, lengths: [16], cvcLen: 3 },
];

export function detectBrand(digits: string): CardBrand {
  const d = digits.replace(/\D/g, "");
  return BRAND_PREFIXES.find((b) => b.test.test(d))?.brand ?? "unknown";
}

export function brandMeta(brand: CardBrand): { label: string; cvcLen: number; maxLen: number } {
  const spec = BRAND_PREFIXES.find((b) => b.brand === brand);
  const label = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", unknown: "Card" }[brand];
  return { label, cvcLen: spec?.cvcLen ?? 3, maxLen: spec?.brand === "amex" ? 15 : 16 };
}

/** Luhn check — a real card-number checksum (used to validate test cards look plausible). */
export function luhnValid(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Group digits for display: Amex 4-6-5, others 4-4-4-4. Never stored — display only. */
export function formatCardNumber(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const brand = detectBrand(d);
  const groups = brand === "amex" ? [4, 6, 5] : [4, 4, 4, 4];
  const out: string[] = [];
  let i = 0;
  for (const g of groups) {
    if (i >= d.length) break;
    out.push(d.slice(i, i + g));
    i += g;
  }
  return out.join(" ");
}

export function formatExpiry(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

export interface CardValidation {
  numberOk: boolean;
  expiryOk: boolean;
  cvcOk: boolean;
  nameOk: boolean;
  brand: CardBrand;
  expMonth?: number;
  expYear?: number;
}

export function validateCard(input: {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
}): CardValidation {
  const digits = input.number.replace(/\D/g, "");
  const brand = detectBrand(digits);
  const { cvcLen, maxLen } = brandMeta(brand);

  const numberOk = digits.length === maxLen && luhnValid(digits);

  const [mmRaw, yyRaw] = input.expiry.split("/");
  const mm = Number(mmRaw);
  const yy = yyRaw ? Number(yyRaw) : NaN;
  const fullYear = yy < 100 ? 2000 + yy : yy;
  // Compare against a fixed "now" would need Date; keep it simple: valid month + plausible year.
  const expiryOk = mm >= 1 && mm <= 12 && fullYear >= 2024 && fullYear <= 2099;

  const cvcOk = new RegExp(`^\\d{${cvcLen}}$`).test(input.cvc);
  const nameOk = input.name.trim().length >= 2;

  return {
    numberOk,
    expiryOk,
    cvcOk,
    nameOk,
    brand,
    expMonth: expiryOk ? mm : undefined,
    expYear: expiryOk ? fullYear : undefined,
  };
}

/**
 * Sandbox tokenization. In production this is Stripe Elements' `createToken` — the PAN
 * never reaches our JS. Here we derive a deterministic-looking fake token from a random
 * seed (passed in so this module stays pure/testable) and DISCARD the number: only last4
 * and expiry survive.
 */
export function sandboxTokenize(
  input: { number: string; expiry: string; cvc: string; name: string },
  seed: string,
): CardTokenResult | { error: string } {
  const v = validateCard(input);
  if (!v.numberOk) return { error: "That card number isn't valid. Try a test card like 4242 4242 4242 4242." };
  if (!v.expiryOk) return { error: "Enter a valid expiry (MM/YY)." };
  if (!v.cvcOk) return { error: "Enter a valid security code." };
  if (!v.nameOk) return { error: "Enter the cardholder name." };

  const digits = input.number.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  // `cvc` and the full number go no further than this function scope.
  return {
    token: `tok_sandbox_${seed}`,
    brand: v.brand,
    last4,
    expMonth: v.expMonth!,
    expYear: v.expYear!,
  };
}

/** A fake 16-digit-ish last4 for an *issued* virtual card (display only). */
export function randomLast4(seed: number): string {
  return String(1000 + (seed % 9000));
}
