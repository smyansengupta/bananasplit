"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * One integration's setup, over the Integrations page: a centred window like
 * every other item in Bananasplit (a task, an epic), never a page of its own.
 * The page opens it from `?app=<key>` and renders its body on the server, so
 * a link straight to it works and Back closes it. Closing drops the query
 * and leaves you where you were on the page.
 */
export function IntegrationDialog({
  title,
  summary,
  mark,
  children,
}: {
  title: string;
  /** Its state in a few words ("Connected, checked Oct 12"). */
  summary?: string;
  mark: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) router.replace(pathname, { scroll: false });
      }}
    >
      <DialogContent className="bg-background flex max-h-[min(88vh,860px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <div className="flex items-center gap-3 border-b px-6 py-4 pr-14">
          <span className="shrink-0">{mark}</span>
          <div className="min-w-0">
            <DialogTitle className="heading text-[17px] leading-tight">{title}</DialogTitle>
            <DialogDescription
              className={summary ? "text-muted-foreground mt-0.5 text-[13px]" : "sr-only"}
            >
              {summary ?? `Set up ${title}.`}
            </DialogDescription>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4.5 overflow-y-auto px-6 py-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
