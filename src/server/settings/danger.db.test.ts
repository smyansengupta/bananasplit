// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { unzipSync, strFromU8 } from "fflate";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Danger zone end to end against the local database and the local blob
 * store: an OWNER export (zip contents, no secrets, ballot privacy, expiry)
 * and delete -> cancel -> delete -> purge (every org row and blob gone, the
 * slug reserved forever). Runs on a throwaway org; skipped without the
 * database.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { ForbiddenError } from "@/lib/auth/errors";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgAction, withSystemOrgTx } from "@/server/db/context";
import { exportExpireJob, orgExportJob, requestOrgExport } from "@/server/export/service";
import type { JobRun } from "@/server/jobs/types";
import { setSecret } from "@/server/secrets";
import { getBlob, listBlobs, putBlob, scopePrefix } from "@/server/storage";

import { bootstrapCbcWorkspace } from "./bootstrap";
import { cancelOrgDeletion, scheduleOrgDeletion } from "./deletion";
import { createOrganization } from "./org-creation";
import { orgPurgeJob } from "./purge";

const SECRET = "sk-ant-api03-TESTSECRETVALUE0123456789abcdefXYZW";

let dbReady = false;
try {
  await authDb.$queryRaw`SELECT 1`;
  dbReady = Boolean(process.env.MIGRATE_DATABASE_URL);
} catch {
  dbReady = false;
}

function run<P>(orgId: string, payload: P, kind: string): JobRun<P> {
  return {
    id: `test-${kind}`,
    kind,
    organizationId: orgId,
    payload,
    dedupeKey: `${kind}:test`,
    attempt: 1,
    maxAttempts: 8,
    signal: new AbortController().signal,
    deadline: Date.now() + 240_000,
  };
}

describe.skipIf(!dbReady)("danger zone against the local database", () => {
  const stamp = Date.now().toString(36);
  const slug = `b1-danger-${stamp}`;
  let owner: { id: string; email: string; name: string | null };
  let member: { id: string; email: string; name: string | null };
  let orgId = "";
  let owner_pg: pg.Client;

  beforeAll(async () => {
    owner_pg = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
    await owner_pg.connect();
    owner = await authDb.user.create({
      data: {
        email: `b1-owner-${stamp}@example.edu`,
        name: "Danger Owner",
        emailVerified: new Date(),
      },
      select: { id: true, email: true, name: true },
    });
    member = await authDb.user.create({
      data: {
        email: `b1-member-${stamp}@example.edu`,
        name: "Danger Member",
        emailVerified: new Date(),
      },
      select: { id: true, email: true, name: true },
    });
    const created = await createOrganization(owner, {
      name: "Danger Test Club",
      slug,
      timezone: "UTC",
    });
    if (!created.ok) throw new Error(created.error);
    orgId = created.orgId;

    await withSystemOrgTx(orgId, { userId: member.id }, ({ db }) =>
      db.membership.create({ data: { organizationId: orgId, userId: member.id, role: "MEMBER" } }),
    );
    await withSystemOrgTx(orgId, async ({ db }) => {
      await db.task.create({
        data: {
          organizationId: orgId,
          title: '=HYPERLINK("x")',
          rank: "a0",
          createdById: owner.id,
        },
      });
      await db.invitation.create({
        data: {
          organizationId: orgId,
          email: `b1-invitee-${stamp}@example.edu`,
          role: "MEMBER",
          token: "f".repeat(64),
          expiresAt: new Date(Date.now() + 86_400_000),
          invitedById: owner.id,
        },
      });
    });
    const tx = await withSystemOrgTx(orgId, { userId: owner.id }, async ({ db }) => {
      const period = await db.budgetPeriod.create({
        data: {
          organizationId: orgId,
          label: "Fall",
          startsOn: new Date("2026-09-01"),
          endsOn: new Date("2026-12-31"),
        },
        select: { id: true },
      });
      return db.transaction.create({
        data: {
          organizationId: orgId,
          budgetPeriodId: period.id,
          kind: "EXPENSE",
          direction: "OUT",
          description: "Pizza",
          amountCents: 1999,
          occurredAt: new Date(),
          submittedById: owner.id,
        },
        select: { id: true },
      });
    });
    const blob = await putBlob(
      "receipts",
      orgId,
      [tx.id, "r1.pdf"],
      Buffer.from("%PDF-1.4 test receipt"),
      {
        contentType: "application/pdf",
      },
    );
    await withSystemOrgTx(orgId, { userId: owner.id }, ({ db }) =>
      db.receipt.create({
        data: {
          organizationId: orgId,
          transactionId: tx.id,
          blobKey: blob.key,
          filename: "r1.pdf",
          mimeType: "application/pdf",
          sizeBytes: 21,
          uploadedById: owner.id,
        },
      }),
    );
    await setSecret({
      orgId,
      actor: { userId: owner.id, role: "OWNER" },
      provider: "CLAUDE",
      kind: "API_KEY",
      value: SECRET,
      config: { defaultModel: "claude-opus-5" },
    });
  });

  beforeEach(() => requireUserMock.mockResolvedValue(owner));

  afterAll(async () => {
    if (orgId) await owner_pg.query(`DELETE FROM "Organization" WHERE "id" = $1`, [orgId]);
    await authDb.user.deleteMany({
      where: { id: { in: [owner?.id, member?.id].filter(Boolean) } },
    });
    await owner_pg.end();
    await disconnectAll();
  });

  const request = withOrgAction(async (ctx) => requestOrgExport(ctx));

  it("only an OWNER may request an export", async () => {
    requireUserMock.mockResolvedValue(member);
    await expect(request(orgId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  let exportId = "";

  it("the export job writes a private zip with NDJSON + CSV per table, files and a manifest, and no secrets", async () => {
    const res = await request(orgId);
    expect(res.ok).toBe(true);
    exportId = (res as { exportId: string }).exportId;

    expect(await orgExportJob(run(orgId, { exportId }, "org-export"))).toBeUndefined();

    const row = await withSystemOrgTx(orgId, ({ db }) =>
      db.orgExport.findUniqueOrThrow({ where: { id: exportId } }),
    );
    expect(row.status).toBe("READY");
    expect(row.blobKey).toBe(`exports/${orgId}/${exportId}.zip`);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const zip = await getBlob(row.blobKey!);
    expect(zip?.body.length).toBeGreaterThan(100);
    const files = unzipSync(new Uint8Array(zip!.body));
    const names = Object.keys(files);
    expect(names).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "README.txt",
        "data/Task.ndjson",
        "data/Task.csv",
        "data/Membership.csv",
      ]),
    );
    expect(names.some((n) => n.startsWith("files/receipts/"))).toBe(true);
    expect(names.some((n) => n.includes("OrgSecret"))).toBe(false);

    const everything = names.map((n) => strFromU8(files[n], true)).join("\n");
    expect(everything).not.toContain(SECRET);
    expect(strFromU8(files["data/Invitation.ndjson"])).not.toContain("f".repeat(64));
    expect(strFromU8(files["data/OrgIntegration.ndjson"])).not.toContain("secretFingerprint");
    // Formula-guarded CSV, exact NDJSON.
    expect(strFromU8(files["data/Task.csv"])).toContain(`"'=HYPERLINK(""x"")"`);
    expect(strFromU8(files["data/Task.ndjson"])).toContain(`"title":"=HYPERLINK(\\"x\\")"`);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.tables.Membership).toBe(2);
    expect(manifest.excluded.OrgSecret).toBeTruthy();

    // The parts are gone; the expiry job is queued for expiresAt.
    const left = await listBlobs("exports", `${scopePrefix("exports", orgId)}${exportId}/`);
    expect(left).toEqual([]);
    const expireJob = await withSystemOrgTx(orgId, ({ db }) =>
      db.job.findFirst({
        where: { organizationId: orgId, dedupeKey: `export-expire:${exportId}` },
      }),
    );
    expect(expireJob?.status).toBe("PENDING");
  });

  it("individual ballots are left out when nobody may see them", async () => {
    await withSystemOrgTx(orgId, { userId: owner.id }, ({ db }) =>
      db.orgSettings.update({
        where: { organizationId: orgId },
        data: { ballotIndividualVisibility: "NOBODY" },
      }),
    );
    const second = await withSystemOrgTx(orgId, ({ db }) =>
      db.orgExport.create({
        data: { organizationId: orgId, requestedById: owner.id },
        select: { id: true },
      }),
    );
    await orgExportJob(run(orgId, { exportId: second.id }, "org-export"));
    const row = await withSystemOrgTx(orgId, ({ db }) =>
      db.orgExport.findUniqueOrThrow({ where: { id: second.id } }),
    );
    const files = unzipSync(new Uint8Array((await getBlob(row.blobKey!))!.body));
    expect(Object.keys(files)).not.toContain("data/Ballot.ndjson");
    expect(Object.keys(files)).not.toContain("data/BallotChoice.csv");
    expect(JSON.parse(strFromU8(files["manifest.json"])).excluded.Ballot).toMatch(/nobody/i);
  });

  it("export-expire deletes the zip at expiresAt and marks the export EXPIRED", async () => {
    await withSystemOrgTx(orgId, ({ db }) =>
      db.orgExport.update({
        where: { id: exportId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );
    await exportExpireJob(run(orgId, { exportId }, "export-expire"));
    const row = await withSystemOrgTx(orgId, ({ db }) =>
      db.orgExport.findUniqueOrThrow({ where: { id: exportId } }),
    );
    expect(row.status).toBe("EXPIRED");
    expect(row.blobKey).toBeNull();
    expect(await getBlob(`exports/${orgId}/${exportId}.zip`)).toBeNull();
  });

  const bootstrap = withOrgAction(async (ctx, mapping: Record<string, string>) =>
    bootstrapCbcWorkspace(ctx, mapping),
  );

  it("Bootstrap CBC workspace is OWNER-only and applies the template under the owner's RLS", async () => {
    requireUserMock.mockResolvedValue(member);
    await expect(bootstrap(orgId, {})).rejects.toBeInstanceOf(ForbiddenError);

    requireUserMock.mockResolvedValue(owner);
    expect(await bootstrap(orgId, { jackson: member.id, oliver: member.id })).toMatchObject({
      error: expect.stringMatching(/one person only/),
    });
    const result = await bootstrap(orgId, { jackson: owner.id, kristine: member.id });
    expect(result.chartVersionId).toBeTruthy();
    const state = await withSystemOrgTx(orgId, async ({ db }) => ({
      labels: await db.label.findMany({ where: { organizationId: orgId }, select: { name: true } }),
      org: await db.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { activeOrgChartVersionId: true },
      }),
      titles: await db.membership.findMany({
        where: { organizationId: orgId },
        select: { userId: true, title: true, role: true },
      }),
      settings: await db.orgSettings.findUniqueOrThrow({ where: { organizationId: orgId } }),
    }));
    expect(state.labels.map((l) => l.name)).toEqual(
      expect.arrayContaining(["Needs President", "Design"]),
    );
    expect(state.org.activeOrgChartVersionId).toBe(result.chartVersionId);
    expect(state.titles.find((t) => t.userId === owner.id)).toMatchObject({
      title: "President",
      role: "OWNER",
    });
    expect(state.titles.find((t) => t.userId === member.id)).toMatchObject({ role: "MEMBER" });
    expect(state.settings.bootstrapTemplate).toBe("cbc");
  });

  const schedule = withOrgAction(async (ctx, confirm: string) => scheduleOrgDeletion(ctx, confirm));
  const cancel = withOrgAction(async (ctx) => cancelOrgDeletion(ctx));

  async function resolves(): Promise<boolean> {
    const r = await owner_pg.query(`SELECT * FROM app.resolve_org_slug($1)`, [slug]);
    return r.rowCount === 1;
  }

  it("delete needs an OWNER and the exact slug; it soft-deletes, schedules the purge, and cancel restores", async () => {
    requireUserMock.mockResolvedValue(member);
    await expect(schedule(orgId, slug)).rejects.toBeInstanceOf(ForbiddenError);

    requireUserMock.mockResolvedValue(owner);
    expect(await schedule(orgId, "wrong-slug")).toMatchObject({ ok: false });

    const scheduled = await schedule(orgId, slug);
    expect(scheduled.ok).toBe(true);
    expect(await resolves()).toBe(false);
    const job = (
      await owner_pg.query(
        `SELECT status, "runAt" FROM "Job" WHERE "organizationId" = $1 AND "dedupeKey" = $2 ORDER BY "createdAt" DESC LIMIT 1`,
        [orgId, `org-purge:${orgId}`],
      )
    ).rows[0];
    expect(job.status).toBe("PENDING");
    expect(new Date(job.runAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    expect(await cancel(orgId)).toEqual({});
    expect(await resolves()).toBe(true);
    const cancelled = (
      await owner_pg.query(
        `SELECT status FROM "Job" WHERE "organizationId" = $1 AND "dedupeKey" = $2`,
        [orgId, `org-purge:${orgId}`],
      )
    ).rows.map((r) => r.status);
    expect(cancelled).toEqual(["CANCELLED"]);
  });

  it("the purge removes every org row and blob and reserves the slug forever", async () => {
    expect((await schedule(orgId, slug)).ok).toBe(true);
    // A purge that runs before its time does nothing.
    expect(await orgPurgeJob(run(orgId, {}, "org-purge"))).toMatchObject({ status: "RETRY" });

    await withSystemOrgTx(orgId, { userId: owner.id }, ({ db }) =>
      db.organization.update({
        where: { id: orgId },
        data: { deleteScheduledFor: new Date(Date.now() - 1000) },
      }),
    );
    await orgPurgeJob(run(orgId, {}, "org-purge"));

    const tables = (
      await owner_pg.query(`
        SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'organizationId'
           AND c.relname NOT IN ('OrgDeletionLog', 'OrgSlugHistory')`)
    ).rows.map((r) => r.relname as string);
    expect(tables.length).toBeGreaterThan(40);
    const leftovers: Record<string, number> = {};
    for (const t of tables) {
      const n = Number(
        (
          await owner_pg.query(
            `SELECT count(*)::int AS n FROM "${t}" WHERE "organizationId" = $1`,
            [orgId],
          )
        ).rows[0].n,
      );
      if (n > 0) leftovers[t] = n;
    }
    expect(leftovers).toEqual({});
    expect(
      (await owner_pg.query(`SELECT 1 FROM "Organization" WHERE id = $1`, [orgId])).rowCount,
    ).toBe(0);

    for (const kind of ["receipts", "exports", "logos", "org-chart"] as const) {
      expect(await listBlobs(kind, scopePrefix(kind, orgId))).toEqual([]);
    }
    const log = (
      await owner_pg.query(
        `SELECT slug, "deletedById" FROM "OrgDeletionLog" WHERE "organizationId" = $1`,
        [orgId],
      )
    ).rows;
    expect(log).toEqual([{ slug, deletedById: owner.id }]);
    expect((await owner_pg.query(`SELECT app.slug_available($1) AS ok`, [slug])).rows[0].ok).toBe(
      false,
    );
    const again = await createOrganization(member, { name: "Squatter", slug, timezone: "UTC" });
    expect(again).toMatchObject({ ok: false, error: "That URL is already taken." });
    orgId = "";
  });
});
