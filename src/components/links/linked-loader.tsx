"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { listLinksAction } from "@/app/app/[orgSlug]/links/actions";
import type { LinkedItem, LinkRef } from "@/lib/links";

import { LinkedPanel } from "./linked-panel";

/**
 * The Linked panel inside something already on the client (a database
 * row's drawer, a transaction's dialog): it asks for its links when it
 * opens, then works like the server-rendered one (LinkedSection).
 */
export function LinkedLoader({
  orgId,
  orgSlug,
  at,
  className,
}: {
  orgId: string;
  /** Defaults to the one in the page's address (/app/{slug}/...). */
  orgSlug?: string;
  at: LinkRef;
  className?: string;
}) {
  const pathname = usePathname() ?? "";
  const slug = orgSlug ?? pathname.split("/")[2] ?? "";
  const [items, setItems] = useState<LinkedItem[] | null>(null);
  useEffect(() => {
    let live = true;
    listLinksAction(orgId, slug, at)
      .then((list) => {
        if (live) setItems(list);
      })
      .catch(() => {
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [orgId, slug, at.kind, at.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (items === null) {
    return (
      <div
        aria-hidden="true"
        className={`bg-muted/60 rounded-card h-14 animate-pulse ${className ?? ""}`}
      />
    );
  }
  return (
    <LinkedPanel
      key={`${at.kind}:${at.id}`}
      orgId={orgId}
      orgSlug={slug}
      at={at}
      initial={items}
      className={className}
    />
  );
}
