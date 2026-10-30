import { describe, expect, it } from "vitest";

import { registrationSchema } from "./schema";

describe("registrationSchema: the phone number", () => {
  it("is optional", () => {
    const left = registrationSchema.parse({ name: "Ada", email: "ada@example.com" });
    expect(left.phone).toBe("");
    const blank = registrationSchema.parse({ name: "Ada", email: "ada@example.com", phone: " " });
    expect(blank.phone).toBe("");
  });

  it("is still checked when given", () => {
    expect(
      registrationSchema.safeParse({ name: "Ada", email: "ada@example.com", phone: "abc" }).success,
    ).toBe(false);
  });
});
