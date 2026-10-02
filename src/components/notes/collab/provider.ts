import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

import { STORED_MESSAGE } from "@/lib/collab/protocol";

/**
 * The live-collaboration transport behind the note editor, kept behind this
 * small interface so the backend can be swapped (docs/features/collaboration.md,
 * "Hosting"). The editor needs a Y.Doc it owns, an Awareness for carets and
 * presence, and the events below. createHocuspocusProvider is the default
 * and speaks the Hocuspocus protocol (the bundled server, or TipTap Cloud);
 * a Liveblocks or PartyKit backend would wrap its own Yjs provider the same
 * way and be passed to useNoteCollab instead.
 */

export type CollabConnection = "connecting" | "connected" | "disconnected";

export interface CollabProviderEvents {
  /** The document is in sync with the server (first sync, or after a reconnect). */
  onSynced(): void;
  onConnection(status: CollabConnection): void;
  /** The server accepted the token; whether this connection may write. */
  onAuthenticated(canWrite: boolean): void;
  /** The server refused the token, or no token could be had. */
  onAuthFailed(reason: string): void;
  /** Local changes the server has not acknowledged yet. */
  onUnsyncedChanges(count: number): void;
  /** The server saved the document into the note. */
  onStored(): void;
}

export interface CollabProviderOptions {
  url: string;
  documentName: string;
  doc: Y.Doc;
  /** Asked on every (re)connection and whenever the server wants a fresh token. */
  getToken(): Promise<string>;
  events: CollabProviderEvents;
}

export interface CollabProvider {
  readonly awareness: Awareness;
  destroy(): void;
}

export type CollabProviderFactory = (options: CollabProviderOptions) => CollabProvider;

/** Server-side closes in a row, without a sync in between, before giving up. */
const MAX_REOPENS = 3;

export const createHocuspocusProvider: CollabProviderFactory = ({
  url,
  documentName,
  doc,
  getToken,
  events,
}) => {
  let reopens = 0;
  let destroyed = false;

  const provider: HocuspocusProvider = new HocuspocusProvider({
    url,
    name: documentName,
    document: doc,
    token: getToken,
    onSynced: () => {
      reopens = 0;
      events.onSynced();
    },
    onStatus: ({ status }) => events.onConnection(status as CollabConnection),
    onAuthenticated: ({ scope }) => events.onAuthenticated(scope === "read-write"),
    onAuthenticationFailed: ({ reason }) => events.onAuthFailed(reason),
    onUnsyncedChanges: ({ number }) => events.onUnsyncedChanges(number),
    onStateless: ({ payload }) => {
      if (payload === STORED_MESSAGE) events.onStored();
    },
    onClose: () => {
      // A socket that really closed reconnects by itself. The server can also
      // close just this document and keep the socket (its token expired, or
      // the app revoked the note's sessions): authenticate again on the same
      // socket, which asks the app for a fresh token.
      if (
        destroyed ||
        provider.configuration.websocketProvider.status !== WebSocketStatus.Connected
      )
        return;
      if (++reopens > MAX_REOPENS) {
        events.onAuthFailed("closed-by-server");
        return;
      }
      void provider.sendToken().then(() => {
        if (!destroyed) provider.startSync();
      });
    },
  });

  return {
    awareness: provider.awareness as Awareness,
    destroy() {
      destroyed = true;
      provider.destroy();
    },
  };
};
