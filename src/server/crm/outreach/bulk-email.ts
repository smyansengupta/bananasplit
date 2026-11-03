import { randomUUID } from "node:crypto";

import { normalizeEmail } from "@/lib/crm/dedupe";
import { renderMerge } from "@/lib/crm/outreach/merge";

import { CrmError, type CrmAccess, type CrmActor } from "../access";
import type { RoleOwner } from "../owners";
import { startBulk } from "./campaigns";
import { listPeople } from "./lists";
import { messageIdFor, type SenderCheck } from "./mailbox";
import { contactable } from "./send";
import { mailToken } from "./tokens";

/**
 * Bulk email to a list (docs/features/crm.md, module 5): one message to
 * everyone on it, each merged for them, with a one-click unsubscribe
 * (List-Unsubscribe and List-Unsubscribe-Post headers, and a link in the
 * footer). It goes out only through the organization's own sender, and
 * only once the sender check passes (its domain verified in Resend, which
 * means SPF and DKIM are set up); never through the platform sender.
 * Do-not-contact, unsubscribes and bounces are left out here and again at
 * send time. Owners, admins and CRM managers send it.
 *
 * The send is a "bulk" campaign: its numbers (contacted, replied, booked)
 * are the campaign's, and the crm-bulk job sends it 25 at a time.
 */

export const BULK_MAX = 2000;

export interface BulkInput {
  viewId: string;
  subject: string;
  body: string;
  templateId?: string | null;
}

export interface BulkPlan {
  recipients: number;
  left: { reason: string; count: number }[];
}

async function recipients(actor: CrmActor, viewId: string, roles: ReadonlyMap<string, RoleOwner>) {
  const { db, organizationId, userId } = actor;
  const people = await listPeople(db, organizationId, viewId, userId, roles, BULK_MAX + 1);
  if (people.length > BULK_MAX) throw new CrmError(`Up to ${BULK_MAX.toLocaleString("en-US")} people in one send. Narrow the list.`);
  const full = await db.crmPerson.findMany({
    where: { organizationId, id: { in: people.map((p) => p.id) } },
    select: { id: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true },
  });
  const ok: { id: string; email: string }[] = [];
  const left = new Map<string, number>();
  const seen = new Set<string>();
  for (const p of full) {
    const can = contactable(p);
    const email = normalizeEmail(p.primaryEmail);
    if (!can.ok || !email) {
      const reason = can.reason ?? "They have no email address.";
      left.set(reason, (left.get(reason) ?? 0) + 1);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    ok.push({ id: p.id, email });
  }
  return { ok, left: [...left.entries()].map(([reason, count]) => ({ reason, count })) };
}

/** Who it would reach, and who's left out and why. */
export async function planBulk(actor: CrmActor, viewId: string, roles: ReadonlyMap<string, RoleOwner>): Promise<BulkPlan> {
  const r = await recipients(actor, viewId, roles);
  return { recipients: r.ok.length, left: r.left };
}

export async function sendBulk(
  actor: CrmActor,
  access: CrmAccess,
  sender: SenderCheck,
  input: BulkInput,
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<{ campaignId: string; recipients: number }> {
  if (!access.manager) throw new CrmError("Owners, admins and CRM managers send bulk email.");
  if (!sender.ok) throw new CrmError(sender.problem ?? "Connect your organization's own sender first.");
  const { db, organizationId, userId } = actor;
  const subject = input.subject.trim().slice(0, 300);
  if (!subject) throw new CrmError("Give it a subject.", ["subject"]);
  if (!input.body.trim()) throw new CrmError("Write the message.", ["body"]);
  for (const t of [subject, input.body]) {
    const unknown = renderMerge(t, {}).unknown;
    if (unknown.length) throw new CrmError(`There's no field called {{${unknown[0]}}}.`);
  }
  const view = await db.crmView.findFirst({ where: { id: input.viewId, organizationId, objectKind: "people" }, select: { name: true } });
  if (!view) throw new CrmError("Pick a list.");
  const r = await recipients(actor, input.viewId, roles);
  if (r.ok.length === 0) throw new CrmError("Nobody on that list can be emailed.");
  const campaign = await db.crmCampaign.create({
    data: {
      organizationId,
      name: subject,
      goal: `Bulk email to ${view.name}`,
      viewId: input.viewId,
      templateId: input.templateId ?? null,
      channel: "bulk",
      status: "ACTIVE",
      createdById: userId,
    },
    select: { id: true },
  });
  const rows = r.ok.map((p) => ({ person: p, threadId: randomUUID(), messageId: randomUUID() }));
  await db.crmEmailThread.createMany({ data: rows.map((x) => ({ id: x.threadId, organizationId, subject })) });
  await db.crmEmailMessage.createMany({
    data: rows.map((x) => ({
      id: x.messageId,
      organizationId,
      threadId: x.threadId,
      direction: "OUTBOUND" as const,
      status: "QUEUED" as const,
      mailbox: "ORG_SENDER" as const,
      mailboxUserId: userId,
      messageIdHeader: messageIdFor(x.messageId),
      fromAddress: sender.from ?? "pending",
      toAddresses: [x.person.email],
      subject,
      // Merged for each person when it goes (send.ts).
      bodyText: input.body.slice(0, 50_000),
      trackingToken: mailToken(),
      templateId: input.templateId ?? null,
      campaignId: campaign.id,
      createdById: userId,
    })),
  });
  await db.crmCampaignTarget.createMany({
    data: rows.map((x) => ({ organizationId, campaignId: campaign.id, personId: x.person.id, assigneeId: userId })),
    skipDuplicates: true,
  });
  await startBulk(db, organizationId, campaign.id);
  return { campaignId: campaign.id, recipients: rows.length };
}
