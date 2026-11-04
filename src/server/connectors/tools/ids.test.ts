import { describe, expect, it } from "vitest";

import { NotFoundError } from "@/lib/auth/errors";

import { isSpaceId, itemId, memberOf, parseItemId, refOf } from "./ids";

describe("the item id codec", () => {
  it("round-trips every kind with its space", () => {
    for (const kind of [
      "note",
      "task",
      "event",
      "poll",
      "person",
      "database",
      "expense",
    ] as const) {
      const id = itemId(kind, "org_robotics-1", "cmvx12abc");
      expect(id).toBe(`${kind}:org_robotics-1:cmvx12abc`);
      expect(parseItemId(id)).toEqual({ kind, spaceId: "org_robotics-1", id: "cmvx12abc" });
    }
    // A database's id part is its URL key.
    expect(parseItemId("database:org_1:gear-2")).toEqual({
      kind: "database",
      spaceId: "org_1",
      id: "gear-2",
    });
  });

  it("refuses anything it wouldn't make", () => {
    for (const bad of [
      "",
      "task",
      "task:org_1",
      "task:org_1:abc:extra",
      "folder:org_1:abc",
      "TASK:org_1:abc",
      "task::abc",
      "task:org_1:",
      "task:org 1:abc",
      "task:org_1:a/b",
      `task:org_1:${"x".repeat(129)}`,
    ]) {
      expect(parseItemId(bad), bad).toBeNull();
    }
    expect(() => itemId("task", "org:1", "abc")).toThrow(TypeError);
  });

  it("answers the wrong kind as not found, the same as a missing id", () => {
    expect(refOf("task:org_1:abc", "task")).toEqual({ kind: "task", spaceId: "org_1", id: "abc" });
    expect(() => refOf("note:org_1:abc", "task")).toThrow(NotFoundError);
    expect(() => refOf("garbage", "task")).toThrow(NotFoundError);
  });

  it("reads a member argument as me, or a person in this space only", () => {
    expect(memberOf("me", "org_1", "user_me")).toBe("user_me");
    expect(memberOf(" Me ", "org_1", "user_me")).toBe("user_me");
    expect(memberOf("person:org_1:user_bob", "org_1", "user_me")).toBe("user_bob");
    expect(memberOf("person:org_2:user_bob", "org_1", "user_me")).toBeNull();
    expect(memberOf("task:org_1:user_bob", "org_1", "user_me")).toBeNull();
    expect(memberOf("user_bob", "org_1", "user_me")).toBeNull();
  });

  it("checks a space id's shape", () => {
    expect(isSpaceId("cmvpv4c7yfbaa8cee7db205e8dc")).toBe(true);
    expect(isSpaceId("org_tool_paused_1a2b")).toBe(true);
    expect(isSpaceId("org:1")).toBe(false);
    expect(isSpaceId("")).toBe(false);
  });
});
