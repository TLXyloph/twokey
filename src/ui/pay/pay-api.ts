/**
 * The pay page's calls to its own server: create the order, then capture it. Both need the
 * judge-session cookie; on a 401 `no_session` the page asks `/api/ai/session` for one and retries
 * once. Errors carry the server's plain message, or the page's own words when the reply can't be
 * read. The browser never sends an amount: only the event and the quantity.
 */
import { API, type CaptureResult, type CreateOrderBody } from "@/ledger/contracts";

export type PayMethod = "paypal" | "venmo";
type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export class PayApiError extends Error {
  readonly code: string;
  /** HTTP status, or 0 when nothing came back. */
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "PayApiError";
    this.code = code;
    this.status = status;
  }
}

const UNREADABLE = "The club's server sent an answer this page couldn't read. Nothing was charged; try again.";
const NETWORK = "This page couldn't reach the club's server. Check your connection and try again.";

export interface PayApi {
  createOrder(eventId: CreateOrderBody["eventId"], quantity: number): Promise<{ orderId: string }>;
  captureOrder(orderId: string, method: PayMethod): Promise<CaptureResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorFrom(status: number, body: unknown): PayApiError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  if (error && typeof error.code === "string" && typeof error.message === "string") {
    return new PayApiError(error.code, status, error.message);
  }
  return new PayApiError("unreadable", status, UNREADABLE);
}

export function createPayApi(fetchFn: FetchFn = (input, init) => fetch(input, init)): PayApi {
  async function send(path: string, body: unknown): Promise<Response> {
    try {
      return await fetchFn(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new PayApiError("network", 0, NETWORK);
    }
  }

  async function post(path: string, body: unknown): Promise<unknown> {
    let response = await send(path, body);
    let payload = await readJson(response);
    if (response.status === 401 && isRecord(payload) && isRecord(payload.error) && payload.error.code === "no_session") {
      const session = await send(API.session, {});
      if (session.ok) {
        response = await send(path, body);
        payload = await readJson(response);
      }
    }
    if (!response.ok) throw errorFrom(response.status, payload);
    return payload;
  }

  return {
    async createOrder(eventId, quantity) {
      const body = await post(API.orders, { eventId, quantity } satisfies CreateOrderBody);
      if (!isRecord(body) || typeof body.orderId !== "string" || body.orderId === "") throw new PayApiError("unreadable", 200, UNREADABLE);
      return { orderId: body.orderId };
    },
    async captureOrder(orderId, method) {
      const body = await post(API.capture(orderId), { method });
      if (
        !isRecord(body) ||
        typeof body.captureId !== "string" ||
        typeof body.status !== "string" ||
        typeof body.amountCents !== "number"
      ) {
        throw new PayApiError("unreadable", 200, UNREADABLE);
      }
      return { captureId: body.captureId, status: body.status, amountCents: body.amountCents };
    },
  };
}
