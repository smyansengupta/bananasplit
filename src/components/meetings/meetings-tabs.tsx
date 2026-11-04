"use client";

import { PageTabs } from "@/components/ui/page-tabs";

export type MeetingsView = "upcoming" | "find" | "booking";

/**
 * Meetings' views, the same switch bar every section uses (Tasks' layouts,
 * Finance's pages): the meetings themselves (coming up, with what's past in
 * a list right under them), Find a time, which lives under Meetings now
 * (it is how a meeting gets its date), so its pages show this bar too, and
 * Meeting links (your own link and the organization's; docs/features/booking.md).
 */
export function MeetingsTabs({
  orgSlug,
  current,
  counts,
}: {
  orgSlug: string;
  current: MeetingsView;
  counts?: Partial<Record<MeetingsView, number>>;
}) {
  const base = `/app/${orgSlug}`;
  return (
    <PageTabs
      label="Meetings"
      tabs={[
        {
          href: `${base}/meetings`,
          label: "Meetings",
          count: counts?.upcoming,
          active: current === "upcoming",
        },
        {
          href: `${base}/calendar/find-a-time`,
          label: "Find a time",
          count: counts?.find,
          active: current === "find",
        },
        {
          href: `${base}/meetings/booking`,
          label: "Meeting links",
          count: counts?.booking,
          active: current === "booking",
        },
      ]}
    />
  );
}
