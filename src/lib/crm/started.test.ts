import { describe, expect, it } from "vitest";

import {
  bringInChoices,
  canSkipCrmStep,
  crmStartedHref,
  crmStartedProgress,
  crmStartedSteps,
  orgSkipEntry,
  ownSkipKey,
  readCrmSkipped,
  type CrmStartedState,
} from "./started";

const admin = { admin: true, personal: false };
const member = { admin: false, personal: false };
const personal = { admin: true, personal: true };

const nothing: CrmStartedState = {
  kinds: false,
  people: false,
  owner: false,
  mailbox: false,
  booking: false,
  goal: false,
  ai: false,
  phone: false,
};
const everything: CrmStartedState = Object.fromEntries(
  Object.keys(nothing).map((k) => [k, true]),
) as CrmStartedState;

describe("Get your CRM started: who gets which steps", () => {
  it("gives owners and admins every step, the first answer first", () => {
    expect(crmStartedSteps(admin).map((s) => s.key)).toEqual([
      "kinds",
      "people",
      "owner",
      "mailbox",
      "booking",
      "goal",
      "ai",
      "phone",
    ]);
  });

  it("gives other members only their own", () => {
    expect(crmStartedSteps(member).map((s) => s.key)).toEqual(["mailbox", "booking"]);
  });

  it("gives a Personal space its short list, with nobody to share people with", () => {
    const keys = crmStartedSteps(personal).map((s) => s.key);
    expect(keys).toEqual(["kinds", "people", "mailbox", "booking", "goal", "ai"]);
    expect(keys).not.toContain("owner");
  });

  it("leaves out what this space can't do", () => {
    expect(crmStartedSteps(admin, ["ai"]).map((s) => s.key)).not.toContain("ai");
  });
});

describe("Get your CRM started: progress", () => {
  it("starts with nothing finished", () => {
    const p = crmStartedProgress(admin, nothing, []);
    expect(p).toMatchObject({ finished: 0, total: 8, complete: false });
    expect(p.steps.every((s) => s.status === "todo")).toBe(true);
  });

  it("finishes a step when the thing exists, whatever was checked off", () => {
    const p = crmStartedProgress(admin, { ...nothing, people: true }, ["people"]);
    expect(p.steps.find((s) => s.key === "people")?.status).toBe("done");
    expect(p.finished).toBe(1);
  });

  it("counts a checked-off step as finished, marked as skipped", () => {
    const p = crmStartedProgress(admin, nothing, ["phone"]);
    expect(p.steps.find((s) => s.key === "phone")?.status).toBe("skipped");
    expect(p.finished).toBe(1);
  });

  it("never lets the first answer be checked off: the CRM needs it", () => {
    expect(canSkipCrmStep("kinds")).toBe(false);
    const p = crmStartedProgress(admin, nothing, ["kinds"]);
    expect(p.steps.find((s) => s.key === "kinds")?.status).toBe("todo");
  });

  it("is complete once every step is done or checked off", () => {
    expect(crmStartedProgress(admin, everything, []).complete).toBe(true);
    const rest = { ...everything, goal: false, phone: false };
    expect(crmStartedProgress(admin, rest, ["goal"]).complete).toBe(false);
    expect(crmStartedProgress(admin, rest, ["goal", "phone"]).complete).toBe(true);
  });

  it("is complete for a member on their own two steps, whatever the organization's are", () => {
    const own = { ...nothing, mailbox: true, booking: true };
    expect(crmStartedProgress(member, own, []).complete).toBe(true);
    expect(crmStartedProgress(member, { ...own, booking: false }, []).complete).toBe(false);
    expect(crmStartedProgress(member, { ...own, booking: false }, ["booking"]).complete).toBe(true);
  });

  it("doesn't wait for a step the space can't do", () => {
    const rest = { ...everything, ai: false };
    expect(crmStartedProgress(admin, rest, []).complete).toBe(false);
    expect(crmStartedProgress(admin, rest, [], ["ai"]).complete).toBe(true);
  });
});

describe("Get your CRM started: what's checked off", () => {
  it("reads the organization's and the member's own, and ignores Home's", () => {
    expect(
      readCrmSkipped(
        ["database", orgSkipEntry("goal"), orgSkipEntry("phone")],
        [ownSkipKey("booking")],
      ).sort(),
    ).toEqual(["booking", "goal", "phone"]);
  });

  it("drops what isn't a step any more", () => {
    expect(readCrmSkipped(["crm:gone"], ["crm:started-gone", "crm:cp_1"])).toEqual([]);
  });
});

describe("Get your CRM started: links and choices", () => {
  it("sends each finished step to where it's changed later", () => {
    expect(crmStartedHref("o", "people")).toBe("/app/o/crm/settings/connections#import");
    expect(crmStartedHref("o", "booking")).toBe("/app/o/meetings/booking");
    expect(crmStartedHref("o", "owner")).toBe("/app/o/crm/settings/team");
  });

  it("offers only who's waiting, and only RSVPs in a Personal space", () => {
    const counts = { members: 3, contacts: 0, forms: 5, sponsors: 0 };
    expect(bringInChoices(counts, false).map((c) => c.id)).toEqual(["members", "forms"]);
    expect(bringInChoices({ ...counts, contacts: 2 }, true).map((c) => c.id)).toEqual(["contacts"]);
  });
});
