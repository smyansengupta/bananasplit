import { describe, expect, it } from "vitest";

import { canonicalHref, describePath } from "./pages";

describe("describePath", () => {
  it("names fixed pages and sub-pages", () => {
    expect(describePath("cbc", "/app/cbc/tasks")).toMatchObject({ kind: "page", label: "Tasks" });
    expect(describePath("cbc", "/app/cbc/finance/budget")).toMatchObject({ label: "Budget" });
    expect(describePath("cbc", "/app/cbc/settings/members")).toMatchObject({ label: "Settings · Members" });
    expect(describePath("cbc", "/app/cbc/")).toMatchObject({ label: "Overview", skipRecent: true });
  });

  it("asks the server for the names of records", () => {
    expect(describePath("cbc", "/app/cbc/notes/n_1?x=1")).toEqual({
      href: "/app/cbc/notes/n_1",
      kind: "note",
      label: "Note",
      lookup: { type: "note", id: "n_1" },
    });
    expect(describePath("cbc", "/app/cbc/databases/sessions")?.lookup).toEqual({
      type: "database",
      key: "sessions",
    });
    // Either kind of poll: the server looks the id up in both tables.
    expect(describePath("cbc", "/app/cbc/calendar/polls/p_1")).toMatchObject({
      kind: "event",
      lookup: { type: "poll", id: "p_1" },
    });
    // The forms that start one are pages, not polls.
    expect(describePath("cbc", "/app/cbc/calendar/polls/ask")).toEqual({
      href: "/app/cbc/calendar/polls/ask",
      kind: "page",
      label: "Ask a question",
    });
    expect(describePath("cbc", "/app/cbc/calendar/polls/new")?.lookup).toBeUndefined();
    expect(describePath("cbc", "/app/cbc/people/u_1")?.kind).toBe("person");
  });

  it("keeps the views that live in the query string, so they can be pinned", () => {
    expect(describePath("cbc", "/app/cbc/notes?folder=f_1&tab=files&junk=1")).toEqual({
      href: "/app/cbc/notes?folder=f_1&tab=files",
      kind: "folder",
      label: "Folder",
      lookup: { type: "folder", id: "f_1" },
      suffix: " · Files",
    });
    expect(describePath("cbc", "/app/cbc/notes?tab=files")).toMatchObject({ label: "Notes · Files" });
    expect(describePath("cbc", "/app/cbc/tasks?scope=mine&view=board")).toMatchObject({
      href: "/app/cbc/tasks?view=board&scope=mine",
      label: "Tasks · Board · Mine",
    });
    // The old "mine" view is the Week, scoped to you.
    expect(canonicalHref("cbc", "/app/cbc/tasks?view=mine")).toBe("/app/cbc/tasks?view=week&scope=mine");
    // Anything else in a query is dropped, so one view has one address.
    expect(canonicalHref("cbc", "/app/cbc/finance?period=x")).toBe("/app/cbc/finance");
    expect(canonicalHref("cbc", "/app/cbc/tasks?view=nonsense")).toBe("/app/cbc/tasks");
    expect(canonicalHref("cbc", "/app/cbc/notes?folder=<b>")).toBe("/app/cbc/notes");
  });

  it("refuses paths outside the org or the app", () => {
    expect(describePath("cbc", "/app/other/tasks")).toBeNull();
    expect(describePath("cbc", "/app/cbcx/tasks")).toBeNull();
    expect(describePath("cbc", "/onboarding")).toBeNull();
    expect(describePath("cbc", "/app/cbc/unknown")).toBeNull();
    expect(describePath("cbc", "/app/cbc/notes/<script>")).toBeNull();
  });
});
