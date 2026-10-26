"use client";

import { Copy, Download, FileJson, Upload } from "@/components/icons";

import { ItemMenu, type ItemMenuEntry } from "@/components/item-menu";

import { useViewParams } from "./view-params";

/** Starts a download without leaving the page (the route answers with an attachment). */
function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * The "…" in a database's header: Export CSV for everyone, and for admins
 * the setup pages (CSV import, possible duplicates, poll definitions) that
 * used to sit beside the table as buttons. Plain props only: the server
 * page passes hrefs, this builds the entries.
 *
 * The table export carries the current view's query (filters, search,
 * sort, date range) and its visible columns, the same as the page shows;
 * `exportResultsHref` is the Ballots results pivot, already complete.
 */
export function DatabaseMenu({
  name,
  exportHref,
  exportColumns,
  exportResultsHref,
  importHref,
  duplicatesHref,
  definitionsHref,
}: {
  name: string;
  exportHref?: string;
  /** Visible column keys, written as cols= when the URL has none. */
  exportColumns?: string[];
  exportResultsHref?: string | null;
  importHref?: string;
  duplicatesHref?: string;
  definitionsHref?: string;
}) {
  const view = useViewParams();

  const tableExport = () => {
    if (!exportHref) return;
    const p = new URLSearchParams(view.params.toString());
    p.delete("row");
    p.delete("page");
    if (!p.get("cols") && exportColumns?.length) p.set("cols", exportColumns.join(","));
    const qs = p.toString();
    download(qs ? `${exportHref}?${qs}` : exportHref);
  };

  const exportEntry: ItemMenuEntry = exportResultsHref
    ? { label: "Export results CSV", icon: Download, onSelect: () => download(exportResultsHref) }
    : exportHref
      ? { label: "Export CSV", icon: Download, onSelect: tableExport }
      : null;
  // Setup pages: one per database kind, in their own group under the export.
  const separated = Boolean(exportEntry);
  const items: ItemMenuEntry[] = [
    exportEntry,
    importHref ? { label: "Import CSV", icon: Upload, href: importHref, separated } : null,
    duplicatesHref
      ? { label: "Possible duplicates", icon: Copy, href: duplicatesHref, separated }
      : null,
    definitionsHref
      ? { label: "Poll definitions", icon: FileJson, href: definitionsHref, separated }
      : null,
  ];

  return <ItemMenu label={`More actions for ${name}`} items={items} className="border-input" />;
}
