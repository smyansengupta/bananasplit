"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { setTaskStatus } from "@/app/app/[orgSlug]/tasks/actions";
import { Checkbox } from "@/components/ui/checkbox";
import { TaskStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * One "Due soon" row: a checkbox that marks the task done in its own space
 * through the tasks action (the same checks as on the task's page, so a
 * task you can't change says why), and the task's link.
 * The action refreshes the page, which drops the row; until then it shows
 * ticked and struck through.
 */
export function DueTaskRow({
  orgId,
  taskId,
  title,
  href,
  space,
  due,
  overdue,
}: {
  orgId: string;
  taskId: string;
  title: string;
  href: string;
  /** Which space it's in ("Personal", a club's name). */
  space: string;
  /** "Overdue · Fri, Oct 9", "Today", "Thu, Oct 15". */
  due: string;
  overdue: boolean;
}) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-start gap-3 py-2">
      <Checkbox
        checked={done}
        disabled={isPending || done}
        aria-label={`Mark "${title}" done`}
        className="mt-0.5"
        onCheckedChange={(checked) => {
          if (checked !== true) return;
          setError(null);
          setDone(true);
          startTransition(async () => {
            const result = await setTaskStatus(orgId, taskId, TaskStatus.COMPLETED);
            if (result.error) {
              setDone(false);
              setError(result.error);
            }
          });
        }}
      />
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className={cn(
            "block truncate text-sm font-medium hover:underline",
            done && "text-muted-foreground line-through",
          )}
        >
          {title}
        </Link>
        <p className="text-muted-foreground truncate text-xs">{space}</p>
        {error && (
          <p role="alert" className="text-destructive mt-0.5 text-xs">
            {error}
          </p>
        )}
      </div>
      <span
        className={cn(
          "shrink-0 text-xs whitespace-nowrap",
          overdue ? "text-destructive font-medium" : "text-muted-foreground",
        )}
      >
        {due}
      </span>
    </div>
  );
}
