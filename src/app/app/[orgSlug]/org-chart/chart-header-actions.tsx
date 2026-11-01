"use client";

import { FileUp, History, Pencil } from "@/components/icons";
import Link from "next/link";

import { ItemMenu } from "@/components/item-menu";
import { StartDraftButton } from "@/components/org-chart/start-draft-button";
import { Button } from "@/components/ui/button";

/**
 * The org chart's actions (People's Org chart view), for editors: one
 * edit button, with importing and the version history in the "…" menu.
 */
export function ChartHeaderActions({
  orgId,
  orgSlug,
  hasChart,
  canEdit,
  draft,
}: {
  orgId: string;
  orgSlug: string;
  hasChart: boolean;
  canEdit: boolean;
  /** An open draft to continue, if there is one. */
  draft: { href: string; number: number } | null;
}) {
  const base = `/app/${orgSlug}/org-chart`;
  return (
    <>
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
