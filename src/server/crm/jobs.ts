import type { Role } from "@/generated/prisma/client";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";

import type { CrmActor } from "./access";
import { queueNewRecordAi } from "./ai-jobs";
import { bringIn, type BringInSource } from "./bring-in";
import { scanDuplicates } from "./dedupe";
import { runImportTurn } from "./import";
import { mirrorWorkspace } from "./mirror";
import { recomputeStrength } from "./strength";

/**
 * The CRM's job handlers (src/server/jobs/registry.ts rows crm-refresh and
 * crm-import). Each turn is its own short withSystemOrgTx in the job's
 * organization; a run that has more to do enqueues its own continuation, so
 * no turn outlives a transaction's 10 seconds and no run its maxRuntime.
 */

type RefreshPayload = {
  personId?: string;
  step?: "mirror" | "strength" | "dedupe";
  match?: { user?: string; contact?: string; registration?: string; response?: string };
};

/** The people a workspace change is about, on the service path. */
async function matchedPeople(db: TxClient, organizationId: string, match: NonNullable<RefreshPayload["match"]>): Promise<string[]> {
  const emails: string[] = [];
  const users: string[] = match.user ? [match.user] : [];
  const contacts: string[] = match.contact ? [match.contact] : [];
  if (match.registration) {
    const r = await db.eventRegistration.findFirst({
      where: { id: match.registration, organizationId },
      select: { email: true, userId: true, attendance: { select: { contactId: true } } },
    });
    if (r?.email) emails.push(r.email.toLowerCase());
    if (r?.userId) users.push(r.userId);
    if (r?.attendance?.contactId) contacts.push(r.attendance.contactId);
  }
  if (match.response) {
    const r = await db.formResponse.findFirst({ where: { id: match.response, organizationId }, select: { email: true, userId: true } });
    if (r?.email) emails.push(r.email.toLowerCase());
    if (r?.userId) users.push(r.userId);
  }
  if (!users.length && !contacts.length && !emails.length) return [];
  const rows = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: [
        ...(users.length ? [{ userId: { in: users } }] : []),
        ...(contacts.length ? [{ contactId: { in: contacts } }] : []),
        ...(emails.length ? [{ emails: { some: { email: { in: emails } } } }] : []),
      ],
    },
    select: { id: true },
    take: 10,
  });
  return rows.map((r) => r.id);
}
type ImportPayload = { importId?: string; bringIn?: BringInSource; userId: string };

/** Mirror, then strength, then duplicates; one step per turn. */
export const crmRefreshJob: JobHandler<RefreshPayload> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-refresh needs an organization");
  const { personId, match } = run.payload;
  if (match) {
    // A form answer, an RSVP or a check-in: just the timelines of whoever it's about.
    const people = await withSystemOrgTx(orgId, ({ db }) => matchedPeople(db, orgId, match));
    for (const id of people) {
      await withSystemOrgTx(orgId, ({ db }) => mirrorWorkspace(db, orgId, { personId: id }));
    }
    if (people.length) await withSystemOrgTx(orgId, ({ db }) => recomputeStrength(db, orgId));
    return;
  }
  let step = run.payload.step ?? "mirror";
  while (Date.now() < run.deadline - 12_000) {
    if (step === "mirror") {
      const result = await withSystemOrgTx(orgId, ({ db }) => mirrorWorkspace(db, orgId, { personId }));
      if (result.more && result.written > 0) continue;
      if (personId) {
        await withSystemOrgTx(orgId, ({ db }) => recomputeStrength(db, orgId));
        await withSystemOrgTx(orgId, ({ db }) => queueNewRecordAi(db, orgId, { personId }));
        return;
      }
      step = "strength";
    } else if (step === "strength") {
      await withSystemOrgTx(orgId, ({ db }) => recomputeStrength(db, orgId));
      step = "dedupe";
    } else {
      await withSystemOrgTx(orgId, ({ db }) => scanDuplicates(db, orgId, null));
      return;
    }
  }
  // Out of time: carry on in a fresh run.
  await withSystemOrgTx(orgId, ({ db }) =>
    enqueueJob(db, {
      orgId,
      kind: "crm-refresh",
      key: personId ? `p:${personId}:${step}` : `${orgId}:${step}`,
      payload: personId ? { personId, step } : { step },
      noKick: true,
    }),
  );
};

async function asMember<T>(orgId: string, userId: string, fn: (actor: CrmActor) => Promise<T>): Promise<T> {
  return withSystemOrgTx(orgId, { userId }, async ({ db }) => {
    const m = await db.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      select: { role: true },
    });
    // Whoever started it left the organization: nothing more is made as them.
    if (!m) throw new PermanentJobError("the member who started this import left");
    return fn({ db, organizationId: orgId, userId, role: m.role as Role });
  });
}

export const crmImportJob: JobHandler<ImportPayload> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-import needs an organization");
  const { importId, bringIn: source, userId } = run.payload;
  while (Date.now() < run.deadline - 15_000) {
    if (importId) {
      const { left } = await asMember(orgId, userId, (actor) => runImportTurn(actor, importId));
      if (left === 0) return;
    } else if (source) {
      const { more } = await asMember(orgId, userId, (actor) => bringIn(actor, source));
      if (!more) {
        await withSystemOrgTx(orgId, ({ db }) =>
          enqueueJob(db, { orgId, kind: "crm-refresh", key: orgId, payload: {} }),
        );
        return;
      }
    } else {
      throw new PermanentJobError("crm-import needs an import or a source");
    }
  }
  await withSystemOrgTx(orgId, ({ db }) =>
    enqueueJob(db, {
      orgId,
      kind: "crm-import",
      key: importId ? `${importId}:more` : `bring:${source}:more`,
      payload: run.payload,
      noKick: true,
    }),
  );
};
