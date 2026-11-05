/**
 * The seed every session's chain starts from (spec §2): the demo club data and the two seeded
 * payout requests, under a version. Seq 1's `prevHash` is the seed hash, so a session's chain
 * proves which seed it was folded over. Bump SEED_VERSION whenever the seed changes.
 */
import { riverbend } from "@/demo/riverbend";
import { SEEDED_REQUESTS } from "@/disbursements/seed-requests";
import { canonicalJson, sha256Hex } from "./canonical";

export const SEED_VERSION = "twokey-seed-v2-2026-11-05";

let memo: Promise<string> | undefined;

/** SHA-256 (hex) of the canonical {seedVersion, club, requests}. */
export function seedHash(): Promise<string> {
  memo ??= sha256Hex(canonicalJson({ seedVersion: SEED_VERSION, club: riverbend, requests: SEEDED_REQUESTS }));
  return memo;
}
