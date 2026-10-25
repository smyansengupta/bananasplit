import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", () => ({ withUserTx: vi.fn() }));

import { consentOptions } from "./consent";
import { ACCESS_CLAIM, SPACE_CLAIM } from "./token";

describe("consentOptions", () => {
  it("offers all spaces, Personal, then each club under a heading, and read first", () => {
    const options = consentOptions([
      { id: "org_personal", name: "Alice Nguyen", kind: "personal" },
      { id: "org_robotics", name: "Robotics Club", kind: "club" },
      { id: "org_chess", name: "Chess Club", kind: "club" },
    ]);
    expect(options).toEqual([
      {
        claim: SPACE_CLAIM,
        type: "enum",
        label: "Which spaces it can use",
        choices: [
          { group: "All spaces", choices: [{ value: "all", label: "Personal and all my clubs" }] },
          { group: "Personal", choices: [{ value: "org_personal", label: "Personal only" }] },
          {
            group: "Clubs",
            choices: [
              { value: "org_robotics", label: "Robotics Club only" },
              { value: "org_chess", label: "Chess Club only" },
            ],
          },
        ],
      },
      {
        claim: ACCESS_CLAIM,
        type: "enum",
        label: "What it can do",
        choices: [
          { value: "read", label: "Read only" },
          { value: "write", label: "Read and make changes" },
        ],
      },
    ]);
  });

  it("keeps the choices flat without clubs (no mix of flat and grouped)", () => {
    const [space] = consentOptions([{ id: "org_personal", name: "Alice", kind: "personal" }]);
    expect(space?.choices).toEqual([
      { value: "all", label: "Personal and all my clubs" },
      { value: "org_personal", label: "Personal only" },
    ]);
  });
});
