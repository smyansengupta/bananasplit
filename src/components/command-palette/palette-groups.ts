import { Command, FileText, Search, type IconComponent } from "@/components/icons";

import { parseQuery, type ParsedQuery } from "@/lib/search/text";
import type { SearchGroup, SearchResponse, SearchScope } from "@/lib/search/types";

import { matchCatalog, type CatalogEntry, type PaletteCommand } from "./catalog";
import { KIND_ICONS, NAMED_ICONS } from "./palette-icons";

/**
 * What the palette lists, group by group, for what is typed and the filter
 * chosen. Pure: the component hands it the page catalog and the server's
 * latest answer.
 *
 * - Nothing typed, "All": recently visited, a few things to do, and the
 *   sections to go to.
 * - Nothing typed, a filter: the latest of that kind (from the server).
 * - Something typed: matching pages and actions (instant) beside the
 *   server's groups, the group with the best hit first.
 */

export interface PaletteItem {
  key: string;
  title: string;
  detail?: string | null;
  meta?: string | null;
  icon: IconComponent;
  command: PaletteCommand;
  score: number;
  /** Mark the query in it (search results, not the home lists). */
  highlight: boolean;
  /** A "Search all … for" link at the end of a group. */
  more?: boolean;
  /** What it is, as a word ("Form", "Meeting"): the tag on the right in Jump to. */
  kind?: string;
}

export interface PaletteGroup {
  id: string;
  heading: string;
  items: PaletteItem[];
}

const HOME_ACTIONS = [
  "action:new-note",
  "action:new-poll",
  "action:ask",
  "action:expense",
  "action:pin",
];

/** The tag on the right of a Jump to row: what the thing is, in a word. */
export const KIND_WORDS: Record<string, string> = {
  page: "Page",
  action: "Action",
  note: "Note",
  folder: "Folder",
  file: "File",
  task: "Task",
  epic: "Epic",
  label: "Tag",
  event: "Meeting",
  poll: "Poll",
  form: "Form",
  budget: "Budget",
  person: "Person",
  position: "Position",
  database: "Database",
  transaction: "Finance",
  sponsor: "Partner",
};

/** The keys that make a poll or a task from the typed text without leaving the box. */
export const CREATE_KEYS = { "create:poll": "p", "create:task": "t" } as const;

/**
 * What the typed text makes, for the Create group (catalog keys "create:"),
 * as the workspace plan draws it: only New quick poll "…" (Alt P) and
 * New task "…" (Alt T). Meetings, forms, notes and expenses are under New.
 */
export function createGroup(catalog: readonly CatalogEntry[], text: string): PaletteGroup | null {
  const typed = text.trim();
  const order = (key: string) => (key === "create:poll" ? 0 : 1);
  const items = catalog
    .filter((e) => e.key.startsWith("create:"))
    .sort((a, b) => order(a.key) - order(b.key))
    .map((e): PaletteItem => {
      const base = fromEntry(e, 0, false);
      if (e.key === "create:task") {
        return {
          ...base,
          title: `New task "${typed}"`,
          meta: "Alt T",
          command: { type: "create-task", text: typed },
        };
      }
      if (e.key === "create:poll" && e.command.type === "href") {
        return {
          ...base,
          title: `New quick poll "${typed}"`,
          meta: "Alt P",
          command: {
            type: "href",
            href: `${e.command.href}&question=${encodeURIComponent(typed)}`,
          },
        };
      }
      return base;
    });
  return typed && items.length ? { id: "create", heading: "Create", items } : null;
}

function fromEntry(entry: CatalogEntry, score: number, highlight: boolean): PaletteItem {
  return {
    kind: entry.group === "actions" ? "Action" : "Page",
    key: entry.key,
    title: entry.title,
    detail: entry.detail,
    icon: NAMED_ICONS[entry.icon] ?? (entry.group === "actions" ? Command : FileText),
    command: entry.command,
    score,
    highlight,
  };
}

function fromServer(group: SearchGroup, highlight: boolean): PaletteGroup {
  const items: PaletteItem[] = group.hits.map((h) => ({
    kind: KIND_WORDS[h.kind] ?? undefined,
    key: h.key,
    title: h.title,
    detail: h.detail,
    meta: h.meta,
    icon: KIND_ICONS[h.kind] ?? FileText,
    command: { type: "href", href: h.href },
    score: h.score,
    highlight,
  }));
  if (group.more) {
    items.push({
      key: `more:${group.id}`,
      title: group.more.label,
      icon: Search,
      command: { type: "href", href: group.more.href },
      score: Number.NEGATIVE_INFINITY,
      highlight: false,
      more: true,
    });
  }
  return { id: group.id, heading: group.label, items };
}

function best(group: PaletteGroup): number {
  return group.items.reduce(
    (max, item) => (item.more ? max : Math.max(max, item.score)),
    Number.NEGATIVE_INFINITY,
  );
}

export function paletteGroups({
  q,
  scope,
  catalog,
  response,
}: {
  q: ParsedQuery;
  scope: SearchScope;
  catalog: readonly CatalogEntry[];
  /** The server's latest answer for this filter (maybe for an earlier query). */
  response: SearchResponse | null;
}): PaletteGroup[] {
  // An earlier answer stands in while the next loads, but only one of the
  // same kind: never recent pages among search results, or the reverse.
  const typed = q.folded.length > 0;
  const usable =
    response && response.scope === scope && parseQuery(response.query).folded.length > 0 === typed;
  const server = usable ? response.groups : [];
  const withClient = scope === "all" || scope === "pages";

  if (!typed) {
    if (scope === "all") {
      const groups: PaletteGroup[] = server.map((g) => fromServer(g, false));
      const actions = HOME_ACTIONS.flatMap((key) => catalog.filter((e) => e.key === key));
      if (actions.length) {
        groups.push({
          id: "actions",
          heading: "Actions",
          items: actions.map((e) => fromEntry(e, 0, false)),
        });
      }
      const sections = catalog.filter((e) => e.key.startsWith("page:section:"));
      if (sections.length) {
        groups.push({
          id: "pages",
          heading: "Go to",
          items: sections.map((e) => fromEntry(e, 0, false)),
        });
      }
      return groups;
    }
    if (scope === "pages") {
      return [
        {
          id: "actions",
          heading: "Actions",
          items: catalog.filter((e) => e.group === "actions").map((e) => fromEntry(e, 0, false)),
        },
        {
          id: "pages",
          heading: "Pages",
          items: catalog.filter((e) => e.group === "pages").map((e) => fromEntry(e, 0, false)),
        },
      ].filter((g) => g.items.length);
    }
    return server.map((g) => fromServer(g, false));
  }

  const groups: PaletteGroup[] = [];
  if (withClient) {
    const hits = matchCatalog(catalog, q);
    const pages = hits.filter((h) => h.entry.group === "pages").slice(0, scope === "all" ? 6 : 50);
    const actions = hits
      .filter((h) => h.entry.group === "actions")
      .slice(0, scope === "all" ? 4 : 50);
    if (pages.length) {
      groups.push({
        id: "pages",
        heading: "Pages",
        items: pages.map((h) => fromEntry(h.entry, h.score, true)),
      });
    }
    if (actions.length) {
      groups.push({
        id: "actions",
        heading: "Actions",
        items: actions.map((h) => fromEntry(h.entry, h.score, true)),
      });
    }
  }
  for (const g of server) groups.push(fromServer(g, true));

  // Everything: one Jump to list, best match first, each with what it is as
  // a tag on the right (the workspace plan's palette). A filter keeps its
  // groups, since there every row is the same kind.
  const sorted =
    scope === "all"
      ? jumpTo(groups)
      : groups
          .map((group, i) => ({ group, i, best: best(group) }))
          .sort((a, b) => b.best - a.best || a.i - b.i)
          .map(({ group }) => group);
  // Then Create: make something from what was typed (a task titled with it,
  // a quick poll asking it), or start a meeting, form, note or expense.
  const create = withClient ? createGroup(catalog, q.text) : null;
  return create ? [...sorted, create] : sorted;
}

/** Every hit as one "Jump to" list, best first, with its kind as the tag. */
function jumpTo(groups: readonly PaletteGroup[]): PaletteGroup[] {
  const items = groups
    .flatMap((g) => g.items.filter((i) => !i.more))
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map((i) => ({
      ...i,
      detail: [i.detail, i.meta].filter(Boolean).join(", ") || null,
      meta: i.kind ?? null,
    }));
  return items.length ? [{ id: "jump", heading: "Jump to", items }] : [];
}
