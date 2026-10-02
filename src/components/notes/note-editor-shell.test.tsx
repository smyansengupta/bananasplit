import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";

import type { NoteCollabSession } from "@/server/collab/session";

import type { CollabProviderEvents, CollabProviderOptions } from "./collab/provider";

/**
 * The note page's editor with and without live collaboration. With it off,
 * or when joining fails, the editor must behave exactly as before: the
 * autosave path saves the whole note through updateNote. Only a joined
 * session switches the title and settings to updateNoteDetails.
 */

const { actions, providers } = vi.hoisted(() => ({
  actions: {
    updateNote: vi.fn(async () => ({ noteId: "note_1", version: 2 })),
    updateNoteDetails: vi.fn(async () => ({ noteId: "note_1" })),
    deleteNote: vi.fn(async () => ({})),
    issueNoteCollabToken: vi.fn(),
  },
  providers: [] as {
    events: CollabProviderEvents;
    awareness: Awareness;
    getToken: () => Promise<string>;
  }[],
}));

vi.mock("@/app/app/[orgSlug]/notes/actions", () => actions);
// The AI import dialog (and the task and event actions behind it) isn't under test here.
vi.mock("@/components/ai/action-items-import", () => ({ ActionItemsImport: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/notes/collab/provider", () => ({
  createHocuspocusProvider: ({ doc, events, getToken }: CollabProviderOptions) => {
    const awareness = new Awareness(doc);
    providers.push({ events, awareness, getToken });
    return { awareness, destroy: () => awareness.destroy() };
  },
}));

const { NoteEditorShell } = await import("./note-editor-shell");

const note = {
  id: "note_1",
  title: "Minutes",
  contentJson: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
  },
  contentText: "Hi",
  visibility: "ORGANIZATION" as const,
  eventId: null,
  version: 1,
};

const collab: NoteCollabSession = {
  url: "ws://localhost:1234",
  documentName: "note:org_1:note_1",
  token: "t",
  expiresAt: Date.now() + 5 * 60_000,
  canWrite: true,
  user: { id: "me", name: "Me", slot: 1 },
};

function renderShell(session: NoteCollabSession | null) {
  return render(
    <NoteEditorShell
      orgId="org_1"
      orgSlug="cbc"
      canEdit
      events={[]}
      note={note}
      collab={session}
    />,
  );
}

const title = () => screen.getByPlaceholderText("Untitled note") as HTMLInputElement;

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  providers.length = 0;
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("NoteEditorShell", () => {
  it("with collaboration off, autosaves the whole note as before", async () => {
    renderShell(null);
    await flush();
    expect(providers).toHaveLength(0);
    expect(title().disabled).toBe(false);

    fireEvent.change(title(), { target: { value: "Minutes v2" } });
    await flush(800);
    expect(actions.updateNote).toHaveBeenCalledWith(
      "org_1",
      "note_1",
      expect.objectContaining({ title: "Minutes v2", contentText: "Hi" }),
      1,
    );
    expect(actions.updateNoteDetails).not.toHaveBeenCalled();
  });

  it("while joining, shows the note read-only; if joining fails, autosaves as before", async () => {
    const { container } = renderShell(collab);
    await flush();
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(title().disabled).toBe(true);

    act(() => providers[0].events.onAuthFailed("permission-denied"));
    await flush();
    expect(title().disabled).toBe(false);
    expect(container.querySelector(".tiptap")?.getAttribute("contenteditable")).toBe("true");

    fireEvent.change(title(), { target: { value: "Minutes v2" } });
    await flush(800);
    expect(actions.updateNote).toHaveBeenCalledTimes(1);
    expect(actions.updateNoteDetails).not.toHaveBeenCalled();
  });

  it("falls back the same way when the collaboration server never answers", async () => {
    renderShell(collab);
    await flush(6000);
    expect(title().disabled).toBe(false);
    fireEvent.change(title(), { target: { value: "Offline edit" } });
    await flush(800);
    expect(actions.updateNote).toHaveBeenCalledTimes(1);
  });

  it("once live, saves only the changed details; the body is the server's job", async () => {
    renderShell(collab);
    await flush();
    act(() => {
      providers[0].events.onAuthenticated(true);
      providers[0].events.onConnection("connected");
      providers[0].events.onSynced();
    });
    await flush();
    expect(screen.getByText("Live")).toBeTruthy();

    fireEvent.change(title(), { target: { value: "Minutes (final)" } });
    await flush(800);
    expect(actions.updateNoteDetails).toHaveBeenCalledWith("org_1", "note_1", {
      title: "Minutes (final)",
    });
    expect(actions.updateNote).not.toHaveBeenCalled();

    act(() => providers[0].events.onStored());
    await flush();
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("removes the note when the app refuses a fresh token mid-session", async () => {
    renderShell(collab);
    await flush();
    act(() => providers[0].events.onSynced());
    await flush();
    await providers[0].getToken(); // the page's token

    // The note turned PRIVATE: the next token is refused.
    actions.issueNoteCollabToken.mockResolvedValue({ error: "Note not found." });
    await expect(providers[0].getToken()).rejects.toThrow();
    act(() => providers[0].events.onAuthFailed("Failed to get token"));
    await flush();
    expect(screen.getByText("This note is no longer available to you.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Untitled note")).toBeNull();
  });
});
