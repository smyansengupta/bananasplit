import { describe, expect, it } from "vitest";

import {
  arrangeSections,
  EMPTY_MY_SIDEBAR,
  mySidebarCookieName,
  parseMySidebar,
  reorderGroup,
  serializeMySidebarCookie,
  toggleHidden,
} from "./my-sidebar";

const SECTIONS = [
  { id: "main", items: [{ id: "overview" }, { id: "inbox" }, { id: "people" }] },
  { id: "plan", items: [{ id: "tasks" }, { id: "calendar" }, { id: "meetings" }] },
  { id: "money", items: [{ id: "finance" }] },
];
const ids = (s: typeof SECTIONS) => s.map((g) => g.items.map((i) => i.id));

describe("my sidebar", () => {
  it("reads back what it writes", () => {
    const my = { order: ["calendar", "tasks"], hidden: ["finance"] };
    const cookie = serializeMySidebarCookie("n", my, false);
    const value = cookie.split(";")[0]!.slice(2);
    expect(parseMySidebar(value)).toEqual(my);
  });

  it("treats junk and a hidden Home as the organization's own", () => {
    expect(parseMySidebar("%E0%A4%A")).toEqual(EMPTY_MY_SIDEBAR);
    expect(parseMySidebar(undefined)).toEqual(EMPTY_MY_SIDEBAR);
    expect(parseMySidebar("~overview.inbox.<script>")).toEqual({ order: [], hidden: ["inbox"] });
  });

  it("clears the cookie when nothing is changed", () => {
    expect(serializeMySidebarCookie("n", EMPTY_MY_SIDEBAR, true)).toContain("Max-Age=0");
  });

  it("orders inside each group and drops hidden rows and empty groups", () => {
    const my = { order: ["meetings", "tasks"], hidden: ["finance", "overview"] };
    expect(ids(arrangeSections(SECTIONS, my))).toEqual([
      ["overview", "inbox", "people"],
      ["meetings", "tasks", "calendar"],
    ]);
    expect(arrangeSections(SECTIONS, my, { keepHidden: true })).toHaveLength(3);
  });

  it("reorders one group and keeps the others", () => {
    const my = reorderGroup(EMPTY_MY_SIDEBAR, SECTIONS, ["calendar", "tasks", "meetings"]);
    expect(ids(arrangeSections(SECTIONS, my))).toEqual([
      ["overview", "inbox", "people"],
      ["calendar", "tasks", "meetings"],
      ["finance"],
    ]);
  });

  it("hides and shows a row, never Home", () => {
    const hidden = toggleHidden(EMPTY_MY_SIDEBAR, "people");
    expect(hidden.hidden).toEqual(["people"]);
    expect(toggleHidden(hidden, "people").hidden).toEqual([]);
    expect(toggleHidden(EMPTY_MY_SIDEBAR, "overview")).toBe(EMPTY_MY_SIDEBAR);
  });

  it("names a cookie per member and organization", () => {
    expect(mySidebarCookieName("u1", "o1")).not.toBe(mySidebarCookieName("u1", "o2"));
  });
});
