"use client";

import { Loader2, Sparkles } from "@/components/icons";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";

import { fillAiFieldAction } from "@/app/app/[orgSlug]/crm/ai-actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

/** Which record a field editor belongs to (RecordFields provides it), for an AI field's Fill. */
export const AiRecordContext = createContext<{ kind: "person" | "company" | "deal"; id: string } | null>(null);

/**
 * An AI field's Fill button on a record (the record page and the Databases
 * row panel): asks the organization's AI for this one row's value now. The
 * value is written with where it came from; a value someone typed stays,
 * and the answer waits in To approve instead.
 */
export function AiFillButton({ orgId, fieldId, hasPrompt }: { orgId: string; fieldId: string; hasPrompt: boolean }) {
  const record = useContext(AiRecordContext);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!record) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy || !hasPrompt}
      title={hasPrompt ? "Fill with AI" : "Give this field a prompt first (in CRM settings)"}
      onClick={async () => {
        setBusy(true);
        const r = await fillAiFieldAction(orgId, fieldId, record.id).catch(() => null);
        setBusy(false);
        if (!r || !r.ok) {
          toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
          return;
        }
        toast({
          title:
            r.result === "written"
              ? "Filled."
              : r.result === "suggested"
                ? "Someone typed a value here, so the answer waits in To approve."
                : r.result === "same"
                  ? "Still the same answer."
                  : "The AI didn't find an answer for this one.",
          tone: r.result === "written" ? "success" : "default",
        });
        router.refresh();
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
      Fill
    </Button>
  );
}
