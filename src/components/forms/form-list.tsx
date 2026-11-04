"use client";

import { Database, Trash2 } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { trashFormAction } from "@/app/app/[orgSlug]/forms/actions";
import { deleteQuestionPoll } from "@/app/app/[orgSlug]/calendar/polls/question-actions";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { ItemMenu } from "@/components/item-menu";
import { TASK_PANEL } from "@/components/tasks/layout-ui";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast, undoable } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

import { shareAgainAction, type FormShareAgain } from "./form-ambient";

export interface FormListRow {
  id: string;
  /**
   * A form, a quick poll made in Forms, an anonymous members' poll, or a
   * poll from the organization's website (its ballots live in Ballots).
   */
  kind: "form" | "poll" | "member-poll" | "website-poll";
  title: string;
  /** The second line: what it asks, or who can answer. */
  detail: string | null;
  href: string;
  open: boolean;
  draft: boolean;
  status: string;
  responses: number;
  /** Members-only: out of how many members ("36 of 40"). */
  outOf: number | null;
  toReview: number;
  databaseHref: string | null;
  canTrash: boolean;
  /** Closing in two days with few answers (src/lib/ambient/forms.ts). */
  shareAgain?: FormShareAgain | null;
}

/** Form | Kind | Responses | Status | Saves to, then the row's menu. */
const COLS =
  "md:grid md:grid-cols-[minmax(0,1fr)_7rem_9.5rem_9.5rem_7rem_2rem] md:items-center md:gap-4";

/**
 * Every form and quick poll, one row each: what it is, its kind, how many
 * answered (and how many wait on a review), whether it's open, and the
 * database its answers go into. The row opens the form.
 */
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
      // An anonymous poll has no trash: its votes go with it, so it still asks.
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

  const shown = rows.filter((r) => !gone.has(r.id));
  return (
    <>
      {confirmElement}
      <div className={TASK_PANEL}>
        <div
          aria-hidden="true"
          className={cn(
            COLS,
            "text-muted-foreground hidden px-3 pt-1 pb-2 text-[12px] font-medium md:grid",
          )}
        >
          <span>Form</span>
          <span>Kind</span>
          <span>Responses</span>
          <span>Status</span>
          <span>Saves to</span>
          <span />
        </div>
        <ul aria-label="Forms">
          {shown.map((row) => (
            <li
              key={row.id}
              className={cn(
                COLS,
                "group hover:bg-muted/60 focus-within:bg-muted/60 rounded-field relative flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 transition-colors duration-150",
                "[li+&]:before:bg-border [li+&]:before:absolute [li+&]:before:inset-x-3 [li+&]:before:top-0 [li+&]:before:h-px",
              )}
            >
              <span className="min-w-0 basis-full md:basis-auto">
                <Link
                  href={row.href}
                  className="block text-[15px] leading-snug font-medium break-words underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-none"
                >
                  {row.title}
                </Link>
                {row.detail && (
                  <span className="text-muted-foreground mt-0.5 block text-[13px] break-words">
                    {row.detail}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground text-[13px]">
                {row.kind === "form" ? "Form" : "Quick poll"}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-[13px] tabular-nums">
                <span className="font-medium">{row.responses}</span>
                {row.outOf !== null && (
                  <span className="text-muted-foreground">of {row.outOf}</span>
                )}
                {row.toReview > 0 && <Badge variant="accent">{row.toReview} to review</Badge>}
              </span>
              <span className="relative z-10 inline-flex flex-col items-start gap-1.5">
                <Badge
                  variant={row.draft ? "outline" : row.open ? "success" : "secondary"}
                  className="whitespace-nowrap"
                >
                  {row.status}
                </Badge>
                {row.shareAgain && (
                  <AmbientActions
                    why
                    className="items-start"
                    actions={[shareAgainAction(orgId, row.shareAgain, row.title)]}
                  />
                )}
              </span>
              <span className="relative z-10 text-[13px]">
                {row.databaseHref ? (
                  <Link
                    href={row.databaseHref}
                    className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                  >
                    <Database className="size-3.5" aria-hidden="true" />
                    Database
                  </Link>
                ) : (
                  <span className="text-muted-foreground">
                    {row.kind === "member-poll" || row.kind === "website-poll"
                      ? "Private votes"
                      : ""}
                  </span>
                )}
              </span>
              <span className="relative z-10 ms-auto md:ms-0">
                {row.canTrash && (
                  <ItemMenu
                    label={`Actions for ${row.title}`}
                    items={[
                      {
                        label: "Delete",
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => void trash(row),
                      },
                    ]}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
