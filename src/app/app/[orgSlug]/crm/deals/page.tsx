import Link from "next/link";

import { CrmHeader } from "@/components/crm/chrome/crm-header";
import { CrmToolbar } from "@/components/crm/chrome/crm-toolbar";
import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { EmptyState } from "@/components/empty-state";
import { crmPipelineHref } from "@/lib/crm/href";

import { crmShell } from "../shell";

export const metadata = { title: "Deals" };

/**
 * Deals (docs/features/crm.md, "Redesign"): for now, each pipeline's board
 * and the reports that belong here, and the deal card over the page
 * (?open=deal:<id>, where old item links land). The grouped list and the
 * board come next on this page.
 */
export default async function CrmDealsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/deals">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | string[] | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const base = `/app/${orgSlug}/crm`;
  return (
    <div>
      <CrmHeader
        orgSlug={orgSlug}
        settings={shell.access.manager}
        toolbar={<CrmToolbar tabs={shell.tabs} />}
      />
      {shell.pipelines.length === 0 ? (
        <EmptyState title="No pipelines yet" description="Add one in CRM settings." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shell.pipelines.map((p) => (
            <Link
              key={p.id}
              href={crmPipelineHref(orgSlug, p.id)}
              className="bg-card ring-foreground/6 hover:bg-muted/50 flex flex-col gap-1 rounded-[22px] p-5 ring-1"
            >
              <b className="text-[15px]">{p.name}</b>
              <span className="text-muted-foreground text-[13px]">{p.stages.length} stages</span>
            </Link>
          ))}
          <Link
            href={`${base}/forecast`}
            className="bg-card ring-foreground/6 hover:bg-muted/50 flex flex-col gap-1 rounded-[22px] p-5 ring-1"
          >
            <b className="text-[15px]">Forecast and goals</b>
            <span className="text-muted-foreground text-[13px]">
              What&apos;s likely to close, and how far along each goal is
            </span>
          </Link>
          <Link
            href={`${base}/quotes`}
            className="bg-card ring-foreground/6 hover:bg-muted/50 flex flex-col gap-1 rounded-[22px] p-5 ring-1"
          >
            <b className="text-[15px]">Quotes</b>
            <span className="text-muted-foreground text-[13px]">
              Every quote sent, and where it stands
            </span>
          </Link>
        </div>
      )}
      <CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />
    </div>
  );
}
