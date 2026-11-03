/**
 * The Worker's bindings and `waitUntil`, through OpenNext's `getCloudflareContext()`. Under plain
 * `next dev` there is no Cloudflare context: every binding then reads as missing and `waitUntil`
 * is undefined, and each route decides what that means (the AI routes fall back to in-memory
 * logs in development only, and answer 503 elsewhere).
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type {} from "./cloudflare-env"; // the CloudflareEnv bindings (DB, secrets, vars)

export interface WorkerContext {
  env: CloudflareEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export function workerContext(): WorkerContext {
  try {
    const { env, ctx } = getCloudflareContext<Record<string, unknown>, { waitUntil(promise: Promise<unknown>): void }>();
    return { env, waitUntil: (promise) => ctx.waitUntil(promise) };
  } catch {
    return { env: {} };
  }
}
