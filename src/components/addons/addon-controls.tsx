"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { addAddOnAction, removeAddOnAction } from "@/app/app/[orgSlug]/integrations/addon-actions";
import { Button } from "@/components/ui/button";
import { toast, undoable } from "@/components/ui/toaster";
import { ADD_ON_INFO, type AddOnId } from "@/lib/addons";

/**
 * Add an add-on in one click, then go where it starts: Forms to its
 * ready-made forms, Finance to its one-screen setup.
 */
export function AddAddOnButton({
  orgId,
  orgSlug,
  id,
  size = "default",
  className,
}: {
  orgId: string;
  orgSlug: string;
  id: AddOnId;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const name = ADD_ON_INFO[id].name;
  const next =
    id === "forms" ? `/app/${orgSlug}/forms/new` : `/app/${orgSlug}/integrations/finance?setup=1`;
  return (
    <Button
      type="button"
      size={size}
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await addAddOnAction(orgId, id).catch(() => null);
          if (!result || !result.ok) {
            toast({
              title: result && !result.ok ? result.error : "That didn't work. Try again.",
              tone: "error",
            });
            return;
          }
          if (id === "forms") toast({ title: "Forms is in the sidebar now." });
          router.push(next);
          router.refresh();
        })
      }
    >
      {pending ? "Adding…" : `Add ${name}`}
    </Button>
  );
}

/** Takes an add-on off at once, with Undo: nothing it made is deleted. */
export function RemoveAddOnButton({ orgId, id }: { orgId: string; id: AddOnId }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const name = ADD_ON_INFO[id].name;
  const fail = (r: Awaited<ReturnType<typeof removeAddOnAction>> | null) =>
    !r ? "That didn't work. Try again." : r.ok ? null : r.error;
  return (
    <Button
      type="button"
      variant="outline"
      className="text-destructive"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const ok = await undoable({
            title: `${name} is off. Everything in it is kept.`,
            run: async () => fail(await removeAddOnAction(orgId, id).catch(() => null)),
            undo: async () => {
              const back = await addAddOnAction(orgId, id).catch(() => null);
              if (!back || !back.ok)
                return back && !back.ok ? back.error : "That didn't work. Try again.";
              router.refresh();
            },
          });
          if (ok) router.refresh();
        })
      }
    >
      Turn off {name}
    </Button>
  );
}
