import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { DropZone } from "@/components/org-chart/drop-zone";
import { AutoRefresh } from "@/components/org-chart/editor/parse-status";
import { StartDraftButton } from "@/components/org-chart/start-draft-button";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { claudeModelLabel, estimateParseCostUsd, formatUsd } from "@/lib/org-chart/models";
import { STARTER_ROLE_COUNT } from "@/lib/org-chart/starter";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getClaudeKeyStatus } from "@/server/org-chart/claude";
import { ACTIVE_PARSE_STATUSES, listVersions } from "@/server/org-chart/service";
import { planGate } from "@/server/billing/plan-gate";

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
 * Import a document (any member): the drop zone, the starter structure for
 * an org with nothing to upload, recent imports and what reads best.
 *
 * No Claude API key is needed. Bananasplit's own parser reads the document
 * when the upload arrives; a key only buys a second opinion on a document it
 * cannot make sense of.
 */
export default async function ImportPage({ params }: PageProps<"/app/[orgSlug]/org-chart/import">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "people");
  if (planLock) return planLock;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "orgchart.write")) notFound();

  const versions = await withOrgTx(organization.id, async (ctx) =>
    (await listVersions(ctx)).filter((v) => v.source === "UPLOAD").slice(0, 10),
  );
  const { saved: keySaved, model } = await getClaudeKeyStatus(organization.id);
  const canSeeIntegrations = can({ role }, "integrations.view");
  const base = `/app/${orgSlug}/org-chart`;
  const active = versions.some(
    (v) =>
      v.status === "DRAFT" &&
      v.parseStatus &&
      (ACTIVE_PARSE_STATUSES as readonly string[]).includes(v.parseStatus),
  );
  const perParse = estimateParseCostUsd(model);

  return (
    <div className="max-w-3xl space-y-6">
      <AutoRefresh active={active} />
      <div className="space-y-1">
        <BackLink href={base} label="Org chart" />
        <h1 className="page-title">Import an org chart</h1>
      </div>

      <DropZone orgId={organization.id} orgSlug={orgSlug} />

      <p className="text-muted-foreground text-sm">
        Word, text or Markdown read free; PDFs need a Claude key.
        {keySaved && perParse !== null
          ? ` A document Bananasplit can't read goes to ${claudeModelLabel(model)}, about ${formatUsd(perParse)} each.`
          : ""}{" "}
        {canSeeIntegrations && (
          <Link
            href={`/app/${orgSlug}/integrations/claude`}
            className="text-foreground underline underline-offset-4"
          >
            {keySaved ? "Change the model" : "Add a key"}
          </Link>
        )}
      </p>

      <section aria-labelledby="start-heading" className="space-y-2.5">
        <h2 id="start-heading" className="heading text-[15px]">
          Nothing to upload?
        </h2>
        <div className="flex flex-wrap gap-2">
          <StartDraftButton
            orgId={organization.id}
            orgSlug={orgSlug}
            from="blank"
            variant="outline"
          >
            Type it
          </StartDraftButton>
          <StartDraftButton
            orgId={organization.id}
            orgSlug={orgSlug}
            from="members"
            variant="outline"
          >
            From members
          </StartDraftButton>
          <StartDraftButton
            orgId={organization.id}
            orgSlug={orgSlug}
            from="starter"
            variant="outline"
          >
            Template
          </StartDraftButton>
        </div>
        <p className="text-muted-foreground text-[13px]">
          Template: {STARTER_ROLE_COUNT} common roles to fill in. Nothing changes for members until
          you publish.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Recent imports</h2>
        {versions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No documents imported yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    v{v.number}, {v.sourceFilename ?? "document"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {v.createdBy ?? "Someone"},{" "}
                    {v.createdAt.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: organization.timezone,
                    })}
                    {v.parseMethod === "BUILTIN" && v.parseConfidence !== null
                      ? `, ${Math.round(v.parseConfidence * 100)}% understood`
                      : ""}
                    {v.parseStatus === "FAILED" && v.parseError ? `, ${v.parseError}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {v.parseMethod && (
                    <Badge variant="outline">{READER_LABEL[v.parseMethod] ?? v.parseMethod}</Badge>
                  )}
                  <Badge variant={v.parseStatus === "FAILED" ? "destructive" : "secondary"}>
                    {v.status === "DRAFT"
                      ? (PARSE_LABEL[v.parseStatus ?? "READY"] ?? v.parseStatus)
                      : v.status.toLowerCase()}
                  </Badge>
                  <Link
                    href={
                      v.status === "DRAFT" ? `${base}/drafts/${v.id}` : `${base}/versions/${v.id}`
                    }
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
