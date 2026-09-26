import { describe, expect, it } from "vitest";

import { isEmailEnabled } from "@/lib/notification-preferences";

import {
  applyNotificationPreferencesPatch,
  defaultNotificationPreferences,
  emailEnabledFor,
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
  notificationPreferencesPatchSchema,
  notificationPreferencesSchema,
  parseNotificationPreferences,
} from "./preferences";

const DEFAULTS = {
  v: 2,
  types: {},
  digest: { enabled: false, hourLocal: 8 },
  reminderLeadDays: 1,
  collaboratorReminders: false,
};

describe("parseNotificationPreferences (v2 upgrade parser)", () => {
  it("gives the defaults for an empty, missing or malformed value", () => {
    for (const raw of [{}, null, undefined, "x", 42, [], [{ TASK_ASSIGNED: false }], true]) {
      expect(parseNotificationPreferences(raw)).toEqual(DEFAULTS);
    }
  });

  it("upgrades the old flat map, keeping only known types with boolean values", () => {
    expect(
      parseNotificationPreferences({
        TASK_DUE_SOON: false,
        TASK_ASSIGNED: true,
        EVENT_INVITE: "no",
        NOT_A_TYPE: false,
      }),
    ).toEqual({ ...DEFAULTS, types: { TASK_DUE_SOON: false, TASK_ASSIGNED: true } });
  });

  it("never opts a flat-map user into the daily digest", () => {
    const upgraded = parseNotificationPreferences({ TASK_ASSIGNED: false });
    expect(upgraded.digest.enabled).toBe(false);
    expect(emailEnabledFor(upgraded, "TASK_DIGEST")).toBe(false);
  });

  it("reads a v2 value as stored", () => {
    const stored = {
      v: 2,
      types: { TASK_MENTIONED: false },
      digest: { enabled: true, hourLocal: 18 },
      reminderLeadDays: 3,
      collaboratorReminders: true,
    };
    expect(parseNotificationPreferences(stored)).toEqual(stored);
  });

  it("repairs a v2 value field by field", () => {
    expect(
      parseNotificationPreferences({
        v: 2,
        types: { TASK_MENTIONED: false, BOGUS: false, EVENT_INVITE: 1 },
        digest: { enabled: "yes", hourLocal: 25 },
        reminderLeadDays: -2,
        extra: "dropped",
      }),
    ).toEqual({ ...DEFAULTS, types: { TASK_MENTIONED: false } });
    expect(parseNotificationPreferences({ v: 2, digest: null })).toEqual(DEFAULTS);
    expect(parseNotificationPreferences({ v: 2, digest: { enabled: true } })).toEqual({
      ...DEFAULTS,
      digest: { enabled: true, hourLocal: 8 },
    });
  });

  it("always returns a value the strict stored schema accepts", () => {
    for (const raw of [
      {},
      { TASK_DUE_SOON: false },
      { v: 2, types: [], digest: 5, reminderLeadDays: 99 },
      { v: 3, TASK_ASSIGNED: false },
    ]) {
      expect(notificationPreferencesSchema.safeParse(parseNotificationPreferences(raw)).success).toBe(true);
    }
  });
});

describe("emailEnabledFor and isEmailEnabled", () => {
  it("treats a missing type as enabled (opt-out) and TASK_DIGEST as opt-in", () => {
    const prefs = parseNotificationPreferences({ v: 2, types: { TASK_ASSIGNED: false } });
    expect(emailEnabledFor(prefs, "TASK_ASSIGNED")).toBe(false);
    expect(emailEnabledFor(prefs, "TASK_MENTIONED")).toBe(true);
    expect(emailEnabledFor(prefs, "TASK_DIGEST")).toBe(false);
    expect(
      emailEnabledFor(parseNotificationPreferences({ v: 2, digest: { enabled: true, hourLocal: 7 } }), "TASK_DIGEST"),
    ).toBe(true);
  });

  it("isEmailEnabled (the email job's check) reads both shapes through the parser", () => {
    expect(isEmailEnabled({ TASK_DUE_SOON: false }, "TASK_DUE_SOON")).toBe(false);
    expect(isEmailEnabled({ TASK_DUE_SOON: false }, "TASK_ASSIGNED")).toBe(true);
    expect(isEmailEnabled({ v: 2, types: { EVENT_INVITE: false } }, "EVENT_INVITE")).toBe(false);
    expect(isEmailEnabled(null, "EVENT_INVITE")).toBe(true);
    expect(isEmailEnabled({}, "TASK_DIGEST")).toBe(false);
  });
});

describe("preference patches", () => {
  it("merges a patch into a complete v2 value", () => {
    let prefs = defaultNotificationPreferences();
    prefs = applyNotificationPreferencesPatch(prefs, { types: { TASK_ASSIGNED: false } });
    prefs = applyNotificationPreferencesPatch(prefs, { digest: { enabled: true } });
    prefs = applyNotificationPreferencesPatch(prefs, { digest: { hourLocal: 17 } });
    prefs = applyNotificationPreferencesPatch(prefs, { reminderLeadDays: 2 });
    expect(prefs).toEqual({
      v: 2,
      types: { TASK_ASSIGNED: false },
      digest: { enabled: true, hourLocal: 17 },
      reminderLeadDays: 2,
      collaboratorReminders: false,
    });
  });

  it("keeps the digest's single switch in digest.enabled", () => {
    const prefs = applyNotificationPreferencesPatch(defaultNotificationPreferences(), {
      types: { TASK_DIGEST: true },
    });
    expect(prefs.types.TASK_DIGEST).toBeUndefined();
    expect(prefs.digest.enabled).toBe(false);
  });

  it("validates patches strictly", () => {
    const ok = (v: unknown) => notificationPreferencesPatchSchema.safeParse(v).success;
    expect(ok({ types: { TASK_ASSIGNED: false } })).toBe(true);
    expect(ok({ digest: { hourLocal: 23 } })).toBe(true);
    expect(ok({ reminderLeadDays: 14 })).toBe(true);
    expect(ok({ types: { NOPE: false } })).toBe(false);
    expect(ok({ digest: { hourLocal: 24 } })).toBe(false);
    expect(ok({ digest: { hourLocal: 7.5 } })).toBe(false);
    expect(ok({ reminderLeadDays: 15 })).toBe(false);
    expect(ok({ reminderLeadDays: -1 })).toBe(false);
    expect(ok({ v: 2 })).toBe(false);
  });

  it("labels every type except the digest, which has its own control", () => {
    const labelled = Object.keys(NOTIFICATION_TYPE_META).sort();
    expect(labelled).toEqual(NOTIFICATION_TYPES.filter((t) => t !== "TASK_DIGEST").sort());
  });
});
