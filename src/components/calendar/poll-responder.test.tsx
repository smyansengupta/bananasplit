import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PollView } from "@/lib/polls/poll-view";

/**
 * The poll responder's behaviour: one tab stop and keyboard painting, the
 * brush, a guest's name before saving, the group heatmap's counts and names,
 * scheduling behind a confirmation, and a closed poll offering no painting.
 * Drag geometry (the rectangle) is covered by paintRect in poll-grid-utils.
 */

const { submitMock, finalizeMock, pushMock, refreshMock } = vi.hoisted(() => ({
  submitMock: vi.fn(),
  finalizeMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/app/poll/[pollId]/actions", () => ({ submitPollResponse: submitMock }));
vi.mock("@/app/app/[orgSlug]/calendar/polls/actions", () => ({ finalizePoll: finalizeMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

const { PollResponder } = await import("./poll-responder");

// Draw in the runtime's own zone so the test doesn't depend on the machine's.
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const at = (day: number, hour: number, minute = 0) => new Date(2030, 0, day, hour, minute);
const slots = [
  { id: "d1a", startsAt: at(7, 9), endsAt: at(7, 9, 30) },
  { id: "d1b", startsAt: at(7, 9, 30), endsAt: at(7, 10) },
  { id: "d2a", startsAt: at(8, 9), endsAt: at(8, 9, 30) },
  { id: "d2b", startsAt: at(8, 9, 30), endsAt: at(8, 10) },
];

function makePoll(overrides: Partial<PollView> = {}): PollView {
  return {
    id: "poll_1",
    title: "Board sync",
    description: null,
    timezone: ZONE,
    durationMinutes: 30,
    closesAt: null,
    isFinalized: false,
    finalizedEventId: null,
    scheduled: null,
    slots,
    responses: [],
    myResponses: {},
    myGuestName: null,
    myRespondentKey: null,
    ...overrides,
  };
}

const mineGrid = () => screen.getByRole("grid", { name: "Your availability" });
const mineCells = () => within(mineGrid()).getAllByRole("gridcell");

beforeEach(() => {
  vi.useFakeTimers();
  submitMock.mockResolvedValue({});
  finalizeMock.mockResolvedValue({ eventId: "evt_1" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("PollResponder: your availability", () => {
  it("is one tab stop, and says what each time is marked", () => {
    render(<PollResponder poll={makePoll()} respondAs="member" canFinalize={false} />);

    const cells = mineCells();
    expect(cells).toHaveLength(4);
    expect(cells.filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(cells.every((c) => /not answered$/.test(c.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("marks the focused time with Space and saves after a pause", async () => {
    render(<PollResponder poll={makePoll()} respondAs="member" canFinalize={false} />);
    const [first] = mineCells();

    fireEvent.keyDown(first, { key: " " });
    expect(first.getAttribute("aria-label")).toMatch(/: available$/);
    expect(submitMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(submitMock).toHaveBeenCalledWith({
      pollId: "poll_1",
      guestName: null,
      entries: [{ slotId: "d1a", availability: "YES" }],
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("paints as it moves with Shift and an arrow, and undoes from a marked time", async () => {
    render(<PollResponder poll={makePoll()} respondAs="member" canFinalize={false} />);
    const cells = () => mineCells();

    fireEvent.keyDown(cells()[0], { key: "ArrowRight", shiftKey: true });
    // Row-major: [d1a, d2a, d1b, d2b].
    expect(cells()[1].getAttribute("aria-label")).toMatch(/: available$/);
    expect(cells()[1].getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(cells()[1], { key: " " });
    expect(cells()[1].getAttribute("aria-label")).toMatch(/: unavailable$/);
  });

  it("paints with the brush that is picked", () => {
    render(<PollResponder poll={makePoll()} respondAs="member" canFinalize={false} />);

    fireEvent.click(screen.getByRole("radio", { name: "If needed" }));
    fireEvent.keyDown(mineCells()[0], { key: "Enter" });

    expect(mineCells()[0].getAttribute("aria-label")).toMatch(/available if needed$/);
  });

  it("asks a guest for a name before saving, then saves under it", async () => {
    render(<PollResponder poll={makePoll()} respondAs="guest" canFinalize={false} />);

    fireEvent.keyDown(mineCells()[0], { key: " " });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(submitMock).not.toHaveBeenCalled();
    expect(screen.getByText("Add your name to save the times you marked.")).toBeTruthy();

    const name = screen.getByLabelText("Your name");
    fireEvent.change(name, { target: { value: "  Priya " } });
    await act(async () => {
      fireEvent.keyDown(name, { key: "Enter" });
    });
    expect(submitMock).toHaveBeenCalledWith({
      pollId: "poll_1",
      guestName: "Priya",
      entries: [{ slotId: "d1a", availability: "YES" }],
    });
  });
});

describe("PollResponder: everyone", () => {
  const answered = makePoll({
    myResponses: { d1a: "YES" },
    myRespondentKey: "r1",
    responses: [
      { slotId: "d1a", respondentKey: "r1", label: "Alice", isGuest: false, availability: "YES" },
      {
        slotId: "d1a",
        respondentKey: "r2",
        label: "Sam",
        isGuest: true,
        availability: "IF_NEEDED",
      },
      { slotId: "d2a", respondentKey: "r2", label: "Sam", isGuest: true, availability: "NO" },
    ],
  });

  it("opens on the group view once you've answered, with counts and names per time", () => {
    render(<PollResponder poll={answered} respondAs="member" canFinalize={false} />);

    const grid = screen.getByRole("grid", { name: "Everyone's availability" });
    const [d1a, d2a] = within(grid).getAllByRole("gridcell");
    expect(d1a.textContent).toBe("2");
    expect(d1a.getAttribute("aria-label")).toMatch(
      /2 of 2 available, 1 only if needed\. Available: You\. If needed: Sam\./,
    );
    expect(d2a.getAttribute("aria-label")).toMatch(/0 of 2 available\. Unavailable: Sam\./);
  });

  it("schedules a best time only after the confirmation", async () => {
    render(
      <PollResponder poll={answered} respondAs="member" orgId="org_1" orgSlug="rc" canFinalize />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Invites the member who can make the start time/)).toBeTruthy();
    expect(within(dialog).getByText(/1 guest can make it but can't be invited/)).toBeTruthy();
    expect(finalizeMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Schedule" }));
    });
    expect(finalizeMock).toHaveBeenCalledWith("org_1", "poll_1", "d1a");
    expect(pushMock).toHaveBeenCalledWith("/app/rc/calendar/evt_1");
  });

  it("offers no painting once the poll has closed", () => {
    render(
      <PollResponder
        poll={{ ...answered, closesAt: new Date(2000, 0, 1) }}
        respondAs="member"
        canFinalize={false}
      />,
    );

    expect(screen.queryByRole("grid", { name: "Your availability" })).toBeNull();
    expect(screen.getByText(/answers can't change/)).toBeTruthy();
  });
});
