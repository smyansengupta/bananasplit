import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A goal and Done on its own are New person's window: its frame, head and
 * foot. Done on its own keeps its Undo buttons, its held back state and its
 * Undo in a toast; a goal saved or deleted closes with Undo in a toast.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  actual: vi.fn(),
  restore: vi.fn(),
  undo: vi.fn(),
  cancelEmail: vi.fn(),
  compose: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace, push: mocks.push }),
  usePathname: () => "/app/acme/crm",
  useSearchParams: () => new URLSearchParams("open=log"),
}));
vi.mock("@/app/app/[orgSlug]/crm/goal-actions", () => ({
  saveGoalAction: mocks.save,
  deleteGoalAction: mocks.remove,
  goalActualAction: mocks.actual,
}));
vi.mock("@/app/app/[orgSlug]/crm/actions", () => ({
  restoreToPointAction: mocks.restore,
  undoAction: mocks.undo,
}));
vi.mock("@/app/app/[orgSlug]/crm/outreach/actions", () => ({
  cancelEmailAction: mocks.cancelEmail,
  composeEmailAction: mocks.compose,
}));
vi.mock("@/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("@/components/tasks/task-fields", () => ({
  MemberOwnerField: () => <button type="button">Whole team</button>,
}));

import { GoalCard, type GoalCardData } from "./goal-card";
import { LogCard, type LogRow } from "./log-card";

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.actual.mockResolvedValue({ ok: true, actual: 0 });
});
afterEach(cleanup);

const goal: GoalCardData = {
  id: "g1",
  metric: "items_won",
  ownerId: null,
  pipelineId: null,
  periodKey: "2026-Q4",
  target: 10,
  actual: 4,
  today: "2026-11-15",
  viewerId: "u1",
  members: [],
  canEdit: true,
};

describe("GoalCard", () => {
  it("is New person's window, with its fields, score and foot", () => {
    render(<GoalCard orgId="o" data={goal} />);
    const dialog = screen.getByRole("dialog", { name: "Deals won this quarter" });
    expect(dialog.className).toContain("sm:max-w-2xl");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByLabelText("Target")).toBeTruthy();
    expect(screen.getByRole("img", { name: "4 deals of 10 deals" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save goal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete goal" })).toBeTruthy();
  });

  it("says so when the goal is hit", () => {
    render(<GoalCard orgId="o" data={{ ...goal, actual: 12 }} />);
    expect(screen.getByText("Goal hit, 20% over")).toBeTruthy();
  });

  it("saves and closes with Undo in the toast", async () => {
    mocks.save.mockResolvedValue({ ok: true, id: "g1", before: { metric: "items_won" } });
    render(<GoalCard orgId="o" data={goal} />);
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls[0]![0].action.label).toBe("Undo");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("is the same window to read for a member, with nothing to save", () => {
    render(<GoalCard orgId="o" data={{ ...goal, canEdit: false }} />);
    expect(screen.getByRole("dialog").className).toContain("sm:max-w-2xl");
    expect((screen.getByLabelText("Target") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Save goal" })).toBeNull();
    expect(screen.getByText("Only CRM managers change goals. Ask one to change this.")).toBeTruthy();
  });

  it("says when the goal has gone", () => {
    render(<GoalCard orgId="o" data={null} />);
    expect(screen.getByRole("dialog", { name: "This goal isn't here any more" })).toBeTruthy();
  });
});

const row = (over: Partial<LogRow>): LogRow => ({
  id: "r",
  kind: "changed",
  day: "Today",
  time: "2:14 PM",
  text: "Moved Maya to Won.",
  why: 'From the automation "Close"',
  undo: null,
  send: null,
  ...over,
});

const rows: LogRow[] = [
  row({
    id: "a",
    undo: { type: "restore", kind: "person", id: "p1", before: "2026-11-04T10:00:00.000Z" },
  }),
  row({ id: "b", kind: "sent", text: "Sending the deck to Sam.", undo: { type: "cancel-email", messageId: "m1" } }),
  row({ id: "c", kind: "held", text: "Held a note to Lee for you to check.", send: { personId: "p2", subject: "Hi", body: "Hello", draftId: "d1" } }),
];

const week = {
  done: 2,
  held: 1,
  days: Array.from({ length: 7 }, (_, i) => ({
    key: `d${i}`,
    label: "S",
    title: "A day",
    done: i === 6 ? 2 : 0,
    held: i === 6 ? 1 : 0,
    today: i === 6,
  })),
};

function renderLog(entries = rows) {
  render(<LogCard orgId="o" settingsHref="/auto" week={week} entries={entries} />);
}

describe("LogCard", () => {
  it("is New person's window, with the week on top and what it may do alone in the foot", () => {
    renderLog();
    const dialog = screen.getByRole("dialog", { name: "Done on its own" });
    expect(dialog.className).toContain("sm:max-w-2xl");
    expect(screen.getByText("things done for you this week")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change what it may do alone" }).getAttribute("href")).toBe("/auto");
  });

  it("filters by kind, keeping held back as its own state", () => {
    renderLog();
    fireEvent.click(screen.getByRole("radio", { name: /Held back/ }));
    expect(screen.queryByText("Moved Maya to Won.")).toBeNull();
    const held = screen.getByText("Held a note to Lee for you to check.").closest("li")!;
    expect(within(held).getByRole("img", { name: "Held back" })).toBeTruthy();
    expect(within(held).getByRole("button", { name: "Send anyway" })).toBeTruthy();
  });

  it("undoes a change, and offers to put it back in a toast", async () => {
    mocks.restore.mockResolvedValue({ ok: true, fields: 2, batchId: "b1" });
    mocks.undo.mockResolvedValue({ ok: true });
    renderLog();
    const change = screen.getByText("Moved Maya to Won.").closest("li")!;
    fireEvent.click(within(change).getByRole("button", { name: "Undo" }));
    await screen.findByText("Undone");
    const shown = mocks.toast.mock.calls[0]![0];
    expect(shown.title).toBe("Put back as it was.");
    await shown.action.run();
    expect(mocks.undo).toHaveBeenCalledWith("o", "b1");
    await waitFor(() => expect(screen.queryByText("Undone")).toBeNull());
  });

  it("cancels a send still waiting", async () => {
    mocks.cancelEmail.mockResolvedValue({ ok: true });
    renderLog();
    const mail = screen.getByText("Sending the deck to Sam.").closest("li")!;
    fireEvent.click(within(mail).getByRole("button", { name: "Undo" }));
    await screen.findByText("Won't send");
    expect(mocks.cancelEmail).toHaveBeenCalledWith("o", "m1");
  });

  it("invites an automation when there's nothing yet", () => {
    render(
      <LogCard
        orgId="o"
        settingsHref="/auto"
        week={{ ...week, done: 0, held: 0 }}
        entries={[]}
      />,
    );
    expect(screen.getByText("Turn on an automation and its work adds up here.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
