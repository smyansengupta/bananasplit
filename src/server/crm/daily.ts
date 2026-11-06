import { safeTimeZone } from "@/lib/calendar/dates";
import { localDateKey } from "@/lib/tasks/dates";
import { withSystemOrgTx } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";

import { weeklySnapshots } from "./forecast";
import { rolePositions } from "./owners";
import { recomputeScoresPage, trainModel } from "./scoring";
import { raiseSignals } from "./signals";
import { runScheduledWorkflows } from "./workflow-engine";

/**
 * The CRM's daily automation and numbers (registry row crm-daily),
 * enqueued once a day with crm-refresh (src/server/crm/schedule.ts):
 *
 * 1. schedules: workflows on a date, a quiet spell or a stuck item;
 * 2. scores: the score rules over every person and open item, in pages;
 * 3. model: the learned model, once there are enough closed items;
 * 4. signals: the Inbox's To review rows for each member;
 * 5. forecast: this week's snapshot of each pipeline's quarter and year.
 *
 * Each step is its own short transaction (or several); out of time, the
 * job enqueues its own continuation from where it stopped.
 */

type Step = "schedules" | "scores" | "model" | "signals" | "forecast";
type Payload = { step?: Step; cursor?: string };

const ORDER: Step[] = ["schedules", "scores", "model", "signals", "forecast"];

export const crmDailyJob: JobHandler<Payload> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-daily needs an organization");
  const now = new Date();
  const stopAt = run.deadline - 12_000;
  let step: Step = run.payload.step ?? "schedules";
  let cursor: string | null = run.payload.cursor ?? null;
  const tz = await withSystemOrgTx(orgId, async ({ db }) => {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
    return safeTimeZone(org?.timezone ?? "UTC");
  });
  const today = localDateKey(now, tz);
  while (Date.now() < stopAt) {
    if (step === "schedules") {
      const r = await runScheduledWorkflows(orgId, now, stopAt);
      if (r.more) break;
    } else if (step === "scores") {
      const r = await withSystemOrgTx(orgId, ({ db }) => recomputeScoresPage(db, orgId, cursor, now));
      cursor = r.cursor;
      if (cursor) continue;
    } else if (step === "model") {
      await withSystemOrgTx(orgId, ({ db }) => trainModel(db, orgId, now));
      // Fresh coefficients: score the open items with them on the next pass.
    } else if (step === "signals") {
      const roles = await rolePositions(orgId);
      await withSystemOrgTx(orgId, ({ db }) => raiseSignals(db, orgId, roles, now));
    } else {
      await withSystemOrgTx(orgId, ({ db }) => weeklySnapshots(db, orgId, today, now));
      return;
    }
    const next = ORDER[ORDER.indexOf(step) + 1];
    if (!next) return;
    step = next;
    cursor = null;
  }
  await withSystemOrgTx(orgId, ({ db }) =>
    enqueueJob(db, {
      orgId,
      kind: "crm-daily",
      key: `${orgId}:${today}:${step}:${cursor ?? ""}`.slice(0, 240),
      payload: { step, ...(cursor ? { cursor } : {}) },
      noKick: true,
    }),
  );
};

/** Enqueues today's crm-daily (once a day; the cron calls it beside crm-refresh). */
export async function scheduleCrmDaily(
  db: Parameters<typeof enqueueJob>[0],
  orgId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const id = await enqueueJob(db, {
    orgId,
    kind: "crm-daily",
    key: `${orgId}:${now.toISOString().slice(0, 10)}`,
    payload: {},
    once: true,
    noKick: true,
  });
  return Boolean(id);
}
