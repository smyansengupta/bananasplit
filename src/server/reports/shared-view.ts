import { spaceIncludes } from "@/lib/billing/space";
import { WIDGETS, type WidgetType } from "@/lib/reports/catalog";
import type { WidgetPayload } from "@/lib/reports/compute";
import { isInvited, normalizeInviteEmail, sharePayload } from "@/lib/reports/share";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { withSystemOrgTx } from "@/server/db/context";

import { runSharedReportAsMaker } from "./shared-as-maker";
import { hashShareToken, isShareToken } from "./share-token";

/**
 * The outside side of a shared report (/r/{token}, /r/invite/{reportId}):
 * finding it with no org context (the definer lookups of
 * 20261103120000_report_sharing), then reading on the service path scoped
 * to its organization, and computing it as its maker sees it. Nothing here
 * runs as the visitor, and nothing relaxes RLS for app_user.
 */

export interface ShareTarget {
  organizationId: string;
  reportId: string;
}

const REPORT_ID = /^[a-z0-9]{8,40}$/i;

/** Opens of shared reports an hour, per visitor's address and per link or report. */
const OPENS_PER_IP = 120;
const OPENS_PER_SHARE = 600;

/**
 * Counts one open of a shared report (each one computes the report). Null
 * when it's within the limits, else when to try again ("in 5 minutes").
 */
export async function sharedViewLimit(share: string): Promise<string | null> {
  const ip = await getClientIp();
  for (const [key, limit] of [
    [rateLimitKey("report-share-ip", ip), OPENS_PER_IP],
    [rateLimitKey("report-share", share), OPENS_PER_SHARE],
  ] as const) {
    const hit = await checkRateLimit(key, limit, 60 * 60);
    if (!hit.allowed) return retryAfterText(hit);
  }
  return null;
}

/** The live, organization-shared report a link's token opens, if any. */
export async function linkTarget(token: string): Promise<ShareTarget | null> {
  if (!isShareToken(token)) return null;
  const hash = hashShareToken(token);
  return withSystemOrgTx(null, async ({ db }) => {
    const rows = await db.$queryRaw<ShareTarget[]>`
      SELECT "organizationId", "reportId" FROM app.report_link_target(${hash})`;
    return rows[0] ?? null;
  });
}

/** The report, if `email` (the visitor's verified address) is invited to it. */
export async function inviteTarget(reportId: string, email: string): Promise<ShareTarget | null> {
  if (!REPORT_ID.test(reportId) || !email) return null;
  const rows = await withSystemOrgTx(
    null,
    ({ db }) =>
      db.$queryRaw<ShareTarget[]>`
      SELECT "organizationId", "reportId"
        FROM app.report_invite_target(${reportId}, ${normalizeInviteEmail(email)})`,
  );
  const target = rows[0] ?? null;
  if (!target) return null;
  // Checked again on the organization's own rows.
  const invites = await withSystemOrgTx(target.organizationId, ({ db }) =>
    db.reportInvite.findMany({
      where: { organizationId: target.organizationId, reportId },
      select: { email: true },
    }),
  );
  return isInvited(
    email,
    invites.map((i) => i.email),
  )
    ? target
    : null;
}

export interface SharedWidget {
  id: string;
  type: WidgetType;
  w: number;
  h: number | null;
  title: string;
  payload: WidgetPayload | null;
}

export interface SharedReport {
  orgName: string;
  title: string;
  sourceName: string;
  rangeLabel: string;
  widgets: SharedWidget[];
}

/** The report as its maker sees it, with nothing that leads into the organization. */
export async function loadSharedReport(target: ShareTarget): Promise<SharedReport | null> {
  const found = await withSystemOrgTx(target.organizationId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: target.organizationId },
      select: {
        name: true,
        deletedAt: true,
        kind: true,
        plan: true,
        trialEndsAt: true,
        planAfterTrial: true,
      },
    });
    if (!org || org.deletedAt || !spaceIncludes(org, "reports", new Date())) return null;
    const report = await db.report.findFirst({
      where: {
        id: target.reportId,
        organizationId: target.organizationId,
        archivedAt: null,
        access: "ORGANIZATION",
      },
      select: { createdById: true },
    });
    if (!report?.createdById) return null;
    return { orgName: org.name, makerId: report.createdById };
  });
  if (!found) return null;
  const run = await runSharedReportAsMaker(target.organizationId, target.reportId, found.makerId);
  if (!run) return null;
  return {
    orgName: found.orgName,
    title: run.title,
    sourceName: run.sourceName,
    rangeLabel: run.rangeLabel,
    widgets: run.computed
      .filter((c) => c.widget.type in WIDGETS)
      .map((c) => ({
        id: c.widget.id,
        type: c.widget.type,
        w: c.widget.w,
        h: c.widget.h,
        title: c.title,
        payload: c.payload ? sharePayload(c.payload) : null,
      })),
  };
}
