import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventFormEvent } from "./event-form-dialog";

/**
 * The event form (docs/features/meetings.md): the shape a new meeting starts
 * as and what Save sends for it, then the reminders (where they start, when the
 * disclosure they sit in opens by itself, and what Save sends). What the form
 * leans on is stubbed.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  turnOnRsvpPage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
  useParams: () => ({ orgSlug: "acme" }),
}));
vi.mock("@/app/app/[orgSlug]/calendar/actions", () => ({
  createEvent: mocks.createEvent,
  updateEvent: mocks.updateEvent,
  deleteEvent: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions", () => ({
  turnOnRsvpPage: mocks.turnOnRsvpPage,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => [null, vi.fn()] }));
// The real picker reads the organization's connections; this one only reports what was chosen.
vi.mock("@/components/meetings/conference-picker", () => ({
  ConferencePicker: (props: {
    onProviderChange: (provider: string) => void;
    onUrlChange: (url: string) => void;
  }) => (
    <div data-testid="conference-picker">
      <button type="button" onClick={() => props.onProviderChange("ZOOM")}>
        Use Zoom
      </button>
      <button
        type="button"
        onClick={() => {
          props.onProviderChange("OTHER");
          props.onUrlChange("https://zoom.us/j/123");
        }}
      >
        Paste a link
      </button>
    </div>
  ),
}));
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
    locationDetails: null,
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
const shape = (name: string) => screen.getByRole("radio", { name });
/** Which of Online, In person and Event is chosen, in that order. */
const chosen = () =>
  ["Online", "In person", "Event"].map(
    (name) => shape(name).getAttribute("aria-checked") === "true",
  );
const picker = () => screen.queryByTestId("conference-picker");
const typeTitle = (value: string) =>
  fireEvent.change(screen.getByLabelText("Title"), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Create event" }));

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.push.mockReset();
  mocks.createEvent.mockReset();
  mocks.updateEvent.mockReset();
  mocks.turnOnRsvpPage.mockReset();
});
afterEach(() => cleanup());

describe("EventFormDialog: the shape of a new meeting", () => {
  it("opens with the three shapes, In person chosen by default", () => {
    open();

    expect(screen.getByRole("radiogroup", { name: "Kind of meeting" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(chosen()).toEqual([false, true, false]);
    expect(screen.getByText("A Google Meet, Zoom or Teams call")).toBeTruthy();
    expect(screen.getByText("A room or an address")).toBeTruthy();
    expect(screen.getByText("Either of those, with a public sign-up page")).toBeTruthy();
  });

  it("is the first thing in the form, ahead of the title", () => {
    open();

    const group = screen.getByRole("radiogroup", { name: "Kind of meeting" });
    const follows = group.compareDocumentPosition(screen.getByLabelText("Title"));
    expect(follows & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still opens on the title, so a title and Enter save", () => {
    open();

    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
  });

  it("Event is chosen when defaultRsvpPage is set", () => {
    open({ defaultRsvpPage: true });

    expect(chosen()).toEqual([false, false, true]);
  });

  it("starts as the shape it is told to, over defaultRsvpPage", () => {
    open({ defaultShape: "online", defaultRsvpPage: true });

    expect(chosen()).toEqual([true, false, false]);
  });

  it("chooses a shape with a click", () => {
    open();

    fireEvent.click(shape("Online"));

    expect(chosen()).toEqual([true, false, false]);
  });

  it("moves the choice with the arrow keys, like a radio group, and tabs to the chosen one only", () => {
    open();
    expect(shape("In person").tabIndex).toBe(0);
    expect(shape("Online").tabIndex).toBe(-1);
    expect(shape("Event").tabIndex).toBe(-1);

    fireEvent.keyDown(shape("In person"), { key: "ArrowRight" });
    expect(chosen()).toEqual([false, false, true]);
    expect(document.activeElement).toBe(shape("Event"));
    expect(shape("Event").tabIndex).toBe(0);

    fireEvent.keyDown(shape("Event"), { key: "ArrowDown" });
    expect(chosen()).toEqual([true, false, false]);

    fireEvent.keyDown(shape("Online"), { key: "ArrowLeft" });
    expect(chosen()).toEqual([false, false, true]);

    fireEvent.keyDown(shape("Event"), { key: "ArrowUp" });
    expect(chosen()).toEqual([false, true, false]);
    expect(document.activeElement).toBe(shape("In person"));
  });

  it("leaves other keys alone", () => {
    open();

    fireEvent.keyDown(shape("In person"), { key: "a" });

    expect(chosen()).toEqual([false, true, false]);
  });

  describe("Online", () => {
    it("Online hides Location and shows the video-call picker", () => {
      open({ defaultShape: "online" });

      expect(screen.queryByLabelText(/Location/)).toBeNull();
      expect(screen.queryByLabelText("How to find it")).toBeNull();
      expect(picker()).toBeTruthy();
    });

    it("saves the provider it was given, and no place", async () => {
      mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
      open({ defaultShape: "online" });

      typeTitle("Standup");
      fireEvent.click(screen.getByRole("button", { name: "Paste a link" }));
      save();

      await waitFor(() => expect(mocks.createEvent).toHaveBeenCalled());
      expect(mocks.createEvent.mock.calls[0]![1]).toMatchObject({
        conferenceProvider: "OTHER",
        conferenceUrl: "https://zoom.us/j/123",
        location: null,
        locationDetails: null,
      });
      expect(mocks.turnOnRsvpPage).not.toHaveBeenCalled();
    });
  });

  describe("In person", () => {
    it("In person hides the video-call picker and shows Location and How to find it", () => {
      open();

      expect(picker()).toBeNull();
      expect(screen.getByLabelText("Location")).toBeTruthy();
      const directions = screen.getByLabelText("How to find it");
      expect(directions.tagName).toBe("TEXTAREA");
      expect(directions.getAttribute("maxlength")).toBe("1000");
    });

    it("saves the place and how to find it, and no call", async () => {
      mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
      open();

      typeTitle("Workshop");
      fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Curry 344" } });
      fireEvent.change(screen.getByLabelText("How to find it"), {
        target: { value: "Second floor, past the elevators." },
      });
      save();

      await waitFor(() => expect(mocks.createEvent).toHaveBeenCalled());
      expect(mocks.createEvent.mock.calls[0]![1]).toMatchObject({
        location: "Curry 344",
        locationDetails: "Second floor, past the elevators.",
        conferenceProvider: "NONE",
        conferenceUrl: null,
      });
      expect(mocks.turnOnRsvpPage).not.toHaveBeenCalled();
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  describe("switching shapes", () => {
    it("switching from Online to In person saves no provider", async () => {
      mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
      open({ defaultShape: "online" });

      typeTitle("Standup");
      fireEvent.click(screen.getByRole("button", { name: "Paste a link" }));
      fireEvent.click(shape("In person"));
      save();

      await waitFor(() => expect(mocks.createEvent).toHaveBeenCalled());
      expect(mocks.createEvent.mock.calls[0]![1]).toMatchObject({
        conferenceProvider: "NONE",
        conferenceUrl: null,
      });
    });

    it("switching from In person to Online saves no location", async () => {
      mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
      open();

      typeTitle("Standup");
      fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Curry 344" } });
      fireEvent.change(screen.getByLabelText("How to find it"), {
        target: { value: "Second floor." },
      });
      fireEvent.click(shape("Online"));
      save();

      await waitFor(() => expect(mocks.createEvent).toHaveBeenCalled());
      expect(mocks.createEvent.mock.calls[0]![1]).toMatchObject({
        location: null,
        locationDetails: null,
      });
    });

    it("carries only the last shape's fields after several switches", async () => {
      mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
      open({ defaultShape: "online" });

      typeTitle("Standup");
      fireEvent.click(screen.getByRole("button", { name: "Use Zoom" }));
      fireEvent.click(shape("In person"));
      fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Curry 344" } });
      fireEvent.click(shape("Online"));
      fireEvent.click(shape("In person"));
      save();

      await waitFor(() => expect(mocks.createEvent).toHaveBeenCalled());
      expect(mocks.createEvent.mock.calls[0]![1]).toMatchObject({
        location: "Curry 344",
        conferenceProvider: "NONE",
        conferenceUrl: null,
      });
    });

    it("keeps what was typed when you come back to the shape", () => {
      open();

      fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Curry 344" } });
      fireEvent.click(shape("Online"));
      expect(screen.queryByLabelText("Location")).toBeNull();
      fireEvent.click(shape("In person"));

      expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("Curry 344");
    });
  });

  describe("Event", () => {
    it("shows the place, how to find it and the video-call picker", () => {
      open({ defaultShape: "event" });

      expect(screen.getByLabelText("Location")).toBeTruthy();
      expect(screen.getByLabelText("How to find it")).toBeTruthy();
      expect(picker()).toBeTruthy();
    });

    it("has no switch of its own for the sign-up page", () => {
      open({ defaultShape: "event" });

      expect(screen.queryByText("Take RSVPs with a public page")).toBeNull();
      expect(screen.queryByRole("switch", { name: /RSVP/ })).toBeNull();
    });

    it("saves both halves", async () => {
      mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
      mocks.turnOnRsvpPage.mockResolvedValue({});
      open({ defaultShape: "event" });

      typeTitle("Open house");
      fireEvent.change(screen.getByLabelText(/Location/), { target: { value: "Curry 344" } });
      fireEvent.change(screen.getByLabelText("How to find it"), { target: { value: "Ring." } });
      fireEvent.click(screen.getByRole("button", { name: "Use Zoom" }));
      save();

      await waitFor(() => expect(mocks.createEvent).toHaveBeenCalled());
      expect(mocks.createEvent.mock.calls[0]![1]).toMatchObject({
        location: "Curry 344",
        locationDetails: "Ring.",
        conferenceProvider: "ZOOM",
      });
    });

    it("Event saves, turns the sign-up page on and continues to its settings", async () => {
      mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
      mocks.turnOnRsvpPage.mockResolvedValue({});
      open({ defaultShape: "event" });

      typeTitle("Open house");
      save();

      await waitFor(() => expect(mocks.push).toHaveBeenCalled());
      expect(mocks.turnOnRsvpPage).toHaveBeenCalledExactlyOnceWith("org_1", "evt_new");
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/app/acme/meetings/evt_new/rsvp?new=1");
    });

    it("continues to the settings without the new-page banner when the page would not turn on", async () => {
      mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
      mocks.turnOnRsvpPage.mockResolvedValue({ error: "Try again." });
      open({ defaultShape: "event" });

      typeTitle("Open house");
      save();

      await waitFor(() => expect(mocks.push).toHaveBeenCalled());
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/app/acme/meetings/evt_new/rsvp");
    });

    it("does not turn the page on when the meeting was not saved", async () => {
      mocks.createEvent.mockResolvedValue({ error: "That did not save." });
      open({ defaultShape: "event" });

      typeTitle("Open house");
      save();

      expect(await screen.findByText("That did not save.")).toBeTruthy();
      expect(mocks.turnOnRsvpPage).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it("does not turn the page on when another shape is picked before saving", async () => {
      mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
      open({ defaultShape: "event" });

      typeTitle("Open house");
      fireEvent.click(shape("In person"));
      save();

      await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
      expect(mocks.turnOnRsvpPage).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
    });
  });

  describe("editing", () => {
    it("edit mode has no shape choice and shows both halves", () => {
      open({
        event: event({
          location: "Curry 344",
          locationDetails: "Second floor.",
          conferenceProvider: "ZOOM",
        }),
      });

      expect(screen.queryByRole("radiogroup")).toBeNull();
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
      expect((screen.getByLabelText(/^Location/) as HTMLInputElement).value).toBe("Curry 344");
      expect((screen.getByLabelText("How to find it") as HTMLTextAreaElement).value).toBe(
        "Second floor.",
      );
      expect(picker()).toBeTruthy();
    });

    it("shows both halves for a meeting that has neither a place nor a call", () => {
      open({ event: event() });

      expect(screen.getByLabelText("Location")).toBeTruthy();
      expect(screen.getByLabelText("How to find it")).toBeTruthy();
      expect(picker()).toBeTruthy();
    });

    it("never turns a sign-up page on", async () => {
      mocks.updateEvent.mockResolvedValue({ eventId: "evt_1" });
      open({ event: event() });

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mocks.updateEvent).toHaveBeenCalled());
      expect(mocks.turnOnRsvpPage).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it("adds a call to an in-person meeting, and keeps its place", async () => {
      mocks.updateEvent.mockResolvedValue({ eventId: "evt_1" });
      open({ event: event({ location: "Curry 344", locationDetails: "Second floor." }) });

      fireEvent.click(screen.getByRole("button", { name: "Use Zoom" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mocks.updateEvent).toHaveBeenCalled());
      expect(mocks.updateEvent.mock.calls[0]![2]).toMatchObject({
        location: "Curry 344",
        locationDetails: "Second floor.",
        conferenceProvider: "ZOOM",
      });
    });

    it("saves how to find it as typed, and none when it is cleared", async () => {
      mocks.updateEvent.mockResolvedValue({ eventId: "evt_1" });
      open({ event: event({ location: "Curry 344", locationDetails: "Second floor." }) });

      fireEvent.change(screen.getByLabelText("How to find it"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mocks.updateEvent).toHaveBeenCalled());
      expect(mocks.updateEvent.mock.calls[0]![2]).toMatchObject({ locationDetails: null });
    });
  });
});

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
