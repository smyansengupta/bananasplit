import { describe, expect, it } from "vitest";

import { Role } from "@/generated/prisma/enums";

import {
  assignableRoles,
  canActOnMember,
  canManageMembers,
  removalDenial,
  roleChangeDenial,
} from "./member-roles";

const change = (over: Partial<Parameters<typeof roleChangeDenial>[0]>) => ({
  actorId: "actor",
  actorRole: Role.ADMIN as Role,
  targetId: "target",
  targetRole: Role.MEMBER as Role,
  newRole: Role.ADMIN as Role,
  ...over,
});

describe("member role rules (0A Fix 3)", () => {
  it("only OWNER and ADMIN manage members", () => {
    expect(canManageMembers(Role.OWNER)).toBe(true);
    expect(canManageMembers(Role.ADMIN)).toBe(true);
    expect(canManageMembers(Role.TREASURER)).toBe(false);
    expect(canManageMembers(Role.MEMBER)).toBe(false);
    expect(canManageMembers(null)).toBe(false);
  });

  it("ADMINs are never offered OWNER", () => {
    expect(assignableRoles(Role.ADMIN)).not.toContain(Role.OWNER);
    expect(assignableRoles(Role.OWNER)).toContain(Role.OWNER);
    expect(assignableRoles(Role.MEMBER)).toEqual([]);
  });

  it("an ADMIN cannot grant OWNER", () => {
    expect(roleChangeDenial(change({ newRole: Role.OWNER }))).toMatch(/only an owner/i);
  });

  it("an ADMIN cannot demote or otherwise touch an OWNER", () => {
    expect(roleChangeDenial(change({ targetRole: Role.OWNER, newRole: Role.MEMBER }))).toMatch(
      /only an owner/i,
    );
    expect(canActOnMember(Role.ADMIN, Role.OWNER)).toBe(false);
    expect(removalDenial(change({ targetRole: Role.OWNER }))).toMatch(/only an owner/i);
  });

  it("nobody changes their own role, owners included", () => {
    expect(
      roleChangeDenial(change({ actorRole: Role.OWNER, targetId: "actor", newRole: Role.MEMBER })),
    ).toMatch(/your own role/i);
    expect(roleChangeDenial(change({ targetId: "actor", newRole: Role.MEMBER }))).toMatch(
      /your own role/i,
    );
    expect(removalDenial(change({ targetId: "actor" }))).toMatch(/yourself/i);
  });

  it("an OWNER may grant and revoke OWNER on someone else", () => {
    expect(roleChangeDenial(change({ actorRole: Role.OWNER, newRole: Role.OWNER }))).toBeNull();
    expect(
      roleChangeDenial(
        change({ actorRole: Role.OWNER, targetRole: Role.OWNER, newRole: Role.ADMIN }),
      ),
    ).toBeNull();
  });

  it("an ADMIN may still manage non-owners", () => {
    expect(roleChangeDenial(change({ newRole: Role.TREASURER }))).toBeNull();
    expect(removalDenial(change({ targetRole: Role.ADMIN }))).toBeNull();
  });

  it("a TREASURER or MEMBER manages nobody", () => {
    expect(roleChangeDenial(change({ actorRole: Role.TREASURER }))).toMatch(/owners and admins/i);
    expect(removalDenial(change({ actorRole: Role.MEMBER }))).toMatch(/owners and admins/i);
  });
});
