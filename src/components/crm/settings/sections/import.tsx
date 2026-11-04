import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { crmPeopleHref } from "@/lib/crm/href";
import { importsToFix, recentImports } from "@/server/crm/import";
import { withOrgTx } from "@/server/db/context";

import { ExportCard, ImportCard, RowsToFix } from "../import-settings";
import type { SectionProps } from "./types";

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Import and export: a spreadsheet of people in, the rows your imports
 * couldn't bring in (each with its fix), everything out as one zip, and the
 * duplicates waiting to merge.
 */
export async function ImportSection({ shell, orgSlug }: SectionProps) {
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db, userId }) => ({
    recent: await recentImports(db, orgId, userId),
    fix: await importsToFix(db, orgId, userId),
    duplicates: await db.crmSuggestion.count({
      where: { organizationId: orgId, kind: "MERGE", status: "PENDING" },
    }),
  }));
  const recent = data.recent
    .filter((r) => r.status !== "mapping")
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      fileName: r.fileName,
      line:
        r.status === "done"
          ? `${day(r.createdAt)}. ${r.created} added, ${r.updated} were already here${r.skipped ? `, ${r.skipped} left out` : ""}.`
          : r.status === "failed"
            ? `${day(r.createdAt)}. It stopped. Try the file again.`
            : `${day(r.createdAt)}. ${r.done} of ${r.total} so far.`,
    }));
  return (
    <>
      {data.fix.map((f) => (
        <RowsToFix
          key={f.id}
          orgId={orgId}
          item={{ id: f.id, fileName: f.fileName, done: f.created + f.updated, rows: f.rows }}
        />
      ))}
      <ImportCard orgId={orgId} orgSlug={orgSlug} recent={recent} admin={shell.access.admin} />
      <ExportCard orgSlug={orgSlug} />
      <SettingsCard
        title="Duplicates"
        description="Found by matching email, phone and name. Merging keeps both timelines."
      >
        {data.duplicates === 0 ? (
          <p className="text-muted-foreground text-sm">
            None waiting. New ones show up in Today too.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <b className="min-w-0 flex-[1_1_15rem] text-[15px] font-semibold">
              {data.duplicates} possible {data.duplicates === 1 ? "duplicate" : "duplicates"} to
              merge
            </b>
            <AmbientActions
              why
              actions={[
                {
                  key: "review",
                  label: "Review them",
                  tone: "solid",
                  reason: "Same email, phone or name",
                  href: crmPeopleHref(orgSlug, { list: "dupes" }),
                },
              ]}
            />
          </div>
        )}
      </SettingsCard>
    </>
  );
}
