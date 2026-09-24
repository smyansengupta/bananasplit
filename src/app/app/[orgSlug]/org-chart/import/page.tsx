import { ChevronLeft, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DropZone } from "@/components/org-chart/drop-zone";
import { AutoRefresh } from "@/components/org-chart/editor/parse-status";
import { StartDraftButton } from "@/components/org-chart/start-draft-button";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { ACTIVE_PARSE_STATUSES, hasClaudeKey, listVersions, UPLOADS_PER_DAY } from "@/server/org-chart/service";

export const metadata: Metadata = { title: "Import org chart" };

const PARSE_LABEL: Record<string, string> = {
  PENDING: "Waiting",
  EXTRACTING: "Reading the file",
  PARSING: "Claude is reading",
  READY: "Ready to review",
  FAILED: "Failed",
};

/** Import a document (OWNER/ADMIN): the drop zone, recent imports and tips. */
export default async function ImportPage({ params }: PageProps<"/app/[orgSlug]/org-chart/import">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "orgchart.write")) notFound();

  const { keySaved, versions, canSeeIntegrations } = await withOrgTx(organization.id, async (ctx) => ({
    keySaved: await hasClaudeKey(ctx.db, organization.id),
    versions: (await listVersions(ctx)).filter((v) => v.source === "UPLOAD").slice(0, 10),
    canSeeIntegrations: can(ctx, "integrations.view"),
  }));
  const base = `/app/${orgSlug}/org-chart`;
  const active = versions.some(
    (v) => v.status === "DRAFT" && v.parseStatus && (ACTIVE_PARSE_STATUSES as readonly string[]).includes(v.parseStatus),
  );

  return (
    <div className="max-w-3xl space-y-6">
      <AutoRefresh active={active} />
      <div className="space-y-1">
        <Link href={base} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Org Chart
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Import an org chart</h1>
        <p className="text-muted-foreground text-sm">
          Claude reads the document into a draft. Nothing changes for members until you review the draft and publish it.
        </p>
      </div>

      {!keySaved && (
        <div role="status" className="border-warning/40 bg-warning/10 flex gap-3 rounded-lg border p-4 text-sm">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p>
              Importing needs your organization&apos;s own Claude API key.{" "}
              {canSeeIntegrations ? (
                <Link href={`/app/${orgSlug}/settings/integrations`} className="font-medium underline underline-offset-4">
                  Add it in Settings &gt; Integrations
                </Link>
              ) : (
                "Ask an owner or admin to add it in Settings > Integrations"
              )}
              . You can build or edit the chart by hand without one.
            </p>
            <StartDraftButton orgId={organization.id} orgSlug={orgSlug} from="blank">
              Start a blank draft
            </StartDraftButton>
          </div>
        </div>
      )}

      <DropZone orgId={organization.id} orgSlug={orgSlug} disabled={!keySaved} />

      <section className="space-y-2 text-sm">
        <h2 className="font-medium">Tips</h2>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5">
          <li>
            From Google Docs, use File &gt; Download &gt; Microsoft Word (.docx) or PDF. Diagrams survive best in a PDF.
          </li>
          <li>One section per role works best: the title, the person, who they report to, then bullets.</li>
          <li>PDFs can have up to 20 pages. Scanned images without text may not read well.</li>
          <li>
            Each import is a new draft version. Your org can import {UPLOADS_PER_DAY} documents a day, one at a time.
          </li>
          <li>
            The document is sent to Anthropic under your org&apos;s API key to be read. Member emails are never sent; people
            are matched to members here, and you confirm every match.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Recent imports</h2>
        {versions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No documents imported yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    v{v.number} · {v.sourceFilename ?? "document"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {v.createdBy ?? "Someone"} ·{" "}
                    {v.createdAt.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: organization.timezone,
                    })}
                    {v.parseStatus === "FAILED" && v.parseError ? ` · ${v.parseError}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={v.parseStatus === "FAILED" ? "destructive" : "secondary"}>
                    {v.status === "DRAFT" ? (PARSE_LABEL[v.parseStatus ?? "READY"] ?? v.parseStatus) : v.status.toLowerCase()}
                  </Badge>
                  <Link
                    href={v.status === "DRAFT" ? `${base}/drafts/${v.id}` : `${base}/versions/${v.id}`}
                    className="text-primary text-sm underline-offset-4 hover:underline"
                  >
                    {v.status === "DRAFT" ? "Open" : "View"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
