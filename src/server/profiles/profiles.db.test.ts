// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Profiles against the real roles, policies and functions on the local
 * seeded database (Phase 2). Skipped when the database or the seed is
 * missing, like the other *.db.test.ts files. Every change is undone in
 * afterAll.
 *
 * Storage is replaced by a fake: the image pipeline has its own tests
 * (src/server/images); here we check WHEN the service deletes variants.
 */

const { requireUserMock, storeImageMock, deleteStoredImageMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  storeImageMock: vi.fn(),
  deleteStoredImageMock: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/images", () => ({
  storeImage: storeImageMock,
  deleteStoredImage: deleteStoredImageMock,
}));

import { Prisma } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { hashIcsToken } from "@/lib/ics-token";
import { authDb, disconnectAll, legacyDb } from "@/server/db/clients";
import { withSystemOrgTx, withUserTx } from "@/server/db/context";

import { getOrgPerson, getOwnProfile, getShellUser, listOrgPeople } from "./queries";
import {
  isOwnAvatar,
  removeOwnAvatar,
  replaceOwnAvatar,
  rotateOwnIcsToken,
  turnOffOwnIcsFeed,
  updateOwnNotificationPreferences,
  updateOwnProfile,
} from "./service";

interface SeedUser {
  id: string;
  email: string;
  name: string | null;
}

interface Seeded {
  cbcId: string;
  roboticsId: string;
  debateId: string;
  jackson: SeedUser;
  oliver: SeedUser;
  kristine: SeedUser;
  alice: SeedUser;
  eve: SeedUser;
  dave: SeedUser;
}

const EMAILS = [
  "jackson@example.edu",
  "oliver@example.edu",
  "kristine@example.edu",
  "alice@example.edu",
  "eve@example.edu",
  "dave@example.edu",
];

let seeded: Seeded | null = null;
let kristineBefore: Record<string, unknown> | null = null;
try {
  const orgs = await legacyDb.organization.findMany({
    where: { slug: { in: ["claude-builders-club", "robotics-club", "debate-society"] } },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(orgs.map((o) => [o.slug, o.id]));
  const users = await authDb.user.findMany({
    where: { email: { in: EMAILS } },
    select: { id: true, email: true, name: true },
  });
  const byEmail = new Map(users.map((u) => [u.email.split("@")[0], u]));
  const cbcId = bySlug.get("claude-builders-club");
  const roboticsId = bySlug.get("robotics-club");
  const debateId = bySlug.get("debate-society");
  if (cbcId && roboticsId && debateId && users.length === EMAILS.length) {
    seeded = {
      cbcId,
      roboticsId,
      debateId,
      jackson: byEmail.get("jackson")!,
      oliver: byEmail.get("oliver")!,
      kristine: byEmail.get("kristine")!,
      alice: byEmail.get("alice")!,
      eve: byEmail.get("eve")!,
      dave: byEmail.get("dave")!,
    };
    kristineBefore = await authDb.user.findUnique({
      where: { id: seeded.kristine.id },
      select: {
        name: true,
        pronouns: true,
        major: true,
        gradYear: true,
        bio: true,
        links: true,
        timezone: true,
        emailPreferences: true,
        avatar: true,
      },
    });
  }
} catch {
  seeded = null;
}

function fakeStored(userId: string, id: string) {
  return {
    key: `avatars/${userId}/${id}`,
    s64: `/api/dev/blob/avatars/${userId}/${id}/s64.webp`,
    s128: `/api/dev/blob/avatars/${userId}/${id}/s128.webp`,
    s256: `/api/dev/blob/avatars/${userId}/${id}/s256.webp`,
    updatedAt: new Date().toISOString(),
  };
}

describe.skipIf(!seeded)("profiles against the local database", () => {
  const s = seeded as Seeded;

  beforeEach(() => {
    vi.clearAllMocks();
    deleteStoredImageMock.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (kristineBefore) {
      const before = kristineBefore as Record<string, never>;
      await authDb.user.update({
        where: { id: s.kristine.id },
        data: {
          name: before.name,
          pronouns: before.pronouns,
          major: before.major,
          gradYear: before.gradYear,
          bio: before.bio,
          timezone: before.timezone,
          links: before.links ?? [],
          emailPreferences: before.emailPreferences ?? {},
          avatar: before.avatar ?? Prisma.DbNull,
        },
      });
    }
    await authDb.userCredential.updateMany({
      where: { userId: s.kristine.id },
      data: { icsTokenHash: null, icsTokenCreatedAt: null },
    });
    await withSystemOrgTx(s.debateId, ({ db }) =>
      db.membership.updateMany({ where: { organizationId: s.debateId, userId: s.dave.id }, data: { title: null } }),
    );
    await withSystemOrgTx(s.roboticsId, ({ db }) =>
      db.membership.updateMany({ where: { organizationId: s.roboticsId, userId: s.dave.id }, data: { title: null } }),
    );
    await disconnectAll();
  });

  it("a profile save changes only the caller's row, and the shell reads it from the database", async () => {
    const oliverBefore = await authDb.user.findUnique({ where: { id: s.oliver.id } });
    await updateOwnProfile(s.kristine.id, {
      name: "Kristine Min",
      pronouns: "she/her",
      bio: "Content calendar and newsletter.",
      links: [{ kind: "instagram", url: "https://instagram.com/cbc" }],
      timezone: "America/Los_Angeles",
    });
    const after = await authDb.user.findUnique({ where: { id: s.kristine.id } });
    expect(after).toMatchObject({
      pronouns: "she/her",
      bio: "Content calendar and newsletter.",
      links: [{ kind: "instagram", url: "https://instagram.com/cbc" }],
      timezone: "America/Los_Angeles",
    });
    expect(await authDb.user.findUnique({ where: { id: s.oliver.id } })).toEqual(oliverBefore);

    await updateOwnProfile(s.kristine.id, { name: "Kristine M." });
    expect((await getShellUser(s.kristine.id, s.kristine.email)).name).toBe("Kristine M.");
    await updateOwnProfile(s.kristine.id, { name: "Kristine Min" });
  });

  it("the people queries only show current members of the org, with this org's title", async () => {
    requireUserMock.mockResolvedValue(s.jackson);
    const oliver = await getOrgPerson(s.cbcId, s.oliver.id);
    expect(oliver).toMatchObject({ name: "Oliver Ward", title: "VP Ops & Programs", role: "ADMIN" });
    expect(oliver).not.toHaveProperty("email");

    // A user who is only in another org, and ids that are not users at all.
    expect(await getOrgPerson(s.cbcId, s.alice.id)).toBeNull();
    expect(await getOrgPerson(s.cbcId, "does-not-exist")).toBeNull();
    expect(await getOrgPerson(s.cbcId, "../../etc")).toBeNull();

    // A viewer who is not a member of the org is refused outright.
    await expect(getOrgPerson(s.roboticsId, s.alice.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listOrgPeople(s.roboticsId)).rejects.toBeInstanceOf(NotFoundError);

    const page = await listOrgPeople(s.cbcId);
    expect(page.total).toBeGreaterThanOrEqual(8);
    expect(page.people.map((p) => p.id)).not.toContain(s.alice.id);
    expect(page.people.every((p) => !("email" in p))).toBe(true);
    const search = await listOrgPeople(s.cbcId, { q: "vp" });
    expect(search.people.map((p) => p.title).sort()).toEqual(["VP Growth", "VP Ops & Programs"]);
  });

  it("a former member keeps a readable User row but has no person page", async () => {
    const temp = await authDb.user.create({
      data: { email: `b2-former-${Date.now()}@example.edu`, name: "Former Member", emailVerified: new Date() },
      select: { id: true },
    });
    try {
      await withSystemOrgTx(s.cbcId, { userId: temp.id }, ({ db }) =>
        db.membership.create({ data: { organizationId: s.cbcId, userId: temp.id, role: "MEMBER" } }),
      );
      requireUserMock.mockResolvedValue(s.jackson);
      expect(await getOrgPerson(s.cbcId, temp.id)).toMatchObject({ name: "Former Member" });
      await withSystemOrgTx(s.cbcId, ({ db }) =>
        db.membership.deleteMany({ where: { organizationId: s.cbcId, userId: temp.id } }),
      );
      expect(await getOrgPerson(s.cbcId, temp.id)).toBeNull();
      expect((await listOrgPeople(s.cbcId, { q: "Former Member" })).total).toBe(0);
    } finally {
      await authDb.user.delete({ where: { id: temp.id } });
    }
  });

  it("a user in two orgs shows a different title in each", async () => {
    await withSystemOrgTx(s.debateId, ({ db }) =>
      db.membership.updateMany({
        where: { organizationId: s.debateId, userId: s.dave.id },
        data: { title: "Tournament Director" },
      }),
    );
    await withSystemOrgTx(s.roboticsId, ({ db }) =>
      db.membership.updateMany({
        where: { organizationId: s.roboticsId, userId: s.dave.id },
        data: { title: "Build Lead" },
      }),
    );
    requireUserMock.mockResolvedValue(s.eve);
    expect((await getOrgPerson(s.debateId, s.dave.id))?.title).toBe("Tournament Director");
    requireUserMock.mockResolvedValue(s.alice);
    expect((await getOrgPerson(s.roboticsId, s.dave.id))?.title).toBe("Build Lead");

    const own = await getOwnProfile(s.dave.id);
    expect(Object.fromEntries(own!.memberships.map((m) => [m.orgSlug, m.title]))).toEqual({
      "debate-society": "Tournament Director",
      "robotics-club": "Build Lead",
    });
  });

  it("preference changes write the v2 shape and survive a reload", async () => {
    await authDb.user.update({ where: { id: s.kristine.id }, data: { emailPreferences: { TASK_DUE_SOON: false } } });
    await updateOwnNotificationPreferences(s.kristine.id, { digest: { enabled: true, hourLocal: 17 } });
    await updateOwnNotificationPreferences(s.kristine.id, { reminderLeadDays: 3 });
    await updateOwnNotificationPreferences(s.kristine.id, { types: { TASK_MENTIONED: false } });
    const stored = await authDb.user.findUnique({
      where: { id: s.kristine.id },
      select: { emailPreferences: true },
    });
    expect(stored?.emailPreferences).toEqual({
      v: 2,
      types: { TASK_DUE_SOON: false, TASK_MENTIONED: false },
      digest: { enabled: true, hourLocal: 17 },
      reminderLeadDays: 3,
      collaboratorReminders: false,
    });

    // Concurrent toggles never lose each other (the row is locked).
    await Promise.all([
      updateOwnNotificationPreferences(s.kristine.id, { types: { EVENT_INVITE: false } }),
      updateOwnNotificationPreferences(s.kristine.id, { types: { EVENT_UPDATED: false } }),
      updateOwnNotificationPreferences(s.kristine.id, { types: { INVITE_ACCEPTED: false } }),
    ]);
    const after = await authDb.user.findUnique({ where: { id: s.kristine.id }, select: { emailPreferences: true } });
    expect((after?.emailPreferences as { types: Record<string, boolean> }).types).toMatchObject({
      EVENT_INVITE: false,
      EVENT_UPDATED: false,
      INVITE_ACCEPTED: false,
    });
  });

  it("the calendar feed link is stored only as a hash; a new one kills the old; turning off clears it", async () => {
    const first = await rotateOwnIcsToken(s.kristine.id);
    const resolve = (token: string) =>
      authDb.userCredential.findUnique({ where: { icsTokenHash: hashIcsToken(token) }, select: { userId: true } });
    expect((await resolve(first.token))?.userId).toBe(s.kristine.id);
    expect((await getOwnProfile(s.kristine.id))?.icsActiveSince).toBeInstanceOf(Date);

    const second = await rotateOwnIcsToken(s.kristine.id);
    expect(second.token).not.toBe(first.token);
    expect(await resolve(first.token)).toBeNull();
    expect((await resolve(second.token))?.userId).toBe(s.kristine.id);
    const credential = await authDb.userCredential.findUnique({ where: { userId: s.kristine.id } });
    expect(credential?.icsTokenHash).toBe(hashIcsToken(second.token));
    expect(JSON.stringify(credential)).not.toContain(second.token);

    expect(await turnOffOwnIcsFeed(s.kristine.id)).toBe(true);
    expect(await resolve(second.token)).toBeNull();
    expect((await getOwnProfile(s.kristine.id))?.icsActiveSince).toBeNull();
    expect(await turnOffOwnIcsFeed(s.kristine.id)).toBe(false);
  });

  it("replacing a picture deletes the old variants only after the new row commits", async () => {
    const one = fakeStored(s.kristine.id, "one");
    const two = fakeStored(s.kristine.id, "two");
    storeImageMock.mockResolvedValueOnce(one).mockResolvedValueOnce(two);

    await replaceOwnAvatar(s.kristine.id, Buffer.from("img-1"));
    expect(storeImageMock).toHaveBeenCalledWith("avatars", s.kristine.id, "avatar", Buffer.from("img-1"));
    const deletedBeforeFirst = deleteStoredImageMock.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(deletedBeforeFirst).not.toContain(one.key);

    // When the old variants are deleted, the row already points at the new ones.
    let rowAtDelete: unknown = "not called";
    deleteStoredImageMock.mockImplementationOnce(async () => {
      rowAtDelete = (await authDb.user.findUnique({ where: { id: s.kristine.id }, select: { avatar: true } }))?.avatar;
    });
    await replaceOwnAvatar(s.kristine.id, Buffer.from("img-2"));
    expect(deleteStoredImageMock).toHaveBeenCalledTimes(1);
    expect(deleteStoredImageMock).toHaveBeenCalledWith(one);
    expect(rowAtDelete).toEqual(two);

    await removeOwnAvatar(s.kristine.id);
    expect(deleteStoredImageMock).toHaveBeenLastCalledWith(two);
    expect((await authDb.user.findUnique({ where: { id: s.kristine.id }, select: { avatar: true } }))?.avatar).toBeNull();
  });

  it("a failed row write deletes the new variants, and a foreign key is never deleted", async () => {
    const orphan = fakeStored("no_such_user", "x");
    storeImageMock.mockResolvedValueOnce(orphan);
    await expect(replaceOwnAvatar("no_such_user", Buffer.from("img"))).rejects.toThrow();
    expect(deleteStoredImageMock).toHaveBeenCalledWith(orphan);

    vi.clearAllMocks();
    deleteStoredImageMock.mockResolvedValue(undefined);
    await withUserTx(s.kristine.id, ({ db }) =>
      db.user.update({
        where: { id: s.kristine.id },
        data: { avatar: { key: `avatars/${s.oliver.id}/theirs` } },
        select: { id: true },
      }),
    );
    storeImageMock.mockResolvedValueOnce(fakeStored(s.kristine.id, "three"));
    await replaceOwnAvatar(s.kristine.id, Buffer.from("img-3"));
    expect(deleteStoredImageMock).not.toHaveBeenCalled();
    expect(isOwnAvatar({ key: `avatars/${s.kristine.id}/abc` }, s.kristine.id)).toBe(true);
    expect(isOwnAvatar({ key: `avatars/${s.kristine.id}/../x` }, s.kristine.id)).toBe(false);
    expect(isOwnAvatar({ key: `logos/${s.kristine.id}/abc` }, s.kristine.id)).toBe(false);
    await removeOwnAvatar(s.kristine.id);
  });
});
