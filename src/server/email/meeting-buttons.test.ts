import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", () => ({}));
vi.mock("@/server/db/clients", () => ({ authDb: {} }));
vi.mock("@/server/tasks/email", () => ({ renderTaskNotificationEmail: vi.fn() }));
vi.mock("./mailer", () => ({ getOrgMailer: vi.fn(), getPlatformMailer: vi.fn() }));
vi.mock("@/lib/app-url", () => ({ appUrl: (path: string) => `https://app.test${path}` }));

import { meetingEmailButtons } from "./jobs";

describe("meetingEmailButtons", () => {
  it("gives an invite Going and Can't go, which open the meeting with the answer ready", () => {
    const out = meetingEmailButtons("EVENT_INVITE", null, "/app/cbc/meetings/e1");
    expect(out.cta).toEqual({
      label: "Open the meeting",
      url: "https://app.test/app/cbc/meetings/e1",
    });
    expect(out.choices).toEqual([
      { label: "Going", url: "https://app.test/app/cbc/meetings/e1?rsvp=YES" },
      { label: "Can't go", url: "https://app.test/app/cbc/meetings/e1?rsvp=NO" },
    ]);
  });

  it("leads an online meeting's reminder with Join the meeting", () => {
    const body = "Mon, Nov 2, 7:00 PM\nJoin: https://zoom.us/j/123";
    expect(meetingEmailButtons("EVENT_REMINDER", body, "/app/cbc/meetings/e1")).toEqual({
      cta: { label: "Join the meeting", url: "https://zoom.us/j/123" },
    });
  });

  it("leaves everything else alone", () => {
    expect(meetingEmailButtons("EVENT_REMINDER", "Where: Curry 340", "/x")).toEqual({});
    expect(meetingEmailButtons("TASK_ASSIGNED", null, "/app/cbc/tasks/t1")).toEqual({});
  });
});
