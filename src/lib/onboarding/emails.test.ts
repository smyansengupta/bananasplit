import { describe, expect, it } from "vitest";

import { emailPatch, setupEmailSwitches } from "./emails";

describe("setupEmailSwitches", () => {
  const allOn = { assigned: true, due: true, events: true, mentions: true, digest: true };

  it("turns everything on for someone who has never chosen (the column's default is {})", () => {
    expect(setupEmailSwitches({})).toEqual(allOn);
    expect(setupEmailSwitches(null)).toEqual(allOn);
  });

  it("starts from what they chose, so a second organization's setup turns nothing back on", () => {
    const chosen = emailPatch({ ...allOn, mentions: false, digest: false });
    expect(setupEmailSwitches(chosen)).toEqual({ ...allOn, mentions: false, digest: false });
  });
});
