import { describe, expect, it } from "vitest";

import { NotificationType } from "@/generated/prisma/enums";

import {
  emailEnabledFor,
  isEmailEnabled,
  parseNotificationPrefs,
  serializeNotificationPrefs,
} from "./notification-prefs";

describe("the preference v2 parser", () => {
  it("upgrades a v1 flat map to v2 with the digest off", () => {
    const prefs = parseNotificationPrefs({ TASK_DUE_SOON: false, TASK_ASSIGNED: true });
    expect(prefs).toEqual({
      v: 2,
      types: { TASK_DUE_SOON: false, TASK_ASSIGNED: true },
      digest: { enabled: false, hourLocal: 8 },
      reminderLeadDays: 1,
      collaboratorReminders: false,
    });
    expect(emailEnabledFor(prefs, NotificationType.TASK_DIGEST)).toBe(false);
  });

  it("keeps an explicit false off", () => {
    expect(isEmailEnabled({ TASK_ASSIGNED: false }, NotificationType.TASK_ASSIGNED)).toBe(false);
    expect(
      isEmailEnabled({ v: 2, types: { TASK_MENTIONED: false } }, NotificationType.TASK_MENTIONED),
    ).toBe(false);
  });

  it("treats a missing type as on, except the default-off ones and the digest", () => {
    expect(isEmailEnabled({}, NotificationType.TASK_ASSIGNED)).toBe(true);
    expect(isEmailEnabled(null, NotificationType.TASK_DUE_REMINDER)).toBe(true);
    expect(isEmailEnabled({}, NotificationType.TASK_COMMENTED)).toBe(false);
    expect(isEmailEnabled({}, NotificationType.TASK_DIGEST)).toBe(false);
  });

  it("reads the digest switch, hour and lead days", () => {
    const prefs = parseNotificationPrefs({
      v: 2,
      types: {},
      digest: { enabled: true, hourLocal: 7 },
      reminderLeadDays: 2,
      collaboratorReminders: true,
    });
    expect(prefs.digest).toEqual({ enabled: true, hourLocal: 7 });
    expect(prefs.reminderLeadDays).toBe(2);
    expect(prefs.collaboratorReminders).toBe(true);
    expect(emailEnabledFor(prefs, NotificationType.TASK_DIGEST)).toBe(true);
  });

  it("clamps garbage to the defaults", () => {
    const prefs = parseNotificationPrefs({
      v: 2,
      types: { NOT_A_TYPE: false, TASK_ASSIGNED: "no" },
      digest: { enabled: "yes", hourLocal: 99 },
      reminderLeadDays: -3,
    });
    expect(prefs.types).toEqual({});
    expect(prefs.digest).toEqual({ enabled: false, hourLocal: 8 });
    expect(prefs.reminderLeadDays).toBe(1);
    expect(parseNotificationPrefs("junk").v).toBe(2);
  });

  it("lets a legacy flat key spread onto v2 win", () => {
    const raw = { v: 2, types: { TASK_ASSIGNED: true }, TASK_ASSIGNED: false };
    expect(isEmailEnabled(raw, NotificationType.TASK_ASSIGNED)).toBe(false);
  });

  it("serializes to normalized v2", () => {
    const out = serializeNotificationPrefs(parseNotificationPrefs({ TASK_DUE_SOON: false }));
    expect(out.v).toBe(2);
    expect(parseNotificationPrefs(out)).toEqual(out);
  });
});
