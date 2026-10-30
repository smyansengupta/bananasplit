"use client";

import { ClipboardList, Database, Trash2, Vote } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { trashFormAction } from "@/app/app/[orgSlug]/forms/actions";
import { deleteQuestionPoll } from "@/app/app/[orgSlug]/calendar/polls/question-actions";
import { ItemMenu } from "@/components/item-menu";
import { TASK_PANEL } from "@/components/tasks/layout-ui";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast, undoable } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

export interface FormListRow {
  id: string;
  /** A form, a quick poll made in Forms, or a members' question poll. */
  kind: "form" | "poll" | "member-poll";
  title: string;
  href: string;
  open: boolean;
  status: string;
  responses: number;
  toReview: number;
  databaseHref: string | null;
  canTrash: boolean;
}

const ROW =
  "group hover:bg-muted/60 focus-within:bg-muted/60 rounded-field relative flex items-center gap-3 px-3 py-3 transition-colors duration-150 sm:gap-3.5 [li+&]:before:bg-border [li+&]:before:absolute [li+&]:before:inset-x-3 [li+&]:before:top-0 [li+&]:before:h-px";

/** The forms and polls, drawn like the Tasks List's rows. */
export function FormList({ orgId, rows }: { orgId: string; rows: FormListRow[] }) {
  const router = useRouter();
  const [confirmElement, confirm] = useConfirm();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const hide = (id: string, on: boolean) =>
    setGone((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function trash(row: FormListRow) {
    if (row.kind === "member-poll") {
      // A question poll has no trash: its votes go with it, so it still asks.
      const deleted = await confirm({
        title: `Delete “${row.title}”?`,
        description: "Everyone's votes go with it. This can't be undone.",
        confirmLabel: "Delete poll",
        run: async () => (await deleteQuestionPoll(orgId, row.id)).error,
      });
      if (!deleted) return;
      hide(row.id, true);
      toast({ title: "Deleted" });
      router.refresh();
      return;
    }
    hide(row.id, true);
    const ok = await undoable({
      title: "Deleted",
      run: async () => (await trashFormAction(orgId, row.id, true)).error,
      undo: async () => {
        const back = await trashFormAction(orgId, row.id, false);
        if (back.error) return back.error;
        hide(row.id, false);
        router.refresh();
      },
    });
    if (!ok) hide(row.id, false);
    else router.refresh();
  }

  return (
    <>
      {confirmElement}
      <ul className={TASK_PANEL} aria-label="Forms">
        {rows
          .filter((r) => !gone.has(r.id))
          .map((row) => {
            const Icon = row.kind === "form" ? ClipboardList : Vote;
            return (
              <li key={row.id} className={ROW}>
                <span className="bg-muted text-muted-foreground grid size-[22px] shrink-0 place-items-center rounded-full">
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                <Link
                  href={row.href}
                  className="focus-visible:outline-foreground min-w-0 flex-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="block text-[15px] leading-snug font-medium break-words">
                    {row.title}
                  </span>
                  <span className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <span>{row.kind === "form" ? "Form" : "Quick poll"}</span>
                    <span className="tabular-nums">
                      {row.responses === 1
                        ? row.kind === "form"
                          ? "1 response"
                          : "1 vote"
                        : `${row.responses} ${row.kind === "form" ? "responses" : "votes"}`}
                    </span>
                    {row.toReview > 0 && <Badge variant="accent">{row.toReview} to review</Badge>}
                  </span>
                </Link>
                <Badge variant={row.open ? "success" : "secondary"} className="shrink-0">
                  {row.status}
                </Badge>
                <ItemMenu
                  label={`Actions for ${row.title}`}
                  items={[
                    row.databaseHref
                      ? { label: "Open database", icon: Database, href: row.databaseHref }
                      : null,
                    row.canTrash && {
                      label: "Delete",
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => void trash(row),
                    },
                  ]}
                  className={cn(!row.canTrash && !row.databaseHref && "hidden")}
                />
              </li>
            );
          })}
      </ul>
    </>
  );
}
