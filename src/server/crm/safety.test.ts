import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), getSession: vi.fn() }));

import { checkInput } from "@/app/app/[orgSlug]/crm/run";
import { eventCouldTrigger } from "@/lib/crm/workflows";

import { approvalFor, draftGone, WITHDRAWN } from "./outreach/send";
import { payloadOf } from "./today";

/** The pure parts of the CRM's safety fixes (the rest is in safety.db.test.ts). */

describe("what a queued email records as its approval", () => {
  it("a member queued it: Send; anything else, an untracked note too: nobody", () => {
    expect(approvalFor({ createdById: "u1" })).toEqual({ approval: "send", approvedById: "u1" });
    expect(approvalFor({ createdById: "u1", workflowId: "w1" })).toEqual({ approval: "send", approvedById: "u1" });
    expect(approvalFor({ createdById: null, track: false })).toEqual({ approval: null, approvedById: null });
    expect(approvalFor({ createdById: null, workflowId: "w1" })).toEqual({ approval: null, approvedById: null });
    expect(approvalFor({ createdById: null, enrollmentId: "e1" })).toEqual({ approval: null, approvedById: null });
    expect(approvalFor({ createdById: null, enrollmentId: "e1", track: false })).toEqual({ approval: null, approvedById: null });
    expect(approvalFor({ createdById: null, approval: { kind: "start", by: "u2" } })).toEqual({ approval: "start", approvedById: "u2" });
  });
});

describe("why a draft can't be sent", () => {
  it("says it in words", () => {
    expect(draftGone("sending:m1")).toBe("That draft is already on its way.");
    expect(draftGone("sent")).toBe("That draft already went.");
    expect(draftGone(`${WITHDRAWN} they replied`)).toMatch(/^That draft was withdrawn because they replied\./);
    expect(draftGone("discarded")).toBe("That draft was thrown away.");
  });
});

describe("events only for triggers in use", () => {
  it("matches an event to the trigger types switched on", () => {
    expect(eventCouldTrigger([], { type: "record.changed", fields: ["created"] })).toBe(false);
    expect(eventCouldTrigger(["record.created"], { type: "record.changed", fields: ["created"] })).toBe(true);
    expect(eventCouldTrigger(["record.created"], { type: "record.changed", fields: ["title"] })).toBe(false);
    expect(eventCouldTrigger(["field.changed"], { type: "record.changed", fields: ["title"] })).toBe(true);
    expect(eventCouldTrigger(["stage.changed"], { type: "record.changed", fields: ["stageId"] })).toBe(true);
    expect(eventCouldTrigger(["stage.changed"], { type: "record.changed", fields: ["title"] })).toBe(false);
    expect(eventCouldTrigger(["date.reached"], { type: "record.changed", fields: ["title"] })).toBe(false);
    expect(eventCouldTrigger(["email.replied"], { type: "email.replied" })).toBe(true);
    expect(eventCouldTrigger(["email.replied"], { type: "email.bounced" })).toBe(false);
  });
});

describe("input checks", () => {
  it("passes good input through and refuses the rest in words", () => {
    expect(checkInput(z.number().int().max(5), 3)).toBe(3);
    expect(() => checkInput(z.number().int().max(5), 9, "Pick up to 5.")).toThrow("Pick up to 5.");
  });

  it("reads a suggestion's payload safely when it has none", () => {
    expect(payloadOf(null)).toEqual({});
    expect(payloadOf([1, 2])).toEqual({});
    expect(payloadOf({ draftId: "d1" }).draftId).toBe("d1");
  });
});
