import { describe, expect, it } from "vitest";

import {
  goToKey,
  hasModifier,
  isShortcutSheetKey,
  isSidebarToggleKey,
  isTypingTarget,
  shortcutGroups,
  type ShortcutGroup,
} from "./shortcuts";

const key = (init: Partial<KeyboardEvent>) =>
  ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, ...init }) as KeyboardEvent;

const rows = (groups: ShortcutGroup[], title: string) =>
  groups.find((g) => g.title === title)?.rows.map((r) => r.label) ?? [];

describe("keyboard shortcuts", () => {
  it("opens the sheet with ⌘/ or Ctrl / on any platform, not with plain /", () => {
    expect(isShortcutSheetKey(key({ key: "/", metaKey: true }))).toBe(true);
    expect(isShortcutSheetKey(key({ key: "/", ctrlKey: true }))).toBe(true);
    // A layout where / sits elsewhere still reports the physical key.
    expect(isShortcutSheetKey(key({ key: "-", code: "Slash", ctrlKey: true }))).toBe(true);
    expect(isShortcutSheetKey(key({ key: "/" }))).toBe(false);
    expect(isShortcutSheetKey(key({ key: "/", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("leaves Shift out of the modifiers (? is Shift+/)", () => {
    expect(hasModifier(key({ key: "?", shiftKey: true }))).toBe(false);
    expect(hasModifier(key({ key: "c", metaKey: true }))).toBe(true);
  });

  it("ignores keys typed into fields and rich text", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(isTypingTarget({ target: input })).toBe(true);
    expect(isTypingTarget({ target: document.body })).toBe(false);
    // jsdom has no isContentEditable; a stand-in that has it.
    expect(isTypingTarget({ target: { tagName: "DIV", isContentEditable: true } as never })).toBe(
      true,
    );
  });

  it("maps a Personal space's Home to the Overview key", () => {
    expect(goToKey("home")).toBe("o");
    expect(goToKey("tasks")).toBe("t");
    expect(goToKey("org-chart")).toBeUndefined();
  });

  it("lists only the sections the viewer has, and Settings only for admins", () => {
    const sections = [
      { id: "overview", label: "Overview" },
      { id: "tasks", label: "Tasks" },
      { id: "notes", label: "Files" },
    ];
    const member = shortcutGroups({ mod: "Ctrl", sections, isAdmin: false, taskViews: true });
    expect(rows(member, "Go to")).toEqual(["Overview", "Tasks", "Files"]);
    const admin = shortcutGroups({ mod: "⌘", sections, isAdmin: true, taskViews: true });
    expect(rows(admin, "Go to")).toContain("Admin panel");
    expect(admin[0]!.rows[0]!.keys).toEqual([["⌘", "K"]]);
  });

  it("leaves out what the plan doesn't have", () => {
    const sections = [{ id: "tasks", label: "Tasks" }];
    const free = shortcutGroups({ mod: "⌘", sections, isAdmin: true, taskViews: false });
    expect(rows(free, "Tasks page")).not.toContain("Dashboard, Board, List, Table or Epics");
    expect(rows(free, "Tasks page")).not.toContain("Weekly update");
    const club = shortcutGroups({
      mod: "⌘",
      sections,
      isAdmin: true,
      taskViews: true,
      teamwork: true,
    });
    expect(rows(club, "Tasks page")).toEqual(
      expect.arrayContaining([
        "Dashboard, Board, List, Table or Epics",
        "Filter by person",
        "Weekly update",
      ]),
    );
    const noTasks = shortcutGroups({ mod: "⌘", sections: [], isAdmin: false });
    expect(noTasks.map((g) => g.title)).toEqual(["Anywhere", "Go to"]);
  });

  it("numbers exactly the layouts the switcher has, in its order", () => {
    const sections = [{ id: "tasks", label: "Tasks" }];
    const club = shortcutGroups({ mod: "⌘", sections, isAdmin: true, taskViews: true });
    const row = club
      .find((g) => g.title === "Tasks page")!
      .rows.find((r) => r.label === "Dashboard, Board, List, Table or Epics")!;
    expect(row.keys).toEqual([["1"], ["2"], ["3"], ["4"], ["5"]]);
  });

  it("collapses the sidebar with ⌘\\ or Ctrl \\, and lists it under Anywhere", () => {
    expect(isSidebarToggleKey(key({ key: "\\", metaKey: true }))).toBe(true);
    expect(isSidebarToggleKey(key({ key: "\\", ctrlKey: true }))).toBe(true);
    // A layout where \ sits elsewhere still reports the physical key.
    expect(isSidebarToggleKey(key({ key: "#", code: "Backslash", ctrlKey: true }))).toBe(true);
    expect(isSidebarToggleKey(key({ key: "\\" }))).toBe(false);
    expect(isSidebarToggleKey(key({ key: "\\", metaKey: true, altKey: true }))).toBe(false);
    const sheet = shortcutGroups({ mod: "Ctrl", sections: [], isAdmin: false });
    const row = sheet[0]!.rows.find((r) => r.label === "Collapse or expand the sidebar");
    expect(row?.keys).toEqual([["Ctrl", "\\"]]);
  });
});
