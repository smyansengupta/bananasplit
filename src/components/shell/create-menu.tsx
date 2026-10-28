"use client";

import {
  CalendarClock,
  CalendarPlus,
  CheckSquare,
  Loader2,
  NotebookPen,
  Plus,
  Vote,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import type { CreateAction } from "@/components/shell/nav-config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";

const ICONS: Record<string, IconComponent> = {
  CalendarClock,
  CalendarPlus,
  CheckSquare,
  NotebookPen,
  Vote,
};

/**
 * The + menu: start a task, an event, a note, a poll or a Find a time from
 * any page (createActions in nav-config.ts says which, for this space and
 * viewer). The tool capsule opens it (desktop only: on a phone each page's
 * own add button does); `children` is the trigger, which gets a spinner while
 * a note is made.
 */
export function CreateMenu({
  orgId,
  orgSlug,
  actions,
  side = "bottom",
  align = "end",
  children,
}: {
  orgId: string;
  orgSlug: string;
  actions: readonly CreateAction[];
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  children: (state: { pending: boolean; icon: React.ReactNode }) => React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function newNote() {
    start(async () => {
      try {
        const res = await createNote(orgId);
        if (res.noteId) {
          router.push(`/app/${orgSlug}/notes/${res.noteId}`);
          return;
        }
        toast({ title: "Couldn't start a note", description: res.error, tone: "error" });
      } catch {
        toast({
          title: "Couldn't start a note",
          description: "Check your connection and try again.",
          tone: "error",
        });
      }
    });
  }

  const icon = pending ? (
    <Loader2 className="size-5 animate-spin" aria-hidden="true" />
  ) : (
    <Plus className="size-5" strokeWidth={1.75} aria-hidden="true" />
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children({ pending, icon })}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} sideOffset={10} className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Create
        </DropdownMenuLabel>
        {actions.map((action) => {
          const Icon = ICONS[action.icon] ?? Plus;
          const content = (
            <>
              <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {action.label}
            </>
          );
          return action.href ? (
            <DropdownMenuItem key={action.id} asChild>
              <Link href={action.href}>{content}</Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={action.id} disabled={pending} onSelect={newNote}>
              {content}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
