import { describe, expect, it } from "vitest";

import { sendRange } from "./schedule";

describe("what a scheduled send covers", () => {
  const now = new Date("2026-11-02T15:00:00Z");
  it("covers the seven days before a weekly send", () => {
    expect(sendRange({ every: "week", day: 1, hour: 9, to: "me" }, "UTC", now)).toEqual({
      from: "2026-10-26",
      to: "2026-11-01",
    });
  });
  it("covers last month for a monthly send", () => {
    expect(sendRange({ every: "month", day: 2, hour: 9, to: "me" }, "UTC", now)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });
});
