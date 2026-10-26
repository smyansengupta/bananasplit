import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventDetail } from "./event-detail-view";

/**
 * The event page serves two sections: the Calendar, and a meeting's own page
 * under Meetings (docs/features/meetings.md). The new props are optional, so
 * the Calendar's page stays exactly as it was.
 */

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  deleteEvent: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  formProps: { current: null as null | { onDeleted?: () => void } },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/app/app/[orgSlug]/calendar/actions", () => ({
  deleteEvent: mocks.deleteEvent,
  rsvpToEvent: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/notes/actions", () => ({ createNote: vi.fn() }));
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => [null, mocks.confirm],
}));
vi.mock("@/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("./event-form-dialog", () => ({
  EventFormDialog: (props: { onDeleted?: () => void }) => {
    mocks.formProps.current = props;
    return null;
  },
}));

const { EventDetailView } = await import("./event-detail-view");

const JOIN = "https://us02web.zoom.us/j/98765432100";

function event(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "evt_1",
    title: "Exec sync",
    description: "Weekly catch-up.",
    startsAt: new Date("2026-11-02T22:00:00Z"),
    endsAt: new Date("2026-11-02T23:00:00Z"),
    allDay: false,
    location: null,
    conferenceProvider: "ZOOM",
    conferenceUrl: JOIN,
    kind: "BOARD_MEETING",
    visibility: "INTERNAL",
    hostUserId: null,
    hostName: null,
    rsvpUrl: null,
    capacityFull: false,
    featured: false,
    publicNote: null,
    stampSlot: null,
    attendeeIds: [],
    needsReview: false,
    googleSyncState: "NOT_APPLICABLE",
    googleHtmlLink: null,
    googleSyncError: null,
    host: null,
    attendees: [],
    notes: [],
    ...overrides,
  };
}

type Props = Parameters<typeof EventDetailView>[0];

function view(overrides: Partial<Props> = {}, eventOverrides: Partial<EventDetail> = {}) {
  const props: Props = {
    orgId: "org_1",
    orgSlug: "club",
    timeZone: "America/New_York",
    event: event(eventOverrides),
    members: [],
    rsvp: { enabled: false, url: null, going: 0, waitlist: 0, capacity: null },
    currentUserId: "user_1",
    canEdit: false,
    ...overrides,
  };
  return render(<EventDetailView {...props} />);
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.deleteEvent.mockReset();
  mocks.confirm.mockReset();
  mocks.toast.mockReset();
  mocks.formProps.current = null;
});
afterEach(() => cleanup());

describe("EventDetailView: the Calendar's page, unchanged", () => {
  it("goes back to the Calendar", () => {
    view();

    const back = screen.getByRole("link", { name: "Calendar" });
    expect(back.getAttribute("href")).toBe("/app/club/calendar");
  });

  it("keeps the plain Join meeting button", () => {
    view();

    expect(screen.getByRole("link", { name: /join meeting/i }).getAttribute("href")).toBe(JOIN);
    expect(screen.getByRole("link", { name: /download \.ics/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /add to google calendar/i })).toBeTruthy();
  });

  it("shows the place as plain text, with no map link or directions", () => {
    view({}, { location: "Curry 342" });

    expect(screen.getByText("Curry 342")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /open in maps/i })).toBeNull();
    expect(screen.queryByText("How to find it")).toBeNull();
  });

  it("sends Delete back to the Calendar", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.deleteEvent.mockResolvedValue({});
    view({ canEdit: true });

    fireEvent.click(screen.getByRole("button", { name: /delete event/i }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/app/club/calendar"));
  });

  it("sends a delete from the edit form back to the Calendar", () => {
    view({ canEdit: true });

    mocks.formProps.current?.onDeleted?.();

    expect(mocks.push).toHaveBeenCalledWith("/app/club/calendar");
  });
});

describe("EventDetailView: a meeting's page", () => {
  it("goes back to Meetings", () => {
    view({ section: "meetings" });

    expect(screen.getByRole("link", { name: "Meetings" }).getAttribute("href")).toBe(
      "/app/club/meetings",
    );
    expect(screen.queryByRole("link", { name: "Calendar" })).toBeNull();
  });

  it("sends Delete back to Meetings", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.deleteEvent.mockResolvedValue({});
    view({ canEdit: true, section: "meetings" });

    fireEvent.click(screen.getByRole("button", { name: /delete event/i }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/app/club/meetings"));
    expect(mocks.push).not.toHaveBeenCalledWith("/app/club/calendar");
  });

  it("sends a delete from the edit form back to Meetings", () => {
    view({ canEdit: true, section: "meetings" });

    mocks.formProps.current?.onDeleted?.();

    expect(mocks.push).toHaveBeenCalledWith("/app/club/meetings");
  });

  it("shows the join card in place of the plain Join meeting button", () => {
    view({ section: "meetings", joinCard: <div data-testid="join-card">the join card</div> });

    expect(screen.getByTestId("join-card")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /join meeting/i })).toBeNull();
    // The calendar buttons beside it stay.
    expect(screen.getByRole("link", { name: /download \.ics/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /add to google calendar/i })).toBeTruthy();
  });

  it("shows the join card even before there is a link to join", () => {
    view({ joinCard: <div data-testid="join-card">the join card</div> }, { conferenceUrl: null });

    expect(screen.getByTestId("join-card")).toBeTruthy();
  });

  it("shows directions and a map link under the place", () => {
    view(
      {
        section: "meetings",
        locationDetails: "Second floor, past the elevators.",
        showMapLink: true,
      },
      { location: "Curry Student Center & Annex" },
    );

    expect(screen.getByText("Curry Student Center & Annex")).toBeTruthy();
    expect(screen.getByText("How to find it")).toBeTruthy();
    expect(screen.getByText("Second floor, past the elevators.")).toBeTruthy();
    const maps = screen.getByRole("link", { name: /open in maps/i });
    expect(maps.getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Curry%20Student%20Center%20%26%20Annex",
    );
    expect(maps.getAttribute("target")).toBe("_blank");
    expect(maps.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows the map link without directions, and directions without the map link", () => {
    const { unmount } = view({ showMapLink: true }, { location: "Curry 342" });
    expect(screen.getByRole("link", { name: /open in maps/i })).toBeTruthy();
    expect(screen.queryByText("How to find it")).toBeNull();
    unmount();

    view({ locationDetails: "Ring the bell." }, { location: "Curry 342" });
    expect(screen.getByText("Ring the bell.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /open in maps/i })).toBeNull();
  });

  it("shows neither without a place", () => {
    view({ showMapLink: true, locationDetails: "Ring the bell." }, { location: null });

    expect(screen.queryByRole("link", { name: /open in maps/i })).toBeNull();
    expect(screen.queryByText("How to find it")).toBeNull();
    expect(screen.queryByText("Where")).toBeNull();
  });
});

describe("EventDetailView: managing sign-ups", () => {
  // Sign-up management lives under Meetings only, whichever section shows the event.
  const sections = ["calendar", "meetings"] as const;
  const live = { enabled: true, url: "https://app.test/e/abc12345", going: 3, waitlist: 1 };

  it.each(sections)("offers the meeting's sign-up screen to set up a page (%s)", (section) => {
    view({ canEdit: true, section });

    const set = screen.getByRole("link", { name: /Set up an RSVP page/ });
    expect(set.getAttribute("href")).toBe("/app/club/meetings/evt_1/rsvp");
  });

  it.each(sections)("sends the guest-list button to the meeting's sign-ups (%s)", (section) => {
    view({ canEdit: true, section, rsvp: { ...live, capacity: null } });

    const manage = screen.getByRole("link", { name: /Manage guests and page/ });
    expect(manage.getAttribute("href")).toBe("/app/club/meetings/evt_1/rsvp");
  });

  it.each(sections)("sends the capacity tile to the meeting's sign-ups (%s)", (section) => {
    view({ canEdit: true, section, rsvp: { ...live, capacity: 10 } });

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/app/club/meetings/evt_1/rsvp");
    expect(hrefs.some((h) => h?.includes("/calendar/evt_1/rsvp"))).toBe(false);
  });
});
