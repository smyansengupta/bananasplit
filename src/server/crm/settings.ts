import type { Prisma } from "@/generated/prisma/client";
import { CHOICE_COLORS } from "@/lib/databases/fields";
import {
  readAutonomy,
  readSending,
  type Autonomy,
  type SendingPrefs,
  type TrustItem,
  type TrustLevel,
} from "@/lib/crm/settings-prefs";
import type { RelationshipType } from "@/lib/crm/templates";
import { writeOrgAuditLog } from "@/server/audit";

import { CrmError, requireCrm, requireManager, type CrmActor } from "./access";
import * as n from "./normalize";

/**
 * CRM settings: who sees what (ALL or OWN), who the CRM managers are, and
 * the relationship types people are tagged with. Access and managers are
 * owners' and admins' to change (a CRM manager can't make more managers or
 * widen their own reach); relationship types are every manager's.
 */

export async function setMemberAccess(actor: CrmActor, mode: "ALL" | "OWN"): Promise<void> {
  const access = await requireCrm(actor);
  if (!access.admin) throw new CrmError("Only owners and admins change who sees what.");
  if (mode !== "ALL" && mode !== "OWN") throw new CrmError("Pick who sees what.");
  await actor.db.crmSettings.update({
    where: { organizationId: actor.organizationId },
    data: { memberAccess: mode },
  });
  await writeOrgAuditLog(actor.db, {
    organizationId: actor.organizationId,
    action: "crm.access_changed",
    targetType: "CrmSettings",
    targetId: actor.organizationId,
    diff: { memberAccess: mode },
  });
}

export async function setManagers(actor: CrmActor, userIds: readonly string[]): Promise<void> {
  const access = await requireCrm(actor);
  if (!access.admin) throw new CrmError("Only owners and admins choose the CRM managers.");
  const ids = [...new Set(userIds)].slice(0, 50);
  const members = await actor.db.membership.findMany({
    where: { organizationId: actor.organizationId, userId: { in: ids } },
    select: { userId: true },
  });
  if (members.length !== ids.length) throw new CrmError("Pick people in your organization.");
  await actor.db.crmSettings.update({
    where: { organizationId: actor.organizationId },
    data: { managerIds: ids },
  });
  await writeOrgAuditLog(actor.db, {
    organizationId: actor.organizationId,
    action: "crm.managers_changed",
    targetType: "CrmSettings",
    targetId: actor.organizationId,
    diff: { managers: ids.length },
  });
}

export async function saveRelationshipTypes(
  actor: CrmActor,
  types: readonly RelationshipType[],
): Promise<void> {
  requireManager(await requireCrm(actor));
  if (types.length > 40) throw new CrmError("Up to 40 relationship types.");
  const seen = new Set<string>();
  const clean: RelationshipType[] = [];
  for (const t of types) {
    const label = n.text(t.label, 40);
    if (!label) throw new CrmError("Give every type a name.");
    const id =
      typeof t.id === "string" && /^[a-z0-9_-]{1,40}$/.test(t.id)
        ? t.id
        : label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "type";
    if (seen.has(id)) continue;
    seen.add(id);
    const color = (CHOICE_COLORS as readonly string[]).includes(t.color) ? t.color : "gray";
    clean.push({ id, label, color });
  }
  await actor.db.crmSettings.update({
    where: { organizationId: actor.organizationId },
    data: { relationshipTypes: clean as unknown as Prisma.InputJsonArray },
  });
}

/** Makes a required-everywhere field (or not) on People or Companies (their database's column settings). */
export async function setRequired(
  actor: CrmActor,
  databaseId: string,
  key: string,
  required: boolean,
): Promise<void> {
  requireManager(await requireCrm(actor));
  const { db, organizationId } = actor;
  const def = await db.databaseDefinition.findFirst({
    where: { id: databaseId, organizationId, kind: { in: ["CRM_PEOPLE", "CRM_COMPANIES"] } },
    select: { id: true, columns: true },
  });
  if (!def) throw new CrmError("That database isn't here any more.");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) throw new CrmError("Pick a field.");
  const columns = (Array.isArray(def.columns) ? def.columns : []) as Record<string, unknown>[];
  const rest = columns.filter((c) => c && c.key !== key);
  const existing = columns.find((c) => c && c.key === key) ?? { key };
  const next = required ? [...rest, { ...existing, required: true }] : [...rest, { ...existing, required: false }];
  await db.databaseDefinition.update({
    where: { id: def.id },
    data: { columns: next as Prisma.InputJsonArray },
  });
}

/**
 * CRM settings > Automations and sending: the window group mail waits for (hours in the
 * organization's timezone, weekends or not) and the unsubscribe line.
 * Whoever runs the CRM. Saved cleaned (readSending).
 */
export async function saveSending(actor: CrmActor, input: Partial<SendingPrefs>): Promise<SendingPrefs> {
  requireManager(await requireCrm(actor));
  const row = await actor.db.crmSettings.findUnique({
    where: { organizationId: actor.organizationId },
    select: { sending: true },
  });
  const current = readSending(row?.sending);
  const startHour = input.startHour ?? current.startHour;
  const endHour = input.endHour ?? current.endHour;
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 24 || endHour <= startHour) {
    throw new CrmError("Pick a start before the end.");
  }
  const next = readSending({ ...current, ...input, startHour, endHour });
  await actor.db.crmSettings.update({
    where: { organizationId: actor.organizationId },
    data: { sending: next as unknown as Prisma.InputJsonObject },
  });
  return next;
}

/** CRM settings > Automations, how much it may do alone. Whoever runs the CRM. */
export async function saveAutonomy(
  actor: CrmActor,
  input: Partial<Record<TrustItem, TrustLevel>>,
): Promise<Autonomy> {
  requireManager(await requireCrm(actor));
  const row = await actor.db.crmSettings.findUnique({
    where: { organizationId: actor.organizationId },
    select: { autonomy: true },
  });
  const next = readAutonomy({ ...readAutonomy(row?.autonomy), ...input });
  await actor.db.crmSettings.update({
    where: { organizationId: actor.organizationId },
    data: { autonomy: next as unknown as Prisma.InputJsonObject },
  });
  await writeOrgAuditLog(actor.db, {
    organizationId: actor.organizationId,
    action: "crm.autonomy_changed",
    targetType: "CrmSettings",
    targetId: actor.organizationId,
    diff: { ...next },
  });
  return next;
}
