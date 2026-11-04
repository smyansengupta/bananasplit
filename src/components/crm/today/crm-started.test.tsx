import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSetup: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  bringIn: vi.fn(async (..._args: unknown[]) => ({ ok: true, added: 2, linked: 0, queued: 0 })),
  skip: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  share: vi.fn(async (..._args: unknown[]) => ({ ok: true, shared: 3 })),
  booking: vi.fn(async (..._args: unknown[]) => ({ ok: true, url: "https://x.test/book/a" })),
  setOpen: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/crm/card/use-crm-open", () => ({
  useCrmOpen: () => ({ setOpen: mocks.setOpen }),
}));
vi.mock("@/app/app/[orgSlug]/crm/actions", () => ({
  runSetupAction: mocks.runSetup,
  bringInAction: mocks.bringIn,
  startImportAction: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/crm/org-keys-actions", () => ({ saveOrgKeyAction: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/crm/outreach/actions", () => ({
  saveMemberSettingsAction: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/crm/settings-actions", () => ({
  hideCrmStartedAction: vi.fn(),
  myLoggingAddressAction: vi.fn(),
  restoreCrmStartedAction: vi.fn(),
  setCrmStepSkippedAction: mocks.skip,
  shareOutOwnersAction: mocks.share,
  turnOnBookingAction: mocks.booking,
}));

import type { CrmStartedState } from "@/lib/crm/started";

import { CrmStarted } from "./crm-started";

const nothing: CrmStartedState = {
  kinds: false,
  people: false,
  owner: false,
  mailbox: false,
  booking: false,
  goal: false,
  ai: false,
  phone: false,
};
const made = { ...nothing, kinds: true };
const counts = { members: 3, contacts: 2, forms: 0, sponsors: 0 };

function panel(
  props: Partial<Parameters<typeof CrmStarted>[0]> & { state: CrmStartedState },
) {
  return render(
    <CrmStarted
      orgId="org"
      orgSlug="o"
      viewer={{ admin: true, personal: false }}
      skipped={[]}
      without={[]}
      counts={counts}
      inbound={false}
      {...props}
    />,
  );
}

describe("Get your CRM started", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("before the CRM exists, shows only the first step, with no way to skip it", () => {
    panel({ state: nothing });
    expect(screen.getByRole("heading", { name: "Get your CRM started" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up the CRM" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Not needed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
    expect(screen.queryByText("Bring people in")).toBeNull();
  });

  it("has the first answer filled in, so it's one click", async () => {
    panel({ state: nothing });
    fireEvent.click(screen.getByRole("button", { name: "Set up the CRM" }));
    await waitFor(() => expect(mocks.runSetup).toHaveBeenCalledWith("org", ["members"]));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("won't set up with nothing picked", () => {
    panel({ state: nothing });
    fireEvent.click(screen.getByRole("button", { name: "Members and volunteers" }));
    expect(
      (screen.getByRole("button", { name: "Set up the CRM" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("once it exists, shows what's left and folds the first step into a chip", () => {
    panel({ state: made });
    expect(screen.getByText("Bring people in")).toBeTruthy();
    expect(screen.getByText("Set your first goal")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Pick what you mostly reach out to" }).getAttribute("href"),
    ).toBe("/app/o/crm/settings/deals");
  });

  it("brings everyone in with one click, or one source", async () => {
    panel({ state: made });
    fireEvent.click(screen.getByRole("button", { name: "Bring in all 5" }));
    await waitFor(() => expect(mocks.bringIn).toHaveBeenCalledTimes(2));
    expect(mocks.bringIn).toHaveBeenCalledWith("org", "members");
    expect(mocks.bringIn).toHaveBeenCalledWith("org", "contacts");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Members 3" }));
    await waitFor(() => expect(mocks.bringIn).toHaveBeenCalledTimes(3));
  });

  it("does each job in place", async () => {
    panel({ state: made });
    fireEvent.click(screen.getByRole("button", { name: "Split evenly" }));
    await waitFor(() => expect(mocks.share).toHaveBeenCalled());
    expect(mocks.share.mock.calls[0]?.slice(0, 2)).toEqual(["org", "split"]);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Turn it on" }));
    await waitFor(() => expect(mocks.booking).toHaveBeenCalledWith("org"));
    fireEvent.click(screen.getByRole("button", { name: "Set a goal" }));
    expect(mocks.setOpen).toHaveBeenCalledWith({ kind: "goal", id: null });
  });

  it("treats Leave them for now as checking the step off", async () => {
    panel({ state: made });
    fireEvent.click(screen.getByRole("button", { name: "Leave them for now" }));
    await waitFor(() => expect(mocks.skip).toHaveBeenCalledWith("org", "owner", true));
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("gives a member only their own tiles", () => {
    panel({ state: nothing, viewer: { admin: false, personal: false }, counts: null });
    expect(screen.getByText("Set up your mail")).toBeTruthy();
    expect(screen.getByText("Turn on your meeting link")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up the CRM" })).toBeNull();
    expect(screen.queryByText("Add your AI key")).toBeNull();
  });

  it("gives a Personal space no owner step, and only RSVPs to bring in", () => {
    panel({ state: made, viewer: { admin: true, personal: true } });
    expect(screen.queryByText("Pick who looks after them")).toBeNull();
    expect(screen.queryByText("Calls and texts")).toBeNull();
    expect(screen.getByRole("button", { name: "People who RSVP'd 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Members/ })).toBeNull();
  });

  it("offers the logging address only where mail can come in", () => {
    panel({ state: made });
    expect(screen.queryByRole("button", { name: "Copy your logging address" })).toBeNull();
    cleanup();
    panel({ state: made, inbound: true });
    expect(screen.getByRole("button", { name: "Copy your logging address" })).toBeTruthy();
  });
});
