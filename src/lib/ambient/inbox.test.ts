import { describe, expect, it } from "vitest";

import {
  canWaitTillMonday,
  inviteReason,
  mentionReason,
  mentionWaiting,
  nextMondayKey,
  recapIsDue,
  requestReason,
  reviewAction,
  smallBatch,
} from "./inbox";

const NOW = new Date("2026-11-04T15:00:00Z"); // a Wednesday
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const req = (id: string, amountCents: number, receipts = 1) => ({
  id,
  amountCents,
  receipts,
  createdAt: hoursAgo(30),
});

describe("smallBatch", () => {
  it("offers Approve all for three or more small ones with receipts", () => {
    const batch = smallBatch([req("a", 4200), req("b", 1800), req("c", 4999), req("d", 9000)]);
    expect(batch).toEqual({
      ids: ["a", "b", "c"],
      label: "Approve all 3",
      reason: "All three are under $50 and have receipts",
    });
  });

  it("leaves out one without a receipt, and needs three", () => {
    expect(smallBatch([req("a", 4200), req("b", 1800), req("c", 1000, 0)])).toBeNull();
    expect(smallBatch([req("a", 5000), req("b", 1800), req("c", 1000)])).toBeNull();
  });
});

describe("requestReason", () => {
  it("says how long it waited and about the receipt", () => {
    expect(requestReason({ receipts: 1, createdAt: hoursAgo(2) }, NOW)).toBe(
      "Sent today, has a receipt",
    );
    expect(requestReason({ receipts: 0, createdAt: hoursAgo(80) }, NOW)).toBe(
      "Waiting 3 days, no receipt",
    );
  });
});

describe("mentions", () => {
  it("waits about a day before Reply shows", () => {
    expect(mentionWaiting(hoursAgo(5), NOW)).toBe(false);
    expect(mentionWaiting(hoursAgo(26), NOW)).toBe(true);
  });

  it("names who and when", () => {
    expect(mentionReason("Kristine Moss", hoursAgo(26), NOW)).toBe(
      "Kristine mentioned you a day ago",
    );
    expect(mentionReason(null, hoursAgo(73), NOW)).toBe("Someone mentioned you 3 days ago");
  });
});

describe("inviteReason", () => {
  it("says when", () => {
    expect(inviteReason("2026-11-04", "2026-11-04")).toBe("Today, you haven't answered");
    expect(inviteReason("2026-11-05", "2026-11-04")).toBe("Tomorrow, you haven't answered");
    expect(inviteReason("2026-11-08", "2026-11-04")).toBe("This week, you haven't answered");
    expect(inviteReason("2026-11-20", "2026-11-04")).toBe("Coming up, you haven't answered");
  });
});

describe("reviewAction", () => {
  it("counts the answers", () => {
    expect(reviewAction(12)?.label).toBe("Review 12");
    expect(reviewAction(1)?.reason).toBe("1 new answer to review");
    expect(reviewAction(0)).toBeNull();
  });
});

describe("Snooze to Monday", () => {
  it("is next week's Monday", () => {
    expect(nextMondayKey("2026-11-04")).toBe("2026-11-09");
    expect(nextMondayKey("2026-11-09")).toBe("2026-11-16");
    expect(nextMondayKey("2026-11-08")).toBe("2026-11-09");
  });

  it("shows only for what can wait", () => {
    expect(canWaitTillMonday({}, "2026-11-04")).toBe(true);
    expect(canWaitTillMonday({ urgent: true }, "2026-11-04")).toBe(false);
    expect(canWaitTillMonday({ dayKey: "2026-11-06" }, "2026-11-04")).toBe(false);
    expect(canWaitTillMonday({ dayKey: "2026-11-09" }, "2026-11-04")).toBe(true);
  });
});

describe("recapIsDue", () => {
  it("is due in the window until one is posted", () => {
    expect(recapIsDue(new Date(), 0)).toBe(true);
    expect(recapIsDue(new Date(), 1)).toBe(false);
    expect(recapIsDue(null, 0)).toBe(false);
  });
});
