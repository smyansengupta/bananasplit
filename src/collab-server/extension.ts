import type { IncomingMessage } from "node:http";

import type {
  beforeHandleAwarenessPayload,
  beforeHandleMessagePayload,
  connectedPayload,
  Connection,
  Extension,
  onAuthenticatePayload,
  onLoadDocumentPayload,
  onRequestPayload,
  onStoreDocumentPayload,
  onTokenSyncPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";

import { BRIDGE_PATHS, revokeRequestSchema, verifyBridgeRequest } from "@/lib/collab/bridge";
import { parseDocumentName, STORED_MESSAGE, type CollabUser } from "@/lib/collab/protocol";
import { COLLAB_TOKEN_TTL_SECONDS, verifyCollabToken, type CollabClaims } from "@/lib/collab/token";

import type { BridgeClient } from "./bridge-client";

/**
 * The collaboration server's rules, as a Hocuspocus extension
 * (docs/features/collaboration.md). It never trusts the client:
 *
 * - Connect: the token must verify (COLLAB_SECRET, unexpired) and name this
 *   exact document. "read" tokens make the connection read-only, so the
 *   server drops every document update it sends.
 * - Lifetime: a connection lives only as long as its token. A minute before
 *   `exp` the server asks the editor for a new one (which the app mints only
 *   if RLS still lets the user see the note); a valid refresh extends the
 *   connection and can downgrade it to read-only, and at `exp` without one
 *   the connection is closed. The app's /revoke call closes a document's
 *   connections at once (a note turned PRIVATE or deleted) and refuses, for
 *   that document, every token minted before it, so a client cannot come
 *   back with a token that is still unexpired: only a token minted after the
 *   change (by an RLS read that still finds the note) gets in.
 * - Presence: every awareness state a connection sends is stamped with the
 *   user from its token, and it cannot speak for another connection's
 *   clients, so nobody can appear as someone else.
 * - Persistence: load and store go through the app's bridge routes as the
 *   connecting user and the last writer, never with database credentials
 *   here. What an autosave merged in comes back and is applied to the live
 *   document; every editor then gets a "stored" message.
 */

export interface ConnectionContext {
  userId: string;
  organizationId: string;
  noteId: string;
  documentName: string;
  canWrite: boolean;
  user: CollabUser;
  /** Token expiry, ms since the epoch. */
  expiresAt: number;
}

type Timers = { refresh: ReturnType<typeof setTimeout>; expire: ReturnType<typeof setTimeout> };

/** Ask for a new token this long before the current one expires. */
export const REFRESH_BEFORE_MS = 60_000;

/** A refused connection or token (Hocuspocus sends `reason` to the client). */
export class CollabDenied extends Error {
  readonly reason: string;
  readonly code = 4403;
  constructor(reason: string) {
    super(reason);
    this.name = "CollabDenied";
    this.reason = reason;
  }
}

const TOKEN_EXPIRED = { code: 4401, reason: "token-expired" };

export interface CollabExtensionOptions {
  secret: string;
  bridge: BridgeClient;
  now?: () => number;
}

export function createCollabExtension({
  secret,
  bridge,
  now = Date.now,
}: CollabExtensionOptions): Extension<ConnectionContext> {
  /**
   * Per revoked document, the app's time of the revoke (seconds): tokens
   * issued before it no longer open it. Kept one token lifetime, after which
   * every such token has expired anyway.
   */
  const revokedAt = new Map<string, { notBefore: number; until: number }>();

  function revoke(documentName: string, notBefore: number) {
    const current = now();
    for (const [name, entry] of revokedAt) if (entry.until < current) revokedAt.delete(name);
    revokedAt.set(documentName, {
      notBefore,
      until: current + (COLLAB_TOKEN_TTL_SECONDS + 60) * 1000,
    });
  }

  /** The claims of a valid token for exactly this note's document; throws otherwise. */
  function claimsFor(token: string, documentName: string): CollabClaims {
    const claims = verifyCollabToken(token, secret, now());
    const document = parseDocumentName(documentName);
    const revoked = revokedAt.get(documentName);
    if (
      !claims ||
      !document ||
      claims.doc !== documentName ||
      claims.org !== document.organizationId ||
      (revoked !== undefined && claims.iat < revoked.notBefore)
    ) {
      throw new CollabDenied("invalid-token");
    }
    return claims;
  }

  const timers = new WeakMap<Connection<ConnectionContext>, Timers>();

  function clearTimers(connection: Connection<ConnectionContext>) {
    const current = timers.get(connection);
    if (!current) return;
    clearTimeout(current.refresh);
    clearTimeout(current.expire);
    timers.delete(connection);
  }

  function scheduleTimers(connection: Connection<ConnectionContext>) {
    clearTimers(connection);
    const left = connection.context.expiresAt - now();
    const refresh = setTimeout(
      () => connection.requestToken(),
      Math.max(0, left - REFRESH_BEFORE_MS),
    );
    const expire = setTimeout(() => connection.close(TOKEN_EXPIRED), Math.max(0, left));
    refresh.unref?.();
    expire.unref?.();
    timers.set(connection, { refresh, expire });
  }

  return {
    extensionName: "cbc-collab",

    async onAuthenticate({ token, documentName, connectionConfig }: onAuthenticatePayload) {
      const claims = claimsFor(token, documentName);
      const document = parseDocumentName(documentName)!;
      connectionConfig.readOnly = claims.perm !== "write";
      const context: ConnectionContext = {
        userId: claims.sub,
        organizationId: claims.org,
        noteId: document.noteId,
        documentName,
        canWrite: claims.perm === "write",
        user: { id: claims.sub, name: claims.name, slot: claims.slot },
        expiresAt: claims.exp * 1000,
      };
      return context;
    },

    async connected({ connection }: connectedPayload<ConnectionContext>) {
      scheduleTimers(connection);
      connection.onClose(() => clearTimers(connection));
    },

    async onTokenSync({ token, documentName, connection }: onTokenSyncPayload<ConnectionContext>) {
      // connection.context is the object the document and awareness hooks
      // read; Hocuspocus also merges the returned fields into its own copy.
      const context = connection.context;
      const claims = claimsFor(token, documentName);
      if (claims.sub !== context.userId) throw new CollabDenied("invalid-token");
      const refreshed = {
        canWrite: claims.perm === "write",
        user: { id: claims.sub, name: claims.name, slot: claims.slot },
        expiresAt: claims.exp * 1000,
      };
      Object.assign(context, refreshed);
      connection.readOnly = !refreshed.canWrite;
      scheduleTimers(connection);
      return refreshed;
    },

    async beforeHandleMessage({ connection }: beforeHandleMessagePayload<ConnectionContext>) {
      // The expiry timer closes the connection; this catches a message that
      // races it.
      if (connection.context.expiresAt <= now()) throw new CollabDenied("token-expired");
    },

    async beforeHandleAwareness({
      states,
      connection,
      document,
    }: beforeHandleAwarenessPayload<ConnectionContext>) {
      // No connection: a server-side awareness change, nothing to stamp.
      if (!connection) return;
      const { user } = connection.context;
      // Another connection's clients are not this connection's to describe.
      for (const other of document.getConnections()) {
        if (other === connection) continue;
        for (const clientId of document.getClients(other)) states.delete(clientId);
      }
      for (const [clientId, state] of states) {
        // An empty state carries nothing (Hocuspocus's own scratch client among them).
        if (!state || Object.keys(state).length === 0) {
          states.delete(clientId);
          continue;
        }
        state.user = { ...user };
      }
    },

    async onLoadDocument({ documentName, context }: onLoadDocumentPayload<ConnectionContext>) {
      return bridge.load(documentName, context.userId);
    },

    async onStoreDocument({
      documentName,
      document,
      lastContext,
    }: onStoreDocumentPayload<ConnectionContext>) {
      // Read-only connections cannot change the document, so the last change
      // came from a writer; anything else (a server-side merge) has no one to
      // save as and needs no save.
      if (!lastContext?.userId || !lastContext.canWrite) return;
      const { update } = await bridge.store(
        documentName,
        lastContext.userId,
        Y.encodeStateAsUpdate(document),
      );
      if (update) {
        // An autosave the app merged in: apply it without scheduling a save
        // of what was just saved.
        Y.applyUpdate(document, update, { source: "local", skipStoreHooks: true });
      }
      document.broadcastStateless(STORED_MESSAGE);
    },

    async onRequest({ request, response, instance }: onRequestPayload) {
      const path = new URL(request.url ?? "/", "http://collab").pathname;
      if (request.method !== "POST" || path !== BRIDGE_PATHS.revoke) return;

      const body = await readBody(request);
      let status = 204;
      if (body === null) {
        status = 413;
      } else if (
        !verifyBridgeRequest("revoke", body, (name) => headerValue(request, name), secret, now())
      ) {
        status = 401;
      } else {
        const parsed = revokeRequestSchema.safeParse(safeJson(body));
        if (!parsed.success) {
          status = 400;
        } else {
          // Refuse older tokens first, so nobody reconnects in between.
          revoke(parsed.data.documentName, Math.floor(parsed.data.notBefore / 1000));
          instance.closeConnections(parsed.data.documentName);
        }
      }
      response.writeHead(status, { "Cache-Control": "no-store" });
      response.end();
      // A rejection without an error stops Hocuspocus's default response.
      return Promise.reject();
    },
  };
}

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The request body as text, or null past a small cap (a revoke is a few hundred bytes). */
async function readBody(request: IncomingMessage, cap = 16 * 1024): Promise<string | null> {
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    total += (chunk as Buffer).length;
    if (total > cap) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
