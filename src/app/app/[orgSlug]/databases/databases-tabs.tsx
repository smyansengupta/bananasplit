"use client";

import { ChartColumn, Database } from "@/components/icons";
import { useParams } from "next/navigation";

import { PageTabs } from "@/components/ui/page-tabs";

/**
 * The tabs under the Databases and Reports titles. Reports shows only to
 * roles that have a report tier and reports.view (the page decides and
 * passes `showReports`); with one tab there is nothing to switch, so no
 * strip. `orgSlug` falls back to the URL (the Reports loading shell has no
 * params).
 */
export function DatabasesTabs({
  orgSlug,
  showReports,
}: {
  orgSlug?: string;
  showReports: boolean;
}) {
  const params = useParams<{ orgSlug: string }>();
  if (!showReports) return null;
  const base = `/app/${orgSlug ?? params.orgSlug}/databases`;
  return (
    <PageTabs
      label="Databases sections"
      tabs={[
        { href: base, label: "Databases", icon: Database },
        { href: `${base}/reports`, label: "Reports", icon: ChartColumn },
      ]}
    />
  );
}
