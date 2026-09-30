"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { pinPathAction, reorderPinsAction } from "@/app/app/[orgSlug]/_shell/pin-actions";

/**
 * Pinning by drag and drop: any in-app link (a sidebar section, a note card,
 * a task row) can be dragged onto a Pinned area to pin it, and pins can be
 * dragged within it to reorder. Links carry their URL natively
 * (text/uri-list); a pin being reordered carries its id under PIN_MIME.
 */

export const PIN_MIME = "application/x-clubport-pin";

/** The same-origin path a drop carries, or null. */
export function pathFromDrop(data: DataTransfer): string | null {
  const raw = (data.getData("text/uri-list") || data.getData("text/plain") || "").split("\n")[0].trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function carriesLink(data: DataTransfer): boolean {
  const types = Array.from(data.types);
  return types.includes("text/uri-list") || types.includes("text/plain") || types.includes(PIN_MIME);
}

/**
 * Drop handling for a Pinned area: a dropped link is pinned, a dropped pin
 * is moved in front of `beforeId` (or to the end).
 */
export function usePinDrop(orgId: string, ids: readonly string[]) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function drop(data: DataTransfer, beforeId: string | null = null) {
    setOver(false);
    const moving = data.getData(PIN_MIME);
    if (moving) {
      const rest = ids.filter((id) => id !== moving);
      const at = beforeId ? rest.indexOf(beforeId) : rest.length;
      const next = [...rest.slice(0, at < 0 ? rest.length : at), moving, ...rest.slice(at < 0 ? rest.length : at)];
      start(async () => {
        await reorderPinsAction(orgId, next);
        router.refresh();
      });
      return;
    }
    const path = pathFromDrop(data);
    if (!path) return;
    start(async () => {
      setError(null);
      const result = await pinPathAction(orgId, path);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  const zone = {
    onDragOver: (e: React.DragEvent) => {
      if (!carriesLink(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = Array.from(e.dataTransfer.types).includes(PIN_MIME) ? "move" : "link";
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!carriesLink(e.dataTransfer)) return;
      e.preventDefault();
      drop(e.dataTransfer);
    },
  };

  const pinProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(PIN_MIME, id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDrop: (e: React.DragEvent) => {
      if (!carriesLink(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      drop(e.dataTransfer, id);
    },
  });

  return { over, error, pending, zone, pinProps };
}
