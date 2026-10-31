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
  updateEvent: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  formProps: {
    current: null as null | {
      open?: boolean;
      event?: { id: string } | null;
      onDeleted?: () => void;
      defaultReminderMinutes?: number[];
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/app/app/[orgSlug]/calendar/actions", () => ({
  deleteEvent: mocks.deleteEvent,
  updateEvent: mocks.updateEvent,
  extendSeries: vi.fn(async () => ({ added: 4 })),
  rsvpToEvent: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/notes/actions", () => ({ createNote: vi.fn() }));
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => [null, mocks.confirm],
}));
vi.mock("@/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("./event-form-dialog", () => ({
  EventFormDialog: (props: {
    open?: boolean;
    event?: { id: string } | null;
    onDeleted?: () => void;
    defaultReminderMinutes?: number[];
  }) => {
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
    locationDetails: null,
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
    reminderMinutes: [1440, 60],
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
  mocks.updateEvent.mockReset();
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
    expect(screen.getByRole("link", { name: /apple \/ outlook/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^google calendar$/i })).toBeTruthy();
  });

  it("shows the place as plain text, with no map link or directions", () => {
    view({}, { location: "Curry 342" });

    expect(screen.getByText("Curry 342")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /open in maps/i })).toBeNull();
    expect(screen.queryByText("How to find it")).toBeNull();
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
    expect(screen.getByRole("link", { name: /apple \/ outlook/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^google calendar$/i })).toBeTruthy();
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

  it("offers the meeting's sign-up screen as 'Add a sign-up page' on the Calendar too", () => {
    view({ canEdit: true, section: "calendar" });

    const set = screen.getByRole("link", { name: /Add a sign-up page/ });
    expect(set.getAttribute("href")).toBe("/app/club/meetings/evt_1/rsvp");
  });

  it("calls it 'Add a sign-up page' under Meetings, to the same screen", () => {
    view({ canEdit: true, section: "meetings" });

    const set = screen.getByRole("link", { name: /Add a sign-up page/ });
    expect(set.getAttribute("href")).toBe("/app/club/meetings/evt_1/rsvp");
  });

  it("keeps 'Guests and page' for a page that is already on, in both sections", () => {
    view({
      canEdit: true,
      section: "meetings",
      rsvp: { ...live, capacity: null },
    });

    expect(screen.getByRole("link", { name: /Guests and page/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Add a sign-up page/ })).toBeNull();
  });

  it.each(sections)("sends the guest-list button to the meeting's sign-ups (%s)", (section) => {
    view({ canEdit: true, section, rsvp: { ...live, capacity: null } });

    const manage = screen.getByRole("link", { name: /Guests and page/ });
    expect(manage.getAttribute("href")).toBe("/app/club/meetings/evt_1/rsvp");
  });

  it.each(sections)("sends the capacity tile to the meeting's sign-ups (%s)", (section) => {
    view({ canEdit: true, section, rsvp: { ...live, capacity: 10 } });

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/app/club/meetings/evt_1/rsvp");
    expect(hrefs.some((h) => h?.includes("/calendar/evt_1/rsvp"))).toBe(false);
  });
});

describe("EventDetailView: a meeting's reminders", () => {
  it("lists them, latest first, to someone who can't change them", () => {
    view({ section: "meetings" }, { reminderMinutes: [1440, 60] });

    expect(screen.getByText("Reminders")).toBeTruthy();
    expect(screen.getByText("1 day before, 1 hour before")).toBeTruthy();
  });

  it("says so when there are none", () => {
    view({ section: "meetings" }, { reminderMinutes: [] });

    expect(screen.getByText("No reminders")).toBeTruthy();
  });

  it("is not on the Calendar's page", () => {
    view({ canEdit: true }, { reminderMinutes: [1440, 60] });

    expect(screen.queryByText("Reminders")).toBeNull();
  });

  it("shows an editor the chips, chosen as the meeting has them", () => {
    view({ section: "meetings", canEdit: true }, { reminderMinutes: [1440, 45] });

    expect(screen.getByRole("button", { name: "1 day before" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: "45 minutes before" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "1 hour before" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves each tap for this meeting alone, then refreshes", async () => {
    mocks.updateEvent.mockResolvedValue({ eventId: "evt_1" });
    view({ section: "meetings", canEdit: true }, { reminderMinutes: [1440, 60] });

    fireEvent.click(screen.getByRole("button", { name: "1 hour before" }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.updateEvent).toHaveBeenCalledExactlyOnceWith("org_1", "evt_1", {
      reminderMinutes: [1440],
    });
  });

  it("puts the chip back and says why when saving fails", async () => {
    mocks.updateEvent.mockResolvedValue({ error: "Use at most 8 reminders." });
    view({ section: "meetings", canEdit: true }, { reminderMinutes: [1440, 60] });

    fireEvent.click(screen.getByRole("button", { name: "1 week before" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Use at most 8 reminders.");
    expect(screen.getByRole("button", { name: "1 week before" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("passes the organization's default to the edit form", () => {
    view({ section: "meetings", canEdit: true, defaultReminderMinutes: [120] });

    expect(mocks.formProps.current?.defaultReminderMinutes).toEqual([120]);
  });
});

describe("EventDetailView: adding a call to an in-person meeting", () => {
  const NO_CALL = { conferenceProvider: "NONE", conferenceUrl: null } as const;
  const addCall = () => screen.queryByRole("button", { name: "Add a video call" });

  it("offers an editor of a meeting with no call a way to add one", () => {
    view({ section: "meetings", canEdit: true }, NO_CALL);

    expect(addCall()).toBeTruthy();
  });

  it("opens the edit form, which asks for the call", () => {
    view({ section: "meetings", canEdit: true }, NO_CALL);
    expect(mocks.formProps.current?.open).toBe(false);

    fireEvent.click(addCall()!);

    expect(mocks.formProps.current?.open).toBe(true);
    expect(mocks.formProps.current?.event?.id).toBe("evt_1");
  });

  it("is the same form 'Edit event' opens", () => {
    view({ section: "meetings", canEdit: true }, NO_CALL);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(mocks.formProps.current?.open).toBe(true);
    expect(mocks.formProps.current?.event?.id).toBe("evt_1");
  });

  it("is not offered to someone who cannot edit the meeting", () => {
    view({ section: "meetings", canEdit: false }, NO_CALL);

    expect(addCall()).toBeNull();
  });

  it("is not on the Calendar's page", () => {
    view({ section: "calendar", canEdit: true }, NO_CALL);

    expect(addCall()).toBeNull();
  });

  it("is not offered once the meeting has a call, even one whose link is still on its way", () => {
    view(
      {
        section: "meetings",
        canEdit: true,
        joinCard: <div data-testid="join-card">the join card</div>,
      },
      { conferenceProvider: "ZOOM", conferenceUrl: null },
    );

    expect(screen.getByTestId("join-card")).toBeTruthy();
    expect(addCall()).toBeNull();
  });

  it("is not offered beside a call that has a link", () => {
    view({ section: "meetings", canEdit: true });

    expect(addCall()).toBeNull();
  });
});
