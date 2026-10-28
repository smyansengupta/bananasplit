import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { chosen, openSelect, stubPointerEvents } from "@/test/select";

/**
 * The note's Share button and dialog: the author adds members as editors or
 * viewers and sets the club's access; anyone else only sees who has access.
 */

const { actions } = vi.hoisted(() => ({
  actions: {
    shareNote: vi.fn(),
    updateNoteAccess: vi.fn(async () => ({ noteId: "note_1" })),
    updateNoteShare: vi.fn(),
    removeNoteShare: vi.fn(),
  },
}));

vi.mock("@/app/app/[orgSlug]/notes/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { ShareNoteDialog } = await import("./share-note-dialog");

/** A themed drop-down says what is picked on its trigger. */
const value = chosen;

const me = { id: "me", name: "Maya Patel", image: null };
const jay = { id: "jay", name: "Jay Chen", image: null };
const sam = { id: "sam", name: "Sam Ruiz", image: null };

function renderDialog(overrides: Partial<Parameters<typeof ShareNoteDialog>[0]["sharing"]> = {}) {
  return render(
    <ShareNoteDialog
      orgId="org_1"
      orgSlug="cbc"
      noteId="note_1"
      title="Budget plan"
      sharing={{
        canShare: true,
        isAuthor: true,
        viewerId: "me",
        myRole: null,
        author: me,
        generalAccess: "RESTRICTED",
        shares: [],
        members: [me, jay, sam],
        ...overrides,
      }}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stubPointerEvents();
  // cmdk measures its list.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
});

describe("ShareNoteDialog", () => {
  it("lets the author add a member as an editor", async () => {
    actions.shareNote.mockResolvedValue({
      shares: [{ userId: "jay", role: "EDITOR", user: { ...jay, avatar: null } }],
    });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /^Share/ }));
    const dialog = screen.getByRole("dialog");
    expect(value(within(dialog).getByRole("combobox", { name: "Their access" }))).toBe("Editor");

    fireEvent.click(within(dialog).getByRole("combobox", { name: "Add people" }));
    // The picker lists everyone but the author.
    expect(screen.queryByRole("option", { name: /Maya Patel/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Jay Chen/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Share" }));
    });

    expect(actions.shareNote).toHaveBeenCalledWith("org_1", "note_1", {
      userIds: ["jay"],
      role: "EDITOR",
    });
    expect(value(within(dialog).getByRole("combobox", { name: "Jay Chen's access" }))).toBe(
      "Editor",
    );
  });

  it("sets what the rest of the organization gets", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^Share/ }));
    openSelect(screen.getByRole("combobox", { name: "Everyone else in the organization" }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("option", { name: "Everyone in the organization can edit" }),
      );
    });
    expect(actions.updateNoteAccess).toHaveBeenCalledWith("org_1", "note_1", "CLUB_EDIT");
  });

  it("shows someone who can't share who has access, and no way to add people", () => {
    renderDialog({
      canShare: false,
      isAuthor: false,
      viewerId: "jay",
      myRole: "VIEWER",
      shares: [{ userId: "jay", role: "VIEWER", user: { ...jay, avatar: null } }],
    });
    fireEvent.click(screen.getByRole("button", { name: /Shared with 1/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("combobox", { name: "Add people" })).toBeNull();
    expect(
      (within(dialog).getByLabelText("Everyone else in the organization") as HTMLSelectElement)
        .disabled,
    ).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Remove me" })).toBeTruthy();
  });
});
