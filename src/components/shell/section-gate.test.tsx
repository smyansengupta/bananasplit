import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/app/o/forms" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/components/addons/addon-controls", () => ({
  AddAddOnButton: ({ id }: { id: string }) => <button type="button">Add {id}</button>,
}));

import { SectionGate } from "./section-gate";

const sections = [
  {
    id: "forms",
    label: "Forms",
    path: "/forms",
    also: ["/calendar/polls"],
    hidden: true,
    notAdded: true,
  },
  { id: "finance", label: "Finance", path: "/finance", hidden: true, notAdded: true },
  { id: "tasks", label: "Tasks", path: "/tasks", hidden: false },
];

function gate(pathname: string, role: string, isAdmin: boolean) {
  nav.pathname = pathname;
  return render(
    <SectionGate orgId="org" orgSlug="o" role={role} sectionPaths={sections} isAdmin={isAdmin}>
      <p>The page</p>
    </SectionGate>,
  );
}

describe("SectionGate with add-ons", () => {
  it("tells a member an add-on isn't added, with no way to add it", () => {
    gate("/app/o/forms", "MEMBER", false);
    expect(screen.getByText("Forms isn't added")).toBeTruthy();
    expect(screen.queryByText("The page")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("covers an add-on's other paths (old poll links)", () => {
    gate("/app/o/calendar/polls/p1", "MEMBER", false);
    expect(screen.getByText("Forms isn't added")).toBeTruthy();
  });

  it("shows owners and admins the page, with Add right there", () => {
    gate("/app/o/forms", "ADMIN", true);
    expect(screen.getByText("The page")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add forms" })).toBeTruthy();
  });

  it("keeps Finance open to treasurers, and everyone's own reimbursements open", () => {
    const { unmount } = gate("/app/o/finance/transactions", "TREASURER", false);
    expect(screen.getByText("The page")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    gate("/app/o/finance/my-reimbursements", "MEMBER", false);
    expect(screen.getByText("The page")).toBeTruthy();
  });

  it("leaves sections that are on alone", () => {
    gate("/app/o/tasks", "MEMBER", false);
    expect(screen.getByText("The page")).toBeTruthy();
  });
});
