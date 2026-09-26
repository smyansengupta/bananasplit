import { NextResponse } from "next/server";

import { Role, TransactionKind, TransactionStatus } from "@/generated/prisma/client";
import { assertCronAuth } from "@/server/cron/auth";
import { serviceDb } from "@/server/db/clients";
import { withSystemOrgTx } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { sanitize } from "@/server/jobs/sanitize";

/**
 * Weekly digest to treasurers/owners of expenses awaiting their review
 * (spec 5.11), invoked by Vercel Cron (vercel.json) with CRON_SECRET.
 *
 * Runs on the fail-closed service path, one org at a time, and only
 * enqueues: one `email` job (template treasurer-digest) per OWNER and
 * TREASURER of each org with pending expenses, keyed per recipient and day
 * with once=true, so a re-run never mails twice. The job builds the list at
 * send time and sends through the org's sender (getOrgMailer).
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const day = new Date().toISOString().slice(0, 10);
  const orgIds = await serviceDb.$queryRaw<{ id: string }[]>`SELECT id FROM app.active_org_ids() AS id`;

  let orgsWithPending = 0;
  let digestsQueued = 0;
  for (const { id: orgId } of orgIds) {
    try {
      const queued = await withSystemOrgTx(orgId, async ({ db }) => {
        const org = await db.organization.findUnique({
          where: { id: orgId },
          select: { deletedAt: true },
        });
        if (!org || org.deletedAt) return 0;
        const pending = await db.transaction.count({
          where: {
            organizationId: orgId,
            kind: TransactionKind.EXPENSE,
            status: TransactionStatus.SUBMITTED,
            voidedAt: null,
          },
        });
        if (pending === 0) return 0;
        const recipients = await db.membership.findMany({
          where: { organizationId: orgId, role: { in: [Role.OWNER, Role.TREASURER] } },
          select: { userId: true },
        });
        for (const r of recipients) {
          await enqueueJob(db, {
            orgId,
            kind: "email",
            key: `treasurer-digest:${r.userId}:${day}`,
            payload: { template: "treasurer-digest", toUserId: r.userId },
            once: true,
          });
        }
        return recipients.length;
      });
      if (queued > 0) orgsWithPending += 1;
      digestsQueued += queued;
    } catch (error) {
      console.error(`[cron] finance-digest failed for one org`, sanitize(error));
    }
  }

  return NextResponse.json(
    { orgsWithPending, digestsQueued },
    { headers: { "Cache-Control": "no-store" } },
  );
}
