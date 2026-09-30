import Link from "next/link";

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
] as const;

const ACTION_COPY: Record<string, string> = {
  "org.created": "created the organization",
  "org.renamed": "renamed the organization",
  "org.slug_changed": "changed the URL",
  "org.timezone_changed": "changed the timezone",
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
  "label.created": "created a label",
  "label.deleted": "deleted a label",
};

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
  const sp = await searchParams;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "audit.view")) {
    return <SettingsNoAccess title="Audit log" who="owners and admins" />;
  }
  const group =
    GROUPS.find((g) => g.key === (typeof sp.group === "string" ? sp.group : "")) ?? GROUPS[0];
  const page = Math.max(1, Math.min(1000, Number(typeof sp.page === "string" ? sp.page : 1) || 1));

  const rows = await withOrgTx(organization.id, async ({ db }) => {
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
    return entries.map((e) => ({
      ...e,
      targetName: e.targetType === "User" && e.targetId ? (names.get(e.targetId) ?? null) : null,
    }));
  });
  const hasNext = rows.length > PAGE_SIZE;
  const shown = rows.slice(0, PAGE_SIZE);
  const href = (g: string, p: number) =>
    `/app/${orgSlug}/settings/audit?${new URLSearchParams({ ...(g ? { group: g } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          Who changed what, and when. Entries can&apos;t be edited or deleted.
        </p>
      </div>
      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <Link
            key={g.key || "all"}
            href={href(g.key, 1)}
            aria-current={g.key === group.key ? "page" : undefined}
            className={`rounded-md border px-3 py-1 text-sm ${g.key === group.key ? "bg-muted font-medium" : ""}`}
          >
            {g.label}
          </Link>
        ))}
      </nav>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">When</TableHead>
              <TableHead>What</TableHead>
              <TableHead className="hidden md:table-cell">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground text-sm">
                  Nothing recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              shown.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {fmt.format(e.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="font-medium">{e.actor?.name ?? "System"}</span>{" "}
                    {ACTION_COPY[e.action] ?? e.action}
                    {e.targetName ? <span className="font-medium"> ({e.targetName})</span> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs md:table-cell">
                    {summarize(e.diffJson)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between text-sm">
        {page > 1 ? (
          <Link href={href(group.key, page - 1)} className="underline underline-offset-4">
            Newer
          </Link>
        ) : (
          <span />
        )}
        {hasNext && (
          <Link href={href(group.key, page + 1)} className="underline underline-offset-4">
            Older
          </Link>
        )}
      </div>
    </div>
  );
}
