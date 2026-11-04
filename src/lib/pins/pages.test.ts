import { describe, expect, it } from "vitest";

import { canonicalHref, describePath } from "./pages";

describe("describePath", () => {
  it("names fixed pages and sub-pages", () => {
    expect(describePath("cbc", "/app/cbc/tasks")).toMatchObject({ kind: "page", label: "Tasks" });
    expect(describePath("cbc", "/app/cbc/finance/budget")).toMatchObject({ label: "Budget" });
    expect(describePath("cbc", "/app/cbc/settings/members")).toMatchObject({
      label: "Admin panel, Members",
    });
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
      label: "Quick poll",
    });
    expect(describePath("cbc", "/app/cbc/calendar/polls/new")?.lookup).toBeUndefined();
    // Find a time is a section of its own; its polls are polls all the same.
    expect(describePath("cbc", "/app/cbc/calendar/find-a-time")).toEqual({
      href: "/app/cbc/calendar/find-a-time",
      kind: "page",
      label: "Find a time",
    });
    // Making one reads as the page it is, not "New find-a-time poll".
    expect(describePath("cbc", "/app/cbc/calendar/find-a-time/new")).toMatchObject({
      kind: "page",
      label: "Find a time",
    });
    expect(describePath("cbc", "/app/cbc/calendar/find-a-time/new")?.lookup).toBeUndefined();
    expect(describePath("cbc", "/app/cbc/calendar/find-a-time/p_1")).toMatchObject({
      kind: "event",
      lookup: { type: "poll", id: "p_1" },
    });
    // A form shows its own title, looked up like a note's.
    expect(describePath("cbc", "/app/cbc/forms/f_1")).toEqual({
      href: "/app/cbc/forms/f_1",
      kind: "form",
      label: "Form",
      lookup: { type: "form", id: "f_1" },
    });
    expect(describePath("cbc", "/app/cbc/forms/new")).toMatchObject({
      kind: "page",
      label: "New form",
    });
    expect(describePath("cbc", "/app/cbc/meetings")?.label).toBe("Meetings");
    expect(describePath("cbc", "/app/cbc/people/u_1")?.kind).toBe("person");
  });

  it("pins a meeting, and its sign-up screen, under Meetings", () => {
    // The meeting's own page: the event's title, looked up like a Calendar event's.
    expect(describePath("cbc", "/app/cbc/meetings/e_1?edit=1")).toEqual({
      href: "/app/cbc/meetings/e_1",
      kind: "event",
      label: "Meeting",
      lookup: { type: "event", id: "e_1" },
    });
    // Its sign-up screen keeps the label and suffix it always had.
    expect(describePath("cbc", "/app/cbc/meetings/e_1/rsvp?new=1")).toEqual({
      href: "/app/cbc/meetings/e_1/rsvp",
      kind: "event",
      label: "RSVP page",
      lookup: { type: "event", id: "e_1" },
      suffix: ", RSVPs",
    });
    // Door mode is named by its section and last segment, as it was under the Calendar.
    expect(describePath("cbc", "/app/cbc/meetings/e_1/rsvp/door")).toMatchObject({
      kind: "page",
      label: "Meetings, Door",
    });
    // Neither is a bare section: the list itself is still just "Meetings".
    expect(describePath("cbc", "/app/cbc/meetings")).toEqual({
      href: "/app/cbc/meetings",
      kind: "page",
      label: "Meetings",
    });
    // A pin saved before the move still describes itself.
    expect(describePath("cbc", "/app/cbc/calendar/e_1/rsvp")).toEqual({
      href: "/app/cbc/calendar/e_1/rsvp",
      kind: "event",
      label: "RSVP page",
      lookup: { type: "event", id: "e_1" },
      suffix: ", RSVPs",
    });
    expect(describePath("cbc", "/app/cbc/calendar/e_1")).toMatchObject({
      kind: "event",
      label: "Event",
      lookup: { type: "event", id: "e_1" },
    });
  });

  it("keeps the views that live in the query string, so they can be pinned", () => {
    expect(describePath("cbc", "/app/cbc/notes?folder=f_1&tab=files&junk=1")).toEqual({
      href: "/app/cbc/notes?folder=f_1&tab=files",
      kind: "folder",
      label: "Folder",
      lookup: { type: "folder", id: "f_1" },
      suffix: ", Uploads",
    });
    expect(describePath("cbc", "/app/cbc/notes?tab=files")).toMatchObject({
      label: "Files, Uploads",
    });
    expect(describePath("cbc", "/app/cbc/tasks?scope=mine&view=board")).toMatchObject({
      href: "/app/cbc/tasks?view=board&scope=mine",
      label: "Tasks, Board, Mine",
    });
    // The old "mine" view is the Week, scoped to you.
    expect(canonicalHref("cbc", "/app/cbc/tasks?view=mine")).toBe(
      "/app/cbc/tasks?view=week&scope=mine",
    );
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

describe("the CRM's pages", () => {
  it("names Today and its groups, People's views and lists, and settings", () => {
    expect(describePath("cbc", "/app/cbc/crm")).toMatchObject({ kind: "page", label: "CRM" });
    expect(describePath("cbc", "/app/cbc/crm?show=approve&open=power")).toMatchObject({
      href: "/app/cbc/crm?show=approve",
      label: "CRM, To approve",
    });
    expect(describePath("cbc", "/app/cbc/crm/people")).toMatchObject({ label: "CRM people" });
    expect(describePath("cbc", "/app/cbc/crm/people?view=companies&open=company:x")).toMatchObject({
      href: "/app/cbc/crm/people?view=companies",
      label: "CRM companies",
    });
    expect(describePath("cbc", "/app/cbc/crm/people?list=due")).toMatchObject({
      label: "CRM people, Follow-ups due",
    });
    expect(describePath("cbc", "/app/cbc/crm/people?list=cmabc123")).toMatchObject({
      href: "/app/cbc/crm/people?list=cmabc123",
      label: "CRM people, A saved list",
    });
    expect(describePath("cbc", "/app/cbc/crm/people?view=board")).toMatchObject({ label: "CRM deals" });
    // Old pages that only redirect now (deals, calls, forecast, handover) aren't pages to pin.
    expect(describePath("cbc", "/app/cbc/crm/deals")).toBeNull();
    expect(describePath("cbc", "/app/cbc/crm/settings/automations")).toMatchObject({
      label: "CRM settings, Automations",
    });
    // A record's old page redirects to its card: nothing to pin or list.
    expect(describePath("cbc", "/app/cbc/crm/people/abc123")).toBeNull();
  });
});
