import { describe, expect, it } from "vitest";

import {
  canDeleteDatabase,
  deleteBlockedReason,
  deleteConfirmCopy,
  type DatabaseDeleteCheck,
} from "./delete";

const base: DatabaseDeleteCheck = {
  role: "MEMBER",
  kind: "CUSTOM",
  formOwned: false,
  membersCanDelete: false,
  canEditRows: true,
};
const check = (over: Partial<DatabaseDeleteCheck>) => canDeleteDatabase({ ...base, ...over });

describe("canDeleteDatabase", () => {
  it("lets owners and admins delete the organization's own databases, setting on or off", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(check({ role, membersCanDelete: false, canEditRows: false })).toBe(true);
      expect(check({ role, membersCanDelete: true })).toBe(true);
    }
  });

  it("refuses members while the setting is off, even on a database they edit", () => {
    expect(check({ role: "MEMBER" })).toBe(false);
    expect(check({ role: "TREASURER" })).toBe(false);
  });

  it("lets members who can edit the rows delete while the setting is on", () => {
    expect(check({ role: "MEMBER", membersCanDelete: true })).toBe(true);
    expect(check({ role: "TREASURER", membersCanDelete: true })).toBe(true);
  });

  it("still refuses members who can only read the database", () => {
    expect(check({ role: "MEMBER", membersCanDelete: true, canEditRows: false })).toBe(false);
  });

  it("never deletes a built-in database or a form's answers, whoever asks", () => {
    for (const kind of ["SESSIONS", "ATTENDANCE", "SIGNUPS", "BALLOTS", "PEOPLE"] as const) {
      expect(check({ role: "OWNER", kind })).toBe(false);
    }
    expect(check({ role: "OWNER", formOwned: true })).toBe(false);
    expect(check({ role: "MEMBER", membersCanDelete: true, formOwned: true })).toBe(false);
  });

  it("refuses someone with no role in the organization", () => {
    expect(check({ role: null, membersCanDelete: true })).toBe(false);
    expect(check({ role: undefined })).toBe(false);
  });
});

describe("deleteBlockedReason", () => {
  it("explains why a built-in or a form's database stays", () => {
    expect(deleteBlockedReason({ kind: "PEOPLE", formOwned: false })).toBe(
      "Built-in databases can't be deleted.",
    );
    expect(deleteBlockedReason({ kind: "CUSTOM", formOwned: true })).toMatch(/Delete the form/);
    expect(deleteBlockedReason({ kind: "CUSTOM", formOwned: false })).toBeNull();
  });
});

describe("deleteConfirmCopy", () => {
  it("says what goes, and that reports reading it will show it's gone", () => {
    expect(deleteConfirmCopy("Roster", 0)).toEqual({
      title: "Delete Roster?",
      description: "Its rows and fields are deleted for good. This can't be undone.",
      confirmLabel: "Delete database",
    });
    expect(deleteConfirmCopy("Roster", 1).description).toMatch(
      /A report reads it and will show it's gone\.$/,
    );
    expect(deleteConfirmCopy("Roster", 3).description).toMatch(/3 reports read it/);
  });
});
