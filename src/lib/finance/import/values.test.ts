import { describe, expect, it } from "vitest";

import { excelSerialToDate, guessDateOrder, looksLikeAmounts, looksLikeDates, parseAmount, parseDate } from "./values";

const today = "2026-10-01";

describe("parseAmount", () => {
  it.each([
    ["12.50", 1250, false],
    ["$1,234.56", 123456, false],
    ["-$25.00", 2500, true],
    ["$-25.00", 2500, true],
    ["- $25.00", 2500, true],
    ["+ $10.00", 1000, false],
    ["(12.00)", 1200, true],
    ["12.00-", 1200, true],
    ["45.10 DR", 4510, true],
    ["45.10 CR", 4510, false],
    ["−7", 700, true],
    ["1.234,56", 123456, false],
    ["12,5", 1250, false],
    ["1,234", 123400, false],
    ["1.234.567", 123456700, false],
    ["€ 9,99", 999, false],
    ["USD 3", 300, false],
    [".5", 50, false],
    ["5.", 500, false],
    ["0.005", 1, false],
    ["0.004", 0, false],
    ["1'234.50", 123450, false],
  ])("%s → %i cents", (raw, cents, negative) => {
    expect(parseAmount(raw)).toEqual({ cents, negative });
  });

  it.each(["", "N/A", "-", "abc", "2025-09-05", "1e3", "$", "12.3.4,5,6"])("rejects %j", (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });

  it("refuses absurdly long numbers instead of losing precision", () => {
    expect(parseAmount("123456789012345")).toBeNull();
  });
});

describe("parseDate", () => {
  it.each([
    ["2025-09-05", "2025-09-05"],
    ["2025-09-05T14:33:00", "2025-09-05"],
    ["2025/9/5", "2025-09-05"],
    ["9/5/2025", "2025-09-05"],
    ["09/05/25", "2025-09-05"],
    ["9/5/2025 6:30 PM", "2025-09-05"],
    ["Sep 5, 2025", "2025-09-05"],
    ["September 5 2025", "2025-09-05"],
    ["Sept. 5th, 2025", "2025-09-05"],
    ["5 Sep 2025", "2025-09-05"],
    ["5-Sep-25", "2025-09-05"],
    ["Thu, Sep 4, 2025", "2025-09-04"],
    ["Friday, September 5, 2025", "2025-09-05"],
  ])("%s → %s", (raw, iso) => {
    expect(parseDate(raw, { today })).toBe(iso);
  });

  it("reads day-first when told to", () => {
    expect(parseDate("05/09/2025", { order: "DMY", today })).toBe("2025-09-05");
    expect(parseDate("5.9.2025", { order: "DMY", today })).toBe("2025-09-05");
  });

  it("puts a date without a year in the past year, not months ahead", () => {
    expect(parseDate("Sep 5", { today })).toBe("2026-09-05");
    expect(parseDate("9/5", { today })).toBe("2026-09-05");
    expect(parseDate("Nov 15", { today })).toBe("2026-11-15");
    expect(parseDate("Dec 20", { today })).toBe("2025-12-20");
    expect(parseDate("Feb 3", { today })).toBe("2026-02-03");
    expect(parseDate("Dec 20", { today: "2026-03-01" })).toBe("2025-12-20");
  });

  it("rejects impossible and implausible dates", () => {
    expect(parseDate("2/30/2025", { today })).toBeNull();
    expect(parseDate("13/13/2025", { today })).toBeNull();
    expect(parseDate("1/1/1850", { today })).toBeNull();
    expect(parseDate("Total 45", { today })).toBeNull();
    expect(parseDate("May 2025", { today })).toBeNull();
    expect(parseDate("", { today })).toBeNull();
  });

  it("reads Excel date numbers only when asked", () => {
    expect(parseDate("45905", { today })).toBeNull();
    expect(parseDate("45905", { today, serials: true })).toBe("2025-09-05");
    expect(excelSerialToDate(1)).toBeNull();
    expect(excelSerialToDate(45905)).toBe("2025-09-05");
  });
});

describe("column sniffing", () => {
  it("guesses the date order from the values", () => {
    expect(guessDateOrder(["9/5/2025", "9/28/2025"])).toBe("MDY");
    expect(guessDateOrder(["28/9/2025", "5/9/2025"])).toBe("DMY");
    expect(guessDateOrder(["2025-09-05"])).toBe("YMD");
    expect(guessDateOrder(["9/5/2025"])).toBe("MDY");
  });

  it("tells dates and amounts apart", () => {
    expect(looksLikeDates(["9/5/2025", "9/6/2025", ""], today)).toBe(true);
    expect(looksLikeDates(["Pizza", "Zoom"], today)).toBe(false);
    expect(looksLikeAmounts(["$12.00", "-4.50", "8"])).toBe(true);
    expect(looksLikeAmounts(["9/5/2025", "9/6/2025"])).toBe(false);
    expect(looksLikeAmounts(["Pizza", "12"])).toBe(false);
  });
});
