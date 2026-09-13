import { Skeleton } from "@/components/ui/skeleton";

/** Generic loading placeholder for a list/table-shaped page. Used by route loading.tsx files. */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
