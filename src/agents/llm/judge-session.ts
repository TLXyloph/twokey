/**
 * The judge session: a stateless, HMAC-signed cookie that the demo's browser holds while it uses
 * the AI. Its random id keys the per-session rate limit and spend share in the AI turn log.
 *
 * Cookie: `__Host-twokey_session=v1.<id>.<issuedAt>.<signature>`; HttpOnly, Secure, SameSite=Strict,
 * Path=/, no Domain (the `__Host-` prefix makes the browser enforce the last three). `id` is 128
 * random bits, `issuedAt` is in seconds, and the signature is HMAC-SHA256 over `v1.<id>.<issuedAt>`
 * with the Worker secret TWOKEY_SESSION_SECRET, verified with Web Crypto (constant time).
 *
 * A session proves only that its holder fetched one from this site. It does not identify a person:
 * anyone can get a fresh one, so the hard total budget is what bounds spend, not the session.
 */

export const SESSION_COOKIE = "__Host-twokey_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const MIN_SESSION_SECRET_LENGTH = 32;
/** Tolerated clock difference for a cookie stamped slightly in the future. */
const CLOCK_SKEW_SECONDS = 60;
const VERSION = "v1";
const ID_BYTES = 16;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface JudgeSession {
  /** 22 base64url characters (128 bits). */
  id: string;
  /** Seconds since epoch. */
  issuedAt: number;
}

export type SessionRefusal = "missing" | "malformed" | "bad_signature" | "expired";
export type SessionCheck = { ok: true; session: JudgeSession } | { ok: false; reason: SessionRefusal };

export interface IssuedSession {
  session: JudgeSession;
  /** The full `Set-Cookie` header value. */
  setCookie: string;
}

export type RandomBytes = (length: number) => Uint8Array;
const cryptoRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

export function isUsableSessionSecret(secret: string | undefined): secret is string {
  return secret !== undefined && secret.trim().length >= MIN_SESSION_SECRET_LENGTH;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const payload = (id: string, issuedAt: number) => new TextEncoder().encode(`${VERSION}.${id}.${issuedAt}`);

export async function issueSession(secret: string, nowMs: number, randomBytes: RandomBytes = cryptoRandom): Promise<IssuedSession> {
  const session: JudgeSession = { id: toBase64Url(randomBytes(ID_BYTES)), issuedAt: Math.floor(nowMs / 1000) };
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), payload(session.id, session.issuedAt)));
  const value = `${VERSION}.${session.id}.${session.issuedAt}.${toBase64Url(signature)}`;
  const setCookie = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
  return { session, setCookie };
}

/**
 * HMAC-SHA256 (hex) of a client IP, keyed with the session secret, for the per-IP session cap:
 * the issuance log can count sessions per IP without ever storing the IP. The `twokey-ip-v1:`
 * prefix keeps these MACs apart from session signatures made with the same key.
 */
export async function clientIpHmac(secret: string, ip: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(`twokey-ip-v1:${ip}`));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The value of cookie `name` in a `Cookie` request header, if present. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export async function verifySession(cookieHeader: string | null, secret: string, nowMs: number): Promise<SessionCheck> {
  const value = readCookie(cookieHeader, SESSION_COOKIE);
  if (value === undefined) return { ok: false, reason: "missing" };
  const [version, id, issuedText, signature, ...rest] = value.split(".");
  const issuedAt = Number(issuedText);
  const wellFormed =
    rest.length === 0 &&
    version === VERSION &&
    id !== undefined &&
    ID_PATTERN.test(id) &&
    issuedText !== undefined &&
    /^\d{1,12}$/.test(issuedText) &&
    signature !== undefined &&
    SIGNATURE_PATTERN.test(signature);
  if (!wellFormed) return { ok: false, reason: "malformed" };
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(signature), payload(id, issuedAt));
  if (!valid) return { ok: false, reason: "bad_signature" };
  const nowSeconds = nowMs / 1000;
  if (issuedAt > nowSeconds + CLOCK_SKEW_SECONDS || nowSeconds - issuedAt >= SESSION_TTL_SECONDS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, session: { id, issuedAt } };
}
