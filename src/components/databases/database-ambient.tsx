"use client";

import { useRouter } from "next/navigation";

import { mergeLikelyDuplicatesAction } from "@/app/app/[orgSlug]/databases/actions";
import { createSuggestedReport } from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { AmbientActions, type AmbientAction } from "@/components/ambient/ambient-button";
import { ChartNoAxesColumn, Merge, RefreshCw } from "@/components/icons";

/**
 * A database's ambient buttons (Buttons3: Databases and reports), in its
 * header: Merge the likely duplicates, Make a report, Reconnect the website
 * sync. The page decides which apply (src/lib/ambient/databases.ts) and
 * hands over the words; this does the job in place.
 */
export function DatabaseAmbient({
  orgId,
  orgSlug,
  merge,
  report,
  reconnect,
  why = true,
}: {
  orgId: string;
  orgSlug: string;
  merge?: { count: number; reason: string } | null;
  /** The report source to make one on ("custom:<id>", "events", ...). */
  report?: { source: string; name: string; reason: string } | null;
  reconnect?: { href: string; reason: string } | null;
  why?: boolean;
}) {
  const router = useRouter();
  const actions: (AmbientAction | null)[] = [
    reconnect
      ? {
          key: "reconnect",
          label: "Reconnect",
          icon: RefreshCw,
          reason: reconnect.reason,
          tone: "spark",
          href: reconnect.href,
        }
      : null,
    merge
      ? {
          key: "merge",
          label: `Merge ${merge.count}`,
          icon: Merge,
          reason: merge.reason,
          tone: "solid",
          run: () => mergeLikelyDuplicatesAction(orgId),
          done: "Merged",
        }
      : null,
    report
      ? {
          key: "report",
          label: "Make a report",
          icon: ChartNoAxesColumn,
          reason: report.reason,
          ariaLabel: `Make a report on ${report.name}`,
          run: async () => {
            const made = await createSuggestedReport(orgId, report.source);
            if (made.ok) router.push(`/app/${orgSlug}/databases/reports/${made.id}`);
            return made;
          },
        }
      : null,
  ];
  return <AmbientActions why={why} actions={actions} />;
}
