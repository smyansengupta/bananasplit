import { describe, expect, it } from "vitest";

import { OWNER_MODES } from "./setup-owners";
import {
  bringInChoices,
  canOpenCrmStep,
  canSkipCrmStep,
  crmStartedHref,
  crmStartedProgress,
  crmStartedSteps,
  isCrmSkipEntry,
  nextCrmStep,
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
  booking: false,
  goal: false,
  mailbox: false,
};
const everything: CrmStartedState = Object.fromEntries(
  Object.keys(nothing).map((k) => [k, true]),
) as CrmStartedState;

describe("Get your CRM started: who gets which steps", () => {
  it("gives owners and admins six steps, in order, the first answer first", () => {
    expect(crmStartedSteps(admin).map((s) => s.key)).toEqual([
      "kinds",
      "people",
      "owner",
      "booking",
      "goal",
      "mailbox",
    ]);
  });

  it("gives other members only their meeting link and signature", () => {
    expect(crmStartedSteps(member).map((s) => s.key)).toEqual(["booking", "mailbox"]);
  });

  it("gives a Personal space everything but who looks after people", () => {
    expect(crmStartedSteps(personal).map((s) => s.key)).toEqual([
      "kinds",
      "people",
      "booking",
      "goal",
      "mailbox",
    ]);
  });

  it("asks each step in words anyone can follow", () => {
    const words = [
      ...crmStartedSteps(admin).flatMap((s) => [s.question, s.hint]),
      ...OWNER_MODES.map((m) => m.title),
    ].join(" ");
    expect(words).not.toMatch(/pipeline|logging address|relationship|booking|club/i);
    expect(crmStartedSteps(admin).every((s) => s.question.endsWith("?"))).toBe(true);
  });
});

describe("Get your CRM started: progress", () => {
  it("starts with nothing finished", () => {
    const p = crmStartedProgress(admin, nothing, []);
    expect(p).toMatchObject({ finished: 0, total: 6, complete: false });
    expect(p.steps.every((s) => s.status === "todo")).toBe(true);
  });

  it("finishes a step when the thing exists, whatever was checked off", () => {
    const p = crmStartedProgress(admin, { ...nothing, people: true }, ["people"]);
    expect(p.steps.find((s) => s.key === "people")?.status).toBe("done");
    expect(p.finished).toBe(1);
  });

  it("counts a checked-off step as finished, marked as skipped", () => {
    const p = crmStartedProgress(admin, nothing, ["goal"]);
    expect(p.steps.find((s) => s.key === "goal")?.status).toBe("skipped");
    expect(p.finished).toBe(1);
  });

  it("never lets the first answer be checked off: the CRM needs it", () => {
    expect(canSkipCrmStep("kinds")).toBe(false);
    const p = crmStartedProgress(admin, nothing, ["kinds"]);
    expect(p.steps.find((s) => s.key === "kinds")?.status).toBe("todo");
  });

  it("is complete once every step is done or checked off", () => {
    expect(crmStartedProgress(admin, everything, []).complete).toBe(true);
    const rest = { ...everything, goal: false, mailbox: false };
    expect(crmStartedProgress(admin, rest, ["goal"]).complete).toBe(false);
    expect(crmStartedProgress(admin, rest, ["goal", "mailbox"]).complete).toBe(true);
  });

  it("is complete for a member on their own two steps, whatever the organization's are", () => {
    const own = { ...nothing, mailbox: true, booking: true };
    expect(crmStartedProgress(member, own, []).complete).toBe(true);
    expect(crmStartedProgress(member, { ...own, booking: false }, []).complete).toBe(false);
    expect(crmStartedProgress(member, { ...own, booking: false }, ["booking"]).complete).toBe(true);
  });

  it("doesn't wait for the AI key or calls and texts: they live in settings now", () => {
    expect(crmStartedProgress(admin, everything, []).total).toBe(6);
    expect(crmStartedProgress(personal, { ...everything, owner: false }, []).complete).toBe(true);
  });
});

describe("Get your CRM started: which step shows", () => {
  const steps = (state: CrmStartedState, skipped: string[] = []) =>
    crmStartedProgress(admin, state, skipped).steps;

  it("starts on the first step left", () => {
    expect(nextCrmStep(steps(nothing))).toBe("kinds");
    expect(nextCrmStep(steps({ ...nothing, kinds: true, people: true }))).toBe("owner");
  });

  it("passes over what's done or checked off", () => {
    expect(nextCrmStep(steps({ ...nothing, kinds: true }, ["people", "owner"]))).toBe("booking");
  });

  it("moves on from the step just answered", () => {
    const made = steps({ ...nothing, kinds: true, goal: true });
    expect(nextCrmStep(made, "goal")).toBe("mailbox");
  });

  it("comes back round to a step left behind by jumping ahead", () => {
    const ahead = steps({ ...everything, people: false, mailbox: false });
    expect(nextCrmStep(ahead, "mailbox")).toBe("people");
  });

  it("has nothing next once every step is finished", () => {
    expect(nextCrmStep(steps(everything))).toBeNull();
    expect(nextCrmStep(steps({ ...everything, goal: false }, ["goal"]), "goal")).toBeNull();
  });

  it("opens nothing else until the first answer has made the CRM", () => {
    expect(canOpenCrmStep(steps(nothing), "kinds")).toBe(true);
    expect(canOpenCrmStep(steps(nothing), "people")).toBe(false);
    expect(canOpenCrmStep(steps({ ...nothing, kinds: true }), "mailbox")).toBe(true);
  });

  it("opens a member's steps either way: they have no first answer to give", () => {
    expect(canOpenCrmStep(crmStartedProgress(member, nothing, []).steps, "mailbox")).toBe(true);
  });
});

describe("Get your CRM started: what's checked off", () => {
  it("reads the organization's and the member's own, and ignores Home's", () => {
    expect(
      readCrmSkipped(
        ["database", orgSkipEntry("goal"), orgSkipEntry("people")],
        [ownSkipKey("booking")],
      ).sort(),
    ).toEqual(["booking", "goal", "people"]);
  });

  it("keeps every stored key the six steps had before", () => {
    expect(orgSkipEntry("people")).toBe("crm:people");
    expect(orgSkipEntry("owner")).toBe("crm:owner");
    expect(orgSkipEntry("goal")).toBe("crm:goal");
    expect(ownSkipKey("booking")).toBe("crm:started-booking");
    expect(ownSkipKey("mailbox")).toBe("crm:started-mailbox");
    expect(readCrmSkipped(["crm:owner"], ["crm:started-mailbox"]).sort()).toEqual([
      "mailbox",
      "owner",
    ]);
  });

  it("drops what isn't a step any more", () => {
    expect(readCrmSkipped(["crm:gone", "crm:ai", "crm:phone"], ["crm:started-gone", "crm:cp_1"])).toEqual(
      [],
    );
  });

  it("tells this list's entries from Home's and from retired steps'", () => {
    expect(isCrmSkipEntry("crm:goal")).toBe(true);
    expect(isCrmSkipEntry("crm:phone")).toBe(false);
    expect(isCrmSkipEntry("database")).toBe(false);
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
