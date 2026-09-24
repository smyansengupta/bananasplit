// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Slug rename against the local database: OWNER-only in the database too,
 * the old slug keeps resolving (as retired, which the org layout turns into
 * a redirect), and no other org can ever claim it. Throwaway orgs.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { ForbiddenError } from "@/lib/auth/errors";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgAction, withSystemOrgTx } from "@/server/db/context";
import { createOrganization } from "@/server/settings/org-creation";

import { renameOrgSlug } from "./actions";

let dbReady = false;
try {
  await authDb.$queryRaw`SELECT 1`;
  dbReady = Boolean(process.env.MIGRATE_DATABASE_URL);
} catch {
  dbReady = false;
}

describe.skipIf(!dbReady)("slug rename against the local database", () => {
  const stamp = Date.now().toString(36);
  const oldSlug = `b1-old-${stamp}`;
  const newSlug = `b1-new-${stamp}`;
  let owner: { id: string; email: string; name: string | null };
  let admin: { id: string; email: string; name: string | null };
  let orgId = "";
  let otherOrgId = "";
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
    await client.connect();
    owner = await authDb.user.create({
      data: {
        email: `b1-slug-owner-${stamp}@example.edu`,
        name: "Slug Owner",
        emailVerified: new Date(),
      },
      select: { id: true, email: true, name: true },
    });
    admin = await authDb.user.create({
      data: {
        email: `b1-slug-admin-${stamp}@example.edu`,
        name: "Slug Admin",
        emailVerified: new Date(),
      },
      select: { id: true, email: true, name: true },
    });
    const a = await createOrganization(owner, {
      name: "Slug Club",
      slug: oldSlug,
      timezone: "UTC",
    });
    if (!a.ok) throw new Error(a.error);
    orgId = a.orgId;
    await withSystemOrgTx(orgId, { userId: admin.id }, ({ db }) =>
      db.membership.create({ data: { organizationId: orgId, userId: admin.id, role: "ADMIN" } }),
    );
    const b = await createOrganization(admin, {
      name: "Other Club",
      slug: `b1-other-${stamp}`,
      timezone: "UTC",
    });
    if (!b.ok) throw new Error(b.error);
    otherOrgId = b.orgId;
  });

  afterAll(async () => {
    await client.query(`DELETE FROM "Organization" WHERE id = ANY($1)`, [
      [orgId, otherOrgId].filter(Boolean),
    ]);
    await authDb.user.deleteMany({ where: { id: { in: [owner?.id, admin?.id].filter(Boolean) } } });
    await client.end();
    await disconnectAll();
  });

  it("the database refuses an ADMIN changing the slug, even without the app check", async () => {
    requireUserMock.mockResolvedValue(admin);
    const raw = withOrgAction(async ({ db, organizationId }) =>
      db.organization.update({
        where: { id: organizationId },
        data: { slug: `b1-sneaky-${stamp}` },
      }),
    );
    await expect(raw(orgId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(renameOrgSlug(orgId, newSlug)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an OWNER renames; the old slug resolves as retired to the new one", async () => {
    requireUserMock.mockResolvedValue(owner);
    expect(await renameOrgSlug(orgId, newSlug)).toEqual({ slug: newSlug });
    const r = await client.query(`SELECT * FROM app.resolve_org_slug($1)`, [oldSlug]);
    expect(r.rows).toEqual([{ organizationId: orgId, canonicalSlug: newSlug, isRetired: true }]);
    const audit = await client.query(
      `SELECT "diffJson" FROM "OrgAuditLog" WHERE "organizationId" = $1 AND action = 'org.slug_changed'`,
      [orgId],
    );
    expect(audit.rows[0].diffJson).toEqual({ from: oldSlug, to: newSlug });
  });

  it("another org can never take the retired slug", async () => {
    requireUserMock.mockResolvedValue(admin); // OWNER of the other org
    expect(await renameOrgSlug(otherOrgId, oldSlug)).toEqual({
      error: "That URL is already taken.",
    });
    const created = await createOrganization(admin, {
      name: "Squat",
      slug: oldSlug,
      timezone: "UTC",
    });
    expect(created).toMatchObject({ ok: false });
  });

  it("the owner can take the old slug back", async () => {
    requireUserMock.mockResolvedValue(owner);
    expect(await renameOrgSlug(orgId, oldSlug)).toEqual({ slug: oldSlug });
    const r = await client.query(`SELECT * FROM app.resolve_org_slug($1)`, [newSlug]);
    expect(r.rows[0]).toMatchObject({ canonicalSlug: oldSlug, isRetired: true });
  });
});
