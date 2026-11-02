import { MAX_INVITES, normalizeInviteEmail, readInviteEmails } from "@/lib/reports/share";

import { ReportInputError, editable } from "./saved";
import { generateShareToken, hashShareToken } from "./share-token";
import type { SourceViewer } from "./sources";

/**
 * Sharing a report outside the organization, as one of its editors (its
 * maker, or an owner/admin on a shared one): the view-only link and the
 * email invites. RLS (20261103120000_report_sharing) allows the same
 * people; these say no in a sentence first. Only a report the organization
 * sees can be shared outside it.
 */

export interface ReportSharing {
  link: boolean;
  invites: string[];
}

async function shareable(v: SourceViewer, id: string) {
  const report = await editable(v, id);
  if (report.access !== "ORGANIZATION") {
    throw new ReportInputError("Share it with the organization first, then outside it.");
  }
  return report;
}

/** The report's sharing, for its editors. */
export async function getReportSharing(v: SourceViewer, id: string): Promise<ReportSharing> {
  const report = await editable(v, id);
  const invites = await v.db.reportInvite.findMany({
    where: { organizationId: v.organizationId, reportId: id },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return { link: report.linkOn, invites: invites.map((i) => i.email) };
}

/**
 * Turns the view-only link on (a new token each time, so "New link" is the
 * same call and the old link stops working) or off. Returns the token when
 * on: it's shown once and never stored.
 */
export async function setReportLink(
  v: SourceViewer,
  id: string,
  on: boolean,
): Promise<string | null> {
  if (on) await shareable(v, id);
  else await editable(v, id);
  const token = on ? generateShareToken() : null;
  await v.db.report.update({
    where: { id },
    data: token
      ? { linkTokenHash: hashShareToken(token), linkCreatedAt: new Date() }
      : { linkTokenHash: null, linkCreatedAt: null },
  });
  return token;
}

/** Shares the report with the addresses typed; returns everyone it's shared with. */
export async function addReportInvites(
  v: SourceViewer,
  id: string,
  typed: string,
): Promise<string[]> {
  await shareable(v, id);
  const { emails, bad } = readInviteEmails(typed);
  if (bad.length > 0) throw new ReportInputError(`${bad[0]} isn't an email address.`);
  if (emails.length === 0) throw new ReportInputError("Type an email address.");
  const have = await v.db.reportInvite.findMany({
    where: { organizationId: v.organizationId, reportId: id },
    select: { email: true },
  });
  const fresh = emails.filter((e) => !have.some((h) => h.email === e));
  if (have.length + fresh.length > MAX_INVITES) {
    throw new ReportInputError(`Share it with ${MAX_INVITES} people at most.`);
  }
  if (fresh.length > 0) {
    await v.db.reportInvite.createMany({
      data: fresh.map((email) => ({ organizationId: v.organizationId, reportId: id, email })),
      skipDuplicates: true,
    });
  }
  return [...have.map((h) => h.email), ...fresh];
}

export async function removeReportInvite(
  v: SourceViewer,
  id: string,
  email: string,
): Promise<void> {
  await editable(v, id);
  await v.db.reportInvite.deleteMany({
    where: { organizationId: v.organizationId, reportId: id, email: normalizeInviteEmail(email) },
  });
}
