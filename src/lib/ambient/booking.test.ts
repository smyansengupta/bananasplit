import { describe, expect, it } from "vitest";

import { bookingAmbient, confirmWaiting, linkAmbient, type BookingFacts, type LinkFacts } from "./booking";

const link = (over: Partial<LinkFacts> = {}): LinkFacts => ({
  personal: false,
  active: true,
  canEdit: true,
  hosts: 2,
  ...over,
});
const kinds = (l: LinkFacts) => linkAmbient(l).map((a) => a.kind);

describe("linkAmbient", () => {
  it("says nothing about a link that's on: nothing needs doing", () => {
    expect(kinds(link())).toEqual([]);
    expect(kinds(link({ personal: true, hosts: 1 }))).toEqual([]);
  });

  it("offers Turn it on only to someone who can", () => {
    expect(kinds(link({ active: false }))).toEqual(["turn-on"]);
    expect(kinds(link({ active: false, canEdit: false }))).toEqual([]);
    expect(linkAmbient(link({ personal: true, active: false, hosts: 1 }))[0]?.reason).toMatch(/free times/);
  });

  it("asks for a host instead on a link nobody hosts, on or off", () => {
    expect(kinds(link({ active: false, hosts: 0 }))).toEqual(["add-host"]);
    expect(kinds(link({ hosts: 0 }))).toEqual(["add-host"]);
    expect(kinds(link({ hosts: 0, canEdit: false }))).toEqual([]);
  });

  it("never offers more than one", () => {
    for (const active of [true, false]) {
      for (const hosts of [0, 1]) expect(kinds(link({ active, hosts })).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("bookingAmbient", () => {
  const now = new Date("2026-11-04T15:00:00Z");
  const at = (n: number) => new Date(now.getTime() + n * 60_000);
  const booking = (over: Partial<BookingFacts> = {}): BookingFacts => ({
    startsAt: at(60),
    endsAt: at(90),
    joinUrl: "https://meet.example/x",
    needsHost: false,
    canTake: false,
    ...over,
  });

  it("shows Join only in the last ten minutes and while it's on", () => {
    expect(bookingAmbient(booking(), now)).toEqual([]);
    expect(bookingAmbient(booking({ startsAt: at(11) }), now)).toEqual([]);
    expect(bookingAmbient(booking({ startsAt: at(10) }), now)).toEqual([{ kind: "join", reason: "Starts in 10 minutes" }]);
    expect(bookingAmbient(booking({ startsAt: at(-5), endsAt: at(25) }), now)).toEqual([{ kind: "join", reason: "It's started" }]);
    expect(bookingAmbient(booking({ startsAt: at(-30), endsAt: at(0) }), now)).toEqual([]);
    expect(bookingAmbient(booking({ startsAt: at(5), joinUrl: null }), now)).toEqual([]);
  });

  it("shows Take it to owners and admins when the host left", () => {
    expect(bookingAmbient(booking({ needsHost: true, canTake: true }), now).map((a) => a.kind)).toEqual(["take"]);
    expect(bookingAmbient(booking({ needsHost: true }), now)).toEqual([]);
  });

  it("says who hasn't confirmed", () => {
    expect(confirmWaiting("Sam Guest")).toMatch(/^Sam hasn't confirmed/);
  });
});
