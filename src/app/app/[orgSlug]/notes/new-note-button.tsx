"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

import { createNote } from "./actions";

export function NewNoteButton({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await createNote(orgId);
          if (result.noteId) {
            router.push(`/app/${orgSlug}/notes/${result.noteId}`);
          }
        })
      }
    >
      <Plus className="size-4" />
      New note
    </Button>
  );
}
