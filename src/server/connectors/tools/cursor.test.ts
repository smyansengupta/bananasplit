import { describe, expect, it } from "vitest";

import { CursorError, decodeCursor, encodeCursor, listFingerprint, pageOf } from "./cursor";

describe("the cursor codec", () => {
  const list = listFingerprint("list_tasks", { space: "org_1", status: "open" });

  it("round-trips an offset and a keyset position, opaque to the app", () => {
    const cursor = encodeCursor(list, { offset: 40 });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, list)).toEqual({ offset: 40 });
    const keyset = encodeCursor(list, { offset: 20, after: "2026-10-01T12:00:00.000Z~rec_1" });
    expect(decodeCursor(keyset, list)).toEqual({
      offset: 20,
      after: "2026-10-01T12:00:00.000Z~rec_1",
    });
  });

  it("starts at the top without a cursor", () => {
    expect(decodeCursor(undefined, list)).toEqual({ offset: 0 });
    expect(decodeCursor("", list)).toEqual({ offset: 0 });
  });

  it("fingerprints the list by tool and filters, in any key order, ignoring the unset ones", () => {
    expect(
      listFingerprint("list_tasks", { status: "open", space: "org_1", query: undefined }),
    ).toBe(list);
    expect(listFingerprint("list_tasks", { space: "org_1", status: "done" })).not.toBe(list);
    expect(listFingerprint("list_notes", { space: "org_1", status: "open" })).not.toBe(list);
  });

  it("refuses a cursor from another list, and anything it didn't make", () => {
    const other = encodeCursor(listFingerprint("list_tasks", { space: "org_2" }), { offset: 20 });
    expect(() => decodeCursor(other, list)).toThrow(CursorError);
    const forge = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString("base64url");
    for (const bad of [
      "not base64 json",
      forge(null),
      forge({ v: 2, s: list, o: 0 }),
      forge({ v: 1, s: list, o: -1 }),
      forge({ v: 1, s: list, o: 1.5 }),
      forge({ v: 1, s: list, o: 10_000_000 }),
      forge({ v: 1, s: list, o: 0, a: 7 }),
    ]) {
      expect(() => decodeCursor(bad, list), bad).toThrow(CursorError);
    }
  });

  it("says so in words the app can act on, without repeating the cursor", () => {
    const error = new CursorError();
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/without a cursor/);
  });
});

describe("pageOf", () => {
  const list = listFingerprint("list_notes", { space: "org_1" });

  it("keeps `limit` rows and points past them when one more was read", () => {
    const page = pageOf([1, 2, 3], 2, list, { offset: 10 });
    expect(page.items).toEqual([1, 2]);
    expect(decodeCursor(page.nextCursor!, list)).toEqual({ offset: 12 });
  });

  it("ends the list when no extra row came back", () => {
    expect(pageOf([1, 2], 2, list, { offset: 0 })).toEqual({ items: [1, 2], nextCursor: null });
    expect(pageOf([], 20, list, { offset: 40 })).toEqual({ items: [], nextCursor: null });
  });
});
