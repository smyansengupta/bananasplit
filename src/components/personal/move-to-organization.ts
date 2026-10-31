"use client";

import { ArrowRightLeft } from "@/components/icons";

import { moveToOrganizationAction, type MovableKind } from "@/app/app/[orgSlug]/move/actions";
import type { ItemMenuEntry } from "@/components/item-menu";
import { toast } from "@/components/ui/toaster";

/** An organization the viewer owns or runs: where a Personal item can go. */
export interface MoveTarget {
  id: string;
  name: string;
}

/** How long a move waits, Undo on screen, before it's sent (it's one way). */
const UNDO_WINDOW_MS = 6000;

/**
 * "Move to <organization>" menu entries for one Personal item, one per
 * organization the viewer runs. A move can't be taken back once it's sent,
 * so it waits a few seconds with Undo first, then moves and calls
 * `onMoved` (a refresh, so the item leaves the list).
 */
export function moveToEntries(
  targets: readonly MoveTarget[] | undefined,
  item: { kind: MovableKind; id: string },
  onMoved: () => void,
): ItemMenuEntry[] {
  return (targets ?? []).map((target, i) => ({
    label: `Move to ${target.name}`,
    icon: ArrowRightLeft,
    separated: i === 0,
    onSelect: () => {
      let undone = false;
      toast({
        title: `Moving to ${target.name}`,
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          run: () => {
            undone = true;
          },
        },
      });
      window.setTimeout(async () => {
        if (undone) return;
        const result = await moveToOrganizationAction(target.id, item.kind, item.id);
        if (result.error) {
          toast({ title: result.error, tone: "error" });
          return;
        }
        toast({ title: `Moved to ${target.name}`, tone: "success" });
        onMoved();
      }, UNDO_WINDOW_MS);
    },
  }));
}
