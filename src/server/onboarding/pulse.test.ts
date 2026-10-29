import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { DEFAULT_PULSE_SETTINGS, PULSE_DAYS, hourLabel } from "@/lib/pulse/settings";

const audit = vi.hoisted(() => ({ writeOrgAuditLog: vi.fn(async () => "a_1") }));
vi.mock("@/server/audit", () => audit);

const { savePulseSettings } = await import("./pulse");

/**
 * The Weekly pulse step's saver (club setup, after Teams; also Admin
 * panel › Weekly pulse): what it writes to OrgSettings, what it refuses,
 * and where the step sits in the flow.
 */

function ctx(role: "OWNER" | "ADMIN" | "TREASURER" | "MEMBER" = "OWNER") {
  return {
    organizationId: "org_1",
    userId: "u_1",
    role,
    db: { orgSettings: { update: vi.fn(async () => ({ organizationId: "org_1" })) } },
  };
}

const input = {
  pulseEnabled: true,
  pulseDay: 4,
  pulseHourLocal: 9,
  pulseAudience: "OFFICERS",
  pulseEmail: false,
  pulseInApp: true,
};

beforeEach(() => vi.clearAllMocks());

describe("savePulseSettings", () => {
  it("writes the six pulse fields to the club's settings, and audits the change", async () => {
    const c = ctx();
    await expect(savePulseSettings(c as never, input)).resolves.toEqual({ ok: true });
    expect(c.db.orgSettings.update).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      data: { ...input, updatedById: "u_1" },
      select: { organizationId: true },
    });
    expect(audit.writeOrgAuditLog).toHaveBeenCalledWith(
      c.db,
      expect.objectContaining({ action: "settings.pulse.updated", diff: input }),
    );
  });

  it("refuses a day or hour out of range, an unknown audience and extra fields", async () => {
    for (const bad of [
      { ...input, pulseDay: 7 },
      { ...input, pulseHourLocal: 24 },
      { ...input, pulseAudience: "TREASURERS" },
      { ...input, weeklyUpdateDay: 1 },
      { pulseDay: 5 },
    ]) {
      const c = ctx();
      await expect(savePulseSettings(c as never, bad)).resolves.toMatchObject({ ok: false });
      expect(c.db.orgSettings.update).not.toHaveBeenCalled();
    }
  });

  it("is for owners and admins", async () => {
    await expect(savePulseSettings(ctx("TREASURER") as never, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(savePulseSettings(ctx("MEMBER") as never, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(savePulseSettings(ctx("ADMIN") as never, input)).resolves.toEqual({ ok: true });
  });
});

describe("the weekly pulse defaults", () => {
  it("defaults to Friday at 5 PM, to everyone, in the app and by email", () => {
    expect(DEFAULT_PULSE_SETTINGS).toEqual({
      pulseEnabled: true,
      pulseDay: 5,
      pulseHourLocal: 17,
      pulseAudience: "EVERYONE",
      pulseEmail: true,
      pulseInApp: true,
    });
    expect(PULSE_DAYS.map((d) => d.label)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(hourLabel(17)).toBe("5:00 PM");
    expect(hourLabel(0)).toBe("12:00 AM");
    expect(hourLabel(12)).toBe("12:00 PM");
  });
});
