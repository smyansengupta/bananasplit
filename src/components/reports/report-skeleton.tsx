import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Card-shaped placeholder with roughly the finished card's height. */
export function ReportSkeleton({
  title,
  bodyHeight = 240,
  stats = 0,
  className,
}: {
  title: string;
  bodyHeight?: number;
  stats?: number;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0 flex-1", className)} aria-busy="true" aria-label={`${title} loading`}>
      <CardHeader>
        <div className="font-heading text-base font-medium">{title}</div>
        <Skeleton className="h-4 w-2/3" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {stats > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: stats }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : null}
        <Skeleton className="w-full" style={{ height: bodyHeight }} />
      </CardContent>
    </Card>
  );
}
