// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { describe, expect, it, vi } from "vitest";

// The quota needs none of the session machinery, and next-auth does not load
// outside a Next runtime.
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    throw new Error("no session");
  },
  getSession: async () => null,
}));

import { assertUploadAllowed, OrgChartError, UPLOADS_PER_DAY } from "./service";

/**
 * The import quota, against a counting stub rather than the database: what
 * it counts matters more than that it counts.
 *
 * The daily limit exists because a document sent to Claude costs the org
 * money. A document the built-in parser reads costs nothing, so it must not
 * consume the allowance - otherwise a club that imports a dozen free drafts
 * in an afternoon is told it has run out of imports the first time it meets
 * a document that actually needs Claude.
 */

type Db = Parameters<typeof assertUploadAllowed>[0];

function countingDb(counts: number[]): { db: Db; wheres: Record<string, unknown>[] } {
  const wheres: Record<string, unknown>[] = [];
  const db = {
    orgChartVersion: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push(where);
        return counts[wheres.length - 1] ?? 0;
      },
    },
  } as unknown as Db;
  return { db, wheres };
}

describe("the daily import quota", () => {
  it("counts only the uploads that were handed to Claude", async () => {
    const { db, wheres } = countingDb([0, 0]);
    await assertUploadAllowed(db, "org_1");
    expect(wheres[0]).toMatchObject({
      organizationId: "org_1",
      source: "UPLOAD",
      // Set when, and only when, a claude-parse was started for the upload.
      parseAttemptId: { not: null },
    });
  });

  it(`refuses the ${UPLOADS_PER_DAY + 1}st document sent to Claude in a day`, async () => {
    await expect(assertUploadAllowed(countingDb([UPLOADS_PER_DAY, 0]).db, "org_1")).rejects.toMatchObject({
      name: "OrgChartError",
      status: 429,
    });
    await expect(assertUploadAllowed(countingDb([UPLOADS_PER_DAY, 0]).db, "org_1")).rejects.toThrow(
      new RegExp(`sent its ${UPLOADS_PER_DAY} documents to Claude`),
    );
  });

  it("lets a retry of an existing draft through the daily limit", async () => {
    const { db } = countingDb([UPLOADS_PER_DAY, 0]);
    await expect(assertUploadAllowed(db, "org_1", "v_existing")).resolves.toBeUndefined();
  });

  it("allows one parse at a time, naming the draft to discard", async () => {
    const { db, wheres } = countingDb([0, 1]);
    const error = await assertUploadAllowed(db, "org_1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrgChartError);
    expect((error as OrgChartError).status).toBe(409);
    expect(wheres[1]).toMatchObject({ status: "DRAFT" });
  });
});
