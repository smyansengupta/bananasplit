import { describe, expect, it } from "vitest";

import { describePath } from "./pages";

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
    expect(describePath("cbc", "/app/cbc/calendar/polls/p_1")?.lookup).toEqual({ type: "poll", id: "p_1" });
    expect(describePath("cbc", "/app/cbc/people/u_1")?.kind).toBe("person");
  });

  it("refuses paths outside the org or the app", () => {
    expect(describePath("cbc", "/app/other/tasks")).toBeNull();
    expect(describePath("cbc", "/app/cbcx/tasks")).toBeNull();
    expect(describePath("cbc", "/onboarding")).toBeNull();
    expect(describePath("cbc", "/app/cbc/unknown")).toBeNull();
    expect(describePath("cbc", "/app/cbc/notes/<script>")).toBeNull();
  });
});
