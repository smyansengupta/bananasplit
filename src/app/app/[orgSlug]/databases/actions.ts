"use server";

import { TZDate } from "@date-fns/tz";
import { z } from "zod";

import { DatabaseKind, EventKind, EventVisibility, IntegrationProvider } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import {
  addManualAttendance,
  addManualSignup,
  assertCanEdit,
  DatabaseEditError,
  deleteAttendance,
  deleteSignup,
  importBallotDefinition,
  linkContactToMember,
  reevaluatePoll,
  renameContact,
  setAttendanceNameOverride,
  setAttendanceSuppressed,
  setBallotSuppressed,
  setSignupsAddedToList,
  setSignupSuppressed,
  updateBallotDefinition,
} from "@/server/databases/admin";
import { mergeContacts, splitContactEmail } from "@/server/databases/contacts";
import { AppError } from "@/server/db/errors";
import { withOrgAction, withOrgTx, withSystemOrgTx } from "@/server/db/context";
import {
  createEvent,
  deleteEvent,
  EventMergeError,
  EventValidationError,
  mergeEvents,
  updateEvent,
} from "@/server/events/service";
import { markReportsDataChanged } from "@/server/reports/data-version";
import { requestSync } from "@/server/sync/enqueue";

/**
 * Server Actions of the Databases section. Each returns { error } for an
 * expected failure (validation, permission, a row that is gone) and throws
 * nothing the user should see. Writes run in withOrgAction (app_user, RLS);
 * merges run on the service path after the permission check, because they
 * must move rows the acting admin's tier may not see.
 */

export interface ActionResult<T = undefined> {
  error?: string;
  data?: T;
}

const KNOWN = [DatabaseEditError, EventValidationError, EventMergeError, ForbiddenError, NotFoundError, AppError, z.ZodError];

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { data: await fn() };
  } catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? "Check the form." };
    if (error instanceof NotFoundError) return { error: "That record no longer exists, or you can't see it." };
    if (KNOWN.some((K) => error instanceof K)) return { error: (error as Error).message };
    throw error;
  }
}

// ---- Sessions (the event service) ------------------------------------------------

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a date and time.");

const sessionFormSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  kind: z.enum(EventKind),
  visibility: z.enum(EventVisibility),
  startsAt: localDateTime,
  endsAt: localDateTime,
  location: z.string().optional(),
  hostUserId: z.string().optional(),
  hostName: z.string().optional(),
  rsvpUrl: z.string().optional(),
  term: z.string().optional(),
  stampSlot: z.string().optional(),
});

export type SessionForm = z.input<typeof sessionFormSchema>;

/** A datetime-local value, read as wall-clock time in the org timezone. */
function fromLocal(value: string, timezone: string): Date {
  const [d, t] = value.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, day, h, min, timezone || "UTC").getTime());
}

async function sessionInput(organizationId: string, form: SessionForm) {
  const data = sessionFormSchema.parse(form);
  const org = await withOrgTx(organizationId, ({ db }) =>
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } }),
  );
  const slot = data.stampSlot?.trim() ? Number(data.stampSlot) : null;
  return {
    title: data.title,
    description: data.description ?? null,
    kind: data.kind,
    visibility: data.visibility,
    startsAt: fromLocal(data.startsAt, org.timezone),
    endsAt: fromLocal(data.endsAt, org.timezone),
    location: data.location ?? null,
    hostUserId: data.hostUserId || null,
    hostName: data.hostUserId ? null : data.hostName || null,
    rsvpUrl: data.rsvpUrl || null,
    term: data.term?.trim() ? data.term.trim() : undefined,
    stampSlot: slot === null || Number.isNaN(slot) ? null : slot,
  };
}

const createSessionTx = withOrgAction(async (ctx, input: Awaited<ReturnType<typeof sessionInput>>) => {
  await assertCanEdit(ctx, DatabaseKind.SESSIONS);
  const { event } = await createEvent(ctx, input);
  await markReportsDataChanged(ctx);
  return event.id;
});

export async function createSessionAction(organizationId: string, form: SessionForm) {
  return run(async () => createSessionTx(organizationId, await sessionInput(organizationId, form)));
}

const updateSessionTx = withOrgAction(
  async (ctx, eventId: string, input: Awaited<ReturnType<typeof sessionInput>>) => {
    await assertCanEdit(ctx, DatabaseKind.SESSIONS);
    await updateEvent(ctx, eventId, input);
    await markReportsDataChanged(ctx);
    return eventId;
  },
);

export async function updateSessionAction(organizationId: string, eventId: string, form: SessionForm) {
  return run(async () => updateSessionTx(organizationId, eventId, await sessionInput(organizationId, form)));
}

const deleteSessionTx = withOrgAction(async (ctx, eventId: string) => {
  await assertCanEdit(ctx, DatabaseKind.SESSIONS);
  await deleteEvent(ctx, eventId);
  await markReportsDataChanged(ctx);
});

export async function deleteSessionAction(organizationId: string, eventId: string) {
  return run(() => deleteSessionTx(organizationId, eventId));
}

/** Clears the needsReview flag: the admin confirmed the session is not a duplicate. */
const dismissReviewTx = withOrgAction(async (ctx, eventId: string) => {
  await assertCanEdit(ctx, DatabaseKind.SESSIONS);
  const updated = await ctx.db.event.updateMany({
    where: { id: eventId, organizationId: ctx.organizationId },
    data: { needsReview: false },
  });
  if (updated.count === 0) throw new NotFoundError();
});

export async function dismissReviewAction(organizationId: string, eventId: string) {
  return run(() => dismissReviewTx(organizationId, eventId));
}

/** Authorizes an admin for a service-path write and returns the acting user. */
async function authorizeServiceWrite(organizationId: string, kind: DatabaseKind) {
  const user = await requireUser();
  const role = await withOrgAction(async (ctx) => {
    await assertCanEdit(ctx, kind);
    return ctx.role;
  })(organizationId);
  requirePermission({ role }, "databases.write");
  return { userId: user.id, role };
}

export async function mergeSessionsAction(organizationId: string, survivorId: string, loserId: string) {
  return run(async () => {
    const actor = await authorizeServiceWrite(organizationId, DatabaseKind.SESSIONS);
    const result = await withSystemOrgTx(organizationId, { userId: actor.userId }, (ctx) =>
      mergeEvents({ ...ctx, organizationId, userId: actor.userId, role: actor.role, kind: "system" }, survivorId, loserId),
    );
    return result.moved;
  });
}

// ---- Attendance -------------------------------------------------------------------

const addAttendanceTx = withOrgAction(async (ctx, input: Parameters<typeof addManualAttendance>[1]) =>
  (await addManualAttendance(ctx, input)).id,
);

export async function addAttendanceAction(organizationId: string, input: Parameters<typeof addManualAttendance>[1]) {
  return run(() => addAttendanceTx(organizationId, input));
}

const suppressAttendanceTx = withOrgAction((ctx, id: string, suppressed: boolean) =>
  setAttendanceSuppressed(ctx, id, suppressed),
);

export async function setAttendanceSuppressedAction(organizationId: string, id: string, suppressed: boolean) {
  return run(() => suppressAttendanceTx(organizationId, id, suppressed));
}

const deleteAttendanceTx = withOrgAction((ctx, id: string) => deleteAttendance(ctx, id));

export async function deleteAttendanceAction(organizationId: string, id: string) {
  return run(() => deleteAttendanceTx(organizationId, id));
}

const renameAttendanceTx = withOrgAction((ctx, id: string, name: string | null) =>
  setAttendanceNameOverride(ctx, id, name),
);

export async function setAttendanceNameAction(organizationId: string, id: string, name: string | null) {
  return run(() => renameAttendanceTx(organizationId, id, name));
}

// ---- Signups ------------------------------------------------------------------------

const addSignupTx = withOrgAction(async (ctx, input: Parameters<typeof addManualSignup>[1]) =>
  (await addManualSignup(ctx, input)).id,
);

export async function addSignupAction(organizationId: string, input: Parameters<typeof addManualSignup>[1]) {
  return run(() => addSignupTx(organizationId, input));
}

const addedToListTx = withOrgAction((ctx, ids: string[], added: boolean) => setSignupsAddedToList(ctx, ids, added));

export async function setSignupsAddedAction(organizationId: string, ids: string[], added: boolean) {
  return run(() => addedToListTx(organizationId, ids, added));
}

const suppressSignupTx = withOrgAction((ctx, id: string, suppressed: boolean) =>
  setSignupSuppressed(ctx, id, suppressed),
);

export async function setSignupSuppressedAction(organizationId: string, id: string, suppressed: boolean) {
  return run(() => suppressSignupTx(organizationId, id, suppressed));
}

const deleteSignupTx = withOrgAction((ctx, id: string) => deleteSignup(ctx, id));

export async function deleteSignupAction(organizationId: string, id: string) {
  return run(() => deleteSignupTx(organizationId, id));
}

// ---- Contacts -----------------------------------------------------------------------

const renameContactTx = withOrgAction((ctx, id: string, name: string) => renameContact(ctx, id, name));

export async function renameContactAction(organizationId: string, contactId: string, name: string) {
  return run(() => renameContactTx(organizationId, contactId, name));
}

const linkContactTx = withOrgAction((ctx, id: string, userId: string | null) =>
  linkContactToMember(ctx, id, userId),
);

export async function linkContactAction(organizationId: string, contactId: string, userId: string | null) {
  return run(() => linkContactTx(organizationId, contactId, userId));
}

export async function mergeContactsAction(organizationId: string, survivorId: string, loserId: string) {
  return run(async () => {
    const actor = await authorizeServiceWrite(organizationId, DatabaseKind.ATTENDANCE);
    const result = await withSystemOrgTx(organizationId, { userId: actor.userId }, (ctx) =>
      mergeContacts({ ...ctx, organizationId }, survivorId, loserId),
    );
    return result.moved;
  });
}

export async function splitContactEmailAction(organizationId: string, contactId: string, emailId: string) {
  return run(async () => {
    const actor = await authorizeServiceWrite(organizationId, DatabaseKind.ATTENDANCE);
    return withSystemOrgTx(organizationId, { userId: actor.userId }, (ctx) =>
      splitContactEmail({ ...ctx, organizationId }, contactId, emailId),
    );
  });
}

/** Contacts matching a name or address, for the merge and manual attendance pickers (RLS applies). */
export async function searchContactsAction(organizationId: string, q: string) {
  return run(async () =>
    withOrgTx(organizationId, async ({ db }) => {
      const term = q.trim().slice(0, 80);
      if (term.length < 2) return [];
      const rows = await db.contact.findMany({
        where: {
          organizationId,
          OR: [
            { displayName: { contains: term, mode: "insensitive" } },
            { emailMasked: { contains: term.toLowerCase(), mode: "insensitive" } },
            { emails: { some: { emailNormalized: { contains: term.toLowerCase() } } } },
          ],
        },
        orderBy: [{ lastCheckInAt: { sort: "desc", nulls: "last" } }],
        take: 12,
        select: { id: true, displayName: true, emailMasked: true, sessionsAttended: true, userId: true },
      });
      return rows;
    }),
  );
}

// ---- Ballots ----------------------------------------------------------------------------

const importDefinitionTx = withOrgAction((ctx, input: Parameters<typeof importBallotDefinition>[1]) =>
  importBallotDefinition(ctx, input),
);

/** Re-evaluates a poll's ballots on the service path (after the admin's own write committed). */
async function reevaluateAsService(organizationId: string, slug: string) {
  const user = await requireUser();
  return withSystemOrgTx(organizationId, { userId: user.id }, ({ db }) => reevaluatePoll(db, organizationId, slug));
}

export async function importDefinitionAction(
  organizationId: string,
  input: Parameters<typeof importBallotDefinition>[1],
) {
  return run(async () => {
    const out = await importDefinitionTx(organizationId, input);
    const result = await reevaluateAsService(organizationId, out.slug);
    return { ...out, ...result };
  });
}

const updateDefinitionTx = withOrgAction((ctx, id: string, patch: Parameters<typeof updateBallotDefinition>[2]) =>
  updateBallotDefinition(ctx, id, patch),
);

export interface DefinitionForm {
  title?: string;
  /** yyyy-MM-ddTHH:mm in the org timezone, or "" for no bound. */
  opensAt?: string;
  closesAt?: string;
  linkedEventId?: string | null;
  isTest?: boolean;
}

export async function updateDefinitionAction(organizationId: string, id: string, form: DefinitionForm) {
  return run(async () => {
    const org = await withOrgTx(organizationId, ({ db }) =>
      db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } }),
    );
    const when = (v: string | undefined) =>
      v === undefined ? undefined : v ? fromLocal(localDateTime.parse(v), org.timezone) : null;
    const out = await updateDefinitionTx(organizationId, id, {
      title: form.title,
      opensAt: when(form.opensAt),
      closesAt: when(form.closesAt),
      linkedEventId: form.linkedEventId,
      isTest: form.isTest,
    });
    return reevaluateAsService(organizationId, out.slug);
  });
}

const suppressBallotTx = withOrgAction((ctx, id: string, suppressed: boolean) =>
  setBallotSuppressed(ctx, id, suppressed),
);

export async function setBallotSuppressedAction(organizationId: string, id: string, suppressed: boolean) {
  return run(() => suppressBallotTx(organizationId, id, suppressed));
}

// ---- Website sync -------------------------------------------------------------------------

const syncNowTx = withOrgAction(async (ctx, reconcile: boolean) => {
  requirePermission(ctx, "databases.write");
  const integration = await ctx.db.orgIntegration.findFirst({
    where: { organizationId: ctx.organizationId, provider: IntegrationProvider.SUPABASE_SOURCE },
    select: { id: true, secretFingerprint: true },
  });
  if (!integration?.secretFingerprint) {
    throw new DatabaseEditError("Connect the website data source in Settings > Integrations first.");
  }
  await requestSync(ctx.db, ctx.organizationId, integration.id, { reconcile });
});

/** "Sync now" (ADMIN+): enqueues the coalesced sync job and kicks the drain; never syncs in the request. */
export async function syncNowAction(organizationId: string, reconcile = false) {
  return run(() => syncNowTx(organizationId, reconcile));
}
