import { describe, expect, it } from "vitest";

import { rsvpEmail } from "./email";

const base = {
  template: "registered" as const,
  guestName: "Ada Lovelace",
  orgName: "Riverside Robotics",
  title: "Build night",
  when: "Thursday, October 15, 6:00 – 7:00 PM EDT",
  startTime: "6:00 PM",
  location: "Curry 340",
  locationDetails: null,
  joinUrl: null,
  pageUrl: "https://app.test/e/abc/manage?key=k",
  calendarUrl: "https://app.test/e/abc/calendar.ics",
};

describe("rsvpEmail: one click from the email", () => {
  it("has Add to calendar and Can't go", () => {
    const { html, text } = rsvpEmail(base);
    expect(html).toContain("Add to calendar");
    expect(html).toContain("https://app.test/e/abc/calendar.ics");
    expect(text).toContain("Can't go: https://app.test/e/abc/manage?key=k");
  });

  it("leads a close reminder for an online meeting with Join", () => {
    const { html } = rsvpEmail({
      ...base,
      template: "reminder",
      offsetMinutes: 60,
      joinUrl: "https://meet.example/x",
    });
    expect(html.indexOf("Join the meeting")).toBeGreaterThan(-1);
    expect(html).toMatch(/href="https:\/\/meet\.example\/x"[^>]*>[^<]*Join the meeting/);
  });

  it("puts no links on a cancellation", () => {
    const { html } = rsvpEmail({ ...base, template: "event-cancelled" });
    expect(html).not.toContain("Add to calendar");
    expect(html).not.toContain("Can't go");
  });
});
