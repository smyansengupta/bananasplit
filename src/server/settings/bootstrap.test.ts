import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

const { suggestCbcMapping } = await import("./bootstrap");

describe("suggestCbcMapping", () => {
  it("matches full names first, then a unique first name, never one member twice", () => {
    const mapping = suggestCbcMapping([
      { userId: "u_jackson", name: "Jackson Lamoureux" },
      { userId: "u_oliver", name: "oliver ward" },
      { userId: "u_alex1", name: "Alex Green" },
      { userId: "u_alex2", name: "Alex Kim" },
      { userId: "u_lucas", name: "Lucas S." },
      { userId: "u_nobody", name: null },
    ]);
    expect(mapping).toMatchObject({
      jackson: "u_jackson",
      oliver: "u_oliver",
      alex: "u_alex1",
      lucas: "u_lucas",
    });
    expect(mapping.mehr).toBeUndefined();
    expect(new Set(Object.values(mapping)).size).toBe(Object.values(mapping).length);
  });

  it("leaves an ambiguous first name unmatched", () => {
    const mapping = suggestCbcMapping([
      { userId: "a", name: "Kristine One" },
      { userId: "b", name: "Kristine Two" },
    ]);
    expect(mapping.kristine).toBeUndefined();
  });
});
