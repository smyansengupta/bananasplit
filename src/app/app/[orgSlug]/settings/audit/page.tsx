import { ArrowLeft, ArrowRight, ScrollText } from "@/components/icons";
import Link from "next/link";

import { TableFrame } from "@/components/databases/table-frame";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

import { ChipLink } from "../chip-link";
import { SettingsNoAccess } from "../settings-no-access";

const PAGE_SIZE = 50;

/** Filter groups: the action prefix each one matches. */
const GROUPS = [
  { key: "", label: "All" },
  { key: "org.", label: "Organization" },
  { key: "member.", label: "Members" },
  { key: "invitation.", label: "Invitations" },
  { key: "integration.", label: "Integrations" },
  { key: "privacy.", label: "Privacy" },
  { key: "export.", label: "Exports" },
  { key: "connector.", label: "AI apps" },
] as const;

const ACTION_COPY: Record<string, string> = {
  "org.created": "created the organization",
  "org.renamed": "renamed the organization",
  "org.slug_changed": "changed the URL",
  "org.timezone_changed": "changed the timezone",
  "settings.weekly_update_day_changed": "changed the weekly update day",
  "org.logo_changed": "uploaded a new logo",
  "org.logo_removed": "removed the logo",
  "org.deletion_scheduled": "scheduled the organization for deletion",
  "org.deletion_cancelled": "cancelled the deletion",
  "member.role_changed": "changed a member's role",
  "member.title_changed": "changed a member's title",
  "member.removed": "removed a member",
  "member.left": "left the organization",
  "member.ownership_transferred": "transferred ownership",
  "invitation.created": "sent an invite",
  "invitation.resent": "resent an invite",
  "invitation.revoked": "revoked an invite",
  "invitation.accepted": "joined through an invite",
  "integration.secret_set": "connected an integration",
  "integration.secret_replaced": "replaced an integration key",
  "integration.secret_removed": "removed an integration",
  "integration.tested": "tested an integration",
  "integration.config_changed": "changed integration settings",
  "integration.disconnected": "disconnected an integration",
  "integration.test_email_sent": "sent a test email",
  "integration.mail_fallback_changed": "changed the platform mail fallback",
  "privacy.updated": "changed privacy settings",
  "privacy.ballot_visibility_changed": "changed who sees individual votes",
  "privacy.database_visibility_changed": "changed a database's visibility",
  "export.requested": "requested a data export",
  "export.ready": "data export finished",
  "export.downloaded": "downloaded a data export",
  "export.expired": "data export expired",
  "workspace.bootstrapped": "applied a workspace template",
  "settings.sidebar.updated": "changed the sidebar",
  "settings.pulse.updated": "changed the weekly pulse",
  "label.created": "created a tag",
  "label.deleted": "deleted a tag",
  "label.renamed": "renamed or recoloured a tag",
  "label.merged": "merged two tags",
  "settings.creation_rules": "changed who can create tags and projects",
  "labels.set_up": "set up the tags",
  "theme.updated": "changed the theme",
  "theme.reset": "reset the theme to the default",
  "org.plan_changed": "changed the plan",
  "join_code.created": "created the invite code",
  "join_code.rotated": "made a new invite code",
  "join_code.updated": "changed the invite code settings",
  "join_code.used": "joined with the invite code",
  "membership.own_title_set": "set their own title",
  "setup.completed": "closed guided setup",
  "setup.reopened": "reopened guided setup",
  "setup.step_skipped": "skipped a setup step",
  "integration.google_revoked": "revoked Google Calendar access",
  "integration.needs_reauth": "lost an integration's access",
  "teams.setup": "set up teams",
  "event.created": "created an event",
  "event.updated": "changed an event",
  "event.deleted": "deleted an event",
  "event.merged": "merged two events",
  "event.rsvp_page_on": "opened an RSVP page",
  "event.rsvp_page_off": "closed an RSVP page",
  "personal.items_moved": "moved items in from Personal",
  "signup.created": "added a sign-up",
  "signup.deleted": "deleted a sign-up",
  "signup.imported": "imported sign-ups",
  "attendance.created": "recorded attendance",
  "attendance.renamed": "renamed a session's attendance",
  "attendance.deleted": "deleted attendance",
  "attendance.imported": "imported attendance",
  "contact.renamed": "renamed a contact",
  "contact.merged": "merged two contacts",
  "contact.split": "split a contact in two",
  "orgchart.upload": "uploaded an org chart",
  "orgchart.publish": "published the org chart",
  "orgchart.rollback": "rolled the org chart back",
  "orgchart.discard": "discarded an org chart draft",
  "database.created": "created a database",
  "database.archived": "archived a database",
  "database.imported": "imported rows into a database",
  "database.exported": "exported a database",
  "database.field_deleted": "deleted a database field",
  "database.settings_changed": "changed a database's settings",
  "finance.records_imported": "imported finance records",
  "finance.import_undone": "undid a finance import",
  "finance.budget_imported": "imported a budget",
  "calendar.google_sync_requested": "asked to sync Google Calendar",
  "calendar.google_import_requested": "asked to import from Google Calendar",
  "ballot_definition.updated": "changed a ballot",
  "ai.action_items_read": "pulled action items from notes with AI",
  "finance.setup": "set up finance",
  "privacy.connectors_changed": "turned AI apps on or off",
  // A member's connected AI app acting for them (docs/features/ai-connectors.md).
  "connector.create_task": "created a task from an AI app",
  "connector.update_task": "changed a task from an AI app",
  "connector.add_task_comment": "commented on a task from an AI app",
  "connector.rsvp_to_event": "answered an invitation from an AI app",
  "connector.add_database_record": "added a database row from an AI app",
  "connector.update_database_record": "changed a database row from an AI app",
  "connector.post_weekly_update": "posted a weekly update from an AI app",
  "connector.vote_in_poll": "voted in a poll from an AI app",
  "connector.create_note": "created a note from an AI app",
};

/** An action with no sentence above, in words: "database.rows_deleted" -> "database: rows deleted". */
function actionWords(action: string): string {
  const [area, ...rest] = action.split(".");
  const what = rest.join(" ").replace(/_/g, " ");
  return what ? `${area?.replace(/_/g, " ")}: ${what}` : action.replace(/_/g, " ");
}

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Short, safe summary of a diff (secrets never reach the audit log; this trims long values). */
function summarize(diff: unknown): string {
  if (!diff || typeof diff !== "object") return "";
  const parts: string[] = [];
  const d = diff as Record<string, unknown>;
  if ("from" in d && "to" in d && typeof d.from !== "object" && typeof d.to !== "object") {
    parts.push(`${String(d.from ?? "none")} → ${String(d.to ?? "none")}`);
  }
  for (const key of ["provider", "role", "database", "last4", "ok", "kind"]) {
    if (key in d && d[key] !== undefined) {
      const v = d[key];
      parts.push(key === "last4" ? `••••${String(v)}` : `${key}: ${String(v)}`);
    }
  }
  // An AI app's change names the app, once its name is known.
  if (typeof d.client === "string") parts.push(`app: ${d.client}`);
  return parts.join(" · ").slice(0, 160);
}

/**
 * Settings > Audit log (OWNER/ADMIN; RLS lets only them read OrgAuditLog).
 * Every settings change, membership change, integration change and data
 * export, newest first, 50 per page.
 */
export default async function AuditLogPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/settings/audit">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "auditLog");
  if (planLock) return planLock;
  const sp = await searchParams;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "audit.view")) {
    return <SettingsNoAccess title="Audit log" who="owners and admins" />;
  }
  const group =
    GROUPS.find((g) => g.key === (typeof sp.group === "string" ? sp.group : "")) ?? GROUPS[0];
  const page = Math.max(1, Math.min(1000, Number(typeof sp.page === "string" ? sp.page : 1) || 1));

  const { rows, total } = await withOrgTx(organization.id, async ({ db }) => {
    const where = {
      organizationId: organization.id,
      ...(group.key ? { action: { startsWith: group.key } } : {}),
    };
    const total = await db.orgAuditLog.count({ where });
    const entries = await db.orgAuditLog.findMany({
      where: {
        organizationId: organization.id,
        ...(group.key ? { action: { startsWith: group.key } } : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        diffJson: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    });
    // Name the member targets the viewer can see (members and former members).
    const userIds = entries
      .filter((e) => e.targetType === "User" && e.targetId)
      .map((e) => e.targetId!);
    const users = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    const rows = entries.map((e) => ({
      ...e,
      targetName: e.targetType === "User" && e.targetId ? (names.get(e.targetId) ?? null) : null,
    }));
    return { rows, total };
  });
  const hasNext = rows.length > PAGE_SIZE;
  const shown = rows.slice(0, PAGE_SIZE);
  const href = (g: string, p: number) =>
    `/app/${orgSlug}/settings/audit?${new URLSearchParams({ ...(g ? { group: g } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  const first = (page - 1) * PAGE_SIZE + 1;
  const summary =
    total === 0
      ? "No entries yet. Entries can't be edited or deleted."
      : `${total} ${group.key ? `${group.label.toLowerCase()} ` : ""}entr${total === 1 ? "y" : "ies"}, newest first${
          total > PAGE_SIZE ? ` · showing ${first}–${first + shown.length - 1}` : ""
        }. Entries can't be edited or deleted.`;

  return (
    <div className="space-y-7.5">
      <PageHeader title="Audit log" description={summary} />
      <div className="space-y-4.5">
        <nav aria-label="Filter" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex min-w-max gap-2">
            {GROUPS.map((g) => (
              <li key={g.key || "all"}>
                <ChipLink href={href(g.key, 1)} active={g.key === group.key}>
                  {g.label}
                </ChipLink>
              </li>
            ))}
          </ul>
        </nav>
        {shown.length === 0 ? (
          <Card>
            <EmptyState
              icon={ScrollText}
              title={
                group.key ? `No ${group.label.toLowerCase()} changes yet.` : "Nothing recorded yet."
              }
              description="Settings, membership, integration and export changes show here as they happen."
            />
          </Card>
        ) : (
          <TableFrame maxHeight="none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead className="hidden md:table-cell">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {fmt.format(e.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="font-semibold">{e.actor?.name ?? "System"}</span>{" "}
                      {ACTION_COPY[e.action] ?? (
                        <span className="text-muted-foreground">· {actionWords(e.action)}</span>
                      )}
                      {e.targetName ? (
                        <span className="font-semibold"> ({e.targetName})</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-[13px] whitespace-normal md:table-cell">
                      {summarize(e.diffJson)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        )}
        {(page > 1 || hasNext) && (
          <div className="flex justify-between gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={href(group.key, page - 1)}>
                  <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                  Newer
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {hasNext && (
              <Button asChild variant="outline" size="sm">
                <Link href={href(group.key, page + 1)}>
                  Older
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
