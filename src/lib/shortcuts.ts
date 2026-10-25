import type { SectionId } from "@/lib/nav/sidebar";

/**
 * The keyboard shortcuts, in one place. The handlers read their keys from
 * here and the shortcut sheet (⌘/ or Ctrl /, or ?, in
 * src/components/shell/keyboard-shortcuts.tsx) lists them from here, so the
 * sheet can't drift from what the keys do.
 *
 * Single keys never fire while you type in a field, a note or a comment,
 * and never while a menu or dialog is open. Pure and client-safe.
 */

/** `g` then one of these opens that section (when the club shows it). */
export const GO_TO_KEYS: Record<SectionId, string> = {
  overview: "o",
  tasks: "t",
  calendar: "c",
  "find-a-time": "a",
  meetings: "r",
  notes: "f",
  people: "p",
  polls: "v",
  databases: "d",
  finance: "m",
};

/** The key after `g` for a sidebar link (a Personal space's Home is the Overview). */
export function goToKey(id: string): string | undefined {
  if (id === "home") return GO_TO_KEYS.overview;
  return (GO_TO_KEYS as Record<string, string | undefined>)[id];
}

/** `g s`: Settings, for the owners and admins who can open it. */
export const GO_TO_SETTINGS_KEY = "s";

/** How long after `g` the second key still counts. */
export const SEQUENCE_TIMEOUT_MS = 1500;

/** The task workspace's single keys (the page's handlers read these). */
export const TASK_KEYS = {
  newTask: "c",
  person: "p",
  clearFilters: "x",
  updates: "u",
} as const;

/** Whose work: the scope chips' keys. */
export const SCOPE_KEYS: Partial<Record<"mine" | "team" | "all", string>> = {
  mine: "m",
  team: "t",
  all: "e",
};

/** `c` anywhere else opens Tasks with a new task started (?new=1). */
export const NEW_TASK_PARAM = "new";

/** Asks the shell to open the shortcut sheet (the ⌘K palette's entry fires it). */
export const OPEN_SHORTCUTS_EVENT = "bananasplit:shortcuts";

/** The event came from somewhere you type: a field, a select, rich text. */
export function isTypingTarget(event: Pick<KeyboardEvent, "target">): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
  return target.isContentEditable === true;
}

/** ⌘, Ctrl or Alt is held (Shift alone is part of the key, as in ?). */
export function hasModifier(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey">) {
  return event.metaKey || event.ctrlKey || event.altKey;
}

/** ⌘/ or Ctrl / on any platform (Ctrl works on a Mac too). */
export function isShortcutSheetKey(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  return event.key === "/" || event.code === "Slash";
}

/**
 * ⌘\ or Ctrl \ on any platform (Ctrl works on a Mac too): collapse the
 * sidebar to its rail, or dock it again. Works in fields too, like ⌘/.
 */
export function isSidebarToggleKey(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  return event.key === "\\" || event.code === "Backslash";
}

/** A menu, popover or dialog is open: single keys belong to it. */
export function overlayOpen(): boolean {
  return (
    document.querySelector("[role=dialog][data-state=open], [role=menu][data-state=open]") !== null
  );
}

export interface ShortcutRow {
  /** Each entry is one way to press it; inside, keys pressed together. */
  keys: readonly (readonly string[])[];
  /** Pressed one after another (g then t), not together. */
  sequence?: boolean;
  label: string;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

export interface ShortcutSheetInput {
  /** "⌘" or "Ctrl". */
  mod: string;
  /** The sidebar's links the viewer can open (section ids), with the club's names. */
  sections: readonly { id: string; label: string }[];
  /** Owners and admins: the Admin panel. */
  isAdmin: boolean;
  /** Board, Week, List, Table, Roadmap and Dashboard (not on the Free plan, which has a plain list). */
  taskViews?: boolean;
  /** The weekly update (not in a Personal space). */
  teamwork?: boolean;
}

/** The shortcut sheet's rows, for this viewer. */
export function shortcutGroups(input: ShortcutSheetInput): ShortcutGroup[] {
  const { mod } = input;
  const has = (id: SectionId) => input.sections.some((s) => goToKey(s.id) === GO_TO_KEYS[id]);
  const upper = (key: string) => key.toUpperCase();

  const anywhere: ShortcutRow[] = [
    { keys: [[mod, "K"]], label: "Search everything" },
    { keys: [[mod, "/"], ["?"]], label: "Show keyboard shortcuts" },
    { keys: [[mod, "\\"]], label: "Collapse or expand the sidebar" },
  ];
  if (has("tasks")) anywhere.push({ keys: [[upper(TASK_KEYS.newTask)]], label: "New task" });

  const goTo: ShortcutRow[] = input.sections.flatMap((s) => {
    const key = goToKey(s.id);
    return key ? [{ keys: [["G", upper(key)]], sequence: true, label: s.label }] : [];
  });
  if (input.isAdmin) {
    goTo.push({ keys: [["G", upper(GO_TO_SETTINGS_KEY)]], sequence: true, label: "Admin panel" });
  }

  const groups: ShortcutGroup[] = [
    { title: "Anywhere", rows: anywhere },
    { title: "Go to", rows: goTo },
  ];

  if (has("tasks")) {
    const tasks: ShortcutRow[] = [];
    if (input.taskViews) {
      tasks.push({
        keys: [["1"], ["2"], ["3"], ["4"], ["5"], ["6"]],
        label: "Board, Week, List, Table, Roadmap or Dashboard",
      });
    }
    tasks.push(
      { keys: [["/"]], label: "Search tasks" },
      { keys: [[upper(TASK_KEYS.person)]], label: "Filter by person" },
      { keys: [[upper(SCOPE_KEYS.mine!)]], label: "Just my tasks" },
      { keys: [[upper(SCOPE_KEYS.team!)]], label: "My team's tasks (if you lead one)" },
      { keys: [[upper(SCOPE_KEYS.all!)]], label: "Everyone's tasks" },
      { keys: [[upper(TASK_KEYS.clearFilters)]], label: "Clear filters" },
    );
    if (input.taskViews && input.teamwork) {
      tasks.push({ keys: [[upper(TASK_KEYS.updates)]], label: "Weekly update" });
    }
    groups.push(
      { title: "Tasks page", rows: tasks },
      {
        title: "In a task",
        rows: [
          { keys: [[mod, "Enter"]], label: "Save" },
          { keys: [["Esc"]], label: "Close" },
          {
            keys: [["T"], ["M"], ["F"], ["W"]],
            label: "Due: today, tomorrow, Friday, next week (in the date menu)",
          },
        ],
      },
      {
        title: "Picking people",
        rows: [
          { keys: [["↑"], ["↓"]], label: "Move through the matches" },
          {
            keys: [["Enter"]],
            label: "Add the highlighted person (type the next name right after)",
          },
          { keys: [["Backspace"]], label: "Remove the last person (with the box empty)" },
          { keys: [["Esc"]], label: "Done" },
        ],
      },
    );
  }
  return groups;
}
