/**
 * The Cron Trigger's work (every 10 minutes; wrangler.jsonc `triggers.crons`): POST
 * /api/watchtower/run on the app's own fetch handler (OpenNext's), with
 * `Authorization: Bearer <TWOKEY_CRON_SECRET>`. Calling the handler directly keeps the request
 * inside the Worker: nothing goes over the network, and the route runs with the same env and D1.
 *
 * Dependency-free on purpose: the Worker entry (src/platform/cron-worker.ts) imports it, and
 * wrangler bundles that entry outside Next's build. Never logs the secret.
 */
import { WATCHTOWER_API } from "./contracts";

export interface CronEnv {
  TWOKEY_CRON_SECRET?: string;
  TWOKEY_SITE_ORIGIN?: string;
}

export type FetchHandler<Env, Ctx> = (request: Request, env: Env, ctx: Ctx) => Response | Promise<Response>;

/** The origin of the internal request when TWOKEY_SITE_ORIGIN isn't a URL (routing ignores the host). */
export const FALLBACK_ORIGIN = "https://twokey.invalid";

function originOf(raw: string | undefined): string {
  try {
    const url = new URL(raw ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : FALLBACK_ORIGIN;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

const CODE = /^[a-z_]{1,32}$/;

/** Runs the Watchtower once through the app's route. Rejects when the route doesn't answer 200. */
export async function runScheduledWatch<Env extends CronEnv, Ctx>(
  fetchHandler: FetchHandler<Env, Ctx>,
  env: Env,
  ctx: Ctx,
  log: (line: string) => void = (line) => console.info(line),
): Promise<void> {
  const secret = env.TWOKEY_CRON_SECRET?.trim();
  if (!secret) {
    log("[watchtower/cron] outcome=skipped detail=TWOKEY_CRON_SECRET:unset");
    return;
  }
  const request = new Request(`${originOf(env.TWOKEY_SITE_ORIGIN)}${WATCHTOWER_API.run}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  const response = await fetchHandler(request, env, ctx);
  const body: unknown = await response.json().catch(() => undefined);
  const { outcome, newFindings } = (typeof body === "object" && body !== null ? body : {}) as { outcome?: unknown; newFindings?: unknown };
  const parts = [`[watchtower/cron] status=${response.status}`];
  if (response.status === 200 && typeof outcome === "string" && CODE.test(outcome)) parts.push(`outcome=${outcome}`);
  if (response.status === 200 && Number.isSafeInteger(newFindings)) parts.push(`new=${String(newFindings)}`);
  log(parts.join(" "));
  if (response.status !== 200) throw new Error(`watchtower run answered ${response.status}`);
}
