import { describe, expect, it } from "vitest";

import { buildTransactionWhere } from "./queries";

describe("buildTransactionWhere", () => {
  it("includes the whole of a date-only end day, whatever the time", () => {
    const where = buildTransactionWhere("org1", { dateFrom: "2026-09-21", dateTo: "2026-09-21" });
    expect(where.occurredAt).toEqual({
      gte: new Date("2026-09-21T00:00:00.000Z"),
      lt: new Date("2026-09-22T00:00:00.000Z"),
    });
  });

  it("reads a full timestamp end as that instant", () => {
    const where = buildTransactionWhere("org1", { dateTo: "2026-09-21T12:00:00.000Z" });
    expect(where.occurredAt).toEqual({ lte: new Date("2026-09-21T12:00:00.000Z") });
  });
});
