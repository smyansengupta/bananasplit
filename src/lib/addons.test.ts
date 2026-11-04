import { describe, expect, it } from "vitest";

import { buildCatalog } from "@/components/command-palette/catalog";
import { ADD_ON_INFO, ADD_ONS, isAddOn, readAddOns } from "@/lib/addons";
import { resolveSidebar, visibleSidebar } from "@/lib/nav/sidebar";
import { overviewWidgetsFor, resolveOverview } from "@/lib/overview/widgets";
import { notAddedSections } from "@/server/search/viewer";

describe("add-ons", () => {
  it("reads a stored list in a fixed order, dropping anything unknown", () => {
    expect(readAddOns(["finance", "crm", "forms", "forms"])).toEqual(["forms", "finance"]);
    expect(readAddOns(null)).toEqual([]);
    expect(isAddOn("forms")).toBe(true);
    expect(isAddOn("notes")).toBe(false);
  });

  it("names the plan feature behind each one", () => {
    expect(ADD_ONS.map((id) => ADD_ON_INFO[id].feature)).toEqual(["polls", "finance"]);
  });

  it("keeps an add-on that isn't added out of the sidebar, marked so its page can say so", () => {
    const items = (addOns: string[]) =>
      visibleSidebar(null, addOns)
        .flatMap((g) => g.items)
        .map((i) => i.id);
    expect(items([])).not.toContain("forms");
    expect(items([])).not.toContain("finance");
    expect(items(["forms"])).toContain("forms");
    const finance = resolveSidebar(null, ["forms"])
      .flatMap((g) => g.items)
      .find((i) => i.id === "finance")!;
    expect(finance).toMatchObject({ hidden: true, notAdded: true });
  });

  it("hides an add-on that isn't added from the palette, owners and admins included", () => {
    const sections = resolveSidebar(null, [])
      .flatMap((g) => g.items)
      .map((i) => ({ ...i }));
    const titles = buildCatalog({ orgSlug: "o", role: "OWNER", sections }).map((e) => e.title);
    expect(titles).not.toContain("Forms");
    expect(titles).not.toContain("Finance");
    expect(titles).toContain("Tasks");
  });

  it("offers the Open forms widget on Home only with Forms added", () => {
    const types = (addOns?: string[]) => overviewWidgetsFor(true, addOns).map((w) => w.type);
    expect(types([])).not.toContain("polls");
    expect(types(["forms"])).toContain("polls");
    // Left out (a caller that doesn't know), everything counts as added.
    expect(types()).toContain("polls");
    expect(resolveOverview(null, true, []).map((w) => w.type)).not.toContain("polls");
  });

  it("lists the sections search and the AI connectors leave out for everyone", () => {
    expect([...notAddedSections([])].sort()).toEqual(["finance", "forms"]);
    expect([...notAddedSections(["forms", "finance"])]).toEqual([]);
  });
});
