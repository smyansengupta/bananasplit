import { describe, expect, it } from "vitest";

import { copyIsStale, failedSend, rangeOfCopy, type SendJob } from "./reports";

describe("Refresh a kept copy", () => {
  it("shows once the data changed after the copy", () => {
    const taken = "2026-10-20T12:00:00.000Z";
    expect(copyIsStale(taken, new Date("2026-10-21T00:00:00Z"))).not.toBeNull();
    expect(copyIsStale(taken, new Date("2026-10-19T00:00:00Z"))).toBeNull();
    expect(copyIsStale(taken, null)).toBeNull();
    expect(copyIsStale(null, new Date())).toBeNull();
  });
});

const job = (kind: string, key: string, status: string, payload: object = {}): SendJob => ({
  kind,
  dedupeKey: `${kind}:${key}`,
  status,
  payload,
  createdAt: new Date("2026-11-01T09:00:00Z"),
});

describe("Send again", () => {
  it("retries the copy when the last send gave up", () => {
    const out = failedSend(
      [
        job("report-send", "r1:2026-10-25", "DONE"),
        job("report-send", "r1:2026-11-01", "DEAD", { reportId: "r1", sendKey: "2026-11-01" }),
      ],
      "r1",
    );
    expect(out?.day).toBe("2026-11-01");
    expect(out?.retry).toEqual([
      {
        kind: "report-send",
        key: "r1:2026-11-01",
        payload: { reportId: "r1", sendKey: "2026-11-01" },
      },
    ]);
    expect(out?.reason).toBe("The last scheduled send didn't go out");
  });
  it("retries only the emails that gave up", () => {
    const out = failedSend(
      [
        job("report-send", "r1:2026-11-01", "DONE"),
        job("report-email", "r1:2026-11-01:u1", "DONE"),
        job("report-email", "r1:2026-11-01:u2", "DEAD", { reportId: "r1", userId: "u2" }),
      ],
      "r1",
    );
    expect(out?.retry.map((r) => r.key)).toEqual(["r1:2026-11-01:u2"]);
    expect(out?.reason).toBe("1 email from the last send didn't go out");
  });
  it("is quiet when the last send went out, is still trying, or was sent again", () => {
    expect(failedSend([job("report-send", "r1:2026-11-01", "DONE")], "r1")).toBeNull();
    expect(
      failedSend(
        [job("report-send", "r1:2026-10-25", "DEAD"), job("report-send", "r1:2026-11-01", "DONE")],
        "r1",
      ),
    ).toBeNull();
    expect(
      failedSend(
        [
          job("report-send", "r1:2026-11-01", "DEAD"),
          job("report-send", "r1:2026-11-01", "PENDING"),
        ],
        "r1",
      ),
    ).toBeNull();
    expect(
      failedSend(
        [job("report-send", "r1:2026-11-01", "DEAD"), job("report-send", "r1:2026-11-01", "DONE")],
        "r1",
      ),
    ).toBeNull();
    expect(failedSend([], "r1")).toBeNull();
  });
  it("reads only this report's jobs", () => {
    expect(failedSend([job("report-send", "r2:2026-11-01", "DEAD")], "r1")).toBeNull();
  });
});

describe("the dates a copy was kept over", () => {
  it("reads a span in one year", () => {
    expect(rangeOfCopy("Jul 1 – Sep 30, 2026")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });
  it("reads a span across years", () => {
    expect(rangeOfCopy("Dec 15, 2025 – Jan 14, 2026")).toEqual({
      from: "2025-12-15",
      to: "2026-01-14",
    });
  });
  it("reads one day and all time", () => {
    expect(rangeOfCopy("Sep 1, 2026")).toEqual({ from: "2026-09-01", to: "2026-09-01" });
    expect(rangeOfCopy("All time")).toEqual({ range: "all" });
  });
  it("falls back to the default range for anything else", () => {
    expect(rangeOfCopy("Fall 2026")).toEqual({});
    expect(rangeOfCopy("Sep 30 – Jul 1, 2026")).toEqual({});
  });
});
