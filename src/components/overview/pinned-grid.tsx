"use client";

import { CheckSquare, ClipboardList, NotebookText, Pin, Plus, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { unpinAction } from "@/app/app/[orgSlug]/_shell/pin-actions";
import { usePinDrop } from "@/components/pins/pin-dnd";
import { usePins } from "@/components/pins/pins-context";
import { Button } from "@/components/ui/button";
import { PIN_KIND_LABELS } from "@/components/shell/pin-icons";
import type { PinKind } from "@/lib/pins/pages";
import { cn } from "@/lib/utils";

import {
  KIND_ICON,
  KindIcon,
  SECTION_ICON,
  kindTileClass,
  kindToken,
  pageSection,
} from "./kind-tiles";

/**
 * The Overview's Pinned widget: shortcuts to what the member pinned, as
 * coloured tiles (one colour per kind, as in Recently visited). Drag a page
 * from the sidebar (or any link) onto it to pin it, drag pins to reorder
 * them, and unpin with the x. Empty, it shows three ghost tiles of what a
 * pin looks like, the way to pin something, and lights up as a drop target.
 */

const GHOSTS: { kind: PinKind; Icon: typeof Pin }[] = [
  { kind: "task", Icon: CheckSquare },
  { kind: "note", Icon: NotebookText },
  { kind: "form", Icon: ClipboardList },
];

export function PinnedGrid({
  orgId,
  pins,
}: {
  orgId: string;
  pins: readonly { id: string; href: string; label: string; kind: PinKind }[];
}) {
  const router = useRouter();
  const pinsCtx = usePins();
  const [pending, start] = useTransition();
  const { over, error, zone, pinProps } = usePinDrop(
    orgId,
    pins.map((p) => p.id),
  );

  return (
    <div
      {...zone}
      className={cn(
        "rounded-tile -m-1 p-1 transition-colors",
        over && "ring-brand-accent bg-brand-accent/5 ring-2",
      )}
    >
      {pins.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <ul aria-hidden="true" className="flex w-full max-w-md justify-center gap-2">
            {GHOSTS.map(({ kind, Icon }, i) => (
              <li
                key={kind}
                className={cn(
                  "rounded-tile border-border flex min-w-0 flex-1 items-center gap-2 border border-dashed p-2.5",
                  i === 1 ? "-translate-y-1.5" : "opacity-70",
                )}
              >
                <KindIcon color={kindToken(kind)} className="size-8 rounded-[10px] [&_svg]:size-4">
                  <Icon />
                </KindIcon>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="bg-muted-strong h-2 w-4/5 rounded-full" />
                  <span className="bg-muted h-1.5 w-1/2 rounded-full" />
                </span>
              </li>
            ))}
          </ul>
          <div className="space-y-1">
            <p className="heading text-[15px]">{over ? "Drop to pin it" : "Nothing pinned yet"}</p>
            <p className="text-muted-foreground mx-auto max-w-[32ch] text-[13px]">
              Keep what you open every day one click away. Drag a page here, or pick one.
            </p>
          </div>
          {pinsCtx && (
            <Button type="button" size="sm" variant="outline" onClick={() => pinsCtx.openPicker()}>
              <Pin className="size-4" aria-hidden="true" />
              Pin something
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))] gap-2.5">
          {pins.map((pin) => {
            const Icon = SECTION_ICON[pageSection(pin.kind, pin.href)] ?? KIND_ICON[pin.kind];
            return (
              <li key={pin.id} className="group relative min-w-0" {...pinProps(pin.id)}>
                <Link
                  href={pin.href}
                  draggable={false}
                  className={cn(kindTileClass, "cursor-grab pr-10 active:cursor-grabbing")}
                >
                  <KindIcon color={kindToken(pin.kind, pin.href)}>
                    <Icon />
                  </KindIcon>
                  <span className="min-w-0">
                    <span className="block truncate text-sm leading-tight font-semibold">
                      {pin.label}
                    </span>
                    <span className="text-muted-foreground mt-1 block truncate text-[12.5px]">
                      {PIN_KIND_LABELS[pin.kind]}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Unpin ${pin.label}`}
                  onClick={() =>
                    start(async () => {
                      await unpinAction(orgId, pin.id);
                      router.refresh();
                    })
                  }
                  className="text-muted-foreground hover:text-foreground hover:bg-muted absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => pinsCtx?.openPicker()}
              className={cn(
                "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-border rounded-tile flex size-full min-h-16 items-center justify-center gap-1.5 border border-dashed p-3 text-[12.5px] font-medium transition-colors",
                over && "border-brand-accent text-foreground",
              )}
            >
              {over ? (
                "Drop to pin"
              ) : (
                <>
                  <Plus className="size-3.5" aria-hidden="true" />
                  Pin something
                </>
              )}
            </button>
          </li>
        </ul>
      )}
      {error && <p className="text-destructive pt-2 text-xs">{error}</p>}
    </div>
  );
}
