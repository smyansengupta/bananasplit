"use client";

import { useEffect, useState } from "react";
import * as Y from "yjs";

import { issueNoteCollabToken, type CollabTokenResult } from "@/app/app/[orgSlug]/notes/actions";
import type { CollabUser } from "@/lib/collab/protocol";
import type { NoteCollabSession } from "@/server/collab/session";

import {
  createHocuspocusProvider,
  type CollabConnection,
  type CollabProvider,
  type CollabProviderFactory,
} from "./provider";

/**
 * The note editor's live-collaboration session (docs/features/collaboration.md).
 *
 *   off          collaboration is off (no session from the page)
 *   connecting   joining; the autosave editor shows the note read-only meanwhile
 *   live         synced: the collaborative editor takes over
 *   fallback     could not join (server unreachable, token refused, no sync
 *                within the timeout): the autosave editor, exactly as before
 *   interrupted  was live, then the server stopped accepting the connection
 *                for a reason other than lost access; read-only until it
 *                recovers (a later sync goes back to live) or a reload
 *   revoked      was live, then the app refused a new token: the note is no
 *                longer visible to this user, so the editor is removed
 *
 * Falling back happens only before the first sync. Once live, a dropped
 * connection keeps the editor (Yjs holds the edits and merges them on
 * reconnect) rather than switching to autosave: saving the same edits both
 * ways would write them twice.
 */

export type NoteCollabMode = "off" | "connecting" | "live" | "fallback" | "interrupted" | "revoked";

export interface CollabPeer {
  clientId: number;
  user: CollabUser;
}

export interface LiveSession {
  doc: Y.Doc;
  provider: CollabProvider;
  user: CollabUser;
}

export interface NoteCollabState {
  mode: NoteCollabMode;
  /** The live document and its provider, from the first sync on. */
  live: LiveSession | null;
  canWrite: boolean;
  connection: CollabConnection;
  /** Local changes the server has not acknowledged. */
  unsynced: number;
  /** Counts the server's saves of the document into the note. */
  stored: number;
  /** Everyone else in the note, one entry per person. */
  peers: CollabPeer[];
}

export interface UseNoteCollabOptions {
  orgId: string;
  noteId: string;
  /** The page's session (first token), or null when collaboration is off. */
  initial: NoteCollabSession | null;
  /** Give up joining and fall back after this long without a sync. */
  connectTimeoutMs?: number;
  providerFactory?: CollabProviderFactory;
  issueToken?: (orgId: string, noteId: string) => Promise<CollabTokenResult>;
}

/** A token with less than this left is not worth connecting with. */
const MIN_TOKEN_LIFE_MS = 30_000;
const TOKEN_RETRY_MS = [1000, 3000];

class AccessRefused extends Error {}

export function useNoteCollab({
  orgId,
  noteId,
  initial,
  connectTimeoutMs = 6000,
  providerFactory = createHocuspocusProvider,
  issueToken = issueNoteCollabToken,
}: UseNoteCollabOptions): NoteCollabState {
  const [state, setState] = useState<NoteCollabState>(() => ({
    mode: initial ? "connecting" : "off",
    live: null,
    canWrite: initial?.canWrite ?? false,
    connection: "connecting",
    unsynced: 0,
    stored: 0,
    peers: [],
  }));

  useEffect(() => {
    if (!initial) return;
    const update = (patch: Partial<NoteCollabState>) => setState((s) => ({ ...s, ...patch }));

    const doc = new Y.Doc();
    let mode: NoteCollabMode = "connecting";
    let initialUsed = false;
    let refused = false;
    let disposed = false;

    async function getToken(): Promise<string> {
      if (!initialUsed && initial!.expiresAt - Date.now() > MIN_TOKEN_LIFE_MS) {
        initialUsed = true;
        return initial!.token;
      }
      initialUsed = true;
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await issueToken(orgId, noteId);
          if (result.error !== undefined) throw new AccessRefused(result.error);
          update({ canWrite: result.session.canWrite });
          return result.session.token;
        } catch (error) {
          if (error instanceof AccessRefused) {
            refused = true;
            throw error;
          }
          if (attempt >= TOKEN_RETRY_MS.length) throw error;
          await new Promise((resolve) => setTimeout(resolve, TOKEN_RETRY_MS[attempt]));
        }
      }
    }

    function teardown() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      provider.destroy();
    }

    function settle(next: NoteCollabMode, patch: Partial<NoteCollabState> = {}) {
      mode = next;
      update({ mode: next, ...patch });
    }

    // Provider events arrive asynchronously (after the socket opens), so
    // `provider` and `timer` are set by the time any of these run.
    const provider = providerFactory({
      url: initial.url,
      documentName: initial.documentName,
      doc,
      getToken,
      events: {
        onSynced() {
          if (mode === "connecting") {
            clearTimeout(timer);
            settle("live", { live: { doc, provider, user: initial!.user } });
          } else if (mode === "interrupted") {
            settle("live");
          }
        },
        onAuthenticated(canWrite) {
          update({ canWrite });
        },
        onAuthFailed() {
          if (mode === "connecting") {
            teardown();
            settle("fallback");
          } else if (refused) {
            teardown();
            settle("revoked", { live: null, peers: [] });
          } else if (mode === "live") {
            settle("interrupted");
          }
        },
        onConnection(connection) {
          update({ connection });
        },
        onUnsyncedChanges(unsynced) {
          update({ unsynced });
        },
        onStored() {
          setState((s) => ({ ...s, stored: s.stored + 1 }));
        },
      },
    });

    const timer = setTimeout(() => {
      if (mode !== "connecting") return;
      teardown();
      settle("fallback");
    }, connectTimeoutMs);

    const { awareness } = provider;
    const onAwareness = () => {
      const byUser = new Map<string, CollabPeer>();
      awareness.getStates().forEach((value, clientId) => {
        const user = (value as { user?: CollabUser }).user;
        if (clientId === doc.clientID || !user?.id || user.id === initial!.user.id) return;
        if (!byUser.has(user.id)) byUser.set(user.id, { clientId, user });
      });
      update({
        peers: [...byUser.values()].sort((a, b) => a.user.name.localeCompare(b.user.name)),
      });
    };
    awareness.on("change", onAwareness);

    return () => {
      awareness.off("change", onAwareness);
      teardown();
      doc.destroy();
    };
    // One session per note for the life of the page: a re-render that brings
    // a newer page token must not restart it (later tokens come from
    // issueToken anyway), or the editor would be left on a dead document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.documentName]);

  // Unsaved live edits: warn before the tab closes (they are in this tab only).
  const pending = state.live !== null && state.unsynced > 0;
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  return state;
}
