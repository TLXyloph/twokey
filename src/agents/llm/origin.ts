/**
 * Same-origin check for the AI routes: a request is admitted only when the browser says it came
 * from this site. Browsers set `Origin` and `Sec-Fetch-Site` themselves and page scripts cannot
 * forge them, so this stops other websites from spending the demo's AI budget through a visitor's
 * browser. A non-browser client can send any headers it likes; the session cookie, the rate limit
 * and the spend cap are what bound that case.
 *
 * Rules: `Sec-Fetch-Site`, when present, must be `same-origin`. `Origin` must be present and equal
 * the configured site origin (scheme, host and port). In development only, loopback origins
 * (localhost, 127.0.0.1, [::1], any port) are admitted as well.
 */

export interface OriginPolicy {
  /** The deployed site's origin, from `TWOKEY_SITE_ORIGIN`; already normalized. */
  siteOrigin: string | undefined;
  /** True only under `next dev` (NODE_ENV=development). */
  development: boolean;
}

export type OriginRefusal = "sec_fetch_site" | "origin_missing" | "origin_mismatch";
export type OriginCheck = { ok: true } | { ok: false; reason: OriginRefusal };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The origin of an http(s) URL, lower-cased by the URL parser; undefined for anything else. */
export function normalizeOrigin(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function isLoopback(origin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function checkSameOrigin(headers: Headers, policy: OriginPolicy): OriginCheck {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return { ok: false, reason: "sec_fetch_site" };
  const raw = headers.get("origin");
  const origin = raw === "null" ? undefined : normalizeOrigin(raw ?? undefined);
  if (!origin) return { ok: false, reason: "origin_missing" };
  if (policy.siteOrigin !== undefined && origin === policy.siteOrigin) return { ok: true };
  if (policy.development && isLoopback(origin)) return { ok: true };
  return { ok: false, reason: "origin_mismatch" };
}
