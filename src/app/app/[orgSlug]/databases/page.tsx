import {
  CalendarDays,
  ClipboardCheck,
  Database,
  Lock,
  UserPlus,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { SyncPanel } from "@/components/databases/sync-panel";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { fmtDateTime } from "@/server/databases/format";
import { listDatabases } from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadSyncStatus } from "@/server/sync/status";

const ICONS: Record<string, LucideIcon> = {
  CalendarDays,
  ClipboardCheck,
  UserPlus,
  Vote,
  Users,
};

const DESCRIPTIONS: Record<string, string> = {
  SESSIONS: "Workshops, socials, hackathons and info sessions. The same events as the calendar.",
  ATTENDANCE: "Every check-in, with the stamp it earned and the person's term total.",
  SIGNUPS: "The interest form: who signed up, from where, and whether they came.",
  BALLOTS: "Poll results, and individual votes where your role may see them.",
  PEOPLE: "One row per person per term: sessions, stamps, and who stopped coming.",
};

const VISIBILITY_COPY: Record<string, string> = {
  MEMBERS: "All members",
  ADMINS: "Owners and admins",
  OWNER: "Owners only",
  HIDDEN: "Hidden from members",
};

/** The Databases index: the databases this viewer may open (Settings > Privacy decides). */
export default async function DatabasesPage({ params }: PageProps<"/app/[orgSlug]/databases">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  const isAdmin = can({ role }, "databases.write");

  const { databases, counts, sync } = await withOrgTx(organization.id, async ({ db }) => {
    const list = await listDatabases(db, organization.id, role);
    const counts: Record<string, number> = {};
    for (const d of list) {
      if (d.kind === "SESSIONS") {
        counts[d.key] = await db.event.count({ where: { organizationId: organization.id, deletedAt: null, mergedIntoId: null } });
      } else if (d.kind === "ATTENDANCE") {
        counts[d.key] = await db.attendance.count({ where: { organizationId: organization.id, suppressedAt: null } });
      } else if (d.kind === "SIGNUPS") {
        counts[d.key] = await db.signup.count({ where: { organizationId: organization.id, suppressedAt: null } });
      } else if (d.kind === "PEOPLE") {
        counts[d.key] = await db.contact.count({ where: { organizationId: organization.id, sessionsAttended: { gt: 0 } } });
      } else if (d.kind === "BALLOTS") {
        counts[d.key] = await db.ballotDefinition.count({ where: { organizationId: organization.id, isTest: false } });
      }
    }
    const sync = isAdmin ? await loadSyncStatus(db, organization.id) : null;
    return { databases: list, counts, sync };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Databases</h1>
        <p className="text-muted-foreground text-sm">
          {organization.name}&apos;s data, from the calendar, the website and what admins enter here.
        </p>
      </div>

      {databases.length === 0 ? (
        <EmptyState icon={Database} title="No databases are visible to you" description="Ask an owner about Settings > Privacy." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {databases.map((d) => {
            const Icon = (d.icon && ICONS[d.icon]) || Database;
            const unit = d.kind === "BALLOTS" ? "polls" : d.kind === "PEOPLE" ? "people" : "rows";
            return (
              <li key={d.id}>
                <Link
                  href={`/app/${orgSlug}/databases/${d.key}`}
                  className="hover:bg-muted/50 focus-visible:ring-ring flex h-full flex-col gap-2 rounded-lg border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      <Icon className="text-muted-foreground size-4" aria-hidden="true" />
                      {d.name}
                    </span>
                    {d.memberVisibility !== "MEMBERS" && (
                      <Badge variant="outline" className="gap-1">
                        <Lock className="size-3" aria-hidden="true" />
                        {VISIBILITY_COPY[d.memberVisibility]}
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground text-sm">{DESCRIPTIONS[d.kind] ?? ""}</span>
                  <span className="text-sm tabular-nums">
                    {(counts[d.key] ?? 0).toLocaleString()} {unit}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {isAdmin &&
        (sync ? (
          <SyncPanel
            organizationId={organization.id}
            status={sync.status}
            lastError={sync.lastError}
            endpoint={sync.endpoint}
            configError={sync.configError}
            settingsHref={`/app/${orgSlug}/settings/integrations`}
            streams={sync.streams.map((s) => ({
              stream: s.stream,
              label: s.label,
              lastSynced: s.lastSyncedAt ? fmtDateTime(s.lastSyncedAt, organization.timezone) : null,
              rowsUpserted: s.rowsUpserted,
              lastError: s.lastError,
              detail: s.detail,
            }))}
          />
        ) : (
          <p className="text-muted-foreground rounded-lg border p-4 text-sm">
            To pull check-ins, signups and ballots from the club website, connect its database in{" "}
            <Link className="underline underline-offset-2" href={`/app/${orgSlug}/settings/integrations`}>
              Settings &gt; Integrations
            </Link>
            . Without it, add rows here or import a CSV.
          </p>
        ))}
    </div>
  );
}
