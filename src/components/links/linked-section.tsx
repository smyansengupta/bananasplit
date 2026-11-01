import { withOrgTx } from "@/server/db/context";
import type { LinkKind } from "@/lib/links";
import { listLinked, type LinkRef } from "@/server/links/links";

import type { ReactNode } from "react";

import { LinkedPanel, type FixedLinkedRow } from "./linked-panel";

/**
 * The Linked panel for a page's own thing, loaded on the server as the
 * viewer (src/server/links/links.ts) and handed to the client panel.
 */
export async function LinkedSection({
  orgId,
  orgSlug,
  at,
  title,
  closingTile,
  fixed,
  actions,
  omitKinds,
  className,
}: {
  orgId: string;
  orgSlug: string;
  at: LinkRef;
  title?: string;
  closingTile?: boolean;
  fixed?: readonly FixedLinkedRow[];
  actions?: ReactNode;
  /** Kinds the page lists on its own (LinkedPanel's omitKinds). */
  omitKinds?: readonly LinkKind[];
  className?: string;
}) {
  const items = await withOrgTx(orgId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { timezone: true },
    });
    return listLinked(db, orgId, orgSlug, at, org?.timezone ?? "UTC");
  });
  return (
    <LinkedPanel
      orgId={orgId}
      orgSlug={orgSlug}
      at={at}
      initial={items}
      title={title}
      closingTile={closingTile}
      fixed={fixed}
      actions={actions}
      omitKinds={omitKinds}
      className={className}
    />
  );
}
