import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { notFound } from "next/navigation";

import { CircleAlert, FileJson } from "@/components/icons";

import { BackLink } from "@/components/back-link";
import { DefinitionEditForm, DefinitionImportForm } from "@/components/databases/definition-forms";
import { notice } from "@/components/databases/styles";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NotFoundError } from "@/lib/auth/errors";
import { exclusionLabel, readDefinition } from "@/server/databases/ballot-definitions";
import { fmtDate } from "@/server/databases/format";
import { getDatabase } from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

/**
 * Ballots > Poll definitions (OWNER/ADMIN): import the website's poll files
 * (labels, question types, the voting window) and flag test polls. Counts
 * per exclusion reason show why ballots are or are not counted; they are
 * read as the viewer through RLS, so an admin who may not see individual
 * ballots sees no counts here (the Results tab shows the totals).
 */
export default async function BallotDefinitionsPage({
  params,
}: PageProps<"/app/[orgSlug]/databases/[dbKey]/definitions">) {
  const { orgSlug, dbKey } = await params;
  const planLock = await planGate(orgSlug, "databases");
  if (planLock) return planLock;
  const { organization } = await getOrgContextBySlug(orgSlug);

  let data;
  try {
    data = await withOrgTx(organization.id, async ({ db, role }) => {
      const database = await getDatabase(db, organization.id, role, dbKey);
      if (database.kind !== "BALLOTS" || !database.canEdit) throw new NotFoundError();
      const definitions = await db.ballotDefinition.findMany({
        where: { organizationId: organization.id },
        orderBy: [{ opensAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      });
      // Per-reason counts through the same RLS as everything else: an admin
      // who may not see individual ballots gets none (and sees totals only
      // through the Results tab).
      const reasons = await db.ballot.groupBy({
        by: ["pollSlug", "excludedReason"],
        where: { organizationId: organization.id },
        _count: { _all: true },
      });
      const sessions = await db.event.findMany({
        where: { organizationId: organization.id, deletedAt: null, mergedIntoId: null },
        orderBy: { startsAt: "desc" },
        take: 80,
        select: { id: true, title: true, startsAt: true },
      });
      return { database, definitions, reasons, sessions };
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const tz = organization.timezone;
  const local = (d: Date | null) =>
    d ? format(new TZDate(d.getTime(), tz), "yyyy-MM-dd'T'HH:mm") : "";
  const sessions = data.sessions.map((s) => ({
    id: s.id,
    label: `${s.title} · ${fmtDate(s.startsAt, tz)}`,
  }));
  const bySlug = new Map<string, { reason: string | null; n: number }[]>();
  for (const r of data.reasons) {
    const list = bySlug.get(r.pollSlug) ?? [];
    list.push({ reason: r.excludedReason, n: r._count._all });
    bySlug.set(r.pollSlug, list);
  }
  const unknown = [...bySlug.keys()].filter(
    (slug) => !data.definitions.some((d) => d.slug === slug),
  );

  const countedTotal = data.reasons
    .filter((r) => !r.excludedReason)
    .reduce((s, r) => s + r._count._all, 0);
  const n = data.definitions.length;
  const summary = [
    n === 0 ? "No polls yet" : `${n.toLocaleString()} ${n === 1 ? "poll" : "polls"}`,
    countedTotal > 0 &&
      `${countedTotal.toLocaleString()} counted ${countedTotal === 1 ? "ballot" : "ballots"}`,
    unknown.length > 0 && `${unknown.length} waiting for a definition`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="max-w-3xl space-y-7.5">
      <div className="space-y-3">
        <BackLink href={`/app/${orgSlug}/databases/${dbKey}`} label={data.database.name} />
        <PageHeader title="Poll definitions" description={summary} />
      </div>

      <p className={notice.neutral}>
        What each poll asks, its answer options, and when voting is open. If a poll&apos;s totals
        look off, check here: votes cast outside that window, votes from the website&apos;s own
        tests, and votes for options a poll no longer has are kept but not counted.
      </p>

      {unknown.length > 0 && (
        <p className="bg-muted/60 rounded-tile flex items-start gap-2 p-3 text-sm">
          <CircleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Ballots are waiting for a definition: {unknown.join(", ")}. Import the poll file to
            count them.
          </span>
        </p>
      )}

      <DefinitionImportForm organizationId={organization.id} sessions={sessions} />

      {n === 0 && (
        <Card>
          <EmptyState
            icon={FileJson}
            title="No poll definitions yet"
            description="Import a poll file above to count its ballots and see its results."
          />
        </Card>
      )}

      <ul className="space-y-4.5">
        {data.definitions.map((d) => {
          const def = readDefinition(d.definition);
          const counts = bySlug.get(d.slug) ?? [];
          const counted = counts.filter((c) => !c.reason).reduce((s, c) => s + c.n, 0);
          return (
            <li key={d.id}>
              <DefinitionEditForm
                organizationId={organization.id}
                sessions={sessions}
                title={d.title}
                action={d.isTest ? <Badge variant="secondary">Test</Badge> : undefined}
                description={
                  <span className="tabular-nums">
                    <code className="font-mono text-xs">{d.slug}</code> · {def.questions.length}{" "}
                    questions · {counted} counted
                    {counts
                      .filter((c) => c.reason)
                      .map((c) => ` · ${c.n} ${exclusionLabel(c.reason).toLowerCase()}`)
                      .join("")}
                  </span>
                }
                definition={{
                  id: d.id,
                  title: d.title,
                  opensAt: local(d.opensAt),
                  closesAt: local(d.closesAt),
                  linkedEventId: d.linkedEventId,
                  isTest: d.isTest,
                }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
