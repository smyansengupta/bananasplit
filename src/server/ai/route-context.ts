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

/**
 * The audit row for one AI read: which feature, which connection and model,
 * and sizes. Never the text, the image or what the model said.
 */
export async function auditAiRead(
  orgId: string,
  action: "ai.action_items_read" | "ai.calendar_screenshot_read",
  diff: Record<string, string | number>,
): Promise<void> {
  await withOrgTx(orgId, ({ db }) =>
    writeOrgAuditLog(db, { organizationId: orgId, action, targetType: "Organization", targetId: orgId, diff }),
  ).catch((error) => console.warn("[ai] audit row not written", error instanceof Error ? error.name : error));
}
