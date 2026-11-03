import { describe, expect, it } from "vitest";
import { checkSameOrigin, normalizeOrigin } from "@/agents/llm/origin";

const SITE = "https://twokey.afterscroll.workers.dev";
const headers = (values: Record<string, string>) => new Headers(values);
const production = { siteOrigin: SITE, development: false };
const development = { siteOrigin: undefined, development: true };

describe("checkSameOrigin", () => {
  it("admits a same-origin browser request from the site itself", () => {
    expect(checkSameOrigin(headers({ origin: SITE, "sec-fetch-site": "same-origin" }), production)).toEqual({ ok: true });
  });

  it("admits a request with a matching Origin when the browser sends no Sec-Fetch-Site", () => {
    expect(checkSameOrigin(headers({ origin: SITE }), production)).toEqual({ ok: true });
  });

  it("refuses another site, even when it claims same-origin fetch metadata", () => {
    expect(checkSameOrigin(headers({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }), production)).toEqual({
      ok: false,
      reason: "origin_mismatch",
    });
  });

  it.each(["cross-site", "same-site", "none"])("refuses Sec-Fetch-Site %s, even with the right Origin", (site) => {
    expect(checkSameOrigin(headers({ origin: SITE, "sec-fetch-site": site }), production)).toEqual({
      ok: false,
      reason: "sec_fetch_site",
    });
  });

  it("refuses a request with no Origin, or the opaque 'null' origin", () => {
    expect(checkSameOrigin(headers({}), production)).toEqual({ ok: false, reason: "origin_missing" });
    expect(checkSameOrigin(headers({ origin: "null" }), production)).toEqual({ ok: false, reason: "origin_missing" });
  });

  it("refuses localhost in production", () => {
    expect(checkSameOrigin(headers({ origin: "http://localhost:3000" }), production)).toEqual({
      ok: false,
      reason: "origin_mismatch",
    });
  });

  it("admits loopback origins in development only", () => {
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3001", "http://[::1]:3000", "https://localhost"]) {
      expect(checkSameOrigin(headers({ origin, "sec-fetch-site": "same-origin" }), development)).toEqual({ ok: true });
    }
    expect(checkSameOrigin(headers({ origin: "http://localhost.evil.example" }), development)).toEqual({
      ok: false,
      reason: "origin_mismatch",
    });
  });

  it("still admits the configured site in development", () => {
    expect(checkSameOrigin(headers({ origin: SITE }), { siteOrigin: SITE, development: true })).toEqual({ ok: true });
  });

  it("compares origins exactly: scheme, host and port", () => {
    expect(checkSameOrigin(headers({ origin: "http://twokey.afterscroll.workers.dev" }), production)).toMatchObject({ ok: false });
    expect(checkSameOrigin(headers({ origin: `${SITE}:8443` }), production)).toMatchObject({ ok: false });
  });
});

describe("normalizeOrigin", () => {
  it("reduces a URL to its origin and rejects anything that is not http(s)", () => {
    expect(normalizeOrigin(`${SITE}/demo`)).toBe(SITE);
    expect(normalizeOrigin(" https://Example.COM ")).toBe("https://example.com");
    expect(normalizeOrigin("ftp://example.com")).toBeUndefined();
    expect(normalizeOrigin("not a url")).toBeUndefined();
    expect(normalizeOrigin(undefined)).toBeUndefined();
    expect(normalizeOrigin("")).toBeUndefined();
  });
});
