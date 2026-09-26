import { Skeleton } from "@/components/ui/skeleton";

/** The chart shell while the published chart loads. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the org chart">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="-mx-4 flex h-[calc(100dvh-11.5rem)] min-h-[420px] flex-col items-center gap-10 border-t pt-10 md:-mx-6">
        <Skeleton className="h-24 w-60 rounded-xl" />
        <div className="flex gap-6">
          <Skeleton className="h-24 w-60 rounded-xl" />
          <Skeleton className="hidden h-24 w-60 rounded-xl sm:block" />
          <Skeleton className="hidden h-24 w-60 rounded-xl lg:block" />
        </div>
      </div>
    </div>
  );
}
