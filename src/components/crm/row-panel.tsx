"use client";

import { ArrowUpRight } from "@/components/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { CrmRowPanelData } from "@/server/crm/row-panel";

import { RecordFields } from "./record-fields";

/**
 * A CRM row opened from Databases: the record's own fields, saved as the
 * record page saves them, and a way to the full record (timeline, items,
 * history).
 */
export function CrmRowPanel({
  orgId,
  orgSlug,
  panel,
}: {
  orgId: string;
  orgSlug: string;
  panel: CrmRowPanelData;
}) {
  return (
    <div className="space-y-4">
      <Button asChild variant="outline" size="sm">
        <Link href={panel.href}>
          Open the full record
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </Button>
      <RecordFields
        orgId={orgId}
        orgSlug={orgSlug}
        kind={panel.kind}
        id={panel.id}
        fields={panel.fields}
        compact
      />
    </div>
  );
}
