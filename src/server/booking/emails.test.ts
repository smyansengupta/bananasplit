import { describe, expect, it } from "vitest";

import { guestEmail, type GuestEmailInput } from "./emails";

const base: GuestEmailInput = {
  template: "booked",
  guestName: "Sam Rivera",
  title: "Coffee with the president",
  hostName: "Ada Lovelace",
  orgName: "Northside Makers",
  when: "Tuesday, November 10, 3:00 PM EST",
  durationMin: 30,
  verified: false,
  joinUrl: null,
  location: null,
  manageUrl: "https://app.example/book/m/tok",
  calendarUrl: "https://app.example/book/m/tok/calendar.ics",
};

describe("the guest's booking emails", () => {
  it("puts no link the link's maker typed in front of a stranger", () => {
    const m = guestEmail({
      ...base,
      title: "URGENT re-verify at https://bananasplit-verify.example.net/login now",
      hostName: "Support support@evil.example",
      orgName: "Accounts www.evil.example",
      location: "https://bananasplit-account-verify.example.net/login",
      joinUrl: "https://evil.example/join",
      joinFromAccount: false,
    });
    const all = `${m.subject}
${m.text}
${m.html}`;
    expect(all).not.toMatch(/evil\.example|verify\.example|account-verify/);
    expect(m.text).toContain("booking page");
    // A join link from a connected video account still goes in.
    const ok = guestEmail({ ...base, verified: true, joinUrl: "https://zoom.us/j/123", joinFromAccount: true });
    expect(ok.text).toContain("https://zoom.us/j/123");
  });
  it("asks an unconfirmed guest to say the address is theirs, on their booking page", () => {
    const m = guestEmail(base);
    expect(m.subject).toBe("Confirm your time: Coffee with the president (Ada Lovelace)");
    expect(m.text).toContain("Confirm it's me: https://app.example/book/m/tok");
    expect(m.text).toContain("Hi Sam,");
  });

  it("never repeats a name that isn't one (no links put in front of a stranger)", () => {
    const m = guestEmail({ ...base, guestName: "https://evil.example/login" });
    expect(m.text).not.toContain("evil.example");
    expect(m.html).not.toContain("evil.example");
    expect(m.text).toContain("Hi,");
  });

  it("names the host once when the link already does, and says who sends the details with no video account", () => {
    const m = guestEmail({ ...base, title: "Meet with Ada" });
    expect(m.subject).toBe("Confirm your time: Meet with Ada");
    expect(m.text).toContain("Ada will let you know how to join.");
    expect(guestEmail({ ...base, linkPending: true }).text).toContain("The join link will be on your booking page.");
  });

  it("cancels without links to move it", () => {
    const m = guestEmail({ ...base, template: "cancelled", verified: true });
    expect(m.subject).toBe("Cancelled: Coffee with the president (Ada Lovelace)");
    expect(m.text).not.toContain("Move or cancel");
  });

  it("leads a reminder for an online meeting with the join link", () => {
    const m = guestEmail({ ...base, template: "reminder", offsetMinutes: 60, verified: true, joinUrl: "https://meet.example/x" });
    expect(m.text).toContain("Join the meeting: https://meet.example/x");
    expect(m.text).toContain("in an hour");
  });
});
