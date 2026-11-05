/**
 * The close routes' glue: builds `CloseApiDeps` from the Worker (OpenNext's Cloudflare context for
 * D1, the env for secrets and vars, falling back to `process.env`, which `next dev` fills from .env).
 * Under plain `next dev` with no D1 binding, and only there, sign-offs are kept in memory (per
 * process, reset on restart).
 */
import { workerContext } from "@/platform/worker-context";
import { createD1SignoffStore, createInMemorySignoffStore, type CloseSignoffStore } from "../signoff-store";
import type { CloseApiDeps } from "./prelude";

type StringEnvName = "TWOKEY_SESSION_SECRET" | "TWOKEY_SITE_ORIGIN" | "TWOKEY_DEMO_KEY_REVIEWER";

let devStore: CloseSignoffStore | undefined;

export function closeDepsFromWorker(): CloseApiDeps {
  const { env } = workerContext();
  const read = (name: StringEnvName): string | undefined => env[name] ?? process.env[name];
  const development = process.env.NODE_ENV === "development";
  const store = env.DB ? createD1SignoffStore(env.DB) : development ? (devStore ??= createInMemorySignoffStore()) : undefined;
  return {
    env: {
      TWOKEY_SESSION_SECRET: read("TWOKEY_SESSION_SECRET"),
      TWOKEY_SITE_ORIGIN: read("TWOKEY_SITE_ORIGIN"),
      TWOKEY_DEMO_KEY_REVIEWER: read("TWOKEY_DEMO_KEY_REVIEWER"),
    },
    development,
    store,
  };
}
