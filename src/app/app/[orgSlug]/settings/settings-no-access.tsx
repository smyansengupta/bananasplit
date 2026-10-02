import { EmptyState } from "@/components/empty-state";

/** Shown on a settings page the viewer's role cannot use. */
export function SettingsNoAccess({ title, who }: { title: string; who: string }) {
  return (
    <div className="space-y-6">
      <h1 className="page-title">{title}</h1>
      <EmptyState title={`Only ${who} can manage this.`} />
    </div>
  );
}
