"use client";

import { ChartColumn, Database } from "@/components/icons";

import { PageTabs } from "@/components/ui/page-tabs";

/**
 * The Databases | Reports switch above a CRM report, as on the app's own
 * report page: Databases goes to the report's database, Reports is here.
 */
export function CrmReportTabs({ databasesHref, reportsHref }: { databasesHref: string; reportsHref: string }) {
  return (
    <PageTabs
      label="Databases sections"
      tabs={[
        { href: databasesHref, label: "Databases", icon: Database, active: false },
        { href: reportsHref, label: "Reports", icon: ChartColumn, active: true },
      ]}
    />
  );
}
