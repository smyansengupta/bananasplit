import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Awareness } from "y-protocols/awareness";

import type { NoteCollabSession } from "@/server/collab/session";

import type {
  CollabProviderEvents,
  CollabProviderFactory,
  CollabProviderOptions,
} from "./provider";
import { useNoteCollab } from "./use-note-collab";

vi.mock("@/app/app/[orgSlug]/notes/actions", () => ({ issueNoteCollabToken: vi.fn() }));

/**
 * The session state machine behind the live editor, against a fake
 * provider: when it goes live, when it falls back to the autosave editor,
 * and what happens to a live editor that loses its connection or access.
 */

const session: NoteCollabSession = {
  url: "ws://localhost:1234",
  documentName: "note:org_1:note_1",
  token: "initial-token",
  expiresAt: Date.now() + 5 * 60_000,
  canWrite: true,
  user: { id: "me", name: "Me", slot: 1 },
};

interface Fake {
  options: CollabProviderOptions;
  events: CollabProviderEvents;
  awareness: Awareness;
  destroy: Mock<() => void>;
}

let fakes: Fake[] = [];
const factory: CollabProviderFactory = (options) => {
  const awareness = new Awareness(options.doc);
  const fake: Fake = {
    options,
    events: options.events,
    awareness,
    destroy: vi.fn<() => void>(() => awareness.destroy()),
  };
  fakes.push(fake);
  return { awareness: fake.awareness, destroy: fake.destroy };
};

function start(overrides: Partial<Parameters<typeof useNoteCollab>[0]> = {}) {
  return renderHook(() =>
    useNoteCollab({
      orgId: "org_1",
      noteId: "note_1",
      initial: session,
      providerFactory: factory,
      connectTimeoutMs: 1000,
      ...overrides,
    }),
  );
}

beforeEach(() => {
  fakes = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useNoteCollab", () => {
  it("does nothing while collaboration is off", () => {
    const { result } = start({ initial: null });
    expect(result.current.mode).toBe("off");
    expect(fakes).toHaveLength(0);
  });

  it("goes live on the first sync, with the page's token first", async () => {
    const { result } = start();
    expect(result.current.mode).toBe("connecting");
    expect(await fakes[0].options.getToken()).toBe("initial-token");
    act(() => fakes[0].events.onSynced());
    expect(result.current.mode).toBe("live");
    expect(result.current.live?.doc).toBe(fakes[0].options.doc);
  });

  it("falls back to the autosave editor when the token is refused before the first sync", () => {
    const { result } = start();
    act(() => fakes[0].events.onAuthFailed("permission-denied"));
    expect(result.current.mode).toBe("fallback");
    expect(result.current.live).toBeNull();
    expect(fakes[0].destroy).toHaveBeenCalled();
  });

  it("falls back when the collaboration server does not answer in time", () => {
    const { result } = start();
    act(() => vi.advanceTimersByTime(999));
    expect(result.current.mode).toBe("connecting");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.mode).toBe("fallback");
    expect(fakes[0].destroy).toHaveBeenCalled();
    // A late sync changes nothing: the autosave editor stays.
    act(() => fakes[0].events.onSynced());
    expect(result.current.mode).toBe("fallback");
  });

  it("keeps a live editor through a dropped connection (Yjs merges on reconnect)", () => {
    const { result } = start();
    act(() => fakes[0].events.onSynced());
    act(() => {
      fakes[0].events.onConnection("disconnected");
      fakes[0].events.onUnsyncedChanges(3);
    });
    expect(result.current).toMatchObject({ mode: "live", connection: "disconnected", unsynced: 3 });
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.mode).toBe("live");
  });

  it("removes the editor when the app refuses a new token (the note left this user's view)", async () => {
    const issueToken = vi.fn(async () => ({ error: "Note not found." }));
    const { result } = start({ issueToken });
    await fakes[0].options.getToken(); // the page's token
    act(() => fakes[0].events.onSynced());

    await expect(fakes[0].options.getToken()).rejects.toThrow("Note not found.");
    act(() => fakes[0].events.onAuthFailed("Failed to get token"));
    expect(result.current.mode).toBe("revoked");
    expect(result.current.live).toBeNull();
  });

  it("goes read-only when interrupted for another reason, and back when it syncs again", async () => {
    const { result } = start();
    act(() => fakes[0].events.onSynced());
    act(() => fakes[0].events.onAuthFailed("closed-by-server"));
    expect(result.current.mode).toBe("interrupted");
    expect(result.current.live).not.toBeNull();
    act(() => fakes[0].events.onSynced());
    expect(result.current.mode).toBe("live");
  });

  it("takes write permission from the server and from each fresh token", async () => {
    const issueToken = vi.fn(async () => ({
      session: { ...session, token: "t2", canWrite: false },
    }));
    const { result } = start({ issueToken });
    act(() => fakes[0].events.onAuthenticated(true));
    expect(result.current.canWrite).toBe(true);
    await fakes[0].options.getToken();
    await act(async () => {
      expect(await fakes[0].options.getToken()).toBe("t2");
    });
    expect(result.current.canWrite).toBe(false);
  });

  it("lists the other people in the note once each, never the user themself", () => {
    const { result } = start();
    act(() => fakes[0].events.onSynced());
    const { awareness } = fakes[0];
    act(() => {
      awareness.states.set(101, { user: { id: "u2", name: "Zoe", slot: 2 } });
      awareness.states.set(102, { user: { id: "u2", name: "Zoe", slot: 2 } });
      awareness.states.set(103, { user: { id: "u3", name: "Alex", slot: 3 } });
      awareness.states.set(104, { user: { id: "me", name: "Me", slot: 1 } });
      awareness.emit("change", [{ added: [101, 102, 103, 104], updated: [], removed: [] }, "test"]);
    });
    expect(result.current.peers.map((p) => p.user.name)).toEqual(["Alex", "Zoe"]);
  });

  it("keeps its session when the page re-renders with a newer token", () => {
    const { result, rerender } = renderHook(
      ({ initial }) =>
        useNoteCollab({ orgId: "org_1", noteId: "note_1", initial, providerFactory: factory }),
      { initialProps: { initial: session } },
    );
    act(() => fakes[0].events.onSynced());
    const live = result.current.live;
    rerender({ initial: { ...session, token: "newer-page-token" } });
    expect(fakes).toHaveLength(1);
    expect(result.current.live).toBe(live);
  });

  it("tears the provider down on unmount", () => {
    const { unmount } = start();
    unmount();
    expect(fakes[0].destroy).toHaveBeenCalled();
  });
});
