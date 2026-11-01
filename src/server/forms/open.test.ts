import { describe, expect, it } from "vitest";

import { isFormOpen } from "./forms";

const base = {
  closedAt: null,
  closesAt: null,
  responseCap: null,
  deletedAt: null,
  publishedAt: new Date("2026-10-01"),
};

describe("isFormOpen", () => {
  it("keeps a draft closed until it's published", () => {
    expect(isFormOpen({ ...base, publishedAt: null }, 0)).toBe(false);
    expect(isFormOpen(base, 0)).toBe(true);
  });

  it("closes on a date, a cap or by hand", () => {
    const now = new Date("2026-10-31");
    expect(isFormOpen({ ...base, closesAt: new Date("2026-10-30") }, 0, now)).toBe(false);
    expect(isFormOpen({ ...base, responseCap: 3 }, 3)).toBe(false);
    expect(isFormOpen({ ...base, closedAt: new Date() }, 0)).toBe(false);
  });
});
