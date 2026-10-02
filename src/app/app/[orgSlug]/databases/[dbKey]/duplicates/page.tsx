import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/databases/action-button";
import { MergeSessionPicker } from "@/components/databases/merge-session-picker";
import { Badge } from "@/components/ui/badge";
import { dismissReviewAction } from "@/app/app/[orgSlug]/databases/actions";
import { NotFoundError } from "@/lib/auth/errors";
import { EVENT_KIND_LABELS, fmtDateTime } from "@/server/databases/format";
import { getDatabase } from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { findDuplicatePairs } from "@/server/events/match";

/**
 * Sessions > Possible duplicates (OWNER/ADMIN): sessions an importer could
 * not place (needsReview: several candidates matched), and pairs of live
 * sessions on the same local day, within 90 minutes, with matching titles.
 * Merging keeps the chosen session and moves everything from the other.
 */
export default async function DuplicatesPage({ params }: PageProps<"/app/[orgSlug]/databases/[dbKey]/duplicates">) {
  const { orgSlug, dbKey } = await params;
  const { organization } = await getOrgContextBySlug(orgSlug);
  const tz = organization.timezone;

  let data;
  try {
    data = await withOrgTx(organization.id, async ({ db, role }) => {
      const database = await getDatabase(db, organization.id, role, dbKey);
      if (database.kind !== "SESSIONS" || !database.canEdit) throw new NotFoundError();
      const events = await db.event.findMany({
        where: { organizationId: organization.id, deletedAt: null, mergedIntoId: null },
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          title: true,
          startsAt: true,
          kind: true,
          needsReview: true,
          sourceSessionId: true,
          googleEventId: true,
          attendanceCount: true,
          visibility: true,
        },
        take: 5000,
      });
      return { database, events };
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const byId = new Map(data.events.map((e) => [e.id, e]));
  const pairs = findDuplicatePairs(data.events, tz);
  const flagged = data.events.filter((e) => e.needsReview);
  const describe = (e: (typeof data.events)[number]) =>
    `${e.title} · ${fmtDateTime(e.startsAt, tz)} · ${e.attendanceCount} check-ins${e.sourceSessionId ? " · website" : ""}${e.googleEventId ? " · Google" : ""}`;

  const Row = ({ e }: { e: (typeof data.events)[number] }) => (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/${orgSlug}/databases/${dbKey}?row=${e.id}`}>
        {e.title}
      </Link>
      <span className="text-muted-foreground">{fmtDateTime(e.startsAt, tz)}</span>
      <Badge variant="outline">{EVENT_KIND_LABELS[e.kind] ?? e.kind}</Badge>
      {e.sourceSessionId && <Badge variant="secondary">Website</Badge>}
      {e.googleEventId && <Badge variant="secondary">Google</Badge>}
      <span className="text-muted-foreground">{e.attendanceCount} check-ins</span>
    </div>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href={`/app/${orgSlug}/databases/${dbKey}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          <ChevronLeft className="size-3" aria-hidden="true" />
          {data.database.name}
        </Link>
        <h1 className="page-title">Possible duplicates</h1>
        <p className="text-muted-foreground text-sm">
          A session that exists twice (for example once from the website and once on the calendar) splits its
          check-ins. Merge keeps one and moves check-ins, RSVPs, notes, expenses and the website link to it. It
          cannot be undone; the audit log records what moved.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Flagged by the website sync ({flagged.length})</h2>
        {flagged.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing flagged.</p>
        ) : (
          flagged.map((e) => {
            const nearby = data.events.filter(
              (o) => o.id !== e.id && Math.abs(o.startsAt.getTime() - e.startsAt.getTime()) <= 3 * 86400000,
            );
            return (
              <div key={e.id} className="space-y-2 rounded-lg border p-4">
                <Row e={e} />
                <div className="flex flex-wrap items-start gap-2">
                  <ActionButton action={dismissReviewAction} args={[organization.id, e.id]}>
                    Not a duplicate
                  </ActionButton>
                </div>
                <MergeSessionPicker
                  organizationId={organization.id}
                  loserId={e.id}
                  loserTitle={e.title}
                  candidates={nearby.map((o) => ({ id: o.id, label: describe(o) }))}
                  openSurvivor={false}
                />
              </div>
            );
          })
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Same day, same time, same title ({pairs.length})</h2>
        {pairs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No likely duplicates.</p>
        ) : (
          pairs.map(({ a, b, score }) => {
            const ea = byId.get(a);
            const eb = byId.get(b);
            if (!ea || !eb) return null;
            // Suggest keeping the one with more check-ins (then the website-linked one).
            const keepA =
              ea.attendanceCount > eb.attendanceCount ||
              (ea.attendanceCount === eb.attendanceCount && Boolean(ea.sourceSessionId));
            const keep = keepA ? ea : eb;
            const drop = keepA ? eb : ea;
            return (
              <div key={`${a}-${b}`} className="space-y-2 rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">Title similarity {Math.round(score * 100)}%</p>
                <Row e={keep} />
                <Row e={drop} />
                <MergeSessionPicker
                  organizationId={organization.id}
                  loserId={drop.id}
                  loserTitle={drop.title}
                  candidates={[{ id: keep.id, label: describe(keep) }]}
                  openSurvivor={false}
                />
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
