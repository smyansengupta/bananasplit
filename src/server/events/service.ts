import { z } from "zod";

import {
  CalendarSyncState,
  ConferenceProvider,
  EventKind,
  EventVisibility,
  IntegrationProvider,
  IntegrationStatus,
  Prisma,
  type Role,
} from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { writeOrgAuditLog } from "@/server/audit";
import { invalidate } from "@/server/cache/invalidate";
import { publicEvents, reports } from "@/server/cache/tags";
import type { TxClient, TxKind } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

/**
 * The event service: the ONE place events (calendar events and Sessions,
 * which are the same record) are created, updated and deleted. Calendar
 * (B7) and the Sessions database (B4) call it from their actions; the
 * website sync and the Google import call it from jobs.
 *
 * - Authorization: ADMIN+ (permission events.write) for user contexts; the
 *   service path (jobs, sync) is trusted. RLS enforces tenancy either way.
 * - Validation: kind, visibility (default INTERNAL), host (a member, or a
 *   free-text guest name), http(s) RSVP link, conference link rules.
 * - Every save bumps syncVersion (the Google compare-and-set token and the
 *   ICS SEQUENCE) and, for suite-side edits, sets suiteEditedAt (the 4b
 *   sync precedence rule).
 * - Side effects, all in the caller's transaction or after its commit:
 *     gcal:{eventId} when the org has a Google connection (Phase 7 worker);
 *     site-rebuild:{orgId} (runAt +60s, coalesced) when a PUBLIC event
 *       changes and the org has a website build hook;
 *     an OrgAuditLog row;
 *     invalidate() of tags.publicEvents(org) (when a PUBLIC event is
 *       involved) and tags.reports(org), after commit.
 *
 * Call it with ctx from withOrgAction (Server Actions) or withSystemOrgTx
 * (jobs): the invalidation is queued on that transaction.
 */

export interface EventServiceContext {
  db: TxClient;
  organizationId: string;
  userId: string | null;
  role: Role | null;
  kind: TxKind;
}

export interface EventSaveOptions {
  /** "suite" (default) marks suiteEditedAt; the website sync and Google import pass their origin. */
  origin?: "suite" | "sync" | "import";
  /**
   * The Google import (B7) only: link the event to an existing Google event.
   * On create the row starts SYNCED (its data came from that Google event)
   * and no gcal job is queued; on update the link is recorded and the usual
   * gcal job overwrites the Google copy with the suite's fields.
   */
  google?: GoogleLink;
  /** Importers only: several candidate matches, so list it under 'Possible duplicates'. */
  needsReview?: boolean;
}

/** An existing Google Calendar event an Event mirrors. */
export interface GoogleLink {
  calendarId: string;
  eventId: string;
  etag?: string | null;
  htmlLink?: string | null;
}

function googleLinkData(link: GoogleLink) {
  return {
    googleCalendarId: link.calendarId,
    googleEventId: link.eventId,
    googleEtag: link.etag ?? null,
    googleHtmlLink: link.htmlLink ?? null,
  };
}

export class EventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventValidationError";
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(isHttpUrl, "Links must be http(s) URLs.");

const eventFields = {
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalText(20_000),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean(),
  location: optionalText(300),
  conferenceProvider: z.enum(ConferenceProvider),
  conferenceUrl: optionalText(2000),
  kind: z.enum(EventKind),
  visibility: z.enum(EventVisibility),
  hostUserId: z.string().min(1).max(100).nullish(),
  hostName: optionalText(120),
  rsvpUrl: httpUrl.nullish().transform((v) => v || null),
  term: z
    .string()
    .regex(/^(fall|spring)-\d{4}$/, "Term is fall-YYYY or spring-YYYY")
    .nullish(),
  stampSlot: z.number().int().min(1).max(12).nullish(),
  capacityFull: z.boolean(),
  featured: z.boolean(),
  publicNote: optionalText(500),
};

/** Input for createEvent. Defaults: INTERNAL, OTHER, not all-day, no conference. */
export const eventInputSchema = z.object({
  ...eventFields,
  allDay: eventFields.allDay.default(false),
  conferenceProvider: eventFields.conferenceProvider.default(ConferenceProvider.NONE),
  kind: eventFields.kind.default(EventKind.OTHER),
  visibility: eventFields.visibility.default(EventVisibility.INTERNAL),
  capacityFull: eventFields.capacityFull.default(false),
  featured: eventFields.featured.default(false),
});

/** Input for updateEvent: any subset of the fields. */
export const eventPatchSchema = z.object(eventFields).partial();

export type EventInput = z.input<typeof eventInputSchema>;
export type EventPatch = z.input<typeof eventPatchSchema>;

export const EVENT_SELECT = {
  id: true,
  organizationId: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  location: true,
  conferenceProvider: true,
  conferenceUrl: true,
  kind: true,
  visibility: true,
  hostUserId: true,
  hostName: true,
  rsvpUrl: true,
  term: true,
  stampSlot: true,
  capacityFull: true,
  featured: true,
  publicNote: true,
  createdById: true,
  deletedAt: true,
  mergedIntoId: true,
  googleEventId: true,
  googleSyncState: true,
  syncVersion: true,
  updatedAt: true,
} satisfies Prisma.EventSelect;

export type ServiceEvent = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

export interface EventSaveResult {
  event: ServiceEvent;
  /** The cache tags this save invalidates (after commit). */
  tags: string[];
}

/**
 * The one definition of "on the public feed", used by the public endpoint,
 * the ICS feed, the Google public mirror and the build-hook trigger:
 * PUBLIC, not deleted, not merged into another event, ended at most a day
 * ago and starting within 400 days.
 */
export function publicEventsWhere(organizationId: string, now: Date = new Date()): Prisma.EventWhereInput {
  return {
    organizationId,
    visibility: EventVisibility.PUBLIC,
    deletedAt: null,
    mergedIntoId: null,
    endsAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    startsAt: { lte: new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000) },
  };
}

function authorize(ctx: EventServiceContext): void {
  if (ctx.kind === "system") return;
  requirePermission(ctx, "events.write");
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new EventValidationError(parsed.error.issues[0]?.message ?? "Invalid event.");
  }
  return parsed.data;
}

interface EventShape {
  startsAt: Date;
  endsAt: Date;
  conferenceProvider: ConferenceProvider;
  conferenceUrl: string | null;
}

function checkShape(e: EventShape): void {
  if (Number.isNaN(e.startsAt.getTime()) || Number.isNaN(e.endsAt.getTime())) {
    throw new EventValidationError("Enter a valid start and end time.");
  }
  if (e.endsAt < e.startsAt) throw new EventValidationError("End time must be after the start time.");
  if (e.conferenceProvider === ConferenceProvider.NONE) {
    if (e.conferenceUrl) throw new EventValidationError("Remove the link or choose a conferencing provider.");
    return;
  }
  if (!e.conferenceUrl) throw new EventValidationError("Paste a meeting link for this provider.");
  let url: URL;
  try {
    url = new URL(e.conferenceUrl);
  } catch {
    throw new EventValidationError("That meeting link doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:") throw new EventValidationError("Meeting links must use https.");
}

async function checkHost(ctx: EventServiceContext, hostUserId: string | null | undefined): Promise<void> {
  if (!hostUserId) return;
  const member = await ctx.db.membership.count({
    where: { organizationId: ctx.organizationId, userId: hostUserId },
  });
  if (member === 0) throw new EventValidationError("The host must be a member of this organization.");
}

interface Integrations {
  google: { connected: boolean; hasInternalCalendar: boolean };
  buildHook: boolean;
}

async function loadIntegrations(ctx: EventServiceContext): Promise<Integrations> {
  const rows = await ctx.db.orgIntegration.findMany({
    where: {
      organizationId: ctx.organizationId,
      provider: { in: [IntegrationProvider.GOOGLE_CALENDAR, IntegrationProvider.NETLIFY_BUILD_HOOK] },
      status: IntegrationStatus.CONNECTED,
    },
    select: { provider: true, config: true },
  });
  const google = rows.find((r) => r.provider === IntegrationProvider.GOOGLE_CALENDAR);
  const internal = (google?.config as { internalCalendarId?: unknown } | null)?.internalCalendarId;
  return {
    google: { connected: Boolean(google), hasInternalCalendar: typeof internal === "string" && internal.length > 0 },
    buildHook: rows.some((r) => r.provider === IntegrationProvider.NETLIFY_BUILD_HOOK),
  };
}

/** Whether the Google mirror has work to do for this event state. */
function needsGoogleSync(
  integrations: Integrations,
  after: { visibility: EventVisibility; deleted: boolean },
  before: { googleEventId: string | null } | null,
): boolean {
  if (!integrations.google.connected) return false;
  if (before?.googleEventId) return true; // update, move or delete an existing mirror
  if (after.deleted) return false;
  return after.visibility === EventVisibility.PUBLIC || integrations.google.hasInternalCalendar;
}

async function afterSave(
  ctx: EventServiceContext,
  action: "event.created" | "event.updated" | "event.deleted",
  before: ServiceEvent | null,
  after: ServiceEvent,
  integrations: Integrations,
  googleSync: boolean,
): Promise<string[]> {
  if (googleSync) {
    await enqueueJob(ctx.db, {
      orgId: ctx.organizationId,
      kind: "gcal",
      key: after.id,
      payload: { eventId: after.id },
    });
  }
  const touchesPublic =
    before?.visibility === EventVisibility.PUBLIC || after.visibility === EventVisibility.PUBLIC;
  if (touchesPublic && integrations.buildHook) {
    await enqueueJob(ctx.db, {
      orgId: ctx.organizationId,
      kind: "site-rebuild",
      key: ctx.organizationId,
      payload: {},
      runAt: new Date(Date.now() + 60_000),
    });
  }
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action,
    targetType: "Event",
    targetId: after.id,
    diff: {
      title: after.title,
      kind: after.kind,
      visibility: after.visibility,
      ...(before && before.visibility !== after.visibility ? { visibilityBefore: before.visibility } : {}),
    },
  });
  const tags = [reports(ctx.organizationId)];
  if (touchesPublic) tags.push(publicEvents(ctx.organizationId));
  invalidate(tags);
  return tags;
}

export async function createEvent(
  ctx: EventServiceContext,
  input: EventInput,
  options: EventSaveOptions = {},
): Promise<EventSaveResult> {
  authorize(ctx);
  if (!ctx.userId) throw new EventValidationError("An event needs a creator.");
  const data = parseOrThrow(eventInputSchema, input);
  checkShape(data);
  await checkHost(ctx, data.hostUserId);

  const integrations = await loadIntegrations(ctx);
  const link = options.google;
  const googleSync = link
    ? false
    : needsGoogleSync(integrations, { visibility: data.visibility, deleted: false }, null);
  const event = await ctx.db.event.create({
    data: {
      ...data,
      organizationId: ctx.organizationId,
      createdById: ctx.userId,
      conferenceUrl: data.conferenceProvider === ConferenceProvider.NONE ? null : data.conferenceUrl,
      hostName: data.hostUserId ? null : data.hostName,
      suiteEditedAt: (options.origin ?? "suite") === "suite" ? new Date() : null,
      syncVersion: 1,
      googleSyncState: link
        ? CalendarSyncState.SYNCED
        : googleSync
          ? CalendarSyncState.PENDING
          : CalendarSyncState.NOT_APPLICABLE,
      ...(link ? { ...googleLinkData(link), googleSyncedAt: new Date() } : {}),
      ...(options.needsReview ? { needsReview: true } : {}),
    },
    select: EVENT_SELECT,
  });
  const tags = await afterSave(ctx, "event.created", null, event, integrations, googleSync);
  return { event, tags };
}

async function loadLive(ctx: EventServiceContext, eventId: string): Promise<ServiceEvent> {
  const event = await ctx.db.event.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
    select: EVENT_SELECT,
  });
  if (!event) throw new NotFoundError();
  return event;
}

export async function updateEvent(
  ctx: EventServiceContext,
  eventId: string,
  patch: EventPatch,
  options: EventSaveOptions = {},
): Promise<EventSaveResult> {
  authorize(ctx);
  const changes = parseOrThrow(eventPatchSchema, patch);
  const before = await loadLive(ctx, eventId);
  const merged = { ...before, ...changes };
  const conferenceUrl =
    merged.conferenceProvider === ConferenceProvider.NONE ? null : (merged.conferenceUrl ?? null);
  checkShape({ ...merged, conferenceUrl });
  if (changes.hostUserId !== undefined && changes.hostUserId !== before.hostUserId) {
    await checkHost(ctx, changes.hostUserId);
  }

  const integrations = await loadIntegrations(ctx);
  const googleSync = needsGoogleSync(
    integrations,
    { visibility: merged.visibility, deleted: false },
    before,
  );
  const event = await ctx.db.event.update({
    where: { id: before.id },
    data: {
      ...changes,
      conferenceUrl,
      ...(changes.hostUserId ? { hostName: null } : {}),
      ...((options.origin ?? "suite") === "suite" ? { suiteEditedAt: new Date() } : {}),
      syncVersion: { increment: 1 },
      // A mirrored event edited while Google is disconnected stays PENDING,
      // so "Sync now" after reconnecting pushes the edit.
      ...(googleSync || before.googleEventId ? { googleSyncState: CalendarSyncState.PENDING } : {}),
      ...(options.google ? googleLinkData(options.google) : {}),
    },
    select: EVENT_SELECT,
  });
  const tags = await afterSave(ctx, "event.updated", before, event, integrations, googleSync);
  return { event, tags };
}

/**
 * Soft-deletes an event (deletedAt). Its Google mirror, if any, is removed
 * by the gcal job; a PUBLIC event triggers a website rebuild.
 */
export async function deleteEvent(
  ctx: EventServiceContext,
  eventId: string,
  options: EventSaveOptions = {},
): Promise<EventSaveResult> {
  authorize(ctx);
  const before = await loadLive(ctx, eventId);
  const integrations = await loadIntegrations(ctx);
  const googleSync = needsGoogleSync(
    integrations,
    { visibility: before.visibility, deleted: true },
    before,
  );
  const event = await ctx.db.event.update({
    where: { id: before.id },
    data: {
      deletedAt: new Date(),
      ...((options.origin ?? "suite") === "suite" ? { suiteEditedAt: new Date() } : {}),
      syncVersion: { increment: 1 },
      ...(googleSync || before.googleEventId ? { googleSyncState: CalendarSyncState.PENDING } : {}),
    },
    select: EVENT_SELECT,
  });
  const tags = await afterSave(ctx, "event.deleted", before, event, integrations, googleSync);
  return { event, tags };
}
