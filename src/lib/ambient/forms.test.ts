import { describe, expect, it } from "vitest";

import {
  closingWithin,
  fewAnswers,
  makeReport,
  pulseReady,
  shareAgain,
  shareAgainPost,
  storageNearlyFull,
} from "./forms";

const NOW = new Date("2026-11-04T15:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

const form = { open: true, draft: false, closesAt: inHours(40), responses: 4 };

describe("Share again", () => {
  it("is for an open form closing within two days", () => {
    expect(closingWithin(form, NOW)).toBe(40);
    expect(closingWithin({ ...form, closesAt: inHours(72) }, NOW)).toBeNull();
    expect(closingWithin({ ...form, draft: true }, NOW)).toBeNull();
    expect(closingWithin({ ...form, closesAt: null }, NOW)).toBeNull();
  });

  it("needs few answers", () => {
    expect(fewAnswers({ responses: 4 })).toBe(true);
    expect(fewAnswers({ responses: 12 })).toBe(false);
    expect(fewAnswers({ responses: 12, lastTime: 30 })).toBe(true);
    expect(fewAnswers({ responses: 12, outOf: 20 })).toBe(false);
    expect(fewAnswers({ responses: 8, outOf: 20 })).toBe(true);
  });

  it("says why", () => {
    expect(shareAgain(form, NOW)?.reason).toBe("4 answers, closes in 2 days");
    expect(shareAgain({ ...form, closesAt: inHours(30) }, NOW)?.reason).toBe(
      "4 answers, closes tomorrow",
    );
    expect(shareAgain({ ...form, closesAt: inHours(5) }, NOW)?.reason).toBe(
      "4 answers, closes in 5 hours",
    );
    expect(shareAgain({ ...form, responses: 12, lastTime: 30 }, NOW)?.reason).toBe(
      "12 answers, fewer than last time",
    );
    expect(shareAgain({ ...form, responses: 40 }, NOW)).toBeNull();
  });

  it("writes the post", () => {
    const post = shareAgainPost("Application", inHours(40), "https://x.test/f/app", "UTC");
    expect(post.title).toBe("Application closes Friday");
    expect(post.body).toContain("https://x.test/f/app");
  });
});

describe("Make a report", () => {
  it("is for a closed form with answers and no report", () => {
    const closed = { open: false, draft: false, responses: 12, hasReport: false };
    expect(makeReport(closed)?.reason).toBe("Closed with 12 answers");
    expect(makeReport({ ...closed, hasReport: true })).toBeNull();
    expect(makeReport({ ...closed, responses: 0 })).toBeNull();
    expect(makeReport({ ...closed, open: true })).toBeNull();
  });
});

describe("pulse and storage", () => {
  it("Send now is for an unsent draft while the pulse is on", () => {
    expect(pulseReady({ sentAt: null }, true)).toBe(true);
    expect(pulseReady({ sentAt: NOW }, true)).toBe(false);
    expect(pulseReady({ sentAt: null }, false)).toBe(false);
  });

  it("Free up space from 90% used", () => {
    expect(storageNearlyFull(95, 100)).toBe(0.95);
    expect(storageNearlyFull(80, 100)).toBeNull();
    expect(storageNearlyFull(1, 0)).toBeNull();
  });
});
