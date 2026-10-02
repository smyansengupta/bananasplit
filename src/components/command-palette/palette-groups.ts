import { FileText, Search, Sparkles, type LucideIcon } from "lucide-react";

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
  icon: LucideIcon;
  command: PaletteCommand;
  score: number;
  /** Mark the query in it (search results, not the home lists). */
  highlight: boolean;
  /** A "Search all … for" link at the end of a group. */
  more?: boolean;
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

function fromEntry(entry: CatalogEntry, score: number, highlight: boolean): PaletteItem {
  return {
    key: entry.key,
    title: entry.title,
    detail: entry.detail,
    icon: NAMED_ICONS[entry.icon] ?? (entry.group === "actions" ? Sparkles : FileText),
    command: entry.command,
    score,
    highlight,
  };
}

function fromServer(group: SearchGroup, highlight: boolean): PaletteGroup {
  const items: PaletteItem[] = group.hits.map((h) => ({
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

  // The group holding the best match leads; ties keep their usual order.
  return groups
    .map((group, i) => ({ group, i, best: best(group) }))
    .sort((a, b) => b.best - a.best || a.i - b.i)
    .map(({ group }) => group);
}
