import type { Role } from "@/generated/prisma/client";
import { readAddOns } from "@/lib/addons";
import { can } from "@/lib/auth/permissions";
import { featureRefusal, spaceIncludes } from "@/lib/billing/space";
import type { RelationshipType } from "@/lib/crm/templates";
import type { TxClient } from "@/server/db/context";

/**
 * Who may do what in the CRM (docs/features/crm.md, module 12; the RLS
 * policies in 20261105090000_crm are the real gate, this gives friendly
 * errors and hides controls):
 *
 * - The CRM is there when the space has added it (OrgSettings.addOns) and
 *   its plan has it (Team Advanced or an organization's trial; Personal Plus
 *   or a new account's trial in a Personal space). Every page and action
 *   asks requireCrm first.
 * - In a Personal space the owner is the only member, so they are admin and
 *   manager, and the team parts (who sees what, CRM managers, lead routing,
 *   handover) don't show (`personal`).
 * - Every member adds and edits people, companies and items, logs activity
 *   and works the lists. With memberAccess OWN they see only what they own
 *   or made (the database decides that).
 * - Owners, admins and CRM managers (CrmSettings.managerIds) shape it:
 *   pipelines and stages, fields, relationship types, access, and merging
 *   and deleting for good. Everything else people do goes to the trash.
 */

/** Anything that acts in the CRM: an OrgContext is one. */
export interface CrmActor {
  db: TxClient;
  organizationId: string;
  userId: string;
  role: Role;
}

/** A job or a sync acting for the organization (app_service): no member. */
export interface CrmSystemActor {
  db: TxClient;
  organizationId: string;
  userId: null;
  role: null;
}

/** What the person did wrong, in words for them; actions return it as { error }. */
export class CrmError extends Error {
  readonly fields: string[];

  constructor(message: string, fields: string[] = []) {
    super(message);
    this.name = "CrmError";
    this.fields = fields;
  }
}

export interface CrmSettingsView {
  memberAccess: "ALL" | "OWN";
  managerIds: string[];
  relationshipTypes: RelationshipType[];
  setupKinds: string[];
  setupDoneAt: Date | null;
}

export interface CrmAccess {
  /** The space added the CRM. */
  added: boolean;
  /** A Personal space: one person's CRM, no team settings. */
  personal: boolean;
  /** Its plan (or trial) includes it. */
  onPlan: boolean;
  /** Owner or admin. */
  admin: boolean;
  /** Owner, admin or CRM manager: may shape the CRM. */
  manager: boolean;
  settings: CrmSettingsView | null;
}

function readTypes(raw: unknown): RelationshipType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is RelationshipType =>
        Boolean(t) &&
        typeof t === "object" &&
        typeof (t as RelationshipType).id === "string" &&
        typeof (t as RelationshipType).label === "string",
    )
    .map((t) => ({ id: t.id, label: t.label, color: typeof t.color === "string" ? t.color : "gray" }));
}

export async function readCrmSettings(
  db: TxClient,
  organizationId: string,
): Promise<CrmSettingsView | null> {
  const row = await db.crmSettings.findUnique({ where: { organizationId } });
  if (!row) return null;
  return {
    memberAccess: row.memberAccess === "OWN" ? "OWN" : "ALL",
    managerIds: row.managerIds,
    relationshipTypes: readTypes(row.relationshipTypes),
    setupKinds: row.setupKinds,
    setupDoneAt: row.setupDoneAt,
  };
}

export async function crmAccess(actor: CrmActor): Promise<CrmAccess> {
  const { db, organizationId } = actor;
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { kind: true, plan: true, trialEndsAt: true, planAfterTrial: true },
  });
  const orgSettings = await db.orgSettings.findUnique({
    where: { organizationId },
    select: { addOns: true },
  });
  const settings = await readCrmSettings(db, organizationId);
  const admin = can(actor, "settings.general.write");
  return {
    added: readAddOns(orgSettings?.addOns).includes("crm"),
    personal: org?.kind === "PERSONAL",
    onPlan: Boolean(org && spaceIncludes(org, "crm")),
    admin,
    manager: admin || Boolean(settings?.managerIds.includes(actor.userId)),
    settings,
  };
}

/** The CRM's gate for every page and action: added, and on the plan. */
export async function requireCrm(actor: CrmActor): Promise<CrmAccess> {
  const access = await crmAccess(actor);
  if (!access.onPlan) {
    throw new CrmError(featureRefusal({ kind: access.personal ? "PERSONAL" : "CLUB" }, "crm"));
  }
  if (!access.added) throw new CrmError("Add the CRM on Integrations and apps first.");
  return access;
}

export function requireManager(access: CrmAccess): void {
  if (!access.manager) {
    throw new CrmError("Only owners, admins and CRM managers can change how the CRM is set up.");
  }
}

/** A member of this organization, or a CrmError. */
export async function requireMember(
  db: TxClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const m = await db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { userId: true },
  });
  if (!m) throw new CrmError("Pick someone in your organization.");
}
