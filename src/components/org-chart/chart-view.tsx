"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";

import { startDraftAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { indexChart } from "@/lib/org-chart/tree";
import type { ChartNodeDTO } from "@/lib/org-chart/types";
import { cn } from "@/lib/utils";

import { PositionPanel } from "./position-panel";
import { useMediaQuery } from "./use-media-query";

const ChartCanvas = dynamic(() => import("./chart-canvas"), { ssr: false });

/**
 * The published chart: the lazy canvas (or the server-rendered list with
 * ?view=list) plus the side panel, deep-linked with ?position={key}.
 * Until the canvas module loads, the server-rendered list is shown in its
 * place, so the page is readable without JavaScript.
 */

export function ChartView({
  orgId,
  orgSlug,
  nodes,
  mode,
  listFallback,
  canEdit,
  draftHref,
}: {
  orgId: string;
  orgSlug: string;
  nodes: ChartNodeDTO[];
  mode: "chart" | "list";
  /** The server-rendered list (list view, and the canvas fallback). */
  listFallback: React.ReactNode;
  canEdit: boolean;
  /** An open MANUAL draft to continue, if any. */
  draftHref: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const index = useMemo(() => indexChart(nodes), [nodes]);
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const [editError, setEditError] = useState<string | null>(null);

  const selectedKey = searchParams.get("position");
  const selected = selectedKey ? (index.byKey.get(selectedKey) ?? null) : null;

  const setPosition = useCallback(
    (key: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (key) next.set("position", key);
      else next.delete("position");
      const qs = next.toString();
      // Native history integrates with the Next.js router (useSearchParams
      // updates) without refetching the page, so the canvas keeps its view.
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, searchParams],
  );

  const onSelect = useCallback(
    (id: string) => {
      const node = index.byId.get(id);
      if (node) setPosition(node.key);
    },
    [index, setPosition],
  );

  const onNavigate = useCallback(
    (node: ChartNodeDTO) => {
      setPosition(node.key);
      setFocus({ id: node.id, nonce: Date.now() });
    },
    [setPosition],
  );

  const onEdit = canEdit
    ? () => {
        const suffix = selected ? `?position=${encodeURIComponent(selected.key)}` : "";
        if (draftHref) {
          router.push(`${draftHref}${suffix}`);
          return;
        }
        setEditError(null);
        startTransition(async () => {
          const result = await startDraftAction(orgId, "current");
          if (result.ok && "versionId" in result) router.push(`/app/${orgSlug}/org-chart/drafts/${result.versionId}${suffix}`);
          else setEditError("error" in result ? result.error : "The draft could not be started.");
        });
      }
    : undefined;

  return (
    <>
      {mode === "list" ? (
        <div className="max-w-3xl">{listFallback}</div>
      ) : (
        <div className="relative -mx-4 -mb-4 h-[calc(100dvh-11.5rem)] min-h-[420px] border-t md:-mx-6 md:-mb-6">
          {!ready && <div className="absolute inset-0 overflow-auto p-4 md:p-6">{listFallback}</div>}
          <div className={cn("absolute inset-0", !ready && "invisible")}>
            <ChartCanvas
              nodes={nodes}
              selectedId={selected?.id ?? null}
              onSelect={onSelect}
              focus={focus}
              rightInset={isDesktop && selected ? 448 : 0}
              onReady={() => setReady(true)}
              showMiniMap={nodes.length > 12}
            />
          </div>
        </div>
      )}
      {editError && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {editError}
        </p>
      )}
      <PositionPanel
        orgId={orgId}
        orgSlug={orgSlug}
        node={selected}
        manager={selected ? index.managerOf(selected.id) : null}
        reports={selected ? index.reportsOf(selected.id) : []}
        advisors={selected ? index.advisorsOf(selected.id) : []}
        side={isDesktop ? "right" : "bottom"}
        onClose={() => setPosition(null)}
        onNavigate={onNavigate}
        onEdit={onEdit && !pending ? onEdit : undefined}
      />
    </>
  );
}
