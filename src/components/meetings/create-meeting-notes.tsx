"use client";

import { Loader2, NotebookText } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import { toast } from "@/components/ui/toaster";

/**
 * "Create meeting notes", in the meeting's Linked panel (the workspace plan):
 * a note already tied to this meeting, opened to write in.
 */
export function CreateMeetingNotes({
  orgId,
  orgSlug,
  eventId,
  eventTitle,
}: {
  orgId: string;
  orgSlug: string;
  eventId: string;
  eventTitle: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await createNote(orgId, {
            title: `${eventTitle} meeting notes`,
            eventId,
          });
          if (result.noteId) router.push(`/app/${orgSlug}/notes/${result.noteId}`);
          else toast({ title: result.error ?? "Couldn't create the notes.", tone: "error" });
        })
      }
      className="text-foreground hover:bg-muted/40 focus-glow bg-card flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left text-[13px] font-medium outline-none disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <NotebookText className="text-muted-foreground size-3.5" aria-hidden="true" />
      )}
      Create meeting notes
    </button>
  );
}
