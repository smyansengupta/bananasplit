import type { ReactNode } from "react";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { PageHeader } from "@/components/page-header";
import { Segmented } from "@/components/ui/segmented";
import type { ResolvedCrmTab } from "@/lib/crm/nav";

/**
 * The Outreach tab's header: the CRM's tabs, then one switch for what you
 * shape here (templates, sequences, booking pages, bulk email, your mail),
 * the same bar every section's pages use.
 */

export type OutreachView = "templates" | "sequences" | "booking" | "bulk" | "mail";

export function OutreachHeader({
  orgSlug,
  tabs,
  view,
  title,
  description,
  actions,
}: {
  orgSlug: string;
  tabs: ResolvedCrmTab[];
  view: OutreachView;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const base = `/app/${orgSlug}/crm/outreach`;
  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} actions={actions} tabs={<CrmTabs tabs={tabs} />} />
      <Segmented
        label="Outreach"
        value={view}
        className="max-w-full overflow-x-auto"
        options={[
          { value: "sequences", label: "Plans", href: base },
          { value: "templates", label: "Templates", href: `${base}?view=templates` },
          { value: "booking", label: "Booking pages", href: `${base}/booking` },
          { value: "mail", label: "Your mail", href: `${base}?view=mail` },
        ]}
      />
    </div>
  );
}
