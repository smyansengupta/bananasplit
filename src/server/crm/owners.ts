import { getPublishedOrgChart } from "@/server/org-chart/queries";

/**
 * Relationships owned by a role (docs/features/crm.md, "Relationships owned
 * by a role"): a person, company, pipeline or item can be owned by an
 * org-chart position (ownerRoleKey = OrgChartPosition.key) as well as a
 * member. The holder is read from the published org chart each time, so
 * when the member in that position changes the relationships follow the
 * position and the timeline stays. Shown as "Partnerships lead (Ada)".
 *
 * AUTHORIZE FIRST: the published chart is a cached service read; call this
 * only for an organization the viewer is a member of (every CRM page and
 * action already is).
 */

export interface RoleOwner {
  key: string;
  title: string;
  /** The member holding it now, if anyone. */
  userId: string | null;
  holderName: string | null;
}

export interface OwnerLabelInput {
  ownerId: string | null;
  ownerRoleKey: string | null;
}

/** Every position of the published chart, by key (empty without one). */
export async function rolePositions(organizationId: string): Promise<Map<string, RoleOwner>> {
  const chart = await getPublishedOrgChart(organizationId).catch(() => null);
  const out = new Map<string, RoleOwner>();
  for (const p of chart?.positions ?? []) {
    out.set(p.key, {
      key: p.key,
      title: p.title,
      userId: p.userId,
      holderName: p.user?.name ?? p.personName ?? null,
    });
  }
  return out;
}

/** "Partnerships lead (Ada)", "Partnerships lead (open)", "Ada", or null. */
export function ownerLabel(
  record: OwnerLabelInput,
  roles: ReadonlyMap<string, RoleOwner>,
  memberNames: ReadonlyMap<string, string>,
): string | null {
  if (record.ownerRoleKey) {
    const role = roles.get(record.ownerRoleKey);
    if (role) return `${role.title} (${role.holderName?.split(" ")[0] ?? "open"})`;
  }
  if (record.ownerId) return memberNames.get(record.ownerId) ?? "A former member";
  return null;
}

/** Who is responsible right now: the role's holder first, then the member owner. */
export function effectiveOwnerId(
  record: OwnerLabelInput,
  roles: ReadonlyMap<string, RoleOwner>,
): string | null {
  if (record.ownerRoleKey) {
    const holder = roles.get(record.ownerRoleKey)?.userId;
    if (holder) return holder;
  }
  return record.ownerId;
}

/** The position keys a member holds now (for "Mine": records their role owns count). */
export function rolesHeldBy(userId: string, roles: ReadonlyMap<string, RoleOwner>): string[] {
  return [...roles.values()].filter((r) => r.userId === userId).map((r) => r.key);
}
