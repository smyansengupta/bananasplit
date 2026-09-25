import { EventVisibility, IntegrationStatus, Role } from "@/generated/prisma/client";
import { withSystemOrgTx } from "@/server/db/context";
import { createEvent, updateEvent, EventValidationError } from "@/server/events/service";
import { sanitize } from "@/server/jobs/sanitize";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";

import { GoogleApiError, type CalendarClient, type GoogleEvent } from "./client";
import { loadGoogleIntegration, mergeIntegrationConfig } from "./config";
import { fromGoogleEvent, type ImportedEvent } from "./mapping";
import {
  planImport,
  summarize,
  type ImportDecision,
  type ImportSummary,
  type SuiteCandidate,
} from "./match";
import { markNeedsReauth } from "./reauth";
import { enqueueGoogleBackfill } from "./requests";
import { syncDeps } from "./sync";
import { GoogleReauthError } from "./token";

/**
 * The google-import job: a one-time import of the events already on the
 * org's public Google Calendar, run as a dry run first and then applied.
 *
 * - events.list runs outside any transaction (paginated, bounded by the
 *   job deadline), from 180 days back to 400 days ahead.
 * - Each Google event goes through planImport (./match.ts): exact links and
 *   the suite's own mirrors are no-ops; one clear title-and-time candidate
 *   (a workshop already synced from the website, say) gets googleEventId
 *   linked and becomes PUBLIC, because it is on the public calendar; several
 *   candidates create an Event flagged needsReview (the 'Possible
 *   duplicates' queue); no candidate creates a PUBLIC Event.
 * - The dry run stores "N linked, M new, K ambiguous" (plus a few sample
 *   titles) in the integration's config.import for Settings to show; apply
 *   writes through the event service (origin "import") in short
 *   transactions, logs each link in EventLinkLog, then queues the suite's
 *   own unsynced events for the mirror (the backfill).
 * - Running it again is a no-op: every event is then an exact link.
 *
 * From then on the suite is the source of truth: edits made directly in
 * Google are overwritten by the next save in the suite.
 */

const LOOKBACK_DAYS = 180;
const LOOKAHEAD_DAYS = 400;
const MAX_EVENTS = 2500;
const APPLY_CHUNK = 20;
const DAY = 24 * 60 * 60 * 1000;
const SAMPLE = 8;

export interface ImportRecord extends ImportSummary {
  mode: "dry-run" | "apply";
  status: "done" | "partial" | "failed";
  calendarId: string;
  ranAt: string;
  samples: { linked: string[]; created: string[]; ambiguous: string[] };
  error?: string;
}

async function listAll(
  client: CalendarClient,
  calendarId: string,
  window: { timeMin: Date; timeMax: Date },
  deadline: number,
): Promise<{ items: GoogleEvent[]; complete: boolean }> {
  const raw: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let complete = true;
  do {
    if (Date.now() > deadline - 30_000 || raw.length >= MAX_EVENTS) {
      complete = false;
      break;
    }
    const page = await client.listEvents(calendarId, { ...window, pageToken });
    raw.push(...page.items);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return { items: raw, complete };
}

function samplesOf(
  decisions: readonly ImportDecision[],
  titleOf: (id: string) => string | undefined,
) {
  const pick = (a: ImportDecision["action"][]) =>
    decisions
      .filter((d) => a.includes(d.action))
      .slice(0, SAMPLE)
      .map((d) => {
        if (d.action === "link" || d.action === "relink") {
          const suite = titleOf(d.suiteEventId);
          return suite && suite !== d.google.title
            ? `${d.google.title} -> ${suite}`
            : d.google.title;
        }
        return d.google.title;
      });
  return {
    linked: pick(["link", "relink"]),
    created: pick(["create"]),
    ambiguous: pick(["ambiguous"]),
  };
}

async function recordImport(
  organizationId: string,
  integrationId: string,
  record: ImportRecord,
): Promise<void> {
  await withSystemOrgTx(organizationId, async ({ db }) => {
    await mergeIntegrationConfig(db, integrationId, { import: record });
  });
}

/** The member who owns imported events: whoever connected Google, else an OWNER. */
async function importCreator(
  organizationId: string,
  connectedById: string | null,
): Promise<string> {
  return withSystemOrgTx(organizationId, async ({ db }) => {
    if (connectedById) {
      const member = await db.membership.findFirst({
        where: { organizationId, userId: connectedById },
        select: { userId: true },
      });
      if (member) return member.userId;
    }
    const owner = await db.membership.findFirst({
      where: { organizationId, role: Role.OWNER },
      orderBy: { joinedAt: "asc" },
      select: { userId: true },
    });
    if (!owner) throw new PermanentJobError("the org has no owner to own imported events");
    return owner.userId;
  });
}

function eventInput(g: ImportedEvent, visibility: EventVisibility) {
  return {
    title: g.title,
    description: g.description,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    allDay: g.allDay,
    location: g.location,
    kind: g.kind,
    visibility,
    rsvpUrl: g.rsvpUrl,
  };
}

/** Applies one decision in the caller's transaction. Returns false when it was skipped. */
async function applyDecision(
  ctx: Parameters<typeof createEvent>[0],
  d: ImportDecision,
  calendarId: string,
): Promise<boolean> {
  const link = {
    calendarId,
    eventId: d.google.googleEventId,
    etag: d.google.etag,
    htmlLink: d.google.htmlLink,
  };
  const logLink = (eventId: string, method: "EXACT" | "MATCHED", score: number | null) =>
    ctx.db.eventLinkLog.create({
      data: {
        organizationId: ctx.organizationId,
        eventId,
        source: "GOOGLE",
        externalId: d.google.googleEventId,
        method,
        score,
        actorId: ctx.userId,
      },
    });

  switch (d.action) {
    case "unchanged":
    case "skip":
      return false;
    case "relink":
    case "link": {
      // Linked events adopt PUBLIC: they are on the public calendar. The
      // suite's fields stay (it is the source of truth) and the mirror job
      // overwrites the Google copy with them.
      await updateEvent(
        ctx,
        d.suiteEventId,
        { visibility: EventVisibility.PUBLIC },
        { origin: "import", google: link },
      );
      await logLink(
        d.suiteEventId,
        d.action === "relink" ? "EXACT" : "MATCHED",
        d.action === "link" ? d.score : null,
      );
      return true;
    }
    case "create":
    case "ambiguous": {
      const { event } = await createEvent(ctx, eventInput(d.google, EventVisibility.PUBLIC), {
        origin: "import",
        google: link,
        needsReview: d.action === "ambiguous",
      });
      await logLink(event.id, "EXACT", null);
      return true;
    }
  }
}

export const googleImportJob: JobHandler<{
  integrationId: string;
  mode: "dry-run" | "apply";
}> = async (run) => {
  const organizationId = run.organizationId;
  if (!organizationId) throw new PermanentJobError("google-import is an org job");
  const { integrationId, mode } = run.payload;

  const setup = await withSystemOrgTx(organizationId, async ({ db }) => {
    const integration = await loadGoogleIntegration(db, organizationId);
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return { integration, timeZone: org?.timezone ?? "UTC" };
  });
  const integration = setup.integration;
  if (!integration || integration.id !== integrationId) return; // disconnected or replaced since
  if (integration.status === IntegrationStatus.DISCONNECTED) return;
  if (integration.status === IntegrationStatus.NEEDS_REAUTH) {
    return { status: "CANCELLED", error: "Google Calendar needs to be reconnected" };
  }
  const calendarId = integration.config.publicCalendarId;
  const now = Date.now();
  const window = {
    timeMin: new Date(now - LOOKBACK_DAYS * DAY),
    timeMax: new Date(now + LOOKAHEAD_DAYS * DAY),
  };

  // ---- Google, outside any transaction ----
  let listed: { items: ImportedEvent[]; complete: boolean };
  try {
    const accessToken = await syncDeps.getAccessToken(organizationId, { signal: run.signal });
    const client = syncDeps.createClient(accessToken, run.signal);
    const raw = await listAll(client, calendarId, window, run.deadline);
    listed = {
      items: raw.items
        .map((g) => fromGoogleEvent(g, setup.timeZone))
        .filter((g): g is ImportedEvent => g !== null),
      complete: raw.complete,
    };
  } catch (error) {
    if (error instanceof GoogleReauthError) {
      await markNeedsReauth(organizationId, error.message);
      return { status: "CANCELLED", error: "Google Calendar needs to be reconnected" };
    }
    const failed: ImportRecord = {
      mode,
      status: "failed",
      calendarId,
      ranAt: new Date().toISOString(),
      total: 0,
      unchanged: 0,
      linked: 0,
      created: 0,
      ambiguous: 0,
      skipped: 0,
      samples: { linked: [], created: [], ambiguous: [] },
      error: sanitize(error, 300),
    };
    await recordImport(organizationId, integrationId, failed);
    if (error instanceof GoogleApiError && !error.retryable)
      throw new PermanentJobError(sanitize(error, 300));
    throw error;
  }

  // ---- Plan against the suite's events (one short read) ----
  const suite: SuiteCandidate[] = await withSystemOrgTx(organizationId, async ({ db }) =>
    db.event.findMany({
      where: {
        organizationId,
        startsAt: {
          gte: new Date(window.timeMin.getTime() - DAY),
          lte: new Date(window.timeMax.getTime() + DAY),
        },
      },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        googleCalendarId: true,
        googleEventId: true,
        deletedAt: true,
        mergedIntoId: true,
      },
    }),
  );
  const decisions = planImport(listed.items, suite, { organizationId, calendarId });
  const titles = new Map(suite.map((s) => [s.id, s.title]));
  const record: ImportRecord = {
    mode,
    status: listed.complete ? "done" : "partial",
    calendarId,
    ranAt: new Date().toISOString(),
    ...summarize(decisions),
    samples: samplesOf(decisions, (id) => titles.get(id)),
  };

  if (mode === "dry-run") {
    await recordImport(organizationId, integrationId, record);
    return;
  }

  // ---- Apply in short transactions through the event service ----
  const creatorId = await importCreator(organizationId, integration.connectedById);
  const todo = decisions.filter((d) => d.action !== "unchanged" && d.action !== "skip");
  let applied = 0;
  let skipped = 0;
  for (let i = 0; i < todo.length; i += APPLY_CHUNK) {
    if (Date.now() > run.deadline - 10_000) {
      record.status = "partial";
      break;
    }
    const chunk = todo.slice(i, i + APPLY_CHUNK);
    await withSystemOrgTx(organizationId, { userId: creatorId }, async (ctx) => {
      const serviceCtx = { ...ctx, organizationId, userId: creatorId };
      for (const d of chunk) {
        try {
          if (await applyDecision(serviceCtx, d, calendarId)) applied += 1;
        } catch (error) {
          // One bad Google entry (e.g. an end before its start) is skipped,
          // not allowed to fail the whole import.
          if (!(error instanceof EventValidationError)) throw error;
          skipped += 1;
        }
      }
    });
  }
  record.skipped += skipped;
  await withSystemOrgTx(organizationId, async ({ db }) => {
    await mergeIntegrationConfig(db, integrationId, {
      import: { ...record, appliedAt: new Date().toISOString(), applied },
    });
    // The suite's own events that Google does not have yet.
    await enqueueGoogleBackfill(db, organizationId, integration.config);
  });
};
