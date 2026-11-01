"use client";

import { ArrowUpRight, Loader2 } from "@/components/icons";
import Link from "next/link";
import { useEffect, useState } from "react";

import { peekAction } from "@/app/app/[orgSlug]/links/actions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { LinkRef, PeekSummary } from "@/lib/links";

/**
 * A linked thing opened beside the page instead of in place of it (the
 * plan's side peek), so you never lose your place: its title, what it is,
 * its key facts and some of its words, with Open page for the rest.
 */
export function SidePeek({
  orgId,
  orgSlug,
  target,
  onClose,
}: {
  orgId: string;
  orgSlug: string;
  /** What to show, with what's already known (title, line, page). */
  target: (LinkRef & { title: string; detail: string; href: string }) | null;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<PeekSummary | null | "loading">("loading");
  useEffect(() => {
    if (!target) return;
    let live = true;
    peekAction(orgId, orgSlug, { kind: target.kind, id: target.id })
      .then((s) => {
        if (live) setSummary(s);
      })
      .catch(() => {
        if (live) setSummary(null);
      });
    return () => {
      live = false;
      setSummary("loading");
    };
  }, [orgId, orgSlug, target]);

  const loaded = summary !== "loading" ? summary : null;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {target && (
          <>
            <SheetHeader className="gap-1 px-6 pt-6 pr-14 pb-4">
              <SheetTitle className="text-[19px] break-words">{target.title}</SheetTitle>
              <SheetDescription>{loaded?.detail ?? target.detail}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-6 pb-8">
              {summary === "loading" ? (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading
                </p>
              ) : summary === null ? (
                <p className="text-muted-foreground text-sm">This isn&apos;t available to you.</p>
              ) : (
                <>
                  {summary.facts.length > 0 && (
                    <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
                      {summary.facts.map((f) => (
                        <div key={f.label} className="contents">
                          <dt className="text-muted-foreground">{f.label}</dt>
                          <dd className="min-w-0 break-words">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {summary.text && (
                    <p className="text-sm leading-relaxed break-words whitespace-pre-line">
                      {summary.text}
                    </p>
                  )}
                </>
              )}
              <Button asChild variant="outline">
                <Link href={target.href} onClick={onClose}>
                  Open page
                  <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
