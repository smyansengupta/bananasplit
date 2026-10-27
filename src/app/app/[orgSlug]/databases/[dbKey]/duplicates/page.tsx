import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/databases/action-button";
import { BackLink } from "@/components/back-link";
import { MergeSessionPicker } from "@/components/databases/merge-session-picker";
import { notice } from "@/components/databases/styles";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dismissReviewAction } from "@/app/app/[orgSlug]/databases/actions";
import { NotFoundError } from "@/lib/auth/errors";
import { fmtDateTime } from "@/server/databases/format";
import { getDatabase } from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { findDuplicatePairs } from "@/server/events/match";
import { planGate } from "@/server/billing/plan-gate";

/**
 * Sessions > Possible duplicates (OWNER/ADMIN): sessions an importer could
 * not place (needsReview: several candidates matched), and pairs of live
 * sessions on the same local day, within 90 minutes, with matching titles.
 * Merging keeps the chosen session and moves everything from the other.
 */
export default async function DuplicatesPage({
  params,
}: PageProps<"/app/[orgSlug]/databases/[dbKey]/duplicates">) {
  const { orgSlug, dbKey } = await params;
  const planLock = await planGate(orgSlug, "databases");
  if (planLock) return planLock;
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
          tag: { select: { name: true } },
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

  const Row = ({ e, keep }: { e: (typeof data.events)[number]; keep?: boolean }) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <Link
        className="decoration-foreground/25 hover:decoration-foreground font-semibold underline underline-offset-4"
        href={`/app/${orgSlug}/databases/${dbKey}?row=${e.id}`}
      >
        {e.title}
      </Link>
      {keep && <Badge variant="success">Suggested to keep</Badge>}
      <span className="text-muted-foreground tabular-nums">{fmtDateTime(e.startsAt, tz)}</span>
      {e.tag && <Badge variant="secondary">{e.tag.name}</Badge>}
      {e.sourceSessionId && <Badge variant="info">Website</Badge>}
      {e.googleEventId && <Badge variant="info">Google</Badge>}
      <span className="text-muted-foreground tabular-nums">
        {e.attendanceCount} {e.attendanceCount === 1 ? "check-in" : "check-ins"}
      </span>
    </div>
  );

  const total = flagged.length + pairs.length;
  const summary =
    total === 0
      ? "Nothing to review"
      : [
          flagged.length > 0 && `${flagged.length} flagged by the website sync`,
          pairs.length > 0 && `${pairs.length} likely ${pairs.length === 1 ? "pair" : "pairs"}`,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="max-w-3xl space-y-7.5">
      <div className="space-y-3">
        <BackLink href={`/app/${orgSlug}/databases/${dbKey}`} label={data.database.name} />
        <PageHeader title="Possible duplicates" description={summary} />
      </div>

      <p className={notice.neutral}>
        A session that exists twice (for example once from the website and once on the calendar)
        splits its check-ins. Merge keeps one and moves check-ins, RSVPs, notes, expenses and the
        website link to it. It can&apos;t be undone; the audit log records what moved.
      </p>

      <Card aria-labelledby="dup-flagged" role="region">
        <CardHeader className="flex flex-wrap items-center gap-2">
          <CardTitle>
            <h2 id="dup-flagged">Flagged by the website sync</h2>
          </CardTitle>
          <Badge variant="secondary">{flagged.length}</Badge>
        </CardHeader>
        <CardContent>
          {flagged.length === 0 ? (
            <EmptyState
              size="compact"
              title="Nothing flagged"
              description="The sync flags a session when more than one could be the same meeting."
              className="py-0"
            />
          ) : (
            <ul className="divide-border/70 divide-y">
              {flagged.map((e) => {
                const nearby = data.events.filter(
                  (o) =>
                    o.id !== e.id &&
                    Math.abs(o.startsAt.getTime() - e.startsAt.getTime()) <= 3 * 86400000,
                );
                return (
                  <li key={e.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
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
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card aria-labelledby="dup-pairs" role="region">
        <CardHeader className="flex flex-wrap items-center gap-2">
          <CardTitle>
            <h2 id="dup-pairs">Same day, same time, same title</h2>
          </CardTitle>
          <Badge variant="secondary">{pairs.length}</Badge>
        </CardHeader>
        <CardContent>
          {pairs.length === 0 ? (
            <EmptyState
              size="compact"
              title="No likely duplicates"
              description="Sessions on the same day, within 90 minutes, with matching titles show up here."
              className="py-0"
            />
          ) : (
            <ul className="divide-border/70 divide-y">
              {pairs.map(({ a, b, score }) => {
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
                  <li key={`${a}-${b}`} className="space-y-3 py-4 first:pt-0 last:pb-0">
                    <p className="text-muted-foreground text-[13px] tabular-nums">
                      Title similarity {Math.round(score * 100)}%
                    </p>
                    <Row e={keep} keep />
                    <Row e={drop} />
                    <MergeSessionPicker
                      organizationId={organization.id}
                      loserId={drop.id}
                      loserTitle={drop.title}
                      candidates={[{ id: keep.id, label: describe(keep) }]}
                      openSurvivor={false}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
