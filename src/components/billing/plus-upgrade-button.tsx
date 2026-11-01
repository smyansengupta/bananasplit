"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { switchPlan } from "@/app/app/[orgSlug]/settings/plan/actions";
import { Button } from "@/components/ui/button";
import { undoable } from "@/components/ui/toaster";
import { PLAN_NAMES } from "@/lib/billing/features";

/**
 * A Personal Plus feature's one button: it starts Plus right here (the same
 * switch as the Plan page, with Undo), and the page opens on the feature.
 */
export function PlusUpgradeButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await undoable({
            title: `You're on ${PLAN_NAMES.PERSONAL_PLUS}`,
            run: async () => (await switchPlan(orgId, "PERSONAL_PLUS")).error,
            undo: async () => {
              const error = (await switchPlan(orgId, "FREE")).error;
              router.refresh();
              return error;
            },
          });
          router.refresh();
        })
      }
    >
      Get {PLAN_NAMES.PERSONAL_PLUS}
    </Button>
  );
}
