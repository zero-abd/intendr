// Location → nearest delivery address.
//
// "get location so it can order to the nearest address": we resolve a coarse geo
// (from the Cloudflare request edge, or an explicit override) and pick the closest
// saved shipping address by great-circle distance. Address discovery itself (what
// addresses are on the account) is the commerce provider's job — this module only
// resolves geo and ranks candidates.

export interface Geo {
  lat: number;
  lng: number;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface Address {
  id?: string;
  label?: string; // "Home", "Work", …
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country?: string;
  lat?: number;
  lng?: number;
}

/**
 * Cloudflare Workers attach an `IncomingRequestCfProperties`-shaped `cf` object to
 * each request with edge-resolved geo. We read it structurally so this package
 * doesn't depend on @cloudflare/workers-types.
 */
export function resolveGeoFromCf(cf: unknown): Geo | undefined {
  if (!cf || typeof cf !== "object") return undefined;
  const c = cf as Record<string, unknown>;
  const lat = Number(c.latitude);
  const lng = Number(c.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return {
    lat,
    lng,
    city: typeof c.city === "string" ? c.city : undefined,
    region: typeof c.region === "string" ? c.region : undefined,
    postalCode: typeof c.postalCode === "string" ? c.postalCode : undefined,
    country: typeof c.country === "string" ? c.country : undefined,
  };
}

const R_KM = 6371;
const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in km between two coordinates. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Choose the saved address nearest to `geo`. Falls back to a postal-code match,
 * then the first address, so we always return something usable if any exist.
 */
export function nearestAddress(geo: Geo | undefined, addresses: Address[]): Address | undefined {
  if (addresses.length === 0) return undefined;
  if (geo) {
    const withCoords = addresses.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng));
    if (withCoords.length > 0) {
      return withCoords.reduce((best, a) =>
        haversineKm(geo, { lat: a.lat as number, lng: a.lng as number }) <
        haversineKm(geo, { lat: best.lat as number, lng: best.lng as number })
          ? a
          : best,
      );
    }
    if (geo.postalCode) {
      const byZip = addresses.find((a) => a.postalCode === geo.postalCode);
      if (byZip) return byZip;
    }
  }
  return addresses[0];
}
