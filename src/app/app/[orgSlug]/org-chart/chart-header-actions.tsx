"use client";

import { FileUp, History, Pencil } from "@/components/icons";
import Link from "next/link";

import { AmbientButton } from "@/components/ambient/ambient-button";
import { ItemMenu } from "@/components/item-menu";
import { StartDraftButton } from "@/components/org-chart/start-draft-button";
import { Button } from "@/components/ui/button";

import { publishDraftAction } from "./actions";

/**
 * The org chart's actions (People's Org chart view), for editors: one
 * edit button, with importing and the version history in the "…" menu.
 * A draft with nothing left to check shows Publish right here.
 */
export function ChartHeaderActions({
  orgId,
  orgSlug,
  hasChart,
  canEdit,
  draft,
  ready = null,
}: {
  orgId: string;
  orgSlug: string;
  hasChart: boolean;
  canEdit: boolean;
  /** An open draft to continue, if there is one. */
  draft: { href: string; number: number } | null;
  /** The open draft, when it's checked and ready: Publish without opening it. */
  ready?: { versionId: string; editVersion: number; setTitles: boolean } | null;
}) {
  const base = `/app/${orgSlug}/org-chart`;
  return (
    <>
      {canEdit && ready && (
        <AmbientButton
          action={{
            key: "publish",
            label: "Publish",
            tone: "solid",
            reason: "The draft is checked, with nothing left to fix",
            ariaLabel: "Publish the draft org chart",
            done: "Org chart published",
            run: () =>
              publishDraftAction(orgId, ready.versionId, {
                setTitles: ready.setTitles,
                expectedEditVersion: ready.editVersion,
              }),
          }}
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
