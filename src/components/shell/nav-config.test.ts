import { describe, expect, it } from "vitest";

import { settingsNavItems, isSettingsItemActive } from "@/app/app/[orgSlug]/settings/settings-nav";

import { resolveSidebar, sectionLabel, toConfig, visibleSidebar } from "@/lib/nav/sidebar";

import { createActions, isExactPage, isLinkActive, navSections } from "./nav-config";

const links = (raw: unknown = null) =>
  navSections("cbc", visibleSidebar(raw)).flatMap((s) => s.items);
const item = (label: string, all = links()) => all.find((i) => i.label === label)!;
const active = (label: string, path: string) => isLinkActive(item(label), path, links());

describe("sidebar navigation", () => {
  it("lists every section in order by default, in its groups", () => {
    expect(links().map((i) => i.label)).toEqual([
      "Home",
      "Inbox",
      "People",
      "Tasks",
      "Calendar",
      "Meetings",
      "Files",
      "Databases",
      "Integrations",
      "Forms",
      "Finance",
      "CRM",
    ]);
    const groups = navSections("cbc", visibleSidebar(null));
    // Files is part of Data; Integrations and apps is Integrations, then the
    // add-ons. The money group is empty by default and drops out.
    expect(groups.map((s) => s.id)).toEqual(["main", "plan", "collect", "workspace"]);
    // The sidebar names the groups itself (SECTION_NAMES).
    expect(groups.every((s) => s.label === null)).toBe(true);
    expect(item("Files").href).toBe("/app/cbc/notes");
    expect(item("Inbox").href).toBe("/app/cbc/inbox");
  });

  it("keeps People active on the org chart, which is part of it now", () => {
    expect(active("People", "/app/cbc/org-chart")).toBe(true);
    expect(active("People", "/app/cbc/org-chart/versions/v1")).toBe(true);
    expect(active("People", "/app/cbc/people/u1")).toBe(true);
    expect(active("Forms", "/app/cbc/org-chart")).toBe(false);
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

  it("marks a section active on its sub-pages (prefix match), Home only on itself", () => {
    expect(active("Tasks", "/app/cbc/tasks/abc")).toBe(true);
    expect(active("Home", "/app/cbc")).toBe(true);
    expect(active("Home", "/app/cbc/tasks")).toBe(false);
    expect(active("Files", "/app/cbc/notesy")).toBe(false);
  });

  it("marks only the most specific section active when sections nest", () => {
    // Polls' old pages belong to Forms, Find a time's to Meetings.
    expect(active("Forms", "/app/cbc/calendar/polls/abc")).toBe(true);
    expect(active("Calendar", "/app/cbc/calendar/polls/abc")).toBe(false);
    expect(active("Calendar", "/app/cbc/calendar/sync")).toBe(true);
    expect(active("Forms", "/app/cbc/calendar")).toBe(false);
    expect(active("Meetings", "/app/cbc/calendar/find-a-time/new")).toBe(true);
    expect(active("Meetings", "/app/cbc/calendar/find-a-time/p1")).toBe(true);
    expect(active("Calendar", "/app/cbc/calendar/find-a-time")).toBe(false);
    expect(active("Meetings", "/app/cbc/meetings")).toBe(true);
    // The old RSVP path still belongs to Meetings, so a pasted link lights
    // the right section up.
    expect(active("Meetings", "/app/cbc/calendar/rsvp")).toBe(true);
    expect(active("Calendar", "/app/cbc/calendar/rsvp")).toBe(false);
    expect(active("Meetings", "/app/cbc/meetings/e1/rsvp")).toBe(true);
    expect(active("Meetings", "/app/cbc/meetings/e1/rsvp/door")).toBe(true);
    expect(active("Calendar", "/app/cbc/meetings/e1/rsvp")).toBe(false);
    // Integrations' setup pages still live under the Admin panel and Setup.
    expect(active("Integrations", "/app/cbc/settings/integrations/claude")).toBe(true);
    expect(active("Integrations", "/app/cbc/setup")).toBe(true);
  });

  it("reads a sidebar saved before the new groups: choices kept, each section in its own group", () => {
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
        { id: "find-a-time", group: "club", hidden: false, label: null },
        { id: "databases", group: "data", hidden: false, label: null },
        { id: "finance", group: "data", hidden: false, label: null },
      ],
    };
    const labels = links(saved).map((i) => i.label);
    // A club that hid Polls has Forms hidden; Find a time is part of Meetings.
    expect(labels).not.toContain("Forms");
    expect(labels).not.toContain("Polls");
    expect(labels).not.toContain("Find a time");
    expect(labels).toContain("Meetings");
    expect(labels).toContain("Events");
    const groups = resolveSidebar(saved);
    expect(groups.map((g) => g.id)).toEqual(["main", "plan", "collect", "workspace", "money"]);
    expect(groups.find((g) => g.id === "plan")!.items.map((i) => i.id)).toContain("calendar");
    expect(groups.every((g) => g.label === null)).toBe(true);
  });

  it("names a section's page the way the organization's sidebar does", () => {
    expect(sectionLabel(null, "notes")).toBe("Files");
    const groups = resolveSidebar(null);
    groups.find((g) => g.id === "collect")!.items.find((i) => i.id === "notes")!.label = "Docs";
    groups.find((g) => g.id === "plan")!.items.find((i) => i.id === "meetings")!.hidden = true;
    const config = toConfig(groups);
    expect(sectionLabel(config, "notes")).toBe("Docs");
    // A hidden section keeps its name: admins can still open it.
    expect(sectionLabel(config, "meetings")).toBe("Meetings");
    expect(sectionLabel({ junk: true }, "people")).toBe("People");
    // Old pages ask by their old names.
    expect(sectionLabel(null, "polls")).toBe("Forms");
    expect(sectionLabel(null, "find-a-time")).toBe("Find a time");
  });

  it("follows the org's sidebar: hidden, renamed, moved and reordered sections", () => {
    const groups = resolveSidebar(null);
    const collect = groups.find((g) => g.id === "collect")!;
    groups.find((g) => g.id === "workspace")!.items.find((i) => i.id === "forms")!.hidden = true;
    const main = groups.find((g) => g.id === "main")!;
    main.items.find((i) => i.id === "people")!.label = "Members";
    // Move Databases into the first group, right after Home.
    const databases = collect.items.splice(
      collect.items.findIndex((i) => i.id === "databases"),
      1,
    )[0]!;
    main.items.splice(1, 0, databases);
    const config = toConfig(groups);
    const labels = links(config).map((i) => i.label);
    expect(labels).not.toContain("Forms");
    expect(labels.slice(0, 3)).toEqual(["Home", "Databases", "Inbox"]);
    expect(labels).toContain("Members");
    // An emptied group drops out.
    expect(navSections("cbc", visibleSidebar(config)).map((s) => s.id)).toEqual([
      "main",
      "plan",
      "collect",
      "workspace",
    ]);
    // Home and Inbox can't be hidden, whatever is saved.
    const tampered = {
      ...config,
      items: config.items.map((i) =>
        i.id === "overview" || i.id === "inbox" ? { ...i, hidden: true } : i,
      ),
    };
    expect(links(tampered).map((i) => i.label)).toEqual(expect.arrayContaining(["Home", "Inbox"]));
  });

  it("keeps Integrations first in its section, with only the added add-ons below it", () => {
    const workspace = (raw: unknown, addOns?: string[]) =>
      navSections("cbc", visibleSidebar(raw, addOns))
        .find((s) => s.id === "workspace")!
        .items.map((i) => i.label);
    expect(workspace(null, [])).toEqual(["Integrations"]);
    expect(workspace(null, ["finance"])).toEqual(["Integrations", "Finance"]);
    expect(workspace(null, ["finance", "forms"])).toEqual(["Integrations", "Forms", "Finance"]);
    // A sidebar saved with Files and the add-ons elsewhere, Integrations last:
    // Files goes to Data, and the section keeps its order.
    const saved = {
      groups: [],
      items: [
        { id: "finance", group: "main", hidden: false, label: null },
        { id: "forms", group: "collect", hidden: false, label: null },
        { id: "notes", group: "workspace", hidden: false, label: null },
        { id: "integrations", group: "workspace", hidden: false, label: null },
      ],
    };
    expect(workspace(saved, ["forms", "finance"])).toEqual(["Integrations", "Forms", "Finance"]);
    expect(
      navSections("cbc", visibleSidebar(saved))
        .find((s) => s.id === "collect")!
        .items.map((i) => i.label),
    ).toContain("Files");
    // Another section an older sidebar put in that group sits below the add-ons.
    const tasksThere = {
      groups: [],
      items: [{ id: "tasks", group: "workspace", hidden: false, label: null }],
    };
    const there = workspace(tasksThere, ["forms"]);
    expect(there.slice(0, 2)).toEqual(["Integrations", "Forms"]);
    expect(there).toContain("Tasks");
    // An add-on that isn't added is hidden, and marked so the page can say so.
    const forms = resolveSidebar(null, [])
      .flatMap((g) => g.items)
      .find((i) => i.id === "forms")!;
    expect(forms).toMatchObject({ hidden: true, notAdded: true });
  });
});

type Space = Parameters<typeof settingsNavItems>[2] & {};
const PERSONAL: Space = { kind: "PERSONAL", plan: "FREE", trialEndsAt: null, planAfterTrial: null };
const club = (plan: "TRIAL" | "CLUB" | "SOCIETY", trialEndsAt: Date | null = null): Space => ({
  kind: "CLUB",
  plan,
  trialEndsAt,
  planAfterTrial: null,
});

describe("the sidebar in each space", () => {
  const nav = (space: Space, showLocked = false, addOns?: string[]) =>
    navSections("me", visibleSidebar(null, addOns), { space, showLocked }).flatMap((s) => s.items);
  const PLUS: Space = { ...PERSONAL, plan: "PERSONAL_PLUS" };

  it("gives Personal its own: Home, Inbox, Tasks, Calendar, Meetings, Files, Databases and Integrations", () => {
    const items = nav(PLUS, true, []);
    expect(items.map((i) => i.label)).toEqual([
      "Home",
      "Inbox",
      "Tasks",
      "Calendar",
      "Meetings",
      "Files",
      "Databases",
      "Integrations",
    ]);
    expect(items.map((i) => i.href)).toEqual([
      "/app/me",
      "/app/me/inbox",
      "/app/me/tasks",
      "/app/me/calendar",
      "/app/me/meetings",
      "/app/me/notes",
      "/app/me/databases",
      "/app/me/integrations",
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
    expect(is("Meetings", "/app/me/calendar/rsvp/e1")).toBe(true);
    expect(is("Calendar", "/app/me/calendar/rsvp/e1")).toBe(false);
    expect(is("Meetings", "/app/me/calendar/find-a-time/p1")).toBe(true);
    expect(is("Home", "/app/me/tasks")).toBe(false);
  });

  it("adds the CRM under Integrations once it's added, and locks both on Personal Free", () => {
    expect(
      nav(PLUS, true, ["crm"])
        .map((i) => i.label)
        .slice(-2),
    ).toEqual(["Integrations", "CRM"]);
    expect(nav(PLUS, true, ["crm"]).at(-1)?.href).toBe("/app/me/crm");
    // Forms and Finance are an organization's: added or not, Personal doesn't show them.
    expect(nav(PLUS, true, ["forms", "finance"]).map((i) => i.label)).not.toContain("Forms");
    const free = nav(PERSONAL, true, ["crm"]);
    expect(free.filter((i) => i.locked).map((i) => i.label)).toEqual(["Integrations", "CRM"]);
    expect(nav(PERSONAL, false, ["crm"]).map((i) => i.label)).not.toContain("Integrations");
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

  it("gives a running trial every section, and an ended one (Team Free) all but the paid ones", () => {
    expect(nav(club("TRIAL", new Date(Date.now() + 86_400_000))).map((i) => i.label)).toEqual(
      links().map((i) => i.label),
    );
    const ended = club("TRIAL", new Date(Date.now() - 86_400_000));
    expect(nav(ended).map((i) => i.label)).toEqual(
      links()
        .map((i) => i.label)
        .filter((l) => l !== "Finance" && l !== "Integrations" && l !== "CRM"),
    );
    expect(nav(ended, true).find((i) => i.label === "Finance")?.locked).toBe(true);
  });

  it("locks nothing on Society, and only the CRM (Team Advanced) on Organization", () => {
    expect(nav(club("SOCIETY"), true).some((i) => i.locked)).toBe(false);
    expect(nav(club("SOCIETY")).map((i) => i.label)).toEqual(links().map((i) => i.label));
    expect(
      nav(club("CLUB"), true)
        .filter((i) => i.locked)
        .map((i) => i.label),
    ).toEqual(["CRM"]);
    expect(nav(club("CLUB")).map((i) => i.label)).toEqual(
      links()
        .map((i) => i.label)
        .filter((l) => l !== "CRM"),
    );
  });
});

describe("the create menu", () => {
  const sections = (space: Space, raw: unknown = null, showLocked = false) =>
    navSections("me", visibleSidebar(raw), { space, showLocked });

  it("offers what the space has: task, event, meeting, note, poll, form and Find a time", () => {
    const all = createActions(sections(club("SOCIETY")), { canCreateEvents: true });
    expect(all.map((a) => [a.id, a.href])).toEqual([
      ["task", "/app/me/tasks?new=1"],
      ["event", "/app/me/calendar?new=1"],
      ["meeting", "/app/me/meetings?new=1"],
      ["note", undefined],
      ["poll", "/app/me/forms/new?poll=1"],
      ["form", "/app/me/forms/new"],
      ["expense", "/app/me/finance/my-reimbursements?new=1"],
      ["crm-person", "/app/me/crm/people?new=1"],
      ["crm-company", "/app/me/crm/companies?new=1"],
      ["crm-item", "/app/me/crm/items/new"],
      ["find-a-time", "/app/me/calendar/find-a-time/new"],
    ]);
    // Members who can't create events don't get New event.
    expect(
      createActions(sections(club("SOCIETY")), { canCreateEvents: false }).map((a) => a.id),
    ).not.toContain("event");
  });

  it("leaves out polls in Personal, and what an organization hid", () => {
    expect(createActions(sections(PERSONAL), { canCreateEvents: true }).map((a) => a.id)).toEqual([
      "task",
      "event",
      "meeting",
      "note",
      "find-a-time",
    ]);
    const groups = resolveSidebar(null);
    for (const g of groups) {
      for (const i of g.items) if (i.id === "notes" || i.id === "forms") i.hidden = true;
    }
    expect(
      createActions(sections(club("SOCIETY"), toConfig(groups)), { canCreateEvents: true }).map(
        (a) => a.id,
      ),
    ).toEqual([
      "task",
      "event",
      "meeting",
      "expense",
      "crm-person",
      "crm-company",
      "crm-item",
      "find-a-time",
    ]);
  });

  describe("New meeting", () => {
    const meeting = (actions: ReturnType<typeof createActions>) =>
      actions.find((a) => a.id === "meeting");

    it("New meeting appears for event creators when Meetings is in the sidebar", () => {
      expect(meeting(createActions(sections(club("SOCIETY")), { canCreateEvents: true }))).toEqual({
        id: "meeting",
        label: "New meeting",
        icon: "Video",
        href: "/app/me/meetings?new=1",
      });
      // Personal has Meetings too.
      expect(meeting(createActions(sections(PERSONAL), { canCreateEvents: true }))).toMatchObject({
        label: "New meeting",
        href: "/app/me/meetings?new=1",
      });
    });

    it("not for members who cannot create events", () => {
      expect(
        meeting(createActions(sections(club("SOCIETY")), { canCreateEvents: false })),
      ).toBeUndefined();
      expect(
        meeting(createActions(sections(PERSONAL), { canCreateEvents: false })),
      ).toBeUndefined();
    });

    it("not when Meetings is hidden", () => {
      const groups = resolveSidebar(null);
      for (const g of groups) {
        for (const i of g.items) if (i.id === "meetings") i.hidden = true;
      }
      const hidden = createActions(sections(club("SOCIETY"), toConfig(groups)), {
        canCreateEvents: true,
      });
      expect(meeting(hidden)).toBeUndefined();
      // The Calendar's New event does not depend on it.
      expect(hidden.map((a) => a.id)).toContain("event");
    });
  });
});

describe("Admin panel navigation", () => {
  const labels = (role: Parameters<typeof settingsNavItems>[1]) =>
    settingsNavItems("cbc", role).map((i) => i.label);

  it("shows each role the sections it may use", () => {
    expect(labels("OWNER")).toEqual([
      "General",
      "Plan",
      "Sidebar",
      "Theme",
      "Members",
      "Privacy",
      "Audit log",
      "What's new",
      "Danger zone",
    ]);
    expect(labels("ADMIN")).not.toContain("Danger zone");
    expect(labels("ADMIN")).toContain("Audit log");
    expect(labels("MEMBER")).toEqual(["Members", "What's new"]);
    expect(labels("TREASURER")).toEqual(["Members", "What's new"]);
  });

  it("marks the sections an organization's plan lacks as locked, and none without a space", () => {
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
      "What's new",
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
