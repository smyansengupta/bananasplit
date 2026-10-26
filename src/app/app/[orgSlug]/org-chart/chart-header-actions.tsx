"use client";

import { FileUp, History, List, Network, Pencil } from "@/components/icons";
import Link from "next/link";

import { ItemMenu } from "@/components/item-menu";
import { StartDraftButton } from "@/components/org-chart/start-draft-button";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";

/**
 * The org chart's header actions: Chart or List, then (for editors) one
 * edit button, with importing and the version history in the "…" menu.
 */
export function ChartHeaderActions({
  orgId,
  orgSlug,
  mode,
  hasChart,
  canEdit,
  draft,
}: {
  orgId: string;
  orgSlug: string;
  mode: "chart" | "list";
  hasChart: boolean;
  canEdit: boolean;
  /** An open draft to continue, if there is one. */
  draft: { href: string; number: number } | null;
}) {
  const base = `/app/${orgSlug}/org-chart`;
  return (
    <>
      {hasChart && (
        <Segmented
          label="Chart view"
          value={mode}
          options={[
            { value: "chart", label: "Chart", icon: Network, href: base, compact: true },
            { value: "list", label: "List", icon: List, href: `${base}?view=list`, compact: true },
          ]}
        />
      )}
      {canEdit &&
        (draft ? (
          <Button asChild variant="outline" size="sm">
            <Link href={draft.href}>
              <Pencil className="size-4" aria-hidden="true" />
              Continue draft v{draft.number}
            </Link>
          </Button>
        ) : (
          hasChart && (
            <StartDraftButton orgId={orgId} orgSlug={orgSlug} from="current">
              <Pencil className="size-4" aria-hidden="true" />
              Edit chart
            </StartDraftButton>
          )
        ))}
      {canEdit && hasChart && (
        <ItemMenu
          label="More org chart actions"
          items={[
            { label: "Import a document", icon: FileUp, href: `${base}/import` },
            { label: "Version history", icon: History, href: `${base}/versions` },
          ]}
        />
      )}
    </>
  );
}
