"use client";

import { Library, NotebookText, Upload } from "@/components/icons";
import { usePathname, useSearchParams } from "next/navigation";

import { PageTabs } from "@/components/ui/page-tabs";

const TABS = [
  { tab: null, label: "All", icon: Library },
  { tab: "notes", label: "Notes", icon: NotebookText },
  // `tab=files` keeps its old name, so existing links still land on uploads.
  { tab: "files", label: "Uploads", icon: Upload },
] as const;

/**
 * Files' views as tabs, as every section's are: All, Notes and Uploads. Each
 * keeps the folder, search, filters and order you're on.
 */
export function FilesTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("tab");
  const kind = current === "notes" || current === "files" ? current : null;

  const href = (tab: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (tab) next.set("tab", tab);
    else next.delete("tab");
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <PageTabs
      label="Show"
      tabs={TABS.map((t) => ({
        href: href(t.tab),
        label: t.label,
        icon: t.icon,
        active: kind === t.tab,
      }))}
    />
  );
}
