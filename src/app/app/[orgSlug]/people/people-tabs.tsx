"use client";

import { Network, Users } from "@/components/icons";

import { PageTabs } from "@/components/ui/page-tabs";

/**
 * People is one section with two pages: the member directory and the org
 * chart (its own URL, /org-chart, so old links and pins still work).
 */
export function PeopleTabs({ orgSlug }: { orgSlug: string }) {
  const base = `/app/${orgSlug}`;
  return (
    <PageTabs
      label="People"
      tabs={[
        { href: `${base}/people`, label: "Directory", icon: Users },
        { href: `${base}/org-chart`, label: "Org chart", icon: Network },
      ]}
    />
  );
}
