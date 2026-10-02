import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RollbackButton } from "@/components/org-chart/rollback-button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listVersions, type VersionSummary } from "@/server/org-chart/service";

export const metadata: Metadata = { title: "Org chart versions" };

const SOURCE: Record<string, string> = { UPLOAD: "Imported", MANUAL: "Edited", ROLLBACK: "Restored", SEED: "Seed" };

/** Which reader produced the version, shown next to its source. */
const READER: Record<string, string> = {
  BUILTIN: "read here",
  CLAUDE: "read by Claude",
  TEMPLATE: "club template",
  MANUAL: "by hand",
};

function statusBadge(v: VersionSummary) {
  if (v.isActive) return <Badge>Published</Badge>;
  if (v.status === "DRAFT") {
    if (v.parseStatus === "FAILED") return <Badge variant="destructive">Import failed</Badge>;
    if (v.parseStatus && v.parseStatus !== "READY") return <Badge variant="secondary">Reading…</Badge>;
    return <Badge variant="secondary">Draft</Badge>;
  }
  if (v.status === "DISCARDED") return <Badge variant="outline">Discarded</Badge>;
  return <Badge variant="outline">Archived</Badge>;
}

/** Every version of the chart (OWNER/ADMIN), newest first, with view, compare and restore. */
export default async function VersionsPage({ params }: PageProps<"/app/[orgSlug]/org-chart/versions">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "orgchart.write")) notFound();

  const versions = await withOrgTx(organization.id, (ctx) => listVersions(ctx));
  const base = `/app/${orgSlug}/org-chart`;
  const fmt = (d: Date | null) =>
    d
      ? d.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: organization.timezone,
        })
      : "—";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href={base} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Org Chart
        </Link>
        <h1 className="page-title">Version history</h1>
        <p className="text-muted-foreground text-sm">
          Every import and edit is a numbered version. Restoring copies an old version forward and publishes it; nothing is
          deleted.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Source</TableHead>
              <TableHead className="hidden sm:table-cell">Positions</TableHead>
              <TableHead className="hidden lg:table-cell">Created</TableHead>
              <TableHead className="hidden lg:table-cell">Published</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">
                  v{v.number}
                  {v.sourceFilename && (
                    <span className="text-muted-foreground block max-w-48 truncate text-xs font-normal">
                      {v.sourceFilename}
                    </span>
                  )}
                </TableCell>
                <TableCell>{statusBadge(v)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {SOURCE[v.source] ?? v.source}
                  {v.parseMethod && (
                    <span className="text-muted-foreground block text-xs">
                      {READER[v.parseMethod] ?? v.parseMethod}
                      {v.parseMethod === "BUILTIN" && v.parseConfidence !== null
                        ? `, ${Math.round(v.parseConfidence * 100)}% understood`
                        : ""}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{v.positions}</TableCell>
                <TableCell className="hidden text-sm lg:table-cell">
                  {fmt(v.createdAt)}
                  {v.createdBy && <span className="text-muted-foreground block text-xs">{v.createdBy}</span>}
                </TableCell>
                <TableCell className="hidden text-sm lg:table-cell">
                  {fmt(v.publishedAt)}
                  {v.publishedBy && <span className="text-muted-foreground block text-xs">{v.publishedBy}</span>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-2">
                    {v.status === "DRAFT" ? (
                      <Link href={`${base}/drafts/${v.id}`} className="text-primary text-sm underline-offset-4 hover:underline">
                        Open draft
                      </Link>
                    ) : (
                      <Link href={`${base}/versions/${v.id}`} className="text-primary text-sm underline-offset-4 hover:underline">
                        View{!v.isActive && v.status !== "DISCARDED" ? " and compare" : ""}
                      </Link>
                    )}
                    {!v.isActive && (v.status === "ARCHIVED" || v.status === "PUBLISHED") && (
                      <RollbackButton orgId={organization.id} orgSlug={orgSlug} versionId={v.id} number={v.number} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
