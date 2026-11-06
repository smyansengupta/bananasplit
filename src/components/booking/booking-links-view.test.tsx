import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_HOURS } from "@/lib/booking/hours";
import { comingWeek } from "@/lib/booking/week";
import type { BookingLinkState, BookingPerson, BookingRow } from "@/server/booking/view";

/**
 * Meeting links (docs/features/booking.md): an organization's page and a
 * Personal one are different pages. The strip is the organization's own link,
 * and everything on the page has one action at most, the rest in its menu.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(async () => ({ ok: true })),
  create: vi.fn(async () => ({ ok: true, id: "new" })),
  ask: vi.fn(async () => ({ ok: true })),
  take: vi.fn(async () => ({ ok: true })),
  cancel: vi.fn(async () => ({ ok: true })),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/app/[orgSlug]/meetings/booking/actions", () => ({
  saveBookingLinkAction: mocks.save,
  createOrgLinkAction: mocks.create,
  askToTurnOnAction: mocks.ask,
  takeBookingAction: mocks.take,
  cancelBookingByHostAction: mocks.cancel,
}));
vi.mock("@/components/ui/toaster", () => ({ toast: mocks.toast }));
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
    main: false,
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

const mainLink = (over: Partial<BookingLinkState> = {}) =>
  orgLink("main", { main: true, title: "Meet with Acme", url: "https://app.test/book/acme", ...over });

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
      orgLogo={null}
      personalSpace={false}
      orgLinksAllowed
      crmOn
      mine={link()}
      mainLink={mainLink()}
      orgLinks={[]}
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

/** Opens a "..." menu and hands back the words in it. */
function openMenu(name: string): string[] {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
  return screen.getAllByRole("menuitem").map((m) => m.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the organization's strip", () => {
  it("is the organization's: its initials, its name, a short line, the hosts' faces at the end", () => {
    view();
    const strip = screen.getByRole("region", { name: "Meet with Acme" });
    expect(within(strip).getByRole("heading", { name: "Meet with Acme" })).toBeTruthy();
    expect(within(strip).getByText("AC")).toBeTruthy();
    expect(within(strip).getByText("30 minutes with whoever's free")).toBeTruthy();
    expect(within(strip).getByRole("img", { name: "Hosts: Ana Lee, Bo Lee" })).toBeTruthy();
    expect(within(strip).getByText("app.test/book/acme")).toBeTruthy();
  });

  it("shows the organization's picture when it has one", () => {
    const { container } = view({ orgLogo: "https://cdn.test/logo.webp" });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/logo.webp");
  });

  it("has one button, Copy link, and the rest in its menu", () => {
    view();
    const strip = screen.getByRole("region", { name: "Meet with Acme" });
    expect(within(strip).getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual([
      "Copy link",
      "More for Meet with Acme",
    ]);
    expect(openMenu("More for Meet with Acme")).toEqual(["Open", "Edit", "Turn off", "New link"]);
    expect(screen.getByRole("menuitem", { name: "Open" }).getAttribute("href")).toBe("https://app.test/book/acme");
  });

  it("turns off from the menu", async () => {
    view();
    openMenu("More for Meet with Acme");
    fireEvent.click(screen.getByRole("menuitem", { name: "Turn off" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("org", "main", { active: false }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("offers Turn it on in Copy link's place while it's off, and no address", async () => {
    view({ mainLink: mainLink({ active: false, ambient: [{ kind: "turn-on", reason: "It's off, so nobody can book it" }] }) });
    const strip = screen.getByRole("region", { name: "Meet with Acme" });
    expect(within(strip).getByText("Off")).toBeTruthy();
    expect(within(strip).queryByRole("button", { name: /Copy link/ })).toBeNull();
    expect(within(strip).queryByText("app.test/book/acme")).toBeNull();
    expect(screen.queryByText("It's off, so nobody can book it")).toBeNull();
    fireEvent.click(within(strip).getByRole("button", { name: "Turn on Meet with Acme" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("org", "main", { active: true }));
  });

  it("asks for a host when nobody hosts it, opening the editor", () => {
    view({
      mainLink: mainLink({ active: false, hostIds: [], ambient: [{ kind: "add-host", reason: "Nobody hosts it" }] }),
    });
    expect(screen.getByText("30 minutes with nobody yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a host" }));
    expect(screen.getByText("Editing Meet with Acme")).toBeTruthy();
  });

  it("gives someone who may not edit it only Copy link and Open", () => {
    view({ mainLink: mainLink({ canEdit: false }), orgLinksAllowed: false });
    expect(openMenu("More for Meet with Acme")).toEqual(["Open"]);
  });

  it("draws nothing before anyone who runs links has opened the page", () => {
    view({ mainLink: null });
    expect(screen.queryByRole("heading", { name: "Meet with Acme" })).toBeNull();
    expect(screen.getByRole("region", { name: "Everyone's links" })).toBeTruthy();
  });

  it("is there without the CRM, with no way to make more links and nothing about the CRM", () => {
    view({ orgLinksAllowed: false, crmOn: false });
    expect(screen.getByRole("region", { name: "Meet with Acme" })).toBeTruthy();
    expect(openMenu("More for Meet with Acme")).toEqual(["Open", "Edit", "Turn off"]);
    expect(screen.queryByText(/CRM/)).toBeNull();
  });
});

describe("the organization's other links", () => {
  it("wait behind one quiet control, each with one action, and New link at the foot", () => {
    const coffee = orgLink("coffee", { title: "Coffee with the president", hostIds: ["bo"] });
    const off = orgLink("off", { active: false, ambient: [{ kind: "turn-on", reason: "It's off" }] });
    view({ orgLinks: [coffee, off] });
    expect(screen.queryByRole("region", { name: "Coffee with the president" })).toBeNull();
    expect(screen.queryByText("Coffee with the president")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 more links" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Coffee with the president")).toBeTruthy();
    expect(within(dialog).getByText("Goes to Bo Lee. 30 minutes.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Copy link for Coffee with the president" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Copy link for Link off" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Turn on Link off" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "New link" }));
    expect(screen.getByText("New meeting link")).toBeTruthy();
  });

  it("says one link in the singular, and New link leaves the strip's menu", () => {
    view({ orgLinks: [orgLink("one")] });
    expect(screen.getByRole("button", { name: "1 more link" })).toBeTruthy();
    expect(openMenu("More for Meet with Acme")).toEqual(["Open", "Edit", "Turn off"]);
  });

  it("makes a new link from the menu, then opens it", async () => {
    view();
    openMenu("More for Meet with Acme");
    fireEvent.click(screen.getByRole("menuitem", { name: "New link" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Office hours" } });
    fireEvent.click(screen.getByRole("button", { name: "Create meeting link" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("org", "Office hours"));
  });

  it("stay reachable when the strip isn't there yet", () => {
    view({ mainLink: null, orgLinks: [orgLink("one")] });
    expect(screen.getByRole("button", { name: "1 more link" })).toBeTruthy();
  });
});

describe("copying a link", () => {
  it("says Copied on the button for two seconds, with no toast, and copies the right address", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    view();
    fireEvent.click(screen.getByRole("button", { name: "Copy link for Meet with Acme" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" }).textContent).toBe("Copied"));
    expect(writeText).toHaveBeenCalledWith("https://app.test/book/acme");
    expect(mocks.toast).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy link for Meet with Acme" })).toBeTruthy(), {
      timeout: 2500,
    });
  });

  it("says so when the browser refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("no"))) },
      configurable: true,
    });
    view();
    fireEvent.click(screen.getByRole("button", { name: "Copy link for Meet with Acme" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "error" })));
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});

describe("everyone's cards", () => {
  it("puts yours first; a card opens its page, and has one button", () => {
    view();
    const cards = within(screen.getByRole("region", { name: "Everyone's links" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole("link", { name: "Open your meeting link" }).getAttribute("href")).toBe(
      "https://app.test/book/ana",
    );
    expect(within(cards[1]!).getByRole("link", { name: "Open Bo Lee's meeting link" }).getAttribute("href")).toBe(
      "https://app.test/book/bo",
    );
    expect(within(cards[1]!).getAllByRole("button").map((b) => b.textContent)).toEqual(["Copy link"]);
    expect(within(cards[1]!).getByRole("img", { name: /Bo Lee's week/ })).toBeTruthy();
  });

  it("keeps Edit and Turn off on your own card in its menu, with no pencil", () => {
    view();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(openMenu("More for your meeting link")).toEqual(["Open", "Edit", "Turn off"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByText("Editing Meet with Ana")).toBeTruthy();
  });

  it("keeps someone who hasn't turned theirs on, quietly, with Ask them, once", async () => {
    view({ people: [you, person("bo", { link: null }), person("cy", { link: null, asked: true })] });
    expect(screen.getAllByText("Hasn't turned theirs on")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Bo Lee's meeting link/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy link for Bo/ })).toBeNull();
    expect(screen.queryByText(/Nobody can book/)).toBeNull();
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
    expect(screen.queryByRole("button", { name: "Copy link for your meeting link" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open your meeting link" })).toBeNull();
    expect(screen.queryByText("Off until you turn it on")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn on your meeting link" }));
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
    view({ personalSpace: true, orgLinksAllowed: false, mainLink: null, people: [] });
    const strip = screen.getByRole("region", { name: "Meet with Ana" });
    expect(within(strip).getByRole("img", { name: /Your week/ })).toBeTruthy();
    expect(within(strip).getByText("Thu")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Everyone's links" })).toBeNull();
    expect(within(strip).getByRole("button", { name: "Copy link for your meeting link" })).toBeTruthy();
  });
});

describe("the state of a link", () => {
  it("says there are no open times, and Copy link stays the one button", () => {
    view({ mainLink: mainLink({ openSoon: 0 }) });
    const strip = screen.getByRole("region", { name: "Meet with Acme" });
    expect(within(strip).getByText("No open times")).toBeTruthy();
    expect(within(strip).getByRole("button", { name: /Copy link/ })).toBeTruthy();
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

  it("shows Join when it's near, with no line under it, and only Cancel in the menu then", () => {
    view({ upcoming: [booking({ ambient: [{ kind: "join", reason: "Starts in 8 minutes" }] })] });
    expect(screen.getByRole("link", { name: "Join with Sam Guest" }).getAttribute("href")).toBe("https://zoom.test/j/1");
    expect(screen.queryByText("Starts in 8 minutes")).toBeNull();
    expect(openMenu("More for Sam Guest")).toEqual(["Cancel the meeting"]);
  });

  it("keeps Join in the menu before then", () => {
    view({ upcoming: [booking()] });
    expect(openMenu("More for Sam Guest")).toEqual(["Join", "Cancel the meeting"]);
  });

  it("shows one action at most: Take it before Join", () => {
    view({
      upcoming: [
        booking({
          needsHost: true,
          ambient: [
            { kind: "take", reason: "Its host left the organization" },
            { kind: "join", reason: "Starts in 8 minutes" },
          ],
        }),
      ],
    });
    expect(screen.getByRole("button", { name: "Take the meeting with Sam Guest" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Join with Sam Guest" })).toBeNull();
    expect(screen.queryByText("Its host left the organization")).toBeNull();
    expect(openMenu("More for Sam Guest")).toEqual(["Join", "Cancel the meeting"]);
  });

  it("says it's unconfirmed, why on hover, and whose it is when it isn't yours", () => {
    view({
      upcoming: [booking({ verified: false, waiting: "Sam hasn't confirmed their email yet.", mine: false })],
    });
    expect(screen.getByText("Unconfirmed").getAttribute("title")).toBe("Sam hasn't confirmed their email yet.");
    expect(screen.queryByText("Sam hasn't confirmed their email yet.")).toBeNull();
    expect(screen.getByText("With Ana Lee")).toBeTruthy();
  });

  it("lets an admin Take it when the host left", async () => {
    view({
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
