import { describe, expect, it } from "vitest";

import { Role } from "@/generated/prisma/enums";

import { ForbiddenError } from "./errors";
import {
  assignableRoles,
  can,
  canChangeRole,
  canRemoveMember,
  PERMISSIONS,
  requirePermission,
  type Permission,
} from "./permissions";

const { OWNER, ADMIN, TREASURER, MEMBER } = Role;

describe("permissions matrix", () => {
  const matrix: [Permission, Role[]][] = [
    ["settings.general.write", [OWNER, ADMIN]],
    ["org.slug.write", [OWNER]],
    ["integrations.write", [OWNER, ADMIN]],
    ["integrations.remove", [OWNER]],
    ["org.export", [OWNER]],
    ["org.export.download", [OWNER]],
    ["org.delete", [OWNER]],
    ["members.grantOwner", [OWNER]],
    ["members.invite", [OWNER, ADMIN]],
    ["events.write", [OWNER, ADMIN]],
    ["finance.manage", [OWNER, TREASURER]],
    ["notes.manageAll", [OWNER, ADMIN]],
    ["reports.view", [OWNER, ADMIN, TREASURER, MEMBER]],
  ];

  it.each(matrix)("%s is held by exactly %j", (permission, holders) => {
    for (const role of [OWNER, ADMIN, TREASURER, MEMBER]) {
      expect(can({ role }, permission)).toBe(holders.includes(role));
    }
  });

  it("a missing role holds nothing", () => {
    for (const permission of Object.keys(PERMISSIONS) as Permission[]) {
      expect(can({ role: null }, permission)).toBe(false);
      expect(can({ role: undefined }, permission)).toBe(false);
    }
  });

  it("requirePermission throws ForbiddenError", () => {
    expect(() => requirePermission({ role: MEMBER }, "integrations.write")).toThrow(ForbiddenError);
    expect(() => requirePermission({ role: ADMIN }, "integrations.write")).not.toThrow();
  });
});

describe("role changes", () => {
  it("only an OWNER grants or revokes OWNER", () => {
    expect(canChangeRole(ADMIN, MEMBER, OWNER)).toBe(false);
    expect(canChangeRole(ADMIN, OWNER, MEMBER)).toBe(false);
    expect(canChangeRole(OWNER, MEMBER, OWNER)).toBe(true);
    expect(canChangeRole(OWNER, OWNER, ADMIN)).toBe(true);
    expect(canChangeRole(ADMIN, MEMBER, TREASURER)).toBe(true);
  });

  it("nobody changes their own role, and members change none", () => {
    expect(canChangeRole(OWNER, OWNER, ADMIN, true)).toBe(false);
    expect(canChangeRole(MEMBER, MEMBER, ADMIN)).toBe(false);
    expect(canChangeRole(TREASURER, MEMBER, ADMIN)).toBe(false);
  });

  it("ADMINs never see OWNER in the dropdown", () => {
    expect(assignableRoles(ADMIN)).not.toContain(OWNER);
    expect(assignableRoles(OWNER)).toContain(OWNER);
    expect(assignableRoles(MEMBER)).toEqual([]);
  });

  it("removing: admins remove non-owners, only owners remove owners, anyone may leave", () => {
    expect(canRemoveMember(ADMIN, MEMBER)).toBe(true);
    expect(canRemoveMember(ADMIN, OWNER)).toBe(false);
    expect(canRemoveMember(OWNER, OWNER)).toBe(true);
    expect(canRemoveMember(MEMBER, MEMBER)).toBe(false);
    expect(canRemoveMember(MEMBER, MEMBER, true)).toBe(true);
  });
});
