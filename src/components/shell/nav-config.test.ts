import { describe, expect, it } from "vitest";

import { settingsNavItems, isSettingsItemActive } from "@/app/app/[orgSlug]/settings/settings-nav";

import { isNavItemActive, navItems } from "./nav-config";

const item = (label: string) => navItems.find((i) => i.label === label)!;

describe("sidebar navigation", () => {
  it("lists every section in order", () => {
    expect(navItems.map((i) => i.label)).toEqual([
      "Overview",
      "Tasks",
      "Notes",
      "Calendar",
      "Org Chart",
      "Databases",
      "Reports",
      "Finance",
      "Settings",
    ]);
    expect(item("Org Chart").href("cbc")).toBe("/app/cbc/org-chart");
  });

  it("marks a section active on its sub-pages (prefix match), Overview only on itself", () => {
    expect(isNavItemActive(item("Tasks"), "cbc", "/app/cbc/tasks/abc")).toBe(true);
    expect(isNavItemActive(item("Settings"), "cbc", "/app/cbc/settings/members")).toBe(true);
    expect(isNavItemActive(item("Overview"), "cbc", "/app/cbc")).toBe(true);
    expect(isNavItemActive(item("Overview"), "cbc", "/app/cbc/tasks")).toBe(false);
    expect(isNavItemActive(item("Notes"), "cbc", "/app/cbc/notesy")).toBe(false);
  });
});

describe("settings sub-navigation", () => {
  const labels = (role: Parameters<typeof settingsNavItems>[1]) =>
    settingsNavItems("cbc", role).map((i) => i.label);

  it("shows each role the sections it may use", () => {
    expect(labels("OWNER")).toEqual([
      "General",
      "Members",
      "Integrations",
      "Privacy",
      "Theme",
      "Notifications",
      "Calendar feed",
      "Labels",
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
