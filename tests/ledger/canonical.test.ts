import { describe, expect, it } from "vitest";
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, canonicalJson, sha256Hex } from "@/ledger/canonical";

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("drops undefined members as JSON.stringify does, and writes undefined array items as null", () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
  });

  it("is the same for two objects that differ only in key order", () => {
    expect(canonicalJson({ x: 1, y: "two" })).toBe(canonicalJson({ y: "two", x: 1 }));
  });
});

describe("sha256Hex", () => {
  it("hashes UTF-8 text to lower-case hex (FIPS 180-2 test vector)", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes raw bytes too", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(await sha256Hex("abc"));
  });
});

describe("base64 helpers", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);

  it("round-trips bytes through standard base64 and base64url", () => {
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });

  it("writes base64url without padding or + and /", () => {
    expect(bytesToBase64Url(new Uint8Array([251, 255]))).toBe("-_8");
  });

  it("refuses text that is not base64", () => {
    expect(() => base64ToBytes("not base64!")).toThrow();
  });
});
