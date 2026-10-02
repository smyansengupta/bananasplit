import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DefinitionEditForm, DefinitionImportForm } from "@/components/databases/definition-forms";
import { Badge } from "@/components/ui/badge";
import { NotFoundError } from "@/lib/auth/errors";
import { exclusionLabel, readDefinition } from "@/server/databases/ballot-definitions";
import { fmtDate } from "@/server/databases/format";
import { getDatabase } from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

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
  const local = (d: Date | null) => (d ? format(new TZDate(d.getTime(), tz), "yyyy-MM-dd'T'HH:mm") : "");
  const sessions = data.sessions.map((s) => ({ id: s.id, label: `${s.title} · ${fmtDate(s.startsAt, tz)}` }));
  const bySlug = new Map<string, { reason: string | null; n: number }[]>();
  for (const r of data.reasons) {
    const list = bySlug.get(r.pollSlug) ?? [];
    list.push({ reason: r.excludedReason, n: r._count._all });
    bySlug.set(r.pollSlug, list);
  }
  const unknown = [...bySlug.keys()].filter((slug) => !data.definitions.some((d) => d.slug === slug));

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
        <h1 className="page-title">Poll definitions</h1>
        <p className="text-muted-foreground text-sm">
          Labels, question types and voting windows for each poll. Ballots cast outside the window, test polls,
          load and smoke tests, and ballots naming options a poll no longer has are kept but not counted.
        </p>
      </div>

      <DefinitionImportForm organizationId={organization.id} sessions={sessions} />

      {unknown.length > 0 && (
        <p className="border-warning/40 bg-warning/10 rounded-md border p-3 text-sm">
          Ballots are waiting for a definition: {unknown.join(", ")}. Import the poll file to count them.
        </p>
      )}

      <ul className="space-y-4">
        {data.definitions.map((d) => {
          const def = readDefinition(d.definition);
          const counts = bySlug.get(d.slug) ?? [];
          const counted = counts.filter((c) => !c.reason).reduce((s, c) => s + c.n, 0);
          return (
            <li key={d.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">{d.title}</h2>
                <code className="text-muted-foreground text-xs">{d.slug}</code>
                {d.isTest && <Badge variant="outline">Test</Badge>}
              </div>
              <p className="text-muted-foreground text-xs">
                {def.questions.length} questions · {counted} counted
                {counts
                  .filter((c) => c.reason)
                  .map((c) => ` · ${c.n} ${exclusionLabel(c.reason).toLowerCase()}`)
                  .join("")}
              </p>
              <DefinitionEditForm
                organizationId={organization.id}
                sessions={sessions}
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
