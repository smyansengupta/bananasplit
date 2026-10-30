"use client";

import { PageTabs } from "@/components/ui/page-tabs";

export type MeetingsView = "upcoming" | "find" | "past";

/**
 * Meetings' views, the same switch bar every section uses (Tasks' layouts,
 * Finance's pages): what's coming up, Find a time, and what's past. Find a
 * time lives under Meetings now (it is how a meeting gets its date), so its
 * pages show this bar too, with its tab lit. Past is only there for the
 * people who see past meetings (owners and admins).
 */
export function MeetingsTabs({
  orgSlug,
  current,
  showPast,
  counts,
}: {
  orgSlug: string;
  current: MeetingsView;
  showPast: boolean;
  counts?: Partial<Record<MeetingsView, number>>;
}) {
  const base = `/app/${orgSlug}`;
  const label = (text: string, view: MeetingsView) =>
    counts?.[view] ? `${text} ${counts[view]}` : text;
  return (
    <PageTabs
      label="Meetings"
      tabs={[
        {
          href: `${base}/meetings`,
          label: label("Coming up", "upcoming"),
          active: current === "upcoming",
        },
        {
          href: `${base}/calendar/find-a-time`,
          label: label("Find a time", "find"),
          active: current === "find",
        },
        ...(showPast
          ? [
              {
                href: `${base}/meetings?view=past`,
                label: label("Past", "past"),
                active: current === "past",
              },
            ]
          : []),
      ]}
    />
  );
}
