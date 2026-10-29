import { describe, expect, it } from "vitest";

import { pulseHeadline, pulseNextWeek, pulseRows, parsePulseData } from "@/lib/pulse/data";
import { pulseRecipients } from "@/lib/pulse/settings";
import { pulseEmail } from "@/server/email/pulse";

import { seesPulseFinance } from "./finance";
import { rangeInstants, shapePulseData, type PulseRaw } from "./generate";

/**
 * Pulse generation on a fixed fixture week: a Friday club in New York, the
 * week of Sat Oct 3 to Fri Oct 9, 2026. The reads are mocked out (shape is
 * pure), so this pins the rules: counts per epic, epics finished, polls,
 * next week's window, who gets it, and that money stays with finance roles.
 */

const range = { from: "2026-10-03", to: "2026-10-09" };
const at = (iso: string) => new Date(iso);

const raw: PulseRaw = {
  range,
  timeZone: "America/New_York",
  epics: [
    { id: "p_show", name: "Fall Showcase", color: "#e9b41c" },
    { id: "p_rec", name: "Recruitment", color: null },
    { id: "p_idle", name: "Archive cleanup", color: null },
  ],
  done: [
    { id: "t1", type: "TASK", title: "Book the ballroom", epicId: "p_show" },
    { id: "t2", type: "TASK", title: "Approve the quote", epicId: "p_show" },
    { id: "t5", type: "STORY", title: "Venue and logistics", epicId: "p_show" },
    { id: "e1", type: "EPIC", title: "Spring kickoff", epicId: "e1" },
    { id: "t3", type: "STORY", title: "Tabling plan", epicId: "p_rec" },
    { id: "t4", type: "TASK", title: "Order stickers", epicId: null },
  ],
  openByEpic: [
    { epicId: "p_show", open: 4 },
    { epicId: "p_idle", open: 0 },
    { epicId: null, open: 2 },
  ],
  events: [
    { id: "ev2", title: "Officer meeting", startsAt: at("2026-10-06T23:00:00Z"), checkIns: 8 },
    { id: "ev1", title: "General meeting", startsAt: at("2026-10-05T22:00:00Z"), checkIns: 32 },
  ],
  members: [{ userId: "u_new", name: "Priya Shah", joinedAt: at("2026-10-07T15:00:00Z") }],
  signups: [
    { contactId: "c_1", name: "  ", joinedAt: at("2026-10-04T15:00:00Z") },
    { contactId: "c_2", name: "Sam Lee", joinedAt: at("2026-10-08T15:00:00Z") },
  ],
  polls: [
    {
      kind: "poll",
      id: "q1",
      question: "T-shirt color",
      totalVotes: 21,
      options: [
        { label: "Forest", votes: 6 },
        { label: "Midnight blue", votes: 12 },
        { label: "Red", votes: 3 },
      ],
    },
  ],
  dueNext: [
    { id: "d1", title: "SAO application", dueDate: at("2026-10-16T00:00:00Z"), ownerId: "u_1" },
    // Outside next week (Oct 10 to Oct 16): dropped.
    { id: "d2", title: "Spring budget", dueDate: at("2026-10-17T00:00:00Z"), ownerId: null },
  ],
  eventsNext: [
    // 7pm Tuesday Oct 13 in New York.
    { id: "n1", title: "Officer meeting", startsAt: at("2026-10-13T23:00:00Z") },
    // 9pm Thursday Oct 15 in New York, which is already Friday in UTC.
    { id: "n2", title: "General meeting", startsAt: at("2026-10-16T01:00:00Z") },
  ],
};

describe("shapePulseData", () => {
  const data = shapePulseData(raw);

  it("counts everything finished, per epic, with a line for work outside one", () => {
    expect(data.v).toBe(1);
    expect(data.range).toEqual(range);
    expect(data.doneCount).toBe(6);
    expect(data.byProject).toEqual([
      { projectId: "p_show", name: "Fall Showcase", color: "#e9b41c", done: 3, open: 4 },
      { projectId: "p_rec", name: "Recruitment", color: null, done: 1, open: 0 },
      { projectId: null, name: "Not in an epic", color: null, done: 1, open: 2 },
    ]);
  });

  it("names the epics that finished", () => {
    expect(data.epicsFinished).toEqual([{ id: "e1", title: "Spring kickoff", project: null }]);
  });

  it("lists events in order with check-ins, and new members and sign-ups by join time", () => {
    expect(data.events.map((e) => [e.title, e.checkIns])).toEqual([
      ["General meeting", 32],
      ["Officer meeting", 8],
    ]);
    expect(data.newMembers.map((m) => m.name)).toEqual(["New member", "Priya Shah", "Sam Lee"]);
    expect(data.newMembers[1]).toMatchObject({ userId: "u_new", contactId: null });
  });

  it("orders each poll's options by votes", () => {
    expect(data.pollResults[0].options.map((o) => o.label)).toEqual([
      "Midnight blue",
      "Forest",
      "Red",
    ]);
  });

  it("keeps next week to the seven days after the send day, dated in the club's zone", () => {
    expect(data.nextWeek).toEqual([
      { kind: "event", id: "n1", title: "Officer meeting", date: "2026-10-13", ownerId: null },
      { kind: "event", id: "n2", title: "General meeting", date: "2026-10-15", ownerId: null },
      { kind: "task", id: "d1", title: "SAO application", date: "2026-10-16", ownerId: "u_1" },
    ]);
    expect(pulseNextWeek(data).map((n) => n.text)).toEqual([
      "Officer meeting Tue",
      "General meeting Thu",
      "SAO application due Fri",
    ]);
  });

  it("round-trips through the stored shape, and reads the seed's issue without the new fields", () => {
    expect(parsePulseData(JSON.parse(JSON.stringify(data)))).toEqual(data);
    const { epicsFinished: _e, ...seedShape } = data;
    expect(parsePulseData(seedShape)?.epicsFinished).toBeUndefined();
    expect(parsePulseData({ v: 2 })).toBeNull();
  });

  it("reads as the guide's issue", () => {
    expect(pulseHeadline(data)).toBe("6 things done · 32 at the General meeting · 3 new members");
    const rows = pulseRows(data).map((r) => r.title);
    expect(rows).toEqual([
      "Spring kickoff is done",
      "6 tasks finished",
      "32 came to the General meeting",
      "8 came to the Officer meeting",
      "T-shirt color: Midnight blue won",
      "3 new members joined",
      "Next week",
    ]);
  });
});

describe("the week's instants", () => {
  it("runs midnight to midnight in the club's zone and never reaches past now", () => {
    const now = at("2026-10-09T21:00:00Z"); // Fri 5pm in New York
    const { start, end } = rangeInstants(range, "America/New_York", now);
    expect(start.toISOString()).toBe("2026-10-03T04:00:00.000Z");
    expect(end).toEqual(now);
    const later = rangeInstants(range, "America/New_York", at("2026-10-20T00:00:00Z"));
    expect(later.end.toISOString()).toBe("2026-10-10T04:00:00.000Z");
  });
});

describe("who gets the pulse", () => {
  const members = [
    { userId: "owner", role: "OWNER" as const, emailOff: false },
    { userId: "admin", role: "ADMIN" as const, emailOff: true },
    { userId: "treasurer", role: "TREASURER" as const, emailOff: false },
    { userId: "member", role: "MEMBER" as const, emailOff: false },
  ];
  const emailOn = (m: { emailOff: boolean }) => !m.emailOff;

  it("everyone, minus the email for whoever turned it off", () => {
    const r = pulseRecipients(
      { pulseAudience: "EVERYONE", pulseEmail: true, pulseInApp: true },
      members,
      emailOn,
    );
    expect(r.inApp).toEqual(["owner", "admin", "treasurer", "member"]);
    expect(r.email).toEqual(["owner", "treasurer", "member"]);
  });

  it("officers are owners, admins and treasurers; channels can be off", () => {
    const r = pulseRecipients(
      { pulseAudience: "OFFICERS", pulseEmail: true, pulseInApp: false },
      members,
      emailOn,
    );
    expect(r.inApp).toEqual([]);
    expect(r.email).toEqual(["owner", "treasurer"]);
  });
});

describe("money in the pulse", () => {
  const data = shapePulseData(raw);
  const base = { orgName: "Riverside Robotics", data, note: null, issueUrl: "https://x.test/p" };

  it("is for finance roles only", () => {
    expect(seesPulseFinance("OWNER")).toBe(true);
    expect(seesPulseFinance("TREASURER")).toBe(true);
    expect(seesPulseFinance("ADMIN")).toBe(true);
    expect(seesPulseFinance("MEMBER")).toBe(false);
  });

  it("is never in the stored data, and only in a finance role's email", () => {
    expect(JSON.stringify(data)).not.toMatch(/cents|money/i);
    const member = pulseEmail({ ...base, finance: null });
    expect(member.html).not.toContain("Money moved");
    expect(member.text).not.toContain("Money moved");
    const treasurer = pulseEmail({
      ...base,
      finance: { inCents: 50_000, outCents: 12_550, pendingReimbursements: 2 },
    });
    expect(treasurer.text).toContain("Money moved: $500.00 in, $125.50 out");
    expect(treasurer.text).toContain("2 expenses waiting for review.");
  });

  it("escapes what members wrote, and puts the note first", () => {
    const email = pulseEmail({
      ...base,
      data: { ...data, events: [{ ...data.events[0], title: "<b>Gala</b>" }] },
      note: "Doors at 6:15",
      finance: null,
    });
    expect(email.html).toContain("&lt;b&gt;Gala&lt;/b&gt;");
    expect(email.text.indexOf("Doors at 6:15")).toBeLessThan(email.text.indexOf("tasks finished"));
  });
});
