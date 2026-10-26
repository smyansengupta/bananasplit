import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventFormEvent } from "./event-form-dialog";

/**
 * The event form's reminders (docs/features/meetings.md): where they start, when
 * the disclosure they sit in opens by itself, and what Save sends. The rest of
 * the form is not under test here, so what it leans on is stubbed.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
  useParams: () => ({ orgSlug: "club" }),
}));
vi.mock("@/app/app/[orgSlug]/calendar/actions", () => ({
  createEvent: mocks.createEvent,
  updateEvent: mocks.updateEvent,
  deleteEvent: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions", () => ({ turnOnRsvpPage: vi.fn() }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => [null, vi.fn()] }));
vi.mock("@/components/meetings/conference-picker", () => ({ ConferencePicker: () => null }));
vi.mock("./member-picker", () => ({ MemberMultiPicker: () => null }));

// The dialog's selects measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { EventFormDialog } = await import("./event-form-dialog");

function event(overrides: Partial<EventFormEvent> = {}): EventFormEvent {
  return {
    id: "evt_1",
    title: "Exec sync",
    description: null,
    startsAt: new Date("2026-11-02T22:00:00Z"),
    endsAt: new Date("2026-11-02T23:00:00Z"),
    allDay: false,
    location: null,
    conferenceProvider: "NONE",
    conferenceUrl: null,
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
    ...overrides,
  };
}

function open(props: Partial<Parameters<typeof EventFormDialog>[0]> = {}) {
  return render(
    <EventFormDialog
      orgId="org_1"
      timeZone="America/New_York"
      open
      onOpenChange={vi.fn()}
      event={null}
      members={[]}
      {...props}
    />,
  );
}

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed") === "true";
const moreDetails = () => screen.getByRole("button", { name: /More details|Fewer details/ });

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.push.mockReset();
  mocks.createEvent.mockReset();
  mocks.updateEvent.mockReset();
});
afterEach(() => cleanup());

describe("EventFormDialog: reminders", () => {
  it("names them in the disclosure's summary", () => {
    open();

    expect(screen.getByText("host, RSVP link, invites, description, reminders")).toBeTruthy();
  });

  it("keeps the reminders behind More details for a new event", () => {
    open();

    expect(screen.queryByRole("group", { name: "Reminders" })).toBeNull();
    fireEvent.click(moreDetails());
    expect(screen.getByRole("group", { name: "Reminders" })).toBeTruthy();
  });

  it("starts a new event from the organization's reminders", () => {
    open({ defaultReminderMinutes: [10080, 30] });
    fireEvent.click(moreDetails());

    expect(pressed("1 week before")).toBe(true);
    expect(pressed("30 minutes before")).toBe(true);
    expect(pressed("1 day before")).toBe(false);
    expect(pressed("1 hour before")).toBe(false);
  });

  it("starts a new event from a day's notice and an hour's when it is not told", () => {
    open();
    fireEvent.click(moreDetails());

    expect(pressed("1 day before")).toBe(true);
    expect(pressed("1 hour before")).toBe(true);
    expect(pressed("1 week before")).toBe(false);
  });

  it("starts an existing event from its own, not the organization's", () => {
    open({
      event: event({ reminderMinutes: [120] }),
      defaultReminderMinutes: [1440, 60],
    });

    expect(pressed("2 hours before")).toBe(true);
    expect(pressed("1 day before")).toBe(false);
  });

  it("opens the disclosure for an event whose reminders are not the organization's", () => {
    open({ event: event({ reminderMinutes: [120] }), defaultReminderMinutes: [1440, 60] });

    expect(moreDetails().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Reminders" })).toBeTruthy();
  });

  it("opens it for an event with no reminders when the organization has some", () => {
    open({ event: event({ reminderMinutes: [] }), defaultReminderMinutes: [1440, 60] });

    expect(moreDetails().getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves it closed for an event that has the organization's reminders, in any order", () => {
    open({ event: event({ reminderMinutes: [60, 1440] }), defaultReminderMinutes: [1440, 60] });

    expect(moreDetails().getAttribute("aria-expanded")).toBe("false");
  });

  it("compares with a day's notice and an hour's when it is not told the organization's", () => {
    open({ event: event({ reminderMinutes: [1440, 60] }) });
    expect(moreDetails().getAttribute("aria-expanded")).toBe("false");

    cleanup();
    open({ event: event({ reminderMinutes: [1440] }) });
    expect(moreDetails().getAttribute("aria-expanded")).toBe("true");
  });

  it("sends the chosen reminders when a new event is created", async () => {
    mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
    open({ defaultReminderMinutes: [1440, 60] });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Workshop" } });
    fireEvent.click(moreDetails());
    fireEvent.click(screen.getByRole("button", { name: "1 week before" }));
    fireEvent.click(screen.getByRole("button", { name: "1 hour before" }));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mocks.createEvent).toHaveBeenCalled());
    expect(mocks.createEvent.mock.calls[0]![0]).toBe("org_1");
    expect(mocks.createEvent.mock.calls[0]![1]).toMatchObject({
      reminderMinutes: [10080, 1440],
    });
  });

  it("sends the organization's own reminders untouched when nothing was changed", async () => {
    mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
    open({ defaultReminderMinutes: [120, 10] });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Workshop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mocks.createEvent).toHaveBeenCalled());
    expect(mocks.createEvent.mock.calls[0]![1]).toMatchObject({ reminderMinutes: [120, 10] });
  });

  it("sends an edited event's reminders, including none at all", async () => {
    mocks.updateEvent.mockResolvedValue({ eventId: "evt_1" });
    open({ event: event({ reminderMinutes: [60] }), defaultReminderMinutes: [1440, 60] });

    fireEvent.click(screen.getByRole("button", { name: "1 hour before" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updateEvent).toHaveBeenCalled());
    expect(mocks.updateEvent.mock.calls[0]!.slice(0, 2)).toEqual(["org_1", "evt_1"]);
    expect(mocks.updateEvent.mock.calls[0]![2]).toMatchObject({ reminderMinutes: [] });
  });
});
