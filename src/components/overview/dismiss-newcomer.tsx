"use client";

import { useRouter } from "next/navigation";

import { X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { dismissNewcomer, undismissNewcomer } from "@/server/overview/newcomer-actions";

/**
 * The x on someone new's row (People, Since you were here): the row goes for
 * you without saying hi, with Undo in the toast. The row's owner hides and
 * shows it (onGone, onBack), so it leaves at once.
 */
export function DismissNewcomer({
  orgId,
  personId,
  name,
  onGone,
  onBack,
}: {
  orgId: string;
  personId: string;
  name: string;
  onGone: () => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const failure = "Couldn't dismiss that. Try again.";

  const dismiss = async () => {
    onGone();
    const result = await runAction(() => dismissNewcomer(orgId, personId), failure);
    if (!result || !("ok" in result) || !result.ok) {
      onBack();
      if (result) toast({ title: failure, tone: "error" });
      return;
    }
    router.refresh();
    toast({
      title: "Dismissed",
      action: {
        label: "Undo",
        run: async () => {
          await undismissNewcomer(orgId, personId);
          onBack();
          router.refresh();
        },
      },
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={dismiss}
      aria-label={`Dismiss ${name}`}
      title="Dismiss"
      className="text-muted-foreground shrink-0"
    >
      <X aria-hidden="true" />
    </Button>
  );
}
