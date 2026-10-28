import { describe, expect, it } from "vitest";

import { dayOf, sliceText, TEXT_LIMIT, zonedIso } from "./text";

describe("sliceText", () => {
  it("returns a short text whole", () => {
    expect(sliceText("# Minutes\n\nWe met.\n")).toEqual({
      text: "# Minutes\n\nWe met.\n",
      offset: 0,
      totalLength: 19,
      truncated: false,
      nextOffset: null,
    });
  });

  it("cuts a long text at TEXT_LIMIT, after the last line break near it, and joins back whole", () => {
    const line = `${"word ".repeat(19)}end\n`;
    const whole = line.repeat(Math.ceil((TEXT_LIMIT * 2.5) / line.length));
    const parts: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const part = sliceText(whole, offset);
      expect(part.text.length).toBeLessThanOrEqual(TEXT_LIMIT);
      expect(part.offset).toBe(offset);
      expect(part.totalLength).toBe(whole.length);
      if (part.truncated) expect(part.text.endsWith("\n")).toBe(true);
      parts.push(part.text);
      offset = part.nextOffset;
    }
    expect(parts.length).toBe(3);
    expect(parts.join("")).toBe(whole);
  });

  it("cuts at the limit itself when there's no line break near it", () => {
    const part = sliceText("a".repeat(100), 0, 30);
    expect(part).toMatchObject({ truncated: true, nextOffset: 30 });
    expect(part.text).toHaveLength(30);
  });

  it("never splits an emoji between two parts", () => {
    const whole = `${"a".repeat(29)}🙂${"b".repeat(40)}`;
    const first = sliceText(whole, 0, 30);
    expect(first.text).toBe("a".repeat(29));
    const second = sliceText(whole, first.nextOffset!, 30);
    expect(second.text.startsWith("🙂")).toBe(true);
    // An offset that lands inside the emoji starts after it.
    expect(sliceText(whole, 30, 30).offset).toBe(31);
  });

  it("returns nothing past the end, and reads a negative offset as the start", () => {
    expect(sliceText("short", 50)).toEqual({
      text: "",
      offset: 5,
      totalLength: 5,
      truncated: false,
      nextOffset: null,
    });
    expect(sliceText("short", -3).text).toBe("short");
  });
});

describe("times", () => {
  it("writes an instant in a zone with its offset", () => {
    const at = new Date("2026-10-27T22:00:00Z");
    expect(zonedIso(at, "America/New_York")).toBe("2026-10-27T18:00:00-04:00");
    expect(zonedIso(at, "UTC")).toBe("2026-10-27T22:00:00Z");
  });

  it("writes a date-only value as its day", () => {
    expect(dayOf(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01");
  });
});
