import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_HOURS } from "@/lib/booking/hours";
import { comingWeek } from "@/lib/booking/week";
import type { BookingLinkState, BookingPerson, BookingRow } from "@/server/booking/view";

/**
 * Booking links (docs/features/booking.md): an organization's page and a
 * Personal one are different pages, and each thing on them has its own
 * ambient buttons.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(async () => ({ ok: true })),
  create: vi.fn(async () => ({ ok: true, id: "new" })),
  ask: vi.fn(async () => ({ ok: true })),
  take: vi.fn(async () => ({ ok: true })),
  cancel: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/app/[orgSlug]/meetings/booking/actions", () => ({
  saveBookingLinkAction: mocks.save,
  createOrgLinkAction: mocks.create,
  askToTurnOnAction: mocks.ask,
  takeBookingAction: mocks.take,
  cancelBookingByHostAction: mocks.cancel,
}));
vi.mock("./link-dialog", () => ({
  LinkDialog: ({ link }: { link: { title: string } }) => <div>Editing {link.title}</div>,
}));

const { BookingLinksView } = await import("./booking-links-view");

const now = new Date("2026-11-04T15:00:00Z");
const week = comingWeek(DEFAULT_HOURS, [], "UTC", now);

function link(over: Partial<BookingLinkState> = {}): BookingLinkState {
  return {
    id: "mine",
    personal: true,
    title: "Meet with Ana",
    description: "",
    slug: "ana",
    url: "https://app.test/book/ana",
    durationMin: 30,
    durations: [],
    bufferMin: 0,
    minNoticeHours: 12,
    maxDaysAhead: 30,
    maxPerDay: null,
    timezone: "UTC",
    hours: DEFAULT_HOURS,
    dateOverrides: [],
    hostIds: ["ana"],
    questions: [],
    pipelineId: null,
    video: true,
    location: "",
    reminderMinutes: [],
    active: true,
    canEdit: true,
    openSoon: 20,
    booked: 3,
    nextOpen: "Tomorrow 9 AM",
    week,
    hoursLine: "Mon to Fri, 9 AM to 5 PM",
    lengths: "30 minutes",
    ambient: [],
    ...over,
  };
}

const orgLink = (id: string, over: Partial<BookingLinkState> = {}) =>
  link({ id, title: `Link ${id}`, personal: false, hostIds: ["ana", "bo"], ...over });

function person(id: string, over: Partial<BookingPerson> = {}): BookingPerson {
  return {
    id,
    name: `${id[0]!.toUpperCase()}${id.slice(1)} Lee`,
    image: null,
    avatar: null,
    title: null,
    me: false,
    asked: false,
    link: {
      url: `https://app.test/book/${id}`,
      title: `Meet with ${id}`,
      week,
      hoursLine: "Mon to Fri, 9 AM to 5 PM",
      lengths: "30 minutes",
      openSoon: 5,
      nextOpen: "Tomorrow 9 AM",
    },
    ...over,
  };
}

const you = person("ana", { me: true });

function booking(over: Partial<BookingRow> = {}): BookingRow {
  return {
    id: "b1",
    eventId: "e1",
    guestName: "Sam Guest",
    startsAt: new Date("2026-11-05T14:00:00Z"),
    when: "Tomorrow, 2:00 – 2:30 PM UTC",
    soon: "tomorrow",
    linkTitle: "Coffee",
    host: { name: "Ana Lee", image: null, avatar: null },
    place: { online: true, label: "Zoom" },
    joinUrl: "https://zoom.test/j/1",
    verified: true,
    waiting: null,
    needsHost: false,
    mine: true,
    ambient: [],
    ...over,
  };
}

function view(over: Partial<Parameters<typeof BookingLinksView>[0]> = {}) {
  return render(
    <BookingLinksView
      orgId="org"
      orgSlug="acme"
      orgName="Acme"
      personalSpace={false}
      orgLinksAllowed
      crmOn
      isAdmin={false}
      mine={link()}
      orgLinks={[orgLink("one")]}
      people={[you, person("bo")]}
      upcoming={[]}
      members={[person("ana"), person("bo")]}
      pipelines={[]}
      timeZones={["UTC"]}
      orgTimeZone="UTC"
      openOnArrival={null}
      {...over}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(cleanup);

describe("an organization", () => {
  it("draws the link as a strip, says who it goes to, then everyone's cards with yours first", () => {
    view();
    const strip = screen.getByRole("region", { name: "Link one" });
    expect(within(strip).getByText(/Goes to Ana Lee and Bo Lee, taking turns/)).toBeTruthy();
    expect(within(strip).getByRole("button", { name: "Copy link for Link one" })).toBeTruthy();
    const cards = within(screen.getByRole("region", { name: "Everyone's links" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole("button", { name: "Edit your link" })).toBeTruthy();
    expect(within(cards[1]!).getByRole("link", { name: "Book Bo Lee" }).getAttribute("href")).toBe("https://app.test/book/bo");
    expect(within(cards[1]!).getByRole("img", { name: /Bo Lee's week/ })).toBeTruthy();
  });

  it("folds links past the second behind More links", () => {
    view({ orgLinks: [orgLink("one"), orgLink("two"), orgLink("three")] });
    expect(screen.queryByRole("region", { name: "Link three" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More links (1)" }));
    expect(screen.getByRole("region", { name: "Link three" })).toBeTruthy();
  });

  it("offers to make the first link in place, then opens it", async () => {
    view({ orgLinks: [] });
    const name = screen.getByRole("textbox", { name: "Name of the link" }) as HTMLInputElement;
    expect(name.value).toBe("Meet Acme");
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("org", "Meet Acme"));
  });

  it("leaves the strip out without the CRM, and tells only an admin how to get it", () => {
    view({ orgLinksAllowed: false, orgLinks: [] });
    expect(screen.queryByText(/comes with the CRM/)).toBeNull();
    cleanup();
    view({ orgLinksAllowed: false, orgLinks: [], isAdmin: true });
    expect(screen.getByRole("link", { name: "Add the CRM" }).getAttribute("href")).toBe("/app/acme/integrations/crm");
  });

  it("keeps someone who hasn't turned theirs on, quietly, with Ask them, once", async () => {
    view({ people: [you, person("bo", { link: null }), person("cy", { link: null, asked: true })] });
    expect(screen.getAllByText("Hasn't turned theirs on")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Book Bo/ })).toBeNull();
    const ask = screen.getAllByRole("button", { name: /to turn their link on/ });
    expect(ask).toHaveLength(1);
    fireEvent.click(ask[0]!);
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith("org", "bo"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /to turn their link on/ })).toBeNull());
  });

  it("offers Turn it on on your own card when it's off", async () => {
    view({
      mine: link({ active: false, ambient: [{ kind: "turn-on", reason: "Off until you turn it on" }] }),
    });
    expect(screen.getByText("Yours is off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn it on" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("org", "mine", { active: true }));
  });

  it("past nine people shows the first nine, then everyone, and finds anyone", () => {
    const names = ["bo", "cy", "di", "ed", "fi", "gus", "hal", "ian", "jo", "kit", "lee"];
    view({ people: [you, ...names.map((n) => person(n))] });
    const grid = screen.getByRole("region", { name: "Everyone's links" });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(9);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find someone" }), { target: { value: "kit" } });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find someone" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Show everyone (12)" }));
    expect(within(grid).getAllByRole("listitem")).toHaveLength(12);
  });

  it("doesn't offer search or Show everyone to a small organization", () => {
    view();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show everyone/ })).toBeNull();
  });
});

describe("a Personal space", () => {
  it("has your link as the strip with your week inside it, and no grid", () => {
    view({ personalSpace: true, orgLinksAllowed: false, orgLinks: [], people: [] });
    const strip = screen.getByRole("region", { name: "Meet with Ana" });
    expect(within(strip).getByRole("img", { name: /Your week/ })).toBeTruthy();
    expect(within(strip).getByText("Thu")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Everyone's links" })).toBeNull();
    expect(screen.queryByText(/Organization booking link/)).toBeNull();
  });
});

describe("the signature button", () => {
  const signature = {
    kind: "signature" as const,
    reason: "Nobody's booked this yet: copy it into your email signature",
  };

  it("copies the link, then stays gone in this browser", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    view({ orgLinks: [orgLink("one", { url: "https://app.test/book/one", ambient: [signature] })] });
    expect(screen.getByText(signature.reason)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy for your signature" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Book time with us: https://app.test/book/one"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Copy for your signature" })).toBeNull());
    cleanup();
    view({ orgLinks: [orgLink("one", { ambient: [signature] })] });
    expect(screen.queryByRole("button", { name: "Copy for your signature" })).toBeNull();
  });
});

describe("the editor", () => {
  it("opens from Fix the hours, and that button stays until the hours change", () => {
    view({
      orgLinks: [
        orgLink("one", { openSoon: 0, ambient: [{ kind: "fix-hours", reason: "Nobody can book it in the next two weeks" }] }),
      ],
    });
    expect(screen.getByText("No open times")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fix the hours" }));
    expect(screen.getByText("Editing Link one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix the hours" })).toBeTruthy();
  });

  it("gives no edit control to someone who may not edit", () => {
    view({ orgLinks: [orgLink("one", { canEdit: false })] });
    expect(screen.queryByRole("button", { name: "Edit Link one" })).toBeNull();
  });
});

describe("Coming up", () => {
  it("draws a booking like a meeting card, opening the meeting", () => {
    view({ upcoming: [booking()] });
    expect(screen.getByRole("link", { name: "Sam Guest" }).getAttribute("href")).toBe("/app/acme/meetings/e1");
    expect(screen.getByText("Tomorrow, 2:00 – 2:30 PM UTC")).toBeTruthy();
    expect(screen.getByText("Coffee")).toBeTruthy();
    expect(screen.getByText("You're hosting")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Join with/ })).toBeNull();
  });

  it("shows Join and its reason when it's near", () => {
    view({ upcoming: [booking({ ambient: [{ kind: "join", reason: "Starts in 8 minutes" }] })] });
    expect(screen.getByRole("link", { name: "Join with Sam Guest" }).getAttribute("href")).toBe("https://zoom.test/j/1");
    expect(screen.getByText("Starts in 8 minutes")).toBeTruthy();
  });

  it("says why it's unconfirmed, and whose it is when it isn't yours", () => {
    view({
      upcoming: [booking({ verified: false, waiting: "Sam hasn't confirmed their email yet.", mine: false })],
    });
    expect(screen.getByText("Unconfirmed")).toBeTruthy();
    expect(screen.getByText("Sam hasn't confirmed their email yet.")).toBeTruthy();
    expect(screen.getByText("With Ana Lee")).toBeTruthy();
  });

  it("lets an admin Take it when the host left", async () => {
    view({
      isAdmin: true,
      upcoming: [booking({ needsHost: true, ambient: [{ kind: "take", reason: "Its host left the organization" }] })],
    });
    expect(screen.getByText("Needs a host")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take the meeting with Sam Guest" }));
    await waitFor(() => expect(mocks.take).toHaveBeenCalledWith("org", "b1"));
  });

  it("says so when nothing is booked", () => {
    view();
    expect(screen.getByText("Nothing booked yet")).toBeTruthy();
  });
});
