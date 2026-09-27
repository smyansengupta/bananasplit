import {
  BRIDGE_PATHS,
  fromBase64,
  signBridgeRequest,
  toBase64,
  type BridgeOperation,
  type LoadResponse,
  type StoreResponse,
} from "@/lib/collab/bridge";

/**
 * The collaboration server's side of the bridge: load and store a note's
 * Yjs state through the app (src/app/api/collab), which reads and writes the
 * Note row in the acting user's own RLS context. The collaboration server
 * holds no database credentials.
 *
 * Transient failures (network, 5xx, 409) are retried with backoff; a refusal
 * (401, 403, 404, 413, 422) is not, and throws BridgeError.
 */

export class BridgeError extends Error {
  readonly status: number;
  constructor(operation: BridgeOperation, status: number) {
    super(`bridge ${operation} failed with ${status || "a network error"}`);
    this.name = "BridgeError";
    this.status = status;
  }
}

export interface BridgeClient {
  load(documentName: string, userId: string): Promise<Uint8Array>;
  store(
    documentName: string,
    userId: string,
    state: Uint8Array,
  ): Promise<{ version: number | null; update: Uint8Array | null }>;
}

export interface BridgeClientOptions {
  /** The app's origin, e.g. http://localhost:3000. */
  appUrl: string;
  secret: string;
  fetch?: typeof fetch;
  /** Delays between attempts, ms (one attempt more than entries). */
  backoff?: number[];
  timeoutMs?: number;
}

const RETRYABLE = new Set([0, 409, 429, 500, 502, 503, 504]);

export function createBridgeClient({
  appUrl,
  secret,
  fetch: doFetch = fetch,
  backoff = [500, 2000],
  timeoutMs = 10_000,
}: BridgeClientOptions): BridgeClient {
  const base = appUrl.replace(/\/+$/, "");

  async function call<T>(operation: BridgeOperation, payload: object): Promise<T> {
    const body = JSON.stringify(payload);
    for (let attempt = 0; ; attempt++) {
      let status = 0;
      try {
        const response = await doFetch(`${base}${BRIDGE_PATHS[operation]}`, {
          method: "POST",
          headers: signBridgeRequest(operation, body, secret),
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return (await response.json()) as T;
        status = response.status;
      } catch {
        status = 0;
      }
      if (!RETRYABLE.has(status) || attempt >= backoff.length) {
        throw new BridgeError(operation, status);
      }
      await new Promise((resolve) => setTimeout(resolve, backoff[attempt]));
    }
  }

  return {
    async load(documentName, userId) {
      const { state } = await call<LoadResponse>("load", { documentName, userId });
      return fromBase64(state);
    },
    async store(documentName, userId, state) {
      const res = await call<StoreResponse>("store", {
        documentName,
        userId,
        state: toBase64(state),
      });
      return { version: res.version, update: res.update ? fromBase64(res.update) : null };
    },
  };
}
