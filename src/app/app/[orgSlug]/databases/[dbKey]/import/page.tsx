import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CsvImportForm } from "@/components/databases/csv-import-form";
import { NotFoundError } from "@/lib/auth/errors";
import { getDatabase } from "@/server/databases/views";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

const HELP: Record<string, { columns: string; example: string }> = {
  ATTENDANCE: {
    columns:
      "session (the session's id, or its exact title), email and/or name, and optionally checked_in_at (your org's local time, e.g. 2026-09-16 18:05) and method (qr, form or manual).",
    example: "session,email,name,checked_in_at,method\nWeek 3 meeting,ada@example.edu,Ada Park,2026-09-10 18:02,manual",
  },
  SIGNUPS: {
    columns:
      "name, and optionally email, class_year, signed_up_at (local time; the term follows from it unless a term column says fall-YYYY or spring-YYYY), colleges, meet_days and interests (separated by ; ).",
    example: "name,email,class_year,signed_up_at,colleges,interests\nAda Park,ada@example.edu,second,2026-09-05,engineering;business,events;volunteering",
  },
};

/** CSV import for Attendance and Signups (OWNER/ADMIN), for orgs without the website sync. */
export default async function ImportPage({ params }: PageProps<"/app/[orgSlug]/databases/[dbKey]/import">) {
  const { orgSlug, dbKey } = await params;
  const { organization } = await getOrgContextBySlug(orgSlug);
  let database;
  try {
    database = await withOrgTx(organization.id, async ({ db, role }) => {
      const d = await getDatabase(db, organization.id, role, dbKey);
      if ((d.kind !== "ATTENDANCE" && d.kind !== "SIGNUPS") || !d.canEdit) throw new NotFoundError();
      return d;
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const help = HELP[database.kind];
  const back = `/app/${orgSlug}/databases/${dbKey}`;
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={back} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
          <ChevronLeft className="size-3" aria-hidden="true" />
          {database.name}
        </Link>
        <h1 className="page-title">Import {database.name.toLowerCase()} from CSV</h1>
        <p className="text-muted-foreground text-sm">
          Up to 5,000 rows and 4 MB. Columns: {help.columns} People are matched by email; someone already
          checked in to a session, or already signed up that term, is skipped. Imported rows can be edited and
          deleted later.
        </p>
      </div>
      <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">{help.example}</pre>
      <CsvImportForm uploadUrl={`${back}/import/upload`} backHref={back} />
    </div>
  );
}
