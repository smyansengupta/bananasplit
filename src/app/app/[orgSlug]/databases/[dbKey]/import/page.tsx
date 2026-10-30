import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { CsvImportForm } from "@/components/databases/csv-import-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotFoundError } from "@/lib/auth/errors";
import { getDatabase } from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

const HELP: Record<string, { columns: string; example: string }> = {
  ATTENDANCE: {
    columns:
      "session (the session's id, or its exact title), email and/or name, and optionally checked_in_at (your org's local time, e.g. 2026-09-16 18:05) and method (qr, form or manual).",
    example:
      "session,email,name,checked_in_at,method\nWeek 3 meeting,ada@example.edu,Ada Park,2026-09-10 18:02,manual",
  },
  SIGNUPS: {
    columns:
      "name, and optionally email, class_year, signed_up_at (local time; the term follows from it unless a term column says fall-YYYY or spring-YYYY), colleges, meet_days and interests (separated by ; ).",
    example:
      "name,email,class_year,signed_up_at,colleges,interests\nAda Park,ada@example.edu,second,2026-09-05,engineering;business,events;volunteering",
  },
};

/** CSV import for Attendance and Signups (OWNER/ADMIN), for orgs without the website sync. */
export default async function ImportPage({
  params,
}: PageProps<"/app/[orgSlug]/databases/[dbKey]/import">) {
  const { orgSlug, dbKey } = await params;
  const planLock = await planGate(orgSlug, "databases");
  if (planLock) return planLock;
  const { organization } = await getOrgContextBySlug(orgSlug);
  let database;
  try {
    database = await withOrgTx(organization.id, async ({ db, role }) => {
      const d = await getDatabase(db, organization.id, role, dbKey);
      if ((d.kind !== "ATTENDANCE" && d.kind !== "SIGNUPS") || !d.canEdit)
        throw new NotFoundError();
      return d;
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const help = HELP[database.kind];
  // Attendance: the recent sessions, so a sheet from one meeting needs no session column.
  const sessions =
    database.kind === "ATTENDANCE"
      ? await withOrgTx(organization.id, ({ db }) =>
          db.event.findMany({
            where: {
              organizationId: organization.id,
              deletedAt: null,
              mergedIntoId: null,
              startsAt: { lte: new Date() },
            },
            orderBy: { startsAt: "desc" },
            take: 40,
            select: { id: true, title: true, startsAt: true },
          }),
        )
      : [];
  const back = `/app/${orgSlug}/databases/${dbKey}`;
  return (
    <div className="max-w-3xl space-y-7.5">
      <div className="space-y-3">
        <BackLink href={back} label={database.name} />
        <PageHeader
          title={`Import ${database.name.toLowerCase()}`}
          description="Up to 5,000 rows, 4 MB."
        />
      </div>
      <CsvImportForm
        uploadUrl={`${back}/import/upload`}
        backHref={back}
        backLabel={database.name}
        sessions={sessions.map((x) => ({
          id: x.id,
          label: `${x.title}, ${x.startsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: organization.timezone })}`,
        }))}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>What the file needs</h2>
          </CardTitle>
          <CardDescription>People are matched by email; duplicates are skipped.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">Columns: {help.columns}</p>
          <pre className="bg-muted/60 rounded-tile overflow-x-auto p-4 font-mono text-xs leading-relaxed">
            {help.example}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
