import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { RELEASES, type Release } from "@/lib/changelog/releases";

export const metadata: Metadata = { title: "What's new" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

function ReleaseBody({ release }: { release: Release }) {
  return (
    <div className="space-y-4">
      {release.summary && <p className="text-muted-foreground text-sm">{release.summary}</p>}
      {release.sections.map((section) => (
        <div key={section.kind} className="space-y-1.5">
          <h3 className="text-sm font-medium">{section.kind}</h3>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ReleaseHeading({ release }: { release: Release }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="bg-muted rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums">
        v{release.version}
      </span>
      <span className="font-medium">{release.title}</span>
      <span className="text-muted-foreground text-xs">
        {dateFormat.format(new Date(`${release.date}T00:00:00Z`))}
      </span>
    </span>
  );
}

export default function WhatsNewPage() {
  return (
    <div className="space-y-7.5">
      <PageHeader
        title="What's new"
        description="What each version of Bananasplit added, improved and fixed."
      />
      <div className="space-y-3">
        {RELEASES.map((release, i) => (
          <Card key={release.version} className="p-0">
            <details open={i === 0} className="group">
              <summary className="cursor-pointer list-none px-5 py-4">
                <ReleaseHeading release={release} />
              </summary>
              <div className="px-5 pb-5">
                <ReleaseBody release={release} />
              </div>
            </details>
          </Card>
        ))}
      </div>
    </div>
  );
}
