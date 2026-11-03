"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { queueQuietAction, unqueueQuietAction } from "@/app/app/[orgSlug]/crm/report-actions";
import { AMBIENT_BUTTON, AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

const OUTLINE =
  "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-muted";

/** Going quiet's ambient button: into tomorrow's Power hour, with Undo. */
export function QuietButton({ orgId, ids }: { orgId: string; ids: string[] }) {
  const router = useRouter();
  const [queued, setQueued] = useState<string[] | null>(null);
  if (ids.length === 0 && !queued) return null;
  if (queued) {
    return (
      <div className="flex flex-nowrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          {queued.length === 1 ? "1 person is" : `${queued.length} people are`} in tomorrow&apos;s Power hour.
        </span>
        <button
          type="button"
          className={cn(AMBIENT_BUTTON, OUTLINE)}
          onClick={async () => {
            const r = await runAction(() => unqueueQuietAction(orgId, queued));
            if (r && !r.ok) toast({ title: r.error, tone: "error" });
            setQueued(null);
            router.refresh();
          }}
        >
          Undo
        </button>
      </div>
    );
  }
  const why = `${ids.length === 1 ? "1 has" : `${ids.length} have`} no follow-up set`;
  return (
    <div className="flex flex-nowrap items-center gap-2">
      <AmbientButton
        action={{
          key: "power",
          label: "Add to Power hour",
          tone: "spark",
          reason: why,
          run: async () => {
            const r = await queueQuietAction(orgId, ids);
            if (r.ok) setQueued(r.ids);
            return r;
          },
        }}
      />
      <AmbientWhy className="min-w-0 truncate">{why}</AmbientWhy>
    </div>
  );
}
