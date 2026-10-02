import type { ImportMember } from "@/lib/ai/action-items";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone, zonedDateKey } from "@/lib/calendar/dates";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgTx } from "@/server/db/context";

/**
 * What both AI import routes need about the caller and the club, read as
 * the caller (RLS): it throws NotFoundError for a non-member, so a stranger
 * learns nothing. The member roster is what the model is allowed to see:
 * names and titles under opaque keys, never ids or emails.
 */

export interface ImportContext {
  userId: string;
  canCreateEvents: boolean;
  timezone: string;
  /** The club's local date, YYYY-MM-DD. */
  today: string;
  rules: { requireOwner: boolean; requireDueDate: boolean };
  members: ImportMember[];
}

const MAX_ROSTER = 400;

export async function loadImportContext(orgId: string): Promise<ImportContext> {
  return withOrgTx(orgId, async ({ db, role, userId }) => {
    const org = await db.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { timezone: true, settings: { select: { taskRequireOwner: true, taskRequireDueDate: true } } },
    });
    const memberships = await db.membership.findMany({
      where: { organizationId: orgId },
      select: { userId: true, title: true, user: { select: { name: true } } },
      orderBy: { joinedAt: "asc" },
      take: MAX_ROSTER,
    });
    const timezone = safeTimeZone(org.timezone);
    const members = memberships
      .map((m) => ({ userId: m.userId, name: m.user.name?.trim() || "Unnamed member", title: m.title?.trim() || null }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m, i) => ({ key: `m${i + 1}`, ...m }));
    return {
      userId,
      canCreateEvents: can({ role }, "events.write"),
      timezone,
      today: zonedDateKey(new Date(), timezone),
      rules: {
        requireOwner: org.settings?.taskRequireOwner ?? false,
        requireDueDate: org.settings?.taskRequireDueDate ?? false,
      },
      members,
    };
  });
}

export interface FinanceImportContext {
  userId: string;
  canManageFinance: boolean;
  timezone: string;
  today: string;
  /** Category names the model may file records under: the active period's first, then the rest. */
  categories: string[];
}

const MAX_CATEGORY_NAMES = 80;

/** The finance reader's context, read as the caller (NotFoundError for a non-member). */
export async function loadFinanceImportContext(orgId: string): Promise<FinanceImportContext> {
  return withOrgTx(orgId, async ({ db, role, userId }) => {
    const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
    const categories = await db.budgetCategory.findMany({
      where: { organizationId: orgId },
      select: { name: true, budgetPeriod: { select: { isActive: true } } },
      orderBy: [{ sortOrder: "asc" }],
      take: 500,
    });
    const names: string[] = [];
    const seen = new Set<string>();
    for (const c of [...categories.filter((c) => c.budgetPeriod.isActive), ...categories]) {
      const key = c.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(c.name.trim());
    }
    const timezone = safeTimeZone(org.timezone);
    return {
      userId,
      canManageFinance: can({ role }, "finance.manage"),
      timezone,
      today: zonedDateKey(new Date(), timezone),
      categories: names.slice(0, MAX_CATEGORY_NAMES),
    };
  });
}

/**
 * The audit row for one AI read: which feature, which connection and model,
 * and sizes. Never the text, the image or what the model said.
 */
export async function auditAiRead(
  orgId: string,
  action: "ai.action_items_read" | "ai.calendar_screenshot_read" | "ai.finance_import_read",
  diff: Record<string, string | number>,
): Promise<void> {
  await withOrgTx(orgId, ({ db }) =>
    writeOrgAuditLog(db, { organizationId: orgId, action, targetType: "Organization", targetId: orgId, diff }),
  ).catch((error) => console.warn("[ai] audit row not written", error instanceof Error ? error.name : error));
}
