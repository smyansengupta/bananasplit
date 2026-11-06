import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSetup: vi.fn(async (..._args: unknown[]): Promise<{ ok: boolean; error?: string }> => ({
    ok: true,
  })),
  bringIn: vi.fn(async (..._args: unknown[]) => ({ ok: true, added: 2, linked: 0, queued: 0 })),
  skip: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  share: vi.fn(async (..._args: unknown[]) => ({ ok: true, shared: 3 })),
  booking: vi.fn(async (..._args: unknown[]) => ({ ok: true, url: "https://x.test/book/a" })),
  goal: vi.fn(async (..._args: unknown[]) => ({ ok: true, id: "g1", before: null })),
  signature: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  hide: vi.fn(async (..._args: unknown[]) => ({ ok: true, previous: { org: [], own: [] } })),
  restore: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  toast: vi.fn(),
  setOpen: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/crm/card/use-crm-open", () => ({
  useCrmOpen: () => ({ setOpen: mocks.setOpen }),
}));
vi.mock("@/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("@/app/app/[orgSlug]/crm/actions", () => ({
  runSetupAction: mocks.runSetup,
  bringInAction: mocks.bringIn,
  startImportAction: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/crm/goal-actions", () => ({ saveGoalAction: mocks.goal }));
vi.mock("@/app/app/[orgSlug]/crm/outreach/actions", () => ({
  saveMemberSettingsAction: mocks.signature,
}));
vi.mock("@/app/app/[orgSlug]/crm/settings-actions", () => ({
  hideCrmStartedAction: mocks.hide,
  restoreCrmStartedAction: mocks.restore,
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
  booking: false,
  goal: false,
  mailbox: false,
};
const made = { ...nothing, kinds: true };
const counts = { members: 3, contacts: 2, forms: 0, sponsors: 0 };
const asked = (question: string) => screen.getByRole("heading", { name: question });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const noButton = (name: string | RegExp) => screen.queryByRole("button", { name });

function strip(
  props: Partial<Parameters<typeof CrmStarted>[0]> & { state: CrmStartedState },
) {
  return render(
    <CrmStarted
      orgId="org"
      orgSlug="o"
      viewer={{ admin: true, personal: false }}
      skipped={[]}
      counts={counts}
      meetingLink="x.test/book/sam-…"
      signature={"Sam\nStarted Test"}
      quarter="2026-Q4"
      {...props}
    />,
  );
}

describe("Get your CRM started", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("asks one question at a time, with nothing else beside it", () => {
    strip({ state: made });
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    asked("Who should we bring in?");
    expect(screen.getByText("Step 2 of 6")).toBeTruthy();
    expect(noButton("Split evenly")).toBeNull();
    expect(noButton("Turn it on")).toBeNull();
  });

  it("before the CRM exists, can only answer the first question", () => {
    strip({ state: nothing });
    asked("Who do you mostly reach out to?");
    expect(screen.getByText("Step 1 of 6")).toBeTruthy();
    expect(noButton("Skip")).toBeNull();
    expect(noButton("Hide")).toBeNull();
    expect((button(/^Step 2:/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("has the first answer filled in, so it's one click, and moves on without waiting", async () => {
    let finish = (_: { ok: boolean }) => {};
    mocks.runSetup.mockImplementationOnce(() => new Promise((done) => (finish = done)));
    strip({ state: nothing });
    fireEvent.click(button("Set up the CRM"));
    asked("Who should we bring in?");
    await waitFor(() => expect(mocks.runSetup).toHaveBeenCalledWith("org", ["members"]));
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("won't set up with nothing picked", () => {
    strip({ state: nothing });
    fireEvent.click(button("Members and volunteers"));
    expect((button("Set up the CRM") as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves in the order things were answered: the first answer makes the CRM", async () => {
    let finish = (_: { ok: boolean }) => {};
    mocks.runSetup.mockImplementationOnce(() => new Promise((done) => (finish = done)));
    strip({ state: nothing });
    fireEvent.click(button("Set up the CRM"));
    fireEvent.click(button("Bring in 5 people"));
    asked("Who looks after new people?");
    await waitFor(() => expect(mocks.runSetup).toHaveBeenCalled());
    expect(mocks.bringIn).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true }));
    await waitFor(() => expect(mocks.bringIn).toHaveBeenCalledTimes(2));
  });

  it("brings the question back with the reason when its save fails, and drops what followed", async () => {
    mocks.runSetup.mockResolvedValueOnce({ ok: false, error: "Add the CRM first." });
    strip({ state: nothing });
    fireEvent.click(button("Set up the CRM"));
    fireEvent.click(button("Bring in 5 people"));
    await screen.findByText("Add the CRM first.");
    asked("Who do you mostly reach out to?");
    expect(mocks.bringIn).not.toHaveBeenCalled();
  });

  it("brings in everyone Bananasplit knows with one button", async () => {
    strip({ state: made });
    fireEvent.click(button("Bring in 5 people"));
    asked("Who looks after new people?");
    await waitFor(() => expect(mocks.bringIn).toHaveBeenCalledTimes(2));
    expect(mocks.bringIn).toHaveBeenCalledWith("org", "members");
    expect(mocks.bringIn).toHaveBeenCalledWith("org", "contacts");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("offers a spreadsheet beside it, and adding someone when nobody's waiting", () => {
    strip({ state: made, counts: { members: 0, contacts: 0, forms: 0, sponsors: 0 } });
    expect(button("or drop a spreadsheet")).toBeTruthy();
    fireEvent.click(button("Add someone"));
    expect(mocks.setOpen).toHaveBeenCalledWith({ kind: "new", what: "person" });
    expect(noButton(/^Bring in/)).toBeNull();
  });

  it("answers who looks after people in one click, with no second way to skip", async () => {
    strip({ state: { ...made, people: true } });
    expect(button("By type of person")).toBeTruthy();
    expect(noButton("Skip")).toBeNull();
    fireEvent.click(button("Split evenly"));
    asked("Turn on your meeting link?");
    await waitFor(() => expect(mocks.share).toHaveBeenCalled());
    expect(mocks.share.mock.calls[0]?.slice(0, 2)).toEqual(["org", "split"]);
  });

  it("treats Leave them for now as checking the step off", async () => {
    strip({ state: { ...made, people: true } });
    fireEvent.click(button("Leave them for now"));
    asked("Turn on your meeting link?");
    await waitFor(() => expect(mocks.skip).toHaveBeenCalledWith("org", "owner", true));
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("shows the meeting link and turns it on with one click", async () => {
    strip({ state: { ...made, people: true, owner: true } });
    expect(screen.getByText("x.test/book/sam-…")).toBeTruthy();
    fireEvent.click(button("Turn it on"));
    asked("What's your goal this quarter?");
    await waitFor(() => expect(mocks.booking).toHaveBeenCalledWith("org"));
  });

  it("sets this quarter's goal in place, a number already filled in", async () => {
    strip({ state: { ...made, people: true, owner: true, booking: true } });
    fireEvent.click(button("Set goal"));
    asked("What should your emails end with?");
    await waitFor(() =>
      expect(mocks.goal).toHaveBeenCalledWith(
        "org",
        expect.objectContaining({
          metric: "people_reached",
          ownerId: null,
          periodKey: "2026-Q4",
          target: 25,
        }),
      ),
    );
  });

  it("won't set a goal with no number", () => {
    strip({ state: { ...made, people: true, owner: true, booking: true } });
    fireEvent.change(screen.getByLabelText("How many people to reach"), { target: { value: "" } });
    expect((button("Set goal") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says the CRM is ready after the last answer, then leaves", async () => {
    vi.useFakeTimers();
    const { container } = strip({
      state: { ...made, people: true, owner: true, booking: true, goal: true },
    });
    expect((screen.getByLabelText("Your signature") as HTMLTextAreaElement).value).toBe(
      "Sam\nStarted Test",
    );
    fireEvent.click(button("Save"));
    expect(screen.getByRole("status").textContent).toBe("Your CRM is ready");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2300);
    });
    expect(container.textContent).toBe("");
    expect(mocks.signature).toHaveBeenCalledWith("org", { signature: "Sam\nStarted Test" });
  });

  it("skips a step, moving on at once, and comes back round to one left behind", async () => {
    strip({ state: made });
    fireEvent.click(button("Skip"));
    asked("Who looks after new people?");
    await waitFor(() => expect(mocks.skip).toHaveBeenCalledWith("org", "people", true));
    fireEvent.click(button(/^Step 6:/));
    asked("What should your emails end with?");
    fireEvent.click(button("Save"));
    asked("Who looks after new people?");
  });

  it("marks where you are, and jumps to a step from its segment", () => {
    strip({ state: made, skipped: ["goal"] });
    expect(button(/^Step 1: .*\(done\)$/)).toBeTruthy();
    expect(button(/^Step 5: .*\(skipped\)$/)).toBeTruthy();
    expect(button(/^Step 2:/).getAttribute("aria-current")).toBe("step");
    fireEvent.click(button(/^Step 4:/));
    asked("Turn on your meeting link?");
    expect(button(/^Step 4:/).getAttribute("aria-current")).toBe("step");
  });

  it("lets a skipped step be answered after all", () => {
    strip({ state: made, skipped: ["goal"] });
    fireEvent.click(button(/^Step 5:/));
    expect(button("Set goal")).toBeTruthy();
    expect(noButton("Skip")).toBeNull();
  });

  it("points a finished step at where it's changed", () => {
    strip({ state: made });
    fireEvent.click(button(/^Step 1:/));
    expect(screen.getByRole("link", { name: "Change it" }).getAttribute("href")).toBe(
      "/app/o/crm/settings/deals",
    );
    expect(noButton("Set up the CRM")).toBeNull();
  });

  it("hides at once, with Undo in the toast", async () => {
    const { container } = strip({ state: made });
    fireEvent.click(button("Hide"));
    expect(container.textContent).toBe("");
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    const shown = mocks.toast.mock.calls[0]![0] as {
      title: string;
      action: { label: string; run: () => Promise<unknown> };
    };
    expect(shown.title).toBe("Hidden");
    expect(shown.action.label).toBe("Undo");
    await act(async () => {
      await shown.action.run();
    });
    expect(mocks.restore).toHaveBeenCalledWith("org", { org: [], own: [] });
    asked("Who should we bring in?");
  });

  it("draws nothing once every step is finished", () => {
    const { container } = strip({
      state: { ...nothing, kinds: true, people: true, booking: true, mailbox: true },
      skipped: ["owner", "goal"],
    });
    expect(container.textContent).toBe("");
  });

  it("gives a member only their two steps, and leaves when they're done", () => {
    strip({ state: nothing, viewer: { admin: false, personal: false }, counts: null, quarter: null });
    asked("Turn on your meeting link?");
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    expect(button("Hide")).toBeTruthy();
    fireEvent.click(button("Turn it on"));
    asked("What should your emails end with?");
    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
  });

  it("gives a Personal space no owner step, and counts only RSVPs", () => {
    strip({ state: made, viewer: { admin: true, personal: true } });
    expect(screen.getByText("Step 2 of 5")).toBeTruthy();
    fireEvent.click(button("Bring in 2 people"));
    asked("Turn on your meeting link?");
  });
});
