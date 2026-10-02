import { describe, expect, it } from "vitest";

import { resolveSidebar } from "@/lib/nav/sidebar";
import { parseQuery } from "@/lib/search/text";
import type { SearchResponse } from "@/lib/search/types";

import { buildCatalog, matchCatalog, type CatalogInput, type PaletteSection } from "./catalog";
import { paletteGroups } from "./palette-groups";

function sections(sidebar?: unknown): PaletteSection[] {
  return resolveSidebar(sidebar)
    .flatMap((g) => g.items)
    .map((i) => ({
      id: i.id,
      label: i.label,
      defaultLabel: i.defaultLabel,
      path: i.path,
      hidden: i.hidden,
      icon: i.icon,
      description: i.description,
    }));
}

const hiddenFinance = {
  groups: [],
  items: [{ id: "finance", group: "data", hidden: true, label: null }],
};
const renamedNotes = {
  groups: [],
  items: [{ id: "notes", group: "main", hidden: false, label: "Docs" }],
};

function catalog(overrides: Partial<CatalogInput> = {}) {
  return buildCatalog({
    orgSlug: "cbc",
    role: "MEMBER",
    sections: sections(),
    canPin: true,
    ...overrides,
  });
}

function titles(input: Partial<CatalogInput>, query: string) {
  return matchCatalog(catalog(input), parseQuery(query)).map((h) => h.entry.title);
}

describe("the page catalog", () => {
  it("finds pages by their name and by the words people use for them", () => {
    expect(titles({}, "kanban")[0]).toBe("Task board");
    expect(titles({ role: "ADMIN" }, "dark mode")).toEqual(
      expect.arrayContaining(["Theme", "Use dark theme"]),
    );
    expect(titles({}, "pay me back")).toContain("My reimbursements");
    expect(titles({}, "trash")).toContain("Recently deleted");
  });

  it("only lists the settings and finance pages the role can open", () => {
    expect(titles({ role: "MEMBER" }, "theme")).not.toContain("Theme");
    expect(titles({ role: "ADMIN" }, "theme")).toContain("Theme");
    expect(titles({ role: "MEMBER" }, "notifications")).toContain("Notifications");
    expect(titles({ role: "MEMBER" }, "budget")).not.toContain("Budget");
    expect(titles({ role: "TREASURER" }, "budget")).toContain("Budget");
    expect(titles({ role: "ADMIN" }, "danger")).not.toContain("Danger zone");
    expect(titles({ role: "OWNER" }, "danger")).toContain("Danger zone");
  });

  it("drops a section the org hid for members, not for admins", () => {
    const hidden = sections(hiddenFinance);
    expect(titles({ role: "MEMBER", sections: hidden }, "reimbursements")).toEqual([]);
    expect(titles({ role: "MEMBER", sections: hidden }, "expense")).toEqual([]);
    const admin = matchCatalog(catalog({ role: "ADMIN", sections: hidden }), parseQuery("finance"));
    expect(admin[0].entry.detail).toMatch(/Hidden from members/);
  });

  it("uses the org's own name for a section, and still answers to the usual one", () => {
    const renamed = sections(renamedNotes);
    expect(titles({ sections: renamed }, "docs")[0]).toBe("Docs");
    expect(titles({ sections: renamed }, "notes")).toContain("Docs");
  });

  it("offers theme and org switching only where they apply", () => {
    expect(titles({ themeLocked: true }, "dark")).not.toContain("Use dark theme");
    const orgs = [
      { slug: "cbc", name: "Claude Builders" },
      { slug: "robotics", name: "Robotics Club" },
      { slug: "gone", name: "Gone Club", pendingDeletion: true },
    ];
    expect(titles({ orgs }, "switch")).toEqual(["Switch to Robotics Club"]);
    expect(titles({ canPin: false }, "pin")).not.toContain("Pin something…");
  });
});

describe("paletteGroups", () => {
  const response = (
    query: string,
    scope: SearchResponse["scope"],
    groups: SearchResponse["groups"],
  ): SearchResponse => ({
    query,
    scope,
    groups,
  });
  const hit = (key: string, title: string, score: number) => ({
    key,
    kind: "note" as const,
    title,
    href: `/app/cbc/notes/${key}`,
    score,
  });

  it("opens on recent pages, things to do and the sections", () => {
    const groups = paletteGroups({
      q: parseQuery(""),
      scope: "all",
      catalog: catalog(),
      response: response("", "all", [
        { id: "recent", label: "Recent", hits: [hit("recent:/x", "Minutes", 0)] },
      ]),
    });
    expect(groups.map((g) => g.heading)).toEqual(["Recent", "Actions", "Go to"]);
    expect(groups[1].items.map((i) => i.title)).toContain("New note");
    expect(groups[2].items[0].title).toBe("Overview");
  });

  it("puts the group with the best match first and ends a group with its full-list link", () => {
    const groups = paletteGroups({
      q: parseQuery("budget"),
      scope: "all",
      catalog: catalog(),
      response: response("budget", "all", [
        {
          id: "notes",
          label: "Notes",
          hits: [hit("note:1", "Budget", 200)],
          more: { href: "/app/cbc/notes?q=budget", label: "Search all notes for “budget”" },
        },
      ]),
    });
    expect(groups[0].id).toBe("notes");
    expect(groups[0].items.at(-1)).toMatchObject({
      more: true,
      title: "Search all notes for “budget”",
    });
    // A member doesn't get the treasurer's Budget page; the Finance section mentions budgets.
    const pages = groups.find((g) => g.id === "pages")!.items.map((i) => i.title);
    expect(pages).toContain("Finance");
    expect(pages).not.toContain("Budget");
  });

  it("never mixes recent pages into results, or results from another filter", () => {
    const home = response("", "all", [
      { id: "recent", label: "Recent", hits: [hit("recent:/x", "Minutes", 0)] },
    ]);
    const typed = paletteGroups({
      q: parseQuery("minutes"),
      scope: "all",
      catalog: catalog(),
      response: home,
    });
    expect(typed.find((g) => g.id === "recent")).toBeUndefined();

    const tasks = response("gala", "tasks", [
      { id: "tasks", label: "Tasks", hits: [hit("task:1", "Gala", 30)] },
    ]);
    expect(
      paletteGroups({ q: parseQuery("gala"), scope: "notes", catalog: catalog(), response: tasks }),
    ).toEqual([]);
    // An earlier answer under the same filter stands in while the next loads.
    const stale = paletteGroups({
      q: parseQuery("gala v"),
      scope: "tasks",
      catalog: catalog(),
      response: tasks,
    });
    expect(stale.map((g) => g.id)).toEqual(["tasks"]);
  });

  it("lists every page and action under the Pages filter", () => {
    const groups = paletteGroups({
      q: parseQuery(""),
      scope: "pages",
      catalog: catalog(),
      response: null,
    });
    expect(groups.map((g) => g.id)).toEqual(["actions", "pages"]);
    expect(groups[1].items.length).toBeGreaterThan(20);
  });
});
