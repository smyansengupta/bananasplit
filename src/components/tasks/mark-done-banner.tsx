"use client";

import { CircleCheck } from "@/components/icons";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { TaskStatus } from "@/generated/prisma/enums";

import { useCompleteTask } from "./quick-controls";

/**
 * Where a reminder email's "Mark done" link lands (?done=1): one button
 * that finishes the task. The link itself never changes anything (mail
 * scanners open links), so this one click is the whole job.
 */
export function MarkDoneBanner({
  task,
}: {
  task: { id: string; title: string; status: TaskStatus; blockedReason: string | null };
}) {
  const complete = useCompleteTask();
  const router = useRouter();
  const pathname = usePathname();
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();
  if (done || task.status === TaskStatus.COMPLETED) return null;
  return (
    <div className="bg-card edge rounded-card flex flex-wrap items-center gap-3 px-4 py-3">
      <CircleCheck className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm font-medium">Finished?</p>
      <Button
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            if (await complete(task, TaskStatus.COMPLETED)) {
              setDone(true);
              router.replace(pathname, { scroll: false });
            }
          })
        }
      >
        Mark done
      </Button>
    </div>
  );
}
