import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarMember } from "@/components/calendar/member-picker";

/**
 * New meeting, on the Meetings page and wherever else a link asks for it
 * (docs/features/meetings.md): the same create form the Calendar has, opened
 * in place, and a create that lands on the meeting's own page. The form is
 * the real one; what it leans on is stubbed.
 */

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  createEvent: vi.fn(),
  turnOnRsvpPage: vi.fn(),
  search: { current: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, replace: mocks.replace }),
  useParams: () => ({ orgSlug: "acme" }),
  usePathname: () => "/app/acme/meetings",
  useSearchParams: () => new URLSearchParams(mocks.search.current),
}));
vi.mock("@/app/app/[orgSlug]/calendar/actions", () => ({
  createEvent: mocks.createEvent,
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions", () => ({
  turnOnRsvpPage: mocks.turnOnRsvpPage,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => [null, vi.fn()] }));
vi.mock("@/components/meetings/conference-picker", () => ({
  useMeetingConnections: () => [],
  ConferencePicker: () => <div data-testid="conference-picker" />,
}));
vi.mock("@/components/calendar/member-picker", () => ({ MemberMultiPicker: () => null }));

// The dialog's selects measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { NewMeetingButton } = await import("./new-meeting-button");

const MEMBERS: CalendarMember[] = [
  { id: "u1", name: "Ada", image: null, avatar: null, title: null },
];

type Props = Parameters<typeof NewMeetingButton>[0];

function button(props: Partial<Props> = {}) {
  return (
    <NewMeetingButton
      orgId="org_1"
      timeZone="America/New_York"
      members={MEMBERS}
      defaultReminderMinutes={[1440, 60]}
      {...props}
    />
  );
}

const shape = (name: string) => screen.getByRole("radio", { name });
const chosen = () =>
  ["Online", "In person", "Event"].map(
    (name) => shape(name).getAttribute("aria-checked") === "true",
  );
const dialogOpen = () => screen.findByRole("dialog");

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.replace.mockReset();
  mocks.createEvent.mockReset();
  mocks.turnOnRsvpPage.mockReset();
  mocks.search.current = "";
});
afterEach(() => cleanup());

describe("NewMeetingButton", () => {
  it("opens the dialog", async () => {
    render(button());
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New meeting" }));

    await dialogOpen();
    expect(screen.getByRole("radiogroup", { name: "Kind of meeting" })).toBeTruthy();
    // With no shape asked for, the form starts where it always does.
    expect(chosen()).toEqual([false, true, false]);
  });

  it('startOpen with initialShape "online" opens on Online', async () => {
    render(button({ startOpen: true, initialShape: "online" }));

    await dialogOpen();
    expect(chosen()).toEqual([true, false, false]);
  });

  it("startOpen with no shape opens with nothing preset", async () => {
    render(button({ startOpen: true }));

    await dialogOpen();
    expect(chosen()).toEqual([false, true, false]);
  });

  it("starts the shape it was told to, Event included", async () => {
    render(button({ startOpen: true, initialShape: "event" }));

    await dialogOpen();
    expect(chosen()).toEqual([false, false, true]);
  });

  it("after a create it navigates to the meeting's page", async () => {
    mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
    render(button());
    fireEvent.click(screen.getByRole("button", { name: "New meeting" }));
    await dialogOpen();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Standup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.createEvent.mock.calls[0]![0]).toBe("org_1");
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/app/acme/meetings/evt_new");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("sends a new Event to its sign-up settings, as the form does everywhere", async () => {
    mocks.createEvent.mockResolvedValue({ eventId: "evt_new" });
    mocks.turnOnRsvpPage.mockResolvedValue({});
    render(button({ startOpen: true, initialShape: "event" }));
    await dialogOpen();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Open house" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/app/acme/meetings/evt_new/rsvp?new=1");
  });

  it("starts a new meeting from the organization's reminders", async () => {
    render(button({ defaultReminderMinutes: [10080, 30] }));
    fireEvent.click(screen.getByRole("button", { name: "New meeting" }));
    await dialogOpen();

    fireEvent.click(screen.getByRole("button", { name: /More details/ }));

    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed") === "true";
    expect(pressed("1 week before")).toBe(true);
    expect(pressed("30 minutes before")).toBe(true);
    expect(pressed("1 day before")).toBe(false);
  });

  it("opens with nothing preset when the button is pressed after a preset opening", async () => {
    render(button({ startOpen: true, initialShape: "online" }));
    await dialogOpen();
    expect(chosen()).toEqual([true, false, false]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "New meeting" }));

    await dialogOpen();
    expect(chosen()).toEqual([false, true, false]);
  });

  it("opens when it is asked to after it was already on the page", async () => {
    const view = render(button());
    expect(screen.queryByRole("dialog")).toBeNull();

    view.rerender(button({ startOpen: true, initialShape: "online" }));

    await dialogOpen();
    expect(chosen()).toEqual([true, false, false]);
  });

  it("can be the quieter button an empty page repeats", () => {
    render(button({ variant: "secondary" }));

    expect(screen.getByRole("button", { name: "New meeting" })).toBeTruthy();
  });
});

describe("NewMeetingButton: the ?new= parameter", () => {
  it("is taken off the address once it has opened the dialog, keeping the rest", async () => {
    mocks.search.current = "new=online&conference=connected";
    render(button({ startOpen: true, initialShape: "online" }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      "/app/acme/meetings?conference=connected",
      {
        scroll: false,
      },
    );
  });

  it("leaves a bare ?new= with just the path", async () => {
    mocks.search.current = "new=1";
    render(button({ startOpen: true }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/app/acme/meetings", { scroll: false });
  });

  it("leaves the address alone when it was not asked to open", async () => {
    mocks.search.current = "conference=connected";
    render(button());

    await Promise.resolve();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("does not take the parameter off for a button it did not ask to open", () => {
    mocks.search.current = "new=1";
    // The page's second button, repeated in an empty state, is not the one that opens.
    render(button({ variant: "secondary" }));

    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
