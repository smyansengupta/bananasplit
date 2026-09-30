"use client";

import { FileText, Pin, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { unpinAction } from "@/app/app/[orgSlug]/_shell/pin-actions";
import { usePinDrop } from "@/components/pins/pin-dnd";
import { PIN_ICONS } from "@/components/shell/pin-icons";
import type { PinKind } from "@/lib/pins/pages";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<PinKind, string> = {
  page: "Page",
  note: "Note",
  task: "Task",
  event: "Event",
  database: "Database",
  person: "Person",
  file: "File",
};

/**
 * The Overview's Pinned widget: shortcuts to what the member pinned. Drag a
 * page from the sidebar (or any link) onto it to pin it, drag pins to
 * reorder them, and unpin with the x.
 */
export function PinnedGrid({
  orgId,
  pins,
}: {
  orgId: string;
  pins: readonly { id: string; href: string; label: string; kind: PinKind }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { over, error, zone, pinProps } = usePinDrop(
    orgId,
    pins.map((p) => p.id),
  );

  return (
    <div
      {...zone}
      className={cn("-m-1 rounded-lg p-1 transition-colors", over && "bg-primary/5 ring-primary/40 ring-2")}
    >
      {pins.length === 0 ? (
        <div
          className={cn(
            "text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm",
            over && "border-primary text-foreground",
          )}
        >
          <span className="bg-primary/10 text-primary grid size-9 place-items-center rounded-full">
            <Pin className="size-4" aria-hidden="true" />
          </span>
          <p className="text-foreground font-medium">{over ? "Drop to pin it" : "Nothing pinned yet"}</p>
          <p className="max-w-sm text-balance">
            Drag any page from the sidebar here, press <strong>Pin</strong> at the top of a page, or
            use the pin on a note or file card.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
          {pins.map((pin) => {
            const Icon = PIN_ICONS[pin.kind] ?? FileText;
            return (
              <li key={pin.id} className="group relative" {...pinProps(pin.id)}>
                <Link
                  href={pin.href}
                  draggable={false}
                  className="hover:bg-accent/60 hover:border-foreground/15 flex cursor-grab items-center gap-3 rounded-lg border p-2.5 pr-9 transition-colors active:cursor-grabbing"
                >
                  <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-md">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{pin.label}</span>
                    <span className="text-muted-foreground block text-xs">{KIND_LABEL[pin.kind]}</span>
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
          <li
            className={cn(
              "text-muted-foreground flex items-center justify-center rounded-lg border border-dashed p-2.5 text-xs",
              over && "border-primary text-foreground",
            )}
          >
            {over ? "Drop to pin" : "Drag a page here to pin it"}
          </li>
        </ul>
      )}
      {error && <p className="text-destructive pt-2 text-xs">{error}</p>}
    </div>
  );
}
