import { describe, expect, it } from "vitest";

import { settingsNavItems, isSettingsItemActive } from "@/app/app/[orgSlug]/settings/settings-nav";

import { resolveSidebar, toConfig, visibleSidebar } from "@/lib/nav/sidebar";

import { isLinkActive, navSections, settingsLink } from "./nav-config";

const links = (raw: unknown = null) => [
  ...navSections("cbc", visibleSidebar(raw)).flatMap((s) => s.items),
  settingsLink("cbc"),
];
const item = (label: string, all = links()) => all.find((i) => i.label === label)!;
const active = (label: string, path: string) => isLinkActive(item(label), path, links());

describe("sidebar navigation", () => {
  it("lists every section in order by default, grouped", () => {
    expect(links().map((i) => i.label)).toEqual([
      "Overview",
      "Tasks",
      "Calendar",
      "Notes",
      "People",
      "Org Chart",
      "Polls",
      "Databases",
      "Finance",
      "Settings",
    ]);
    expect(navSections("cbc", visibleSidebar(null)).map((s) => s.label)).toEqual([null, "Club", "Data"]);
    expect(item("Org Chart").href).toBe("/app/cbc/org-chart");
  });

  it("marks a section active on its sub-pages (prefix match), Overview only on itself", () => {
    expect(active("Tasks", "/app/cbc/tasks/abc")).toBe(true);
    expect(active("Settings", "/app/cbc/settings/members")).toBe(true);
    expect(active("Overview", "/app/cbc")).toBe(true);
    expect(active("Overview", "/app/cbc/tasks")).toBe(false);
    expect(active("Notes", "/app/cbc/notesy")).toBe(false);
  });

  it("marks only the most specific section active when sections nest", () => {
    expect(active("Polls", "/app/cbc/calendar/polls/abc")).toBe(true);
    expect(active("Calendar", "/app/cbc/calendar/polls/abc")).toBe(false);
    expect(active("Calendar", "/app/cbc/calendar/sync")).toBe(true);
    expect(active("Polls", "/app/cbc/calendar")).toBe(false);
  });

  it("follows the org's sidebar: hidden, renamed, moved and reordered sections", () => {
    const groups = resolveSidebar(null);
    const club = groups.find((g) => g.id === "club")!;
    const orgChart = club.items.find((i) => i.id === "org-chart")!;
    orgChart.hidden = true;
    const people = club.items.find((i) => i.id === "people")!;
    people.label = "Members";
    // Move Finance to the top group, first after Overview.
    const data = groups.find((g) => g.id === "data")!;
    const finance = data.items.splice(data.items.findIndex((i) => i.id === "finance"), 1)[0];
    groups[0].items.splice(1, 0, finance);
    groups[2].label = "Records";
    const config = toConfig(groups);
    const labels = links(config).map((i) => i.label);
    expect(labels).not.toContain("Org Chart");
    expect(labels.slice(0, 3)).toEqual(["Overview", "Finance", "Tasks"]);
    expect(labels).toContain("Members");
    expect(navSections("cbc", visibleSidebar(config)).map((s) => s.label)).toEqual([null, "Club", "Records"]);
    // Overview can't be hidden, whatever is saved.
    const tampered = { ...config, items: config.items.map((i) => (i.id === "overview" ? { ...i, hidden: true } : i)) };
    expect(links(tampered)[0].label).toBe("Overview");
  });
});

describe("settings sub-navigation", () => {
  const labels = (role: Parameters<typeof settingsNavItems>[1]) =>
    settingsNavItems("cbc", role).map((i) => i.label);

  it("shows each role the sections it may use", () => {
    expect(labels("OWNER")).toEqual([
      "General",
      "Sidebar",
      "Theme",
      "Labels",
      "Members",
      "Privacy",
      "Integrations",
      "Notifications",
      "Calendar feed",
      "Audit log",
      "Danger zone",
    ]);
    expect(labels("ADMIN")).not.toContain("Danger zone");
    expect(labels("ADMIN")).toContain("Audit log");
    expect(labels("MEMBER")).toEqual(["Members", "Notifications", "Calendar feed"]);
    expect(labels("TREASURER")).toEqual(["Members", "Notifications", "Calendar feed"]);
  });

  it("keeps Members active on the invitations page", () => {
    const members = settingsNavItems("cbc", "OWNER").find((i) => i.label === "Members")!;
    expect(isSettingsItemActive(members, "/app/cbc/settings/invitations")).toBe(true);
    expect(isSettingsItemActive(members, "/app/cbc/settings/members")).toBe(true);
    expect(isSettingsItemActive(members, "/app/cbc/settings/labels")).toBe(false);
  });
});
