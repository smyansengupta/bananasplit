import { describe, expect, it } from "vitest";

import { advance, campaignNumbers, readRouting, routeOwner, splitAmong } from "./assign";
import { bookingSlots, bookingSlug, pickHost, readQuestions, slotsByDay } from "./booking";
import { handoverBrief, recapLines } from "./brief";
import { applyMap, readDestination, suggestMap } from "./form-map";
import {
  addressList,
  autoReplyOf,
  bareAddress,
  singleSender,
  bounceOf,
  displayNameOf,
  neverLogged,
  newText,
  ourAddresses,
  returnDate,
  signatureOf,
} from "./inbound";
import { linksIn, mergeKeys, renderMerge, sinceWords, textToHtml } from "./merge";
import { cadenceLabel, cadenceLapsed, nextInWindow, readWindow, windowLabel } from "./schedule";

describe("merge fields", () => {
  it("fills fields, uses fallbacks and reports what's missing", () => {
    const r = renderMerge("Hi {{first_name|there}}, thanks for {{ last_event }}. {{company}} rocks. {{nope}}", {
      last_event: "the March showcase",
    });
    expect(r.text).toBe("Hi there, thanks for the March showcase. rocks.");
    expect(r.missing).toEqual(["company"]);
    expect(r.unknown).toEqual(["nope"]);
  });

  it("lists keys once, in order", () => {
    expect(mergeKeys("{{first_name}} {{company}} {{first_name|x}}")).toEqual(["first_name", "company"]);
  });

  it("turns text into escaped paragraphs with tracked links", () => {
    const html = textToHtml("Hi <b>Ada</b>,\n\nSee https://example.org/a?b=1.\nBye", (u) => `T(${u})`);
    expect(html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(html).toContain('<a href="T(https://example.org/a?b=1)">https://example.org/a?b=1</a>.');
    expect(html.match(/<p /g)).toHaveLength(2);
    expect(linksIn("go to https://x.org, then http://y.com/z")).toEqual(["https://x.org", "http://y.com/z"]);
  });

  it("says how long ago in words", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(sinceWords(new Date("2026-11-02T12:00:00Z"), now)).toBe("yesterday");
    expect(sinceWords(new Date("2026-09-01T12:00:00Z"), now)).toBe("2 months ago");
    expect(sinceWords(null, now)).toBeNull();
  });
});

describe("send windows and cadences", () => {
  const w = readWindow({ days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 });

  it("keeps a time inside the window and moves one outside it to the next opening", () => {
    // Tuesday 3 Nov 2026, 10:00 in New York (15:00 UTC).
    const inside = new Date("2026-11-03T15:00:00Z");
    expect(nextInWindow(inside, w, "America/New_York")).toEqual(inside);
    // Tuesday 20:00 New York -> Wednesday 9:00 New York (14:00 UTC).
    expect(nextInWindow(new Date("2026-11-04T01:00:00Z"), w, "America/New_York").toISOString()).toBe(
      "2026-11-04T14:00:00.000Z",
    );
    // Saturday -> Monday 9:00.
    expect(nextInWindow(new Date("2026-11-07T15:00:00Z"), w, "America/New_York").toISOString()).toBe(
      "2026-11-09T14:00:00.000Z",
    );
    // Early morning the same open day -> 9:00 that day.
    expect(nextInWindow(new Date("2026-11-03T11:00:00Z"), w, "America/New_York").toISOString()).toBe(
      "2026-11-03T14:00:00.000Z",
    );
  });

  it("cleans odd windows and says them in words", () => {
    expect(readWindow({ days: [9], startHour: 20, endHour: 3 })).toEqual({ days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 });
    expect(windowLabel(w)).toBe("Weekdays, 9 AM to 5 PM");
  });

  it("knows when a cadence has lapsed", () => {
    const now = new Date("2026-11-03T00:00:00Z");
    expect(cadenceLapsed(new Date("2026-09-01T00:00:00Z"), 30, now)).toBe(true);
    expect(cadenceLapsed(new Date("2026-10-20T00:00:00Z"), 30, now)).toBe(false);
    expect(cadenceLapsed(null, 30, now)).toBe(true);
    expect(cadenceLapsed(null, null, now)).toBe(false);
    expect(cadenceLabel(91)).toBe("Each quarter");
    expect(cadenceLabel(10)).toBe("Every 10 days");
  });
});

describe("reading incoming mail", () => {
  it("reads addresses and names", () => {
    expect(bareAddress('"Ada L" <Ada@Example.ORG>')).toBe("ada@example.org");
    expect(displayNameOf('"Ada Lovelace" <ada@x.org>')).toBe("Ada Lovelace");
    expect(addressList('a@x.org, "B, Jr" <b@y.org>, a@x.org')).toEqual(["a@x.org", "b@y.org"]);
  });

  it("names one sender only when the From line holds one address", () => {
    expect(singleSender('"Ada L" <Ada@Example.ORG>')).toBe("ada@example.org");
    expect(singleSender("ada@example.org")).toBe("ada@example.org");
    expect(singleSender('"ada@example.org" <ada@example.org>')).toBe("ada@example.org");
    expect(singleSender('"mallory@attacker.example" <victim@example.org>')).toBeNull();
    expect(singleSender("a@x.org, b@y.org")).toBeNull();
    expect(singleSender("Nobody")).toBeNull();
  });

  it("finds our BCC and reply addresses on the inbound domain only", () => {
    expect(
      ourAddresses(["log+abcdefgh12@in.example.org", "reply+tok_123456@in.example.org", "log+abcdefgh12@evil.org"], "in.example.org"),
    ).toEqual({ bcc: ["abcdefgh12"], reply: ["tok_123456"] });
  });

  it("matches never-log addresses and domains", () => {
    expect(neverLogged("dr@clinic.org", ["@clinic.org"])).toBe(true);
    expect(neverLogged("x@mail.bank.com", ["bank.com"])).toBe(true);
    expect(neverLogged("mom@family.net", ["mom@family.net"])).toBe(true);
    expect(neverLogged("dad@family.net", ["mom@family.net"])).toBe(false);
  });

  it("detects out-of-office and when they're back", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const ooo = autoReplyOf(
      { subject: "Automatic reply: Sponsorship", text: "I'm out of the office and will be back on November 12.", headers: { "auto-submitted": "auto-replied" } },
      now,
    );
    expect(ooo.outOfOffice).toBe(true);
    expect(ooo.backOn?.toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(autoReplyOf({ subject: "Re: hi", text: "Sounds great, see you then", headers: {} }, now).outOfOffice).toBe(false);
    expect(returnDate("returning 1/5", now)?.toISOString().slice(0, 10)).toBe("2027-01-05");
  });

  it("detects bounces and the address that failed", () => {
    const b = bounceOf({
      from: "MAILER-DAEMON@mx.example.org",
      subject: "Undelivered Mail Returned to Sender",
      text: "Final-Recipient: rfc822; gone@harbor.org\nStatus: 5.1.1",
      headers: {},
    });
    expect(b).toEqual({ bounced: true, recipient: "gone@harbor.org", permanent: true });
    expect(bounceOf({ from: "ada@x.org", subject: "Hello", text: "hi", headers: {} }).bounced).toBe(false);
  });

  it("keeps only the new part of a reply and reads the signature", () => {
    const body = "Yes, let's meet Thursday.\n\nBest,\nGrace Hopper\nDirector of Partnerships, Harbor Light\n+1 (617) 555-0123\n\nOn Tue, Nov 3, 2026 at 9:00 AM Ada <ada@x.org> wrote:\n> Can we meet?";
    expect(newText(body)).toContain("Thursday");
    expect(newText(body)).not.toContain("Can we meet");
    expect(signatureOf(body)).toEqual({
      name: "Grace Hopper",
      title: "Director of Partnerships",
      company: "Harbor Light",
      phone: "+1 (617) 555-0123",
    });
  });
});

describe("booking pages", () => {
  const now = new Date("2026-11-02T13:00:00Z"); // Monday 8:00 New York
  it("offers free times only, after the notice, and names who's free", () => {
    const slots = bookingSlots({
      now,
      tz: "America/New_York",
      durationMin: 60,
      bufferMin: 0,
      minNoticeHours: 2,
      maxDaysAhead: 0,
      hosts: [
        { userId: "a", busy: ["0-11"], events: [] },
        { userId: "b", busy: [], events: [{ start: new Date("2026-11-02T15:00:00Z"), end: new Date("2026-11-02T16:00:00Z") }] },
      ],
    });
    const at = (iso: string) => slots.find((s) => s.start.toISOString() === iso)?.hostIds;
    // 10:00 NY (15:00Z): a is free, b is in a meeting.
    expect(at("2026-11-02T15:00:00.000Z")).toEqual(["a"]);
    // 11:00 NY: a is busy that hour, b is free.
    expect(at("2026-11-02T16:00:00.000Z")).toEqual(["b"]);
    // Before the notice (8:00 + 2h): nothing at 9:00.
    expect(at("2026-11-02T14:00:00.000Z")).toBeUndefined();
    // Nothing runs past 5 PM.
    expect(slots.every((s) => s.end.getTime() <= new Date("2026-11-02T22:00:00Z").getTime())).toBe(true);
    expect(slotsByDay(slots, "America/New_York")).toHaveLength(1);
  });

  it("round-robins to whoever has had the fewest", () => {
    expect(pickHost(["a", "b", "c"], new Map([["a", 2], ["b", 0], ["c", 0]]))).toBe("b");
    expect(pickHost([], new Map())).toBeNull();
  });

  it("reads questions and makes slugs", () => {
    expect(readQuestions([{ label: "What about?", required: true }, { nope: 1 }])).toEqual([
      { id: "q1", label: "What about?", required: true },
    ]);
    expect(bookingSlug("Coffee with Ada!", "x7")).toBe("coffee-with-ada-x7");
  });
});

describe("splitting and routing", () => {
  it("splits evenly, owners first", () => {
    const out = splitAmong(
      [
        { id: "p1", ownerId: "m2" },
        { id: "p2" },
        { id: "p3" },
        { id: "p4" },
      ],
      ["m1", "m2"],
    );
    expect(out.get("p1")).toBe("m2");
    const counts = [...out.values()].reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>());
    expect(counts.get("m1")).toBe(2);
    expect(counts.get("m2")).toBe(2);
  });

  it("routes by the first matching rule, else round-robin, never to a non-member", () => {
    const routing = readRouting({
      mode: "rules",
      pool: ["m1", "m2", "gone"],
      rules: [
        { field: "company", op: "contains", value: "harbor", ownerId: "m2" },
        { field: "source", op: "is", value: "x", ownerId: "gone" },
        { field: "bad", op: "is", value: "x", ownerId: "m1" },
      ],
    });
    expect(routing.rules).toHaveLength(2);
    const members = new Set(["m1", "m2"]);
    expect(routeOwner(routing, { company: "Harbor Light" }, members, new Map())?.ownerId).toBe("m2");
    expect(routeOwner(routing, { source: "x" }, members, new Map([["m1", 3]]))?.ownerId).toBe("m2");
    expect(routeOwner(readRouting({ mode: "off" }), {}, members, new Map())).toBeNull();
  });

  it("counts a campaign's progress cumulatively, and statuses only move forward", () => {
    expect(campaignNumbers(["TODO", "CONTACTED", "REPLIED", "BOOKED", "SKIPPED"])).toEqual({
      total: 5,
      todo: 1,
      contacted: 3,
      replied: 2,
      booked: 1,
      converted: 0,
      skipped: 1,
    });
    expect(advance("BOOKED", "REPLIED")).toBe("BOOKED");
    expect(advance("CONTACTED", "REPLIED")).toBe("REPLIED");
  });
});

describe("forms to the CRM", () => {
  const questions = [
    { id: "q1", type: "short", title: "Your name", fieldId: "f1" },
    { id: "q2", type: "email", title: "Email", fieldId: "f2" },
    { id: "q3", type: "short", title: "Company", fieldId: "f3" },
    { id: "q4", type: "choice", title: "Interest", fieldId: "f4", options: [{ id: "o1", label: "Volunteering" }] },
    { id: "q5", type: "number", title: "Pledge amount", fieldId: "f5" },
  ];

  it("suggests a mapping from the questions", () => {
    expect(suggestMap(questions)).toEqual({ q1: "name", q2: "email", q3: "company", q5: "amount" });
  });

  it("applies it, keeping unmapped answers as a note", () => {
    const dest = readDestination({ object: "deal", pipelineId: "pl", map: { ...suggestMap(questions), bad: "zzz" } })!;
    expect(dest.map).not.toHaveProperty("bad");
    const m = applyMap(dest, questions, { f1: "Ada Lovelace", f2: "ADA@x.org", f3: "Harbor", f4: "o1", f5: 250 });
    expect(m.person).toMatchObject({ name: "Ada Lovelace", email: "ada@x.org", company: "Harbor" });
    expect(m.amountCents).toBe(25000);
    expect(m.note).toBe("Interest: Volunteering");
    expect(readDestination({ object: "nope" })).toBeNull();
  });
});

describe("briefs and recaps", () => {
  it("writes a handover brief from the record", () => {
    const lines = handoverBrief({
      name: "Grace",
      company: "Harbor Light",
      title: "Director",
      previousOwner: "Ada",
      lastContactedAt: new Date("2026-10-01T00:00:00Z"),
      firstContactAt: new Date("2025-01-01T00:00:00Z"),
      touches: 12,
      recent: [{ kind: "EMAIL", subject: "Renewal", at: new Date("2026-10-01T00:00:00Z") }],
      open: [{ title: "2027 sponsorship", stage: "Committed", nextStep: null, amountCents: 500000 }],
      promises: [{ title: "Logo on shirts", dueOn: null }],
      receivedCents: 250000,
      pledgedCents: 500000,
      cadenceDays: 30,
      doNotContact: false,
    });
    expect(lines[0]).toContain("Grace, Director at Harbor Light. Ada looked after them.");
    expect(lines.join(" ")).toContain("no next step");
    expect(lines.join(" ")).toContain("We still owe them: Logo on shirts.");
    expect(lines.at(-1)).toBe("$2,500 received, $5,000 pledged.");
  });

  it("writes a recap from real numbers", () => {
    expect(
      recapLines({
        orgName: "Robotics",
        companyName: "Harbor",
        events: [{ title: "Demo day", startsAt: new Date(), checkIns: 80, signUps: 120 }],
        deliverables: [
          { title: "Logo", doneAt: new Date(), dueOn: null },
          { title: "Talk", doneAt: null, dueOn: null },
        ],
      }),
    ).toEqual(["One event so far, with 80 people checked in and 120 signed up.", "1 of 2 promises kept so far."]);
  });
});
