import { describe, expect, it } from "vitest";
import {
  issueSession,
  isUsableSessionSecret,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifySession,
} from "@/agents/llm/judge-session";

// A test-only value, long enough to pass the minimum length; never a real secret.
const SECRET = "test-session-secret-not-real-0123456789abcdef";
const OTHER_SECRET = "another-test-secret-not-real-0123456789abcdef";
const NOW = 1_790_000_000_000;
const fixedBytes = (n: number) => new Uint8Array(n).fill(7);

const cookieHeaderFrom = (setCookie: string) => setCookie.split(";")[0]!;

describe("issueSession", () => {
  it("sets an HttpOnly, Secure, SameSite=Strict, host-only cookie that expires with the session", async () => {
    const issued = await issueSession(SECRET, NOW, fixedBytes);
    const attributes = issued.setCookie.split("; ");
    expect(attributes[0]?.startsWith(`${SESSION_COOKIE}=v1.`)).toBe(true);
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(attributes).toEqual(
      expect.arrayContaining(["Path=/", `Max-Age=${SESSION_TTL_SECONDS}`, "HttpOnly", "Secure", "SameSite=Strict"]),
    );
    expect(attributes.some((part) => part.toLowerCase().startsWith("domain="))).toBe(false);
    expect(issued.session).toEqual({ id: "BwcHBwcHBwcHBwcHBwcHBw", issuedAt: NOW / 1000 });
  });

  it("draws a fresh 128-bit id from the random source each time", async () => {
    const a = await issueSession(SECRET, NOW);
    const b = await issueSession(SECRET, NOW);
    expect(a.session.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.session.id).not.toBe(b.session.id);
  });
});

describe("verifySession", () => {
  it("accepts the cookie it issued and returns the session", async () => {
    const issued = await issueSession(SECRET, NOW, fixedBytes);
    const header = `theme=dark; ${cookieHeaderFrom(issued.setCookie)}; other=1`;
    expect(await verifySession(header, SECRET, NOW + 1000)).toEqual({ ok: true, session: issued.session });
  });

  it("reports a missing cookie", async () => {
    expect(await verifySession(null, SECRET, NOW)).toEqual({ ok: false, reason: "missing" });
    expect(await verifySession("theme=dark", SECRET, NOW)).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses a cookie signed with another secret", async () => {
    const issued = await issueSession(OTHER_SECRET, NOW);
    expect(await verifySession(cookieHeaderFrom(issued.setCookie), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a cookie whose id or time was changed after signing", async () => {
    const issued = await issueSession(SECRET, NOW, fixedBytes);
    const [name, value] = cookieHeaderFrom(issued.setCookie).split("=") as [string, string];
    const [version, id, issuedAt, signature] = value.split(".");
    const forgedId = `${name}=${[version, `A${id!.slice(1)}`, issuedAt, signature].join(".")}`;
    const forgedTime = `${name}=${[version, id, String(Number(issuedAt) + 3600), signature].join(".")}`;
    expect(await verifySession(forgedId, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifySession(forgedTime, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses an expired session, and one issued in the future", async () => {
    const issued = await issueSession(SECRET, NOW);
    const header = cookieHeaderFrom(issued.setCookie);
    expect(await verifySession(header, SECRET, NOW + SESSION_TTL_SECONDS * 1000)).toEqual({ ok: false, reason: "expired" });
    expect(await verifySession(header, SECRET, NOW - 5 * 60_000)).toEqual({ ok: false, reason: "expired" });
  });

  it.each(["", "v1", "v2.abc.1.sig", "v1.short.1790000000.sig", "v1.BwcHBwcHBwcHBwcHBwcHBw.notanumber.sig", "v1.BwcHBwcHBwcHBwcHBwcHBw.1790000000.***"])(
    "refuses a malformed value %j",
    async (value) => {
      expect(await verifySession(`${SESSION_COOKIE}=${value}`, SECRET, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/malformed|missing/) });
    },
  );
});

describe("isUsableSessionSecret", () => {
  it("requires at least 32 characters", () => {
    expect(isUsableSessionSecret(SECRET)).toBe(true);
    expect(isUsableSessionSecret("x".repeat(31))).toBe(false);
    expect(isUsableSessionSecret(undefined)).toBe(false);
    expect(isUsableSessionSecret("   ")).toBe(false);
  });
});

describe("readCookie", () => {
  it("finds a cookie by exact name", () => {
    expect(readCookie("a=1; __Host-twokey_session=v; b=2", "__Host-twokey_session")).toBe("v");
    expect(readCookie("x__Host-twokey_session=v", "__Host-twokey_session")).toBeUndefined();
    expect(readCookie(null, "a")).toBeUndefined();
  });
});
