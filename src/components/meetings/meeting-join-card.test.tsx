import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConferenceStatus } from "@/lib/meetings/conference-status";

/**
 * The join details on a meeting's page (docs/features/meetings.md): the link,
 * the host's own link for people who may start it, the passcode and dial-in
 * numbers, and what to do when making the meeting failed.
 */

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    refresh,
    // One router for the life of the page, as Next.js hands out.
    router: { refresh },
    retry: vi.fn(),
    toast: vi.fn(),
    writeText: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/app/app/[orgSlug]/meetings/actions", () => ({
  retryConferenceSync: mocks.retry,
}));
vi.mock("@/components/ui/toaster", () => ({ toast: mocks.toast }));

const { MeetingJoinCard, PENDING_REFRESH_MS, PENDING_REFRESH_FOR_MS } = await import(
  "./meeting-join-card"
);

const JOIN = "https://us02web.zoom.us/j/98765432100?pwd=abc";
const HOST = "https://us02web.zoom.us/s/98765432100?zak=host";

type Props = Parameters<typeof MeetingJoinCard>[0];

function card(overrides: Partial<Props> = {}) {
  const props: Props = {
    orgId: "org_1",
    eventId: "evt_1",
    providerLabel: "Zoom",
    joinUrl: JOIN,
    hostUrl: null,
    passcode: null,
    dialIn: [],
    status: { kind: "ready" },
    canEdit: false,
    ...overrides,
  };
  return render(<MeetingJoinCard {...props} />);
}

const FAILED: ConferenceStatus = {
  kind: "failed",
  line: "Couldn't make the Zoom meeting.",
  reason: "Zoom needs to be reconnected from Meetings.",
};

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.retry.mockReset();
  mocks.toast.mockReset();
  mocks.writeText.mockReset();
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MeetingJoinCard: joining", () => {
  it("opens the join link in a new tab, without handing the page to the provider", () => {
    card();

    const join = screen.getByRole("link", { name: /join meeting/i });
    expect(join.getAttribute("href")).toBe(JOIN);
    expect(join.getAttribute("target")).toBe("_blank");
    expect(join.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("names the provider", () => {
    card({ providerLabel: "Microsoft Teams" });

    expect(screen.getByText("Microsoft Teams")).toBeTruthy();
  });

  it("copies the join link and says so", async () => {
    card();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(JOIN));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Link copied" })),
    );
  });

  it("says when the browser would not copy", async () => {
    mocks.writeText.mockRejectedValue(new Error("denied"));
    card();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/couldn't copy/i), tone: "error" }),
      ),
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Link copied" }));
  });

  it("offers neither a link nor a copy button while there is no link", () => {
    card({ joinUrl: null, status: { kind: "pending", line: "Getting the Zoom link…" } });

    expect(screen.queryByRole("link", { name: /join meeting/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("says there is no link yet when nothing is making one", () => {
    // Saved before the provider was connected: not pending, not failed.
    card({ joinUrl: null, status: { kind: "none" } });

    expect(screen.getByText("No join link yet.")).toBeTruthy();
  });
});

describe("MeetingJoinCard: passcode and dial-in", () => {
  it("shows the passcode with its own copy button", async () => {
    card({ passcode: "482913" });

    expect(screen.getByText("482913")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy passcode" }));

    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("482913"));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Passcode copied" }),
      ),
    );
  });

  it("shows no passcode row for a meeting without one", () => {
    card({ passcode: null });

    expect(screen.queryByRole("button", { name: "Copy passcode" })).toBeNull();
    expect(screen.queryByText("Passcode")).toBeNull();
  });

  it("lists each dial-in number, with its country and PIN where it has them", () => {
    card({
      dialIn: [
        { country: "US", number: "+1 646 558 8656", pin: null },
        { country: null, number: "+44 203 481 5240", pin: "5551" },
      ],
    });

    expect(screen.getByText(/\+1 646 558 8656/)).toBeTruthy();
    expect(screen.getByText(/US/)).toBeTruthy();
    const second = screen.getByText(/\+44 203 481 5240/);
    expect(second.textContent).toContain("5551");
  });

  it("shows no dial-in row for a meeting without numbers", () => {
    card({ dialIn: [] });

    expect(screen.queryByText("Dial in")).toBeNull();
  });
});

describe("MeetingJoinCard: the host's link", () => {
  it("renders Start as host only when there is a host link", () => {
    const { unmount } = card({ hostUrl: null });
    expect(screen.queryByRole("link", { name: /start as host/i })).toBeNull();
    unmount();

    card({ hostUrl: HOST, canEdit: true });
    const start = screen.getByRole("link", { name: /start as host/i });
    expect(start.getAttribute("href")).toBe(HOST);
    expect(start.getAttribute("target")).toBe("_blank");
    expect(start.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("never prints the host link as text", () => {
    card({ hostUrl: HOST, canEdit: true });

    expect(screen.queryByText(HOST)).toBeNull();
    expect(screen.queryByText(/zak=host/)).toBeNull();
  });
});

describe("MeetingJoinCard: while the link is on its way", () => {
  it("says so, and offers nothing to retry", () => {
    card({
      joinUrl: null,
      canEdit: true,
      status: { kind: "pending", line: "Getting the Zoom link…" },
    });

    expect(screen.getByText("Getting the Zoom link…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("MeetingJoinCard: picking up the link once it is made", () => {
  const PENDING: ConferenceStatus = { kind: "pending", line: "Getting the Zoom link…" };

  function props(status: ConferenceStatus, joinUrl: string | null = null): Props {
    return {
      orgId: "org_1",
      eventId: "evt_1",
      providerLabel: "Zoom",
      joinUrl,
      hostUrl: null,
      passcode: null,
      dialIn: [],
      status,
      canEdit: true,
    };
  }

  it("asks the page again every couple of seconds while the link is on its way", () => {
    vi.useFakeTimers();
    card({ joinUrl: null, status: PENDING });

    expect(PENDING_REFRESH_MS).toBe(2_500);
    vi.advanceTimersByTime(PENDING_REFRESH_MS - 1);
    expect(mocks.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PENDING_REFRESH_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("gives up after half a minute, when the job is plainly taking longer", () => {
    vi.useFakeTimers();
    card({ joinUrl: null, status: PENDING });

    expect(PENDING_REFRESH_FOR_MS).toBe(30_000);
    vi.advanceTimersByTime(PENDING_REFRESH_FOR_MS);
    const asked = mocks.refresh.mock.calls.length;
    expect(asked).toBe(PENDING_REFRESH_FOR_MS / PENDING_REFRESH_MS);

    vi.advanceTimersByTime(5 * 60_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(asked);
  });

  it("stops once the link has arrived", () => {
    vi.useFakeTimers();
    const view = render(<MeetingJoinCard {...props(PENDING)} />);
    vi.advanceTimersByTime(PENDING_REFRESH_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    // The refresh brought the link: the page renders the card as ready.
    view.rerender(<MeetingJoinCard {...props({ kind: "ready" }, JOIN)} />);
    vi.advanceTimersByTime(PENDING_REFRESH_FOR_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps counting the same half minute across refreshes that find it still pending", () => {
    vi.useFakeTimers();
    const view = render(<MeetingJoinCard {...props(PENDING)} />);
    vi.advanceTimersByTime(PENDING_REFRESH_FOR_MS / 2);
    view.rerender(<MeetingJoinCard {...props({ ...PENDING })} />);
    vi.advanceTimersByTime(PENDING_REFRESH_FOR_MS);

    expect(mocks.refresh).toHaveBeenCalledTimes(PENDING_REFRESH_FOR_MS / PENDING_REFRESH_MS);
  });

  it("stops when the card goes away", () => {
    vi.useFakeTimers();
    const view = render(<MeetingJoinCard {...props(PENDING)} />);
    view.unmount();

    vi.advanceTimersByTime(PENDING_REFRESH_FOR_MS);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each<[string, ConferenceStatus]>([
    ["ready", { kind: "ready" }],
    ["failed", FAILED],
    ["none", { kind: "none" }],
  ])("does not ask while the link is %s", (_name, status) => {
    vi.useFakeTimers();
    card({ status });

    vi.advanceTimersByTime(PENDING_REFRESH_FOR_MS);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("MeetingJoinCard: when making the meeting failed", () => {
  it("shows the line and the reason, with Try again for someone who can edit", () => {
    card({ joinUrl: null, status: FAILED, canEdit: true });

    expect(screen.getByText("Couldn't make the Zoom meeting.")).toBeTruthy();
    expect(screen.getByText("Zoom needs to be reconnected from Meetings.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows no Try again to someone who cannot edit", () => {
    card({ joinUrl: null, status: { ...FAILED, reason: null }, canEdit: false });

    expect(screen.getByText("Couldn't make the Zoom meeting.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("still shows the old link a failed update left behind", () => {
    card({ status: FAILED, canEdit: true });

    expect(screen.getByRole("link", { name: /join meeting/i }).getAttribute("href")).toBe(JOIN);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("asks for the retry and refreshes the page to show it queued", async () => {
    mocks.retry.mockResolvedValue({});
    card({ joinUrl: null, status: FAILED, canEdit: true });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("org_1", "evt_1"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("shows why a retry was refused, and does not refresh", async () => {
    mocks.retry.mockResolvedValue({ error: "This meeting has no video call to make." });
    card({ joinUrl: null, status: FAILED, canEdit: true });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This meeting has no video call to make.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
