import type { PlanFeature } from "@/lib/billing/features";

/**
 * Add-ons: parts of Bananasplit an organization adds when it wants them,
 * so a workspace starts with only what everyone uses. Owners and admins add
 * and take them off on Integrations and apps; the list lives in
 * OrgSettings.addOns. Taking one off only hides it (the sidebar, New, Home):
 * every form, response and transaction stays, and comes back when it's
 * added again. It's tidying, not a permission.
 */

export const ADD_ONS = ["forms", "finance", "crm"] as const;
export type AddOnId = (typeof ADD_ONS)[number];

export function isAddOn(id: string): id is AddOnId {
  return (ADD_ONS as readonly string[]).includes(id);
}

/** The add-ons a stored list names, in ADD_ONS order (unknown ids dropped). */
export function readAddOns(raw: readonly string[] | null | undefined): AddOnId[] {
  const have = new Set(raw ?? []);
  return ADD_ONS.filter((id) => have.has(id));
}

export interface AddOnInfo {
  id: AddOnId;
  /** The plan feature it needs (src/lib/billing/features.ts). */
  feature: PlanFeature;
  name: string;
  /** One line, for its card. */
  summary: string;
  /** Under its name on its card: who uses it. */
  who: string;
  /** The page under /app/{slug} it opens. */
  path: string;
}

export const ADD_ON_INFO: Record<AddOnId, AddOnInfo> = {
  forms: {
    id: "forms",
    feature: "polls",
    name: "Forms",
    summary:
      "Sign-ups, applications and quick polls. Every response is saved in a database you can filter and export.",
    who: "Owners and admins make forms; anyone you choose answers",
    path: "/forms",
  },
  finance: {
    id: "finance",
    feature: "finance",
    name: "Finance",
    summary:
      "Budgets by quarter or year, expenses with receipts, and reimbursements that need an approval.",
    who: "Owners, admins and treasurers keep the books; members submit expenses",
    path: "/finance",
  },
  crm: {
    id: "crm",
    feature: "crm",
    name: "CRM",
    summary:
      "The people and companies you reach out to: members, donors, partners, speakers and clients, with deals in pipelines and a timeline that fills itself.",
    who: "Every member works the CRM; owners, admins and CRM managers set it up",
    path: "/crm",
  },
};
