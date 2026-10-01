import { ReportSkeleton } from "@/components/reports/report-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** The Reports shell while the page resolves the org and the viewer's reports. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ReportSkeleton title="Last session" bodyHeight={160} />
        <ReportSkeleton title="Attendance over time" stats={4} className="lg:col-span-2" />
        <ReportSkeleton title="Retention" stats={5} bodyHeight={266} className="lg:col-span-2" />
        <ReportSkeleton title="Session breakdown" bodyHeight={200} />
      </div>
    </div>
  );
}
