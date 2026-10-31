"use client";

import { Check, Eye, Loader2, Send } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { publishFormAction } from "@/app/app/[orgSlug]/forms/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

/**
 * The builder's two buttons: Preview (the answer page as people will see
 * it, in a new tab, sending nothing) and Publish, which puts a draft live.
 * Once it's live the button says so; clicking it takes the form back to a
 * draft, with Undo.
 */
export function FormPublish({
  orgId,
  formId,
  previewHref,
  published,
}: {
  orgId: string;
  formId: string;
  previewHref: string;
  published: boolean;
}) {
  const router = useRouter();
  const [live, setLive] = useState(published);
  const [pending, start] = useTransition();

  function set(next: boolean) {
    setLive(next);
    start(async () => {
      const result = await publishFormAction(orgId, formId, next);
      if (result.error) {
        setLive(!next);
        toast({ title: result.error, tone: "error" });
        return;
      }
      toast({
        title: next ? "Published" : "Back to a draft",
        action: {
          label: "Undo",
          run: async () => {
            const back = await publishFormAction(orgId, formId, !next);
            if (back.error) return back.error;
            setLive(!next);
            router.refresh();
          },
        },
      });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" asChild>
        <a href={previewHref} target="_blank" rel="noreferrer">
          <Eye className="size-4" aria-hidden="true" />
          Preview
        </a>
      </Button>
      {live ? (
        <Button
          variant="outline"
          onClick={() => set(false)}
          disabled={pending}
          title="Take it back to a draft"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
          Published
        </Button>
      ) : (
        <Button variant="create" onClick={() => set(true)} disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          Publish
        </Button>
      )}
    </div>
  );
}
