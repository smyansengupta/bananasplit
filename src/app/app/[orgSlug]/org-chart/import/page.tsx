import { BookOpenText, ChevronLeft, Cpu, LayoutTemplate } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DropZone } from "@/components/org-chart/drop-zone";
import { AutoRefresh } from "@/components/org-chart/editor/parse-status";
import { StartDraftButton } from "@/components/org-chart/start-draft-button";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { claudeModelLabel, estimateParseCostUsd, formatUsd } from "@/lib/org-chart/models";
import { STARTER_ROLE_COUNT } from "@/lib/org-chart/starter";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { readClaudeSettings } from "@/server/org-chart/claude";
import { ACTIVE_PARSE_STATUSES, hasClaudeKey, listVersions, UPLOADS_PER_DAY } from "@/server/org-chart/service";

export const metadata: Metadata = { title: "Import org chart" };

const PARSE_LABEL: Record<string, string> = {
  PENDING: "Waiting",
  EXTRACTING: "Reading the file",
  PARSING: "Claude is reading",
  READY: "Ready to review",
  FAILED: "Failed",
};

const READER_LABEL: Record<string, string> = {
  BUILTIN: "Read here",
  CLAUDE: "Read by Claude",
  TEMPLATE: "Template",
  MANUAL: "By hand",
};

/**
 * Import a document (OWNER/ADMIN): the drop zone, the starter structure for
 * an org with nothing to upload, recent imports and what reads best.
 *
 * No Claude API key is needed. The portal's own parser reads the document
 * when the upload arrives; a key only buys a second opinion on a document it
 * cannot make sense of.
 */
export default async function ImportPage({ params }: PageProps<"/app/[orgSlug]/org-chart/import">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "orgchart.write")) notFound();

  const { keySaved, versions, canSeeIntegrations, model } = await withOrgTx(organization.id, async (ctx) => {
    const integration = await ctx.db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: organization.id, provider: "CLAUDE" } },
      select: { config: true },
    });
    return {
      keySaved: await hasClaudeKey(ctx.db, organization.id),
      versions: (await listVersions(ctx)).filter((v) => v.source === "UPLOAD").slice(0, 10),
      canSeeIntegrations: can(ctx, "integrations.view"),
      model: readClaudeSettings((integration?.config as Record<string, unknown> | null) ?? {}).model,
    };
  });
  const base = `/app/${orgSlug}/org-chart`;
  const active = versions.some(
    (v) => v.status === "DRAFT" && v.parseStatus && (ACTIVE_PARSE_STATUSES as readonly string[]).includes(v.parseStatus),
  );
  const perParse = estimateParseCostUsd(model);

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
          The portal reads your document into a draft. Nothing changes for members until you review the draft and
          publish it.
        </p>
      </div>

      <DropZone orgId={organization.id} orgSlug={orgSlug} />

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 rounded-lg border p-4 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <BookOpenText className="size-4" aria-hidden="true" />
            Read here first, free
          </p>
          <p className="text-muted-foreground">
            The portal understands indented outlines, drawn trees, a section per role with a &ldquo;Reports to&rdquo;
            line, heading hierarchies and simple tables. No API key, no cost, and the draft is ready as soon as the
            upload finishes.
          </p>
        </div>
        <div className="space-y-1.5 rounded-lg border p-4 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <Cpu className="size-4" aria-hidden="true" />
            Claude as the backup
          </p>
          {keySaved ? (
            <p className="text-muted-foreground">
              A document the portal cannot make sense of is sent to {claudeModelLabel(model)} under your own API key.
              {perParse !== null ? ` That costs about ${formatUsd(perParse)} per import.` : ""}{" "}
              {canSeeIntegrations && (
                <Link href={`/app/${orgSlug}/settings/integrations/claude`} className="underline underline-offset-4">
                  Change the model
                </Link>
              )}
            </p>
          ) : (
            <p className="text-muted-foreground">
              Your org has no Claude API key, which is fine: uploads still work. A key only helps with a document the
              portal cannot make sense of on its own, and with PDFs.{" "}
              {canSeeIntegrations && (
                <Link href={`/app/${orgSlug}/settings/integrations/claude`} className="underline underline-offset-4">
                  Add a key in Settings
                </Link>
              )}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2 rounded-lg border p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <LayoutTemplate className="size-4" aria-hidden="true" />
          Nothing to upload?
        </p>
        <p className="text-muted-foreground text-sm">
          Start from the club template: {STARTER_ROLE_COUNT} roles a student club usually has (President, VPs, Heads, an
          advisor and an open hire), already laid out with responsibilities written in. Fill in the people, change what
          does not fit and delete the rest.
        </p>
        <div className="flex flex-wrap gap-2">
          <StartDraftButton orgId={organization.id} orgSlug={orgSlug} from="starter" variant="default">
            Start from the club template
          </StartDraftButton>
          <StartDraftButton orgId={organization.id} orgSlug={orgSlug} from="blank" variant="outline">
            Start a blank draft
          </StartDraftButton>
        </div>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="font-medium">Tips</h2>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5">
          <li>
            What reads best: one section per role with its title, the person, a &ldquo;Reports to&rdquo; line, then
            bullets, and a &ldquo;Decides alone&rdquo; line. Mark vacancies (&ldquo;Open hire&rdquo;) and advisors.
          </li>
          <li>
            From Google Docs, use File &gt; Download &gt; Microsoft Word (.docx) or PDF. A .docx or text file reads here
            for free; a PDF needs a Claude key, because its text cannot be read in the portal.
          </li>
          <li>Each import is a new draft version. Your org can send {UPLOADS_PER_DAY} documents a day to Claude.</li>
          <li>
            Every draft shows which reader produced it and which lines it could not place, and nothing is published
            until you review it.
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
                    {v.parseMethod === "BUILTIN" && v.parseConfidence !== null
                      ? ` · ${Math.round(v.parseConfidence * 100)}% understood`
                      : ""}
                    {v.parseStatus === "FAILED" && v.parseError ? ` · ${v.parseError}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {v.parseMethod && <Badge variant="outline">{READER_LABEL[v.parseMethod] ?? v.parseMethod}</Badge>}
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
