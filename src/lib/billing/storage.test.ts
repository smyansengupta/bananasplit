import { describe, expect, it } from "vitest";

import type { SpaceInfo } from "./space";
import {
  crossesWarning,
  formatInLimitUnit,
  formatStorage,
  formatUsed,
  storageLevel,
  storageState,
  uploadRefusal,
  type StorageSpace,
} from "./storage";

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const NOW = new Date("2026-10-19T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const space = (info: Partial<SpaceInfo>, usedBytes = 0): StorageSpace => ({
  kind: "CLUB",
  plan: "CLUB",
  trialEndsAt: null,
  planAfterTrial: null,
  ...info,
  storageUsedBytes: BigInt(usedBytes),
});

const free = (used = 0) => space({ kind: "PERSONAL", plan: "FREE" }, used);
const plus = (used = 0) => space({ kind: "PERSONAL", plan: "PERSONAL_PLUS" }, used);
const team = (used = 0) => space({ plan: "CLUB" }, used);
const advanced = (used = 0) => space({ plan: "SOCIETY" }, used);
const trial = (endsInDays: number, used = 0) =>
  space(
    {
      plan: "TRIAL",
      trialEndsAt: new Date(NOW.getTime() + endsInDays * DAY),
      planAfterTrial: null,
    },
    used,
  );

const files = { feature: "files", now: NOW } as const;

describe("each tier's limits at the gate", () => {
  it.each([
    ["Personal Free", free, 10 * MB, 1 * GB],
    ["Personal Plus", plus, 250 * MB, 25 * GB],
    ["Team", team, 250 * MB, 50 * GB],
    ["Team Advanced", advanced, 1 * GB, 100 * GB],
    ["a trial", (u?: number) => trial(10, u), 1 * GB, 100 * GB],
  ])("%s: files up to its largest, and up to its storage", (_name, make, maxFile, storage) => {
    expect(uploadRefusal(make(), maxFile, files)).toBeNull();
    expect(uploadRefusal(make(), maxFile + 1, files)?.refused).toBe("too-large");
    expect(storageState(make()).limitBytes).toBe(storage);
    // Exactly full is allowed; one byte past it isn't.
    expect(uploadRefusal(make(storage - MB), MB, files)).toBeNull();
    expect(uploadRefusal(make(storage - MB), MB + 1, files)?.refused).toBe("full");
  });
});

describe("uploadRefusal", () => {
  it("lets both Personal plans and every club upload notes files", () => {
    for (const s of [free(), plus(), team(), advanced(), trial(3)]) {
      expect(uploadRefusal(s, MB, files)).toBeNull();
    }
  });

  it("refuses receipts in a Personal space (finance is for clubs)", () => {
    const refusal = uploadRefusal(plus(), MB, { feature: "finance", now: NOW });
    expect(refusal).toMatchObject({ status: 403, code: "SPACE_FEATURE", refused: "feature" });
    expect(uploadRefusal(team(), MB, { feature: "finance", now: NOW })).toBeNull();
  });

  it("lets an ended trial (Team Free) keep uploading files, within Team Free's limits", () => {
    expect(uploadRefusal(trial(-1), MB, files)).toBeNull();
    expect(uploadRefusal(trial(-1), 200 * MB, files)).toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(uploadRefusal(trial(-1), MB, { feature: "finance", now: NOW })).toMatchObject({
      code: "SPACE_FEATURE",
      refused: "feature",
    });
  });

  it("says how big the file is and how big it may be", () => {
    const refusal = uploadRefusal(team(), 312 * MB, files);
    expect(refusal).toMatchObject({ status: 413, code: "FILE_TOO_LARGE", maxFileBytes: 250 * MB });
    expect(refusal?.error).toBe("This file is 312 MB. Your plan allows files up to 250 MB.");
  });

  it("names a route's own cap when it is lower than the plan's", () => {
    const refusal = uploadRefusal(advanced(), 12 * MB, { ...files, routeMaxBytes: 4 * MB });
    expect(refusal?.error).toBe("This file is 12 MB. Files here can be up to 4 MB.");
  });

  it("says how full the space is, and what to do", () => {
    const refusal = uploadRefusal(advanced(Math.round(99.5 * GB)), 900 * MB, files);
    expect(refusal).toMatchObject({ status: 403, code: "STORAGE_FULL", refused: "full" });
    expect(refusal?.error).toBe(
      "Not enough space: 99.5 GB of 100 GB used. Empty the trash or upgrade.",
    );
    const almost = team(Math.round(49.9 * GB));
    expect(uploadRefusal(almost, 200 * MB, files)?.error).toBe(
      "Not enough space: 49.9 GB of 50 GB used. Empty the trash or upgrade.",
    );
    expect(uploadRefusal(almost, 200 * MB, { ...files, canManagePlan: false })?.error).toBe(
      "Not enough space: 49.9 GB of 50 GB used. Ask an owner or admin to make room.",
    );
  });

  it("counts whatever the database counts, the trash included: an over-limit space takes nothing", () => {
    // A downgrade left this Personal space over 1 GB: uploads stop, nothing else.
    expect(uploadRefusal(free(3 * GB), 1, files)?.refused).toBe("full");
    expect(storageState(free(3 * GB))).toMatchObject({ level: "full", freeBytes: 0 });
  });
});

describe("storageLevel and the 80% line", () => {
  it("is ok under 80%, a warning from 80% and full at 100%", () => {
    expect(storageLevel(79, 100)).toBe("ok");
    expect(storageLevel(80, 100)).toBe("warning");
    expect(storageLevel(99, 100)).toBe("warning");
    expect(storageLevel(100, 100)).toBe("full");
    expect(storageLevel(120, 100)).toBe("full");
  });

  it("crosses once, upwards only", () => {
    expect(crossesWarning(79, 80, 100)).toBe(true);
    expect(crossesWarning(80, 90, 100)).toBe(false);
    expect(crossesWarning(90, 70, 100)).toBe(false);
    expect(crossesWarning(10, 120, 100)).toBe(true);
  });
});

describe("formatStorage", () => {
  it("reads like the pricing table", () => {
    expect(formatStorage(1 * GB)).toBe("1 GB");
    expect(formatStorage(25 * GB)).toBe("25 GB");
    expect(formatStorage(Math.round(98.7 * GB))).toBe("98.7 GB");
    expect(formatStorage(500 * GB)).toBe("500 GB");
    expect(formatStorage(250 * MB)).toBe("250 MB");
    expect(formatStorage(Math.round(4.5 * MB))).toBe("4.5 MB");
    expect(formatStorage(18 * 1024)).toBe("18 KB");
    expect(formatStorage(12)).toBe("12 B");
  });

  it("never rounds the used figure up to the limit", () => {
    expect(formatUsed(100 * GB - 1024, 100 * GB)).toBe("99.9 GB");
    expect(formatUsed(100 * GB, 100 * GB)).toBe("100 GB");
    expect(formatUsed(62 * GB, 100 * GB)).toBe("62 GB");
  });
});

describe("formatInLimitUnit", () => {
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  it("reads the meter in the allowance's unit, as the guide writes it", () => {
    expect(formatInLimitUnit(0, 500 * GB)).toBe("0 GB");
    expect(formatInLimitUnit(62.45 * GB, 100 * GB)).toBe("62.4 GB");
    expect(formatInLimitUnit(312 * MB, 1 * GB)).toBe("0.3 GB");
    expect(formatInLimitUnit(18 * 1024, 500 * GB)).toBe("<0.1 GB");
    expect(formatInLimitUnit(5 * MB, 512 * MB)).toBe("5 MB");
  });
});
