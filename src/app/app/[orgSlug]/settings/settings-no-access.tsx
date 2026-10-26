import { Lock } from "@/components/icons";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

/** Shown on a settings page the viewer's role cannot use. */
export function SettingsNoAccess({ title, who }: { title: string; who: string }) {
  return (
    <div className="space-y-7.5">
      <PageHeader title={title} />
      <Card>
        <EmptyState
          icon={Lock}
          title={`Only ${who} can manage this.`}
          description="Ask one of them if something here needs changing."
        />
      </Card>
    </div>
  );
}
