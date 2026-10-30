import { withOrgTx } from "@/server/db/context";
import { listLinked, type LinkRef } from "@/server/links/links";

import { LinkedPanel } from "./linked-panel";

/**
 * The Linked panel for a page's own thing, loaded on the server as the
 * viewer (src/server/links/links.ts) and handed to the client panel.
 */
export async function LinkedSection({
  orgId,
  orgSlug,
  at,
  className,
}: {
  orgId: string;
  orgSlug: string;
  at: LinkRef;
  className?: string;
}) {
  const items = await withOrgTx(orgId, ({ db }) => listLinked(db, orgId, orgSlug, at));
  return (
    <LinkedPanel orgId={orgId} orgSlug={orgSlug} at={at} initial={items} className={className} />
  );
}
