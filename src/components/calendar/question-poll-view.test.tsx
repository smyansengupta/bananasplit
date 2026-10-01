import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestionPollView } from "@/lib/polls/question-poll";

/**
 * The question poll page: a vote shows at once and is sent a moment later
 * (only the last of a quick run of changes), results read as bars with
 * counts and faces, an anonymous poll names nobody, hidden results stay
 * hidden, and a closed poll offers no voting.
 */

const { voteMock, setClosedMock, toastMock, pushMock } = vi.hoisted(() => ({
  voteMock: vi.fn(),
  setClosedMock: vi.fn(),
  toastMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/app/app/[orgSlug]/calendar/polls/question-actions", () => ({
  voteOnQuestionPoll: voteMock,
  setQuestionPollClosed: setClosedMock,
  addQuestionPollOption: vi.fn(),
  removeQuestionPollOption: vi.fn(),
  deleteQuestionPoll: vi.fn(),
}));
vi.mock("@/components/pins/pins-context", () => ({ PinToggle: () => null }));
vi.mock("@/components/ui/toaster", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

const { QuestionPoll } = await import("./question-poll-view");

const ann = { key: "v1", name: "Ann Lee", image: null, avatar: {} };
const me = { key: "me", name: "Viola Viewer", image: null, avatar: {} };

function makePoll(overrides: Partial<QuestionPollView> = {}): QuestionPollView {
  return {
    id: "qp_1",
    question: "Pizza or tacos?",
    description: null,
    multiple: false,
    anonymous: false,
    allowMemberOptions: false,
    hideResultsUntilClosed: false,
    closesAt: null,
    closedAt: null,
    createdAt: new Date("2026-09-30T12:00:00Z"),
    askedBy: "Ann Lee",
    isOpen: true,
    resultsVisible: true,
    options: [
      {
        id: "o_pizza",
        label: "Pizza",
        votes: 2,
        voters: [ann, { key: "v2", name: "Bo", image: null, avatar: {} }],
      },
      {
        id: "o_tacos",
        label: "Tacos",
        votes: 1,
        voters: [{ key: "v3", name: "Cy", image: null, avatar: {} }],
      },
    ],
    voterCount: 3,
    myVotes: [],
    me,
    canVote: true,
    canAddOption: false,
    canManage: false,
    ...overrides,
  };
}

function show(poll: QuestionPollView) {
  return render(<QuestionPoll poll={poll} orgId="org_1" orgSlug="cbc" timeZone="UTC" />);
}

beforeEach(() => {
  vi.useFakeTimers();
  voteMock.mockResolvedValue({});
  setClosedMock.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("QuestionPoll: voting", () => {
  it("shows each option's share, the leader and who picked it", () => {
    show(makePoll());
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText("33%")).toBeTruthy();
    expect(screen.getByText("Leading")).toBeTruthy();
    expect(screen.getByText("Voted: Ann Lee, Bo.")).toBeTruthy();
    expect(screen.getByText("3 people voted")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("shows a vote at once and sends only the last of a quick run of changes", async () => {
    show(makePoll());
    const [pizza, tacos] = screen.getAllByRole("radio");

    fireEvent.click(tacos);
    expect((tacos as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("You voted")).toBeTruthy();
    // The viewer joins the voters and the counts move before the server answers.
    expect(screen.getByText("Voted: You, Cy.")).toBeTruthy();
    expect(screen.getByText("4 people voted")).toBeTruthy();

    fireEvent.click(pizza);
    expect((pizza as HTMLInputElement).checked).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(voteMock).toHaveBeenCalledTimes(1);
    expect(voteMock).toHaveBeenCalledWith("org_1", "qp_1", ["o_pizza"]);
  });

  it("takes several choices on a multiple-choice poll, and clears them", async () => {
    show(makePoll({ multiple: true, myVotes: ["o_pizza"], options: makePoll().options }));
    const [, tacos] = screen.getAllByRole("checkbox");
    fireEvent.click(tacos);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(voteMock).toHaveBeenLastCalledWith("org_1", "qp_1", ["o_pizza", "o_tacos"]);

    fireEvent.click(screen.getByRole("button", { name: /Clear my vote/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(voteMock).toHaveBeenLastCalledWith("org_1", "qp_1", []);
  });

  it("says so when a vote isn't saved", async () => {
    voteMock.mockResolvedValue({ error: "This poll is closed. Votes can't change any more." });
    show(makePoll());
    fireEvent.click(screen.getAllByRole("radio")[1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Your vote wasn't saved", tone: "error" }),
    );
  });
});

describe("QuestionPoll: what each viewer sees", () => {
  it("names nobody on an anonymous poll", () => {
    const { container } = show(
      makePoll({
        anonymous: true,
        me: null,
        myVotes: ["o_pizza"],
        options: makePoll().options.map((o) => ({ ...o, voters: null })),
      }),
    );
    expect(screen.queryByText(/^Voted:/)).toBeNull();
    expect(container.textContent).not.toContain("Bo");
    expect(screen.getByText(/Nobody, not even admins, can see who voted for what/)).toBeTruthy();
    expect(screen.getByText("You voted")).toBeTruthy();
  });

  it("keeps hidden results hidden, showing the voter only their own choice", () => {
    show(
      makePoll({
        hideResultsUntilClosed: true,
        resultsVisible: false,
        myVotes: ["o_tacos"],
        options: makePoll().options.map((o) => ({ ...o, votes: null, voters: null })),
      }),
    );
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(screen.getByText(/hidden until the poll closes/)).toBeTruthy();
    expect((screen.getAllByRole("radio")[1] as HTMLInputElement).checked).toBe(true);
  });

  it("offers no voting once closed, marks the top choice, and lets a manager reopen it", async () => {
    show(
      makePoll({
        isOpen: false,
        canVote: false,
        canManage: true,
        closedAt: new Date("2026-10-01T12:00:00Z"),
      }),
    );
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("Top choice")).toBeTruthy();
    expect(screen.getByText("Results")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reopen/ }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(setClosedMock).toHaveBeenCalledWith("org_1", "qp_1", false);
  });
});
