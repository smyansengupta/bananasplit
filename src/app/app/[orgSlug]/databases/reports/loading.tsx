import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

import { DatabasesTabs } from "../databases-tabs";

/** The Reports shell while the page resolves the org and the viewer's reports. */
export default function Loading() {
  return (
    <div className="space-y-7.5" aria-busy="true">
      <PageHeader
        title="Reports"
        description={
          <span className="bg-muted inline-block h-4 w-56 max-w-full animate-pulse rounded-full align-middle" />
        }
        actions={<Skeleton className="h-10 w-36 rounded-full" />}
        tabs={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DatabasesTabs showReports />
            <Skeleton className="h-10 w-72 rounded-full" />
          </div>
        }
      />
      <div className="grid gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="rounded-card h-48" />
        ))}
      </div>
    </div>
  );
}
