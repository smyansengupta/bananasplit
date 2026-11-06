import { normalizeEmail } from "@/lib/crm/dedupe";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";

import { logActivity } from "../activity";
import { writeHistory } from "../history";
import { setPersonEmails } from "../people";
import { tokenTarget } from "./public";
import { selfUpdateToken, selfUpdateUrl, sha256 } from "./tokens";

/**
 * People keep their own details current (docs/features/crm.md, "What
 * makes ours better" 13): a private link (/c/{token}) where a contact
 * updates their own email, title, phone and company, offered in the RSVP
 * confirmation and in form receipts, so records stay fresh without paying
 * for enrichment. The token is derived from the person (tokens.ts), its
 * hash stored on CrmPerson.selfUpdateTokenHash when the link is first
 * offered.
 */

/** The person's link, switched on if it wasn't (call in the organization's transaction). */
export async function ensureSelfUpdateLink(db: TxClient, organizationId: string, personId: string): Promise<string | null> {
  const p = await db.crmPerson.findFirst({
    where: { id: personId, organizationId, deletedAt: null },
    select: { id: true, selfUpdateTokenHash: true },
  });
  if (!p) return null;
  const hash = sha256(selfUpdateToken(organizationId, p.id));
  if (p.selfUpdateTokenHash !== hash) {
    await db.crmPerson.update({ where: { id: p.id }, data: { selfUpdateTokenHash: hash } });
  }
  return selfUpdateUrl(organizationId, p.id);
}

/**
 * The link for whoever in this organization's CRM has this address, or
 * null (no CRM, nobody with it). For RSVP confirmations and form receipts.
 */
export async function selfUpdateLinkFor(db: TxClient, organizationId: string, email: string | null | undefined): Promise<string | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  const crm = await db.crmSettings.findUnique({ where: { organizationId }, select: { setupDoneAt: true } });
  if (!crm?.setupDoneAt) return null;
  const row = await db.crmPersonEmail.findFirst({
    where: { organizationId, email: e, person: { deletedAt: null, doNotContact: false } },
    select: { personId: true },
  });
  return row ? ensureSelfUpdateLink(db, organizationId, row.personId) : null;
}

export interface SelfUpdateView {
  orgName: string;
  name: string;
  email: string | null;
  title: string | null;
  phone: string | null;
  company: string | null;
}

export async function loadSelfUpdate(token: string): Promise<SelfUpdateView | null> {
  const target = await tokenTarget("self", token);
  if (!target) return null;
  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    const p = await db.crmPerson.findFirst({
      where: { id: target.id, organizationId: target.organizationId, deletedAt: null },
      select: { name: true, primaryEmail: true, title: true, phone: true, company: { select: { name: true } } },
    });
    if (!p) return null;
    const org = await db.organization.findUnique({ where: { id: target.organizationId }, select: { name: true } });
    return { orgName: org?.name ?? "", name: p.name, email: p.primaryEmail, title: p.title, phone: p.phone, company: p.company?.name ?? null };
  });
}

export interface SelfUpdateInput {
  name: string;
  email: string;
  title: string;
  phone: string;
  company: string;
}

export type SelfUpdateResult = { ok: true } | { ok: false; error: string };

export async function saveSelfUpdate(token: string, input: SelfUpdateInput): Promise<SelfUpdateResult> {
  const target = await tokenTarget("self", token);
  if (!target) return { ok: false, error: "This link isn't working any more. Ask whoever sent it for a new one." };
  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim() ? normalizeEmail(input.email) : null;
  if (!name) return { ok: false, error: "Add your name." };
  if (input.email.trim() && !email) return { ok: false, error: "That email address doesn't look right." };
  const orgId = target.organizationId;
  return withSystemOrgTx(orgId, async ({ db }) => {
    const before = await db.crmPerson.findFirst({
      where: { id: target.id, organizationId: orgId, deletedAt: null },
      select: { id: true, name: true, primaryEmail: true, title: true, phone: true, companyId: true, company: { select: { name: true } } },
    });
    if (!before) return { ok: false as const, error: "This link isn't working any more." };
    if (email && email !== before.primaryEmail) {
      const taken = await db.crmPersonEmail.findFirst({
        where: { organizationId: orgId, email, personId: { not: before.id }, person: { deletedAt: null } },
        select: { id: true },
      });
      if (taken) return { ok: false as const, error: "That address is already on file for someone else. Write to us and we'll sort it out." };
    }
    const title = input.title.trim().slice(0, 120) || null;
    const phone = input.phone.trim().slice(0, 40) || null;
    const companyName = input.company.trim().slice(0, 200) || null;
    let companyId = before.companyId;
    if (companyName && companyName !== before.company?.name) {
      const found = await db.crmCompany.findFirst({
        where: { organizationId: orgId, deletedAt: null, name: { equals: companyName, mode: "insensitive" } },
        select: { id: true },
      });
      companyId = found?.id ?? (await db.crmCompany.create({ data: { organizationId: orgId, name: companyName }, select: { id: true } })).id;
    } else if (!companyName) companyId = null;
    const changes = [
      { field: "name", oldValue: before.name, newValue: name },
      { field: "primaryEmail", oldValue: before.primaryEmail, newValue: email ?? before.primaryEmail },
      { field: "title", oldValue: before.title, newValue: title },
      { field: "phone", oldValue: before.phone, newValue: phone },
      { field: "companyId", oldValue: before.companyId, newValue: companyId },
    ].filter((c) => c.oldValue !== c.newValue);
    if (changes.length === 0) return { ok: true as const };
    await db.crmPerson.update({
      where: { id: before.id },
      data: { name, title, phone, companyId, ...(email ? { primaryEmail: email } : {}) },
    });
    if (email && email !== before.primaryEmail) {
      const others = (
        await db.crmPersonEmail.findMany({ where: { organizationId: orgId, personId: before.id }, select: { email: true } })
      )
        .map((e) => e.email)
        .filter((e) => e !== email);
      await setPersonEmails(db, orgId, before.id, email, others);
    }
    await writeHistory(db, { organizationId: orgId, targetKind: "person", targetId: before.id, changes, userId: null, source: "system" });
    await logActivity(db, {
      organizationId: orgId,
      kind: "SYSTEM",
      subject: "Updated their own details",
      body: changes.map((c) => c.field).join(", "),
      targets: [{ kind: "person", id: before.id }],
    });
    return { ok: true as const };
  });
}
