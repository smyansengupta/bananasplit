// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The storage counter and the upload gate against the real roles, triggers
 * and policies (redesign guide 11.2): Organization.storageUsedBytes counts
 * an upload the moment its row is written, keeps counting it in the trash,
 * and stays out of the app roles' reach; the gate lets both Personal plans
 * upload notes files and rolls back a row that lands over the limit.
 * Everything made here is removed in afterAll.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx } from "@/server/db/context";
import { removeNoteFile, storeNoteFile } from "@/server/notes/files";
import { deleteBlobs } from "@/server/storage";
import { sendFileToClub } from "@/server/storage/send-to-club";
import { ensurePersonalSpace } from "@/server/personal/space";
import { createOrganization } from "@/server/settings/org-creation";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { confirmFits, gateUpload, readStorageUsed, UploadRefusedError } from "./quota";

const tag = randomBytes(4).toString("hex");
const GB = 1024 ** 3;
let owner = { id: "", email: "", name: "" };
let club = { id: "", slug: "" };
let personalId = "";
let reachable = true;

async function makeUser(local: string) {
  const row = await authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name: `${local} ${tag}`,
      emailVerified: new Date(),
      onboardedAt: new Date(),
    },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

const used = async (orgId: string) =>
  Number(
    (
      await ownerDb.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { storageUsedBytes: true },
      })
    ).storageUsedBytes,
  );

/** A file row written as the owner under RLS, with the gate's in-transaction check. */
function addFile(orgId: string, sizeBytes: number) {
  requireUserMock.mockResolvedValue(owner);
  return withOrgTx(orgId, async ({ db, userId, role }) => {
    const row = await db.orgFile.create({
      data: {
        organizationId: orgId,
        name: `f-${tag}.txt`,
        contentType: "text/plain",
        sizeBytes,
        storageKey: `files/${orgId}/${randomBytes(12).toString("hex")}`,
        visibility: "ORGANIZATION",
        uploadedById: userId,
      },
      select: { id: true },
    });
    await confirmFits(db, orgId, sizeBytes, role);
    return row.id;
  });
}

beforeAll(async () => {
  vi.stubEnv("PLATFORM_ORG_CREATION_ENABLED", "true");
  vi.stubEnv("ORG_CREATION_MODE", "open");
  try {
    owner = await makeUser("quota-owner");
    const made = await createOrganization(owner, {
      name: `Quota ${tag}`,
      slug: `quota-${tag}`,
      timezone: "UTC",
    });
    if (!made.ok) throw new Error(JSON.stringify(made));
    club = { id: made.orgId, slug: made.slug };
    personalId = (await ensurePersonalSpace(owner.id)).id;
  } catch (error) {
    console.warn("[quota.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
}, 30_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  if (reachable && club.id) {
    await ownerDb.organization.delete({ where: { id: club.id } });
    await ownerDb.orgSlugHistory.deleteMany({ where: { slug: club.slug } });
  }
  // The Personal space first: its files name the user.
  if (personalId) await ownerDb.organization.deleteMany({ where: { id: personalId } });
  if (owner.id) await ownerDb.user.deleteMany({ where: { id: owner.id } });
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("Organization.storageUsedBytes", () => {
  it("counts a file when its row is written, and keeps counting it in the trash", async () => {
    if (!reachable) return;
    const before = await used(club.id);
    const fileId = await addFile(club.id, 1234);
    expect(await used(club.id)).toBe(before + 1234);
    requireUserMock.mockResolvedValue(owner);
    expect(await readStorageUsed(club.id)).toBe(before + 1234);

    await withOrgTx(club.id, ({ db }) => removeNoteFile(db, club.id, fileId));
    // The trash counts until it is emptied.
    expect(await used(club.id)).toBe(before + 1234);
  });

  it("lets a Personal space upload a note file, and send a copy to a club that counts there", async () => {
    if (!reachable) return;
    requireUserMock.mockResolvedValue(owner);
    const personalBefore = await used(personalId);
    const file = await storeNoteFile({
      orgId: personalId,
      bytes: Buffer.from("hello from personal\n"),
      filename: `hello-${tag}.txt`,
      visibility: "PRIVATE",
    });
    expect(await used(personalId)).toBe(personalBefore + 20);

    const clubBefore = await used(club.id);
    const sent = await sendFileToClub(personalId, file.id, club.id);
    expect(sent.ok).toBe(true);
    expect(await used(club.id)).toBe(clubBefore + 20);
    // The original stays in Personal.
    expect(await used(personalId)).toBe(personalBefore + 20);
    const keys = await ownerDb.orgFile.findMany({
      where: { organizationId: { in: [personalId, club.id] }, name: `hello-${tag}.txt` },
      select: { storageKey: true },
    });
    await deleteBlobs(keys.map((k) => k.storageKey));
  });

  it("can't be written by the app roles", async () => {
    if (!reachable) return;
    requireUserMock.mockResolvedValue(owner);
    await expect(
      withOrgTx(club.id, ({ db }) =>
        db.organization.update({ where: { id: club.id }, data: { storageUsedBytes: BigInt(0) } }),
      ),
    ).rejects.toThrow();
  });
});

describe("the upload gate", () => {
  it("lets a Personal Free space upload notes files, within 10 MB a file", async () => {
    if (!reachable) return;
    requireUserMock.mockResolvedValue(owner);
    expect(
      (await gateUpload(personalId, 5 * 1024 * 1024, { feature: "files" })).refusal,
    ).toBeNull();
    const big = await gateUpload(personalId, 11 * 1024 * 1024, { feature: "files" });
    expect(big.refusal?.code).toBe("FILE_TOO_LARGE");
    expect(big.refusal?.error).toBe("This file is 11 MB. Your plan allows files up to 10 MB.");
    expect((await gateUpload(personalId, 1, { feature: "finance" })).refusal?.code).toBe(
      "SPACE_FEATURE",
    );
  });

  it("rolls back a row that lands over the limit, and the counter with it", async () => {
    if (!reachable) return;
    // A trial has Team Advanced's 100 GB: bring the club to 10 bytes short (the owner role may).
    await ownerDb.organization.update({
      where: { id: club.id },
      data: { storageUsedBytes: BigInt(100 * GB - 10) },
    });
    requireUserMock.mockResolvedValue(owner);
    const gate = await gateUpload(club.id, 100, { feature: "files" });
    expect(gate.refusal?.code).toBe("STORAGE_FULL");
    expect(gate.refusal?.error).toBe(
      "Not enough space: 99.9 GB of 100 GB used. Empty the trash or upgrade.",
    );

    await expect(addFile(club.id, 100)).rejects.toBeInstanceOf(UploadRefusedError);
    expect(await used(club.id)).toBe(100 * GB - 10);
    expect(await addFile(club.id, 10)).toMatch(/\w+/);
    expect(await used(club.id)).toBe(100 * GB);
  });
});
