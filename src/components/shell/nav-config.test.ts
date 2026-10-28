import { describe, expect, it } from "vitest";

import { settingsNavItems, isSettingsItemActive } from "@/app/app/[orgSlug]/settings/settings-nav";

import { resolveSidebar, sectionLabel, toConfig, visibleSidebar } from "@/lib/nav/sidebar";

import { createActions, isExactPage, isLinkActive, navSections } from "./nav-config";

const links = (raw: unknown = null) =>
  navSections("cbc", visibleSidebar(raw)).flatMap((s) => s.items);
const item = (label: string, all = links()) => all.find((i) => i.label === label)!;
const active = (label: string, path: string) => isLinkActive(item(label), path, links());

describe("sidebar navigation", () => {
  it("lists every section in order by default, grouped", () => {
    expect(links().map((i) => i.label)).toEqual([
      "Overview",
      "Tasks",
      "Calendar",
      "People",
      "Polls",
      "Find a time",
      "RSVPs",
      "Files",
      "Databases",
      "Finance",
    ]);
    expect(navSections("cbc", visibleSidebar(null)).map((s) => s.label)).toEqual([
      null,
      "Organization",
      "Data",
    ]);
    expect(item("Files").href).toBe("/app/cbc/notes");
  });

  it("keeps People active on the org chart, which is part of it now", () => {
    expect(active("People", "/app/cbc/org-chart")).toBe(true);
    expect(active("People", "/app/cbc/org-chart/versions/v1")).toBe(true);
    expect(active("People", "/app/cbc/people/u1")).toBe(true);
    expect(active("Polls", "/app/cbc/org-chart")).toBe(false);
  });

  it("reads saved sidebars that still list the retired Org Chart section", () => {
    const saved = {
      groups: [{ id: "club", label: "Club" }],
      items: [
        { id: "people", group: "club", hidden: false, label: "Members" },
        { id: "org-chart", group: "club", hidden: true, label: null },
      ],
    };
    const labels = links(saved).map((i) => i.label);
    expect(labels).toContain("Members");
    expect(labels).not.toContain("Org Chart");
  });

  it("marks a section active on its sub-pages (prefix match), Overview only on itself", () => {
    expect(active("Tasks", "/app/cbc/tasks/abc")).toBe(true);
    expect(active("Overview", "/app/cbc")).toBe(true);
    expect(active("Overview", "/app/cbc/tasks")).toBe(false);
    expect(active("Files", "/app/cbc/notesy")).toBe(false);
  });

  it("marks only the most specific section active when sections nest", () => {
    expect(active("Polls", "/app/cbc/calendar/polls/abc")).toBe(true);
    expect(active("Calendar", "/app/cbc/calendar/polls/abc")).toBe(false);
    expect(active("Calendar", "/app/cbc/calendar/sync")).toBe(true);
    expect(active("Polls", "/app/cbc/calendar")).toBe(false);
    expect(active("Find a time", "/app/cbc/calendar/find-a-time/new")).toBe(true);
    expect(active("Find a time", "/app/cbc/calendar/find-a-time/p1")).toBe(true);
    expect(active("Calendar", "/app/cbc/calendar/find-a-time")).toBe(false);
    expect(active("RSVPs", "/app/cbc/calendar/rsvp")).toBe(true);
    expect(active("Calendar", "/app/cbc/calendar/rsvp")).toBe(false);
    // An event's own RSVP page is part of that event, on the Calendar.
    expect(active("Calendar", "/app/cbc/calendar/e1/rsvp")).toBe(true);
  });

  it("puts sections added since a club saved its sidebar after the one before them, hidden with what they came from", () => {
    // A sidebar saved before Find a time and RSVPs: Calendar moved under Club, Polls hidden.
    const saved = {
      groups: [
        { id: "main", label: null },
        { id: "club", label: "Club" },
        { id: "data", label: "Data" },
      ],
      items: [
        { id: "overview", group: "main", hidden: false, label: null },
        { id: "tasks", group: "main", hidden: false, label: null },
        { id: "notes", group: "main", hidden: false, label: null },
        { id: "calendar", group: "club", hidden: false, label: "Events" },
        { id: "people", group: "club", hidden: false, label: null },
        { id: "polls", group: "club", hidden: true, label: null },
        { id: "databases", group: "data", hidden: false, label: null },
        { id: "finance", group: "data", hidden: false, label: null },
      ],
    };
    const club = resolveSidebar(saved).find((g) => g.id === "club")!;
    expect(club.items.map((i) => i.label)).toEqual([
      "Events",
      "People",
      "Polls",
      "Find a time",
      "RSVPs",
    ]);
    expect(club.items.find((i) => i.id === "find-a-time")!.hidden).toBe(true);
    expect(club.items.find((i) => i.id === "rsvps")!.hidden).toBe(false);
    expect(links(saved).map((i) => i.label)).not.toContain("Find a time");
  });

  it("names a section's page the way the club's sidebar does", () => {
    expect(sectionLabel(null, "notes")).toBe("Files");
    const groups = resolveSidebar(null);
    groups.find((g) => g.id === "data")!.items.find((i) => i.id === "notes")!.label = "Docs";
    groups.find((g) => g.id === "club")!.items.find((i) => i.id === "rsvps")!.hidden = true;
    const config = toConfig(groups);
    expect(sectionLabel(config, "notes")).toBe("Docs");
    // A hidden section keeps its name: admins can still open it.
    expect(sectionLabel(config, "rsvps")).toBe("RSVPs");
    expect(sectionLabel({ junk: true }, "people")).toBe("People");
  });

  it("follows the org's sidebar: hidden, renamed, moved and reordered sections", () => {
    const groups = resolveSidebar(null);
    const club = groups.find((g) => g.id === "club")!;
    const polls = club.items.find((i) => i.id === "polls")!;
    polls.hidden = true;
    const people = club.items.find((i) => i.id === "people")!;
    people.label = "Members";
    // Move Finance to the top group, first after Overview.
    const data = groups.find((g) => g.id === "data")!;
    const finance = data.items.splice(
      data.items.findIndex((i) => i.id === "finance"),
      1,
    )[0];
    groups[0].items.splice(1, 0, finance);
    groups[2].label = "Records";
    const config = toConfig(groups);
    const labels = links(config).map((i) => i.label);
    expect(labels).not.toContain("Polls");
    expect(labels.slice(0, 3)).toEqual(["Overview", "Finance", "Tasks"]);
    expect(labels).toContain("Members");
    expect(navSections("cbc", visibleSidebar(config)).map((s) => s.label)).toEqual([
      null,
      "Organization",
      "Records",
    ]);
    // Overview can't be hidden, whatever is saved.
    const tampered = {
      ...config,
      items: config.items.map((i) => (i.id === "overview" ? { ...i, hidden: true } : i)),
    };
    expect(links(tampered)[0].label).toBe("Overview");
  });
});

type Space = Parameters<typeof settingsNavItems>[2] & {};
const PERSONAL: Space = { kind: "PERSONAL", plan: "FREE", trialEndsAt: null };
const club = (plan: "TRIAL" | "CLUB" | "SOCIETY", trialEndsAt: Date | null = null): Space => ({
  kind: "CLUB",
  plan,
  trialEndsAt,
});

describe("the sidebar in each space", () => {
  const nav = (space: Space, showLocked = false) =>
    navSections("me", visibleSidebar(null), { space, showLocked }).flatMap((s) => s.items);

  it("gives Personal its own seven: Home, Tasks, Calendar, Files, Databases, Find a time and RSVPs", () => {
    const items = nav(PERSONAL, true);
    expect(items.map((i) => i.label)).toEqual([
      "Home",
      "Tasks",
      "Calendar",
      "Files",
      "Databases",
      "Find a time",
      "RSVPs",
    ]);
    expect(items.map((i) => i.href)).toEqual([
      "/app/me",
      "/app/me/tasks",
      "/app/me/calendar",
      "/app/me/notes",
      "/app/me/databases",
      "/app/me/calendar/find-a-time",
      "/app/me/calendar/rsvp",
    ]);
    expect(items.some((i) => i.locked)).toBe(false);
    const all = items;
    const is = (label: string, path: string, search = "") =>
      isLinkActive(
        all.find((i) => i.label === label)!,
        path,
        all,
        search,
      );
    expect(is("RSVPs", "/app/me/calendar/rsvp/e1")).toBe(true);
    expect(is("Calendar", "/app/me/calendar/rsvp/e1")).toBe(false);
    expect(is("Find a time", "/app/me/calendar/find-a-time/p1")).toBe(true);
    expect(is("Home", "/app/me/tasks")).toBe(false);
  });

  it("puts Personal's notes and uploads under one Files", () => {
    const all = nav(PERSONAL);
    const active = (path: string, search = "") =>
      all.filter((i) => isLinkActive(i, path, all, search)).map((i) => i.label);
    expect(active("/app/me/notes")).toEqual(["Files"]);
    expect(active("/app/me/notes", "tab=files&folder=f1")).toEqual(["Files"]);
    expect(active("/app/me/notes/n1")).toEqual(["Files"]);
    expect(active("/app/me/notes/files/f1")).toEqual(["Files"]);
    expect(isExactPage("/app/me", "/app/me")).toBe(true);
  });

  it("gives a running trial every section, and an ended one (Team Free) all but Finance", () => {
    expect(nav(club("TRIAL", new Date(Date.now() + 86_400_000))).map((i) => i.label)).toEqual(
      links().map((i) => i.label),
    );
    const ended = club("TRIAL", new Date(Date.now() - 86_400_000));
    expect(nav(ended).map((i) => i.label)).toEqual(
      links()
        .map((i) => i.label)
        .filter((l) => l !== "Finance"),
    );
    expect(nav(ended, true).find((i) => i.label === "Finance")?.locked).toBe(true);
  });

  it("locks nothing on Club and Society", () => {
    for (const p of ["CLUB", "SOCIETY"] as const) {
      expect(nav(club(p), true).some((i) => i.locked)).toBe(false);
      expect(nav(club(p)).map((i) => i.label)).toEqual(links().map((i) => i.label));
    }
  });
});

describe("the create menu", () => {
  const sections = (space: Space, raw: unknown = null, showLocked = false) =>
    navSections("me", visibleSidebar(raw), { space, showLocked });

  it("offers what the space has: task, event, note, poll and Find a time", () => {
    const all = createActions(sections(club("SOCIETY")), { canCreateEvents: true });
    expect(all.map((a) => [a.id, a.href])).toEqual([
      ["task", "/app/me/tasks?new=1"],
      ["event", "/app/me/calendar?new=1"],
      ["note", undefined],
      ["poll", "/app/me/calendar/polls/ask"],
      ["find-a-time", "/app/me/calendar/find-a-time/new"],
    ]);
    // Members who can't create events don't get New event.
    expect(
      createActions(sections(club("SOCIETY")), { canCreateEvents: false }).map((a) => a.id),
    ).not.toContain("event");
  });

  it("leaves out polls in Personal, and what a club hid", () => {
    expect(createActions(sections(PERSONAL), { canCreateEvents: true }).map((a) => a.id)).toEqual([
      "task",
      "event",
      "note",
      "find-a-time",
    ]);
    const groups = resolveSidebar(null);
    for (const g of groups) {
      for (const i of g.items) if (i.id === "notes" || i.id === "polls") i.hidden = true;
    }
    expect(
      createActions(sections(club("SOCIETY"), toConfig(groups)), { canCreateEvents: true }).map(
        (a) => a.id,
      ),
    ).toEqual(["task", "event", "find-a-time"]);
  });
});

describe("Admin panel navigation", () => {
  const labels = (role: Parameters<typeof settingsNavItems>[1]) =>
    settingsNavItems("cbc", role).map((i) => i.label);

  it("shows each role the sections it may use", () => {
    expect(labels("OWNER")).toEqual([
      "General",
      "Plan and storage",
      "Sidebar",
      "Theme",
      "Weekly pulse",
      "Members",
      "Privacy",
      "Integrations",
      "Audit log",
      "Danger zone",
    ]);
    expect(labels("ADMIN")).not.toContain("Danger zone");
    expect(labels("ADMIN")).toContain("Audit log");
    expect(labels("MEMBER")).toEqual(["Members"]);
    expect(labels("TREASURER")).toEqual(["Members"]);
  });

  it("marks the sections a club's plan lacks as locked, and none without a space", () => {
    const locked = (space?: Space) =>
      settingsNavItems("cbc", "OWNER", space)
        .filter((i) => i.locked)
        .map((i) => i.label);
    expect(locked()).toEqual([]);
    expect(locked(club("CLUB"))).toEqual(["Theme", "Audit log"]);
    expect(locked(club("SOCIETY"))).toEqual([]);
    expect(locked(club("TRIAL", new Date(Date.now() + 86_400_000)))).toEqual([]);
  });

  it("gives Personal only its own settings, its plan and storage, and no team settings", () => {
    expect(settingsNavItems("me", "OWNER", PERSONAL).map((i) => i.label)).toEqual([
      "General",
      "Plan and storage",
      "Danger zone",
    ]);
  });

  it("keeps Members active on the invitations page", () => {
    const members = settingsNavItems("cbc", "OWNER").find((i) => i.label === "Members")!;
    expect(isSettingsItemActive(members, "/app/cbc/settings/invitations")).toBe(true);
    expect(isSettingsItemActive(members, "/app/cbc/settings/members")).toBe(true);
    expect(isSettingsItemActive(members, "/app/cbc/settings/labels")).toBe(false);
  });
});
