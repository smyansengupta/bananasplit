import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/app/o/tasks", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { BeforeSettings, isSettingsPath, SettingsClose } from "./settings-close";

function closeHref(fallback = "/app/o/crm") {
  render(<SettingsClose orgSlug="o" fallback={fallback} />);
  return screen.getByRole("link", { name: "Close settings" }).getAttribute("href");
}

describe("Close on settings", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it("knows the Admin panel and CRM settings, and nothing else", () => {
    expect(isSettingsPath("/app/o/settings")).toBe(true);
    expect(isSettingsPath("/app/o/settings/members")).toBe(true);
    expect(isSettingsPath("/app/o/crm/settings/deals")).toBe(true);
    expect(isSettingsPath("/app/o/crm")).toBe(false);
    expect(isSettingsPath("/app/o/crm/people")).toBe(false);
    expect(isSettingsPath("/app/o/settings-like")).toBe(false);
  });

  it("goes to the fallback with no page to go back to", () => {
    expect(closeHref("/app/o")).toBe("/app/o");
  });

  it("goes back to the page you came from, with its filters", () => {
    nav.pathname = "/app/o/crm/people";
    nav.search = "view=board";
    render(<BeforeSettings />);
    cleanup();
    expect(closeHref()).toBe("/app/o/crm/people?view=board");
  });

  it("doesn't count settings pages as where you came from", () => {
    nav.pathname = "/app/o/tasks";
    nav.search = "";
    render(<BeforeSettings />);
    cleanup();
    nav.pathname = "/app/o/crm/settings/team";
    render(<BeforeSettings />);
    cleanup();
    expect(closeHref()).toBe("/app/o/tasks");
  });

  it("ignores a page from another organization in this tab", () => {
    sessionStorage.setItem("bananasplit:before-settings", "/app/other/tasks");
    expect(closeHref()).toBe("/app/o/crm");
  });
});
