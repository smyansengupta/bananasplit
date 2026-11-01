import { FileUp } from "@/components/icons";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { ChartList } from "@/components/org-chart/chart-list";
import { ChartView } from "@/components/org-chart/chart-view";
import { StartDraftButton } from "@/components/org-chart/start-draft-button";
import { Button } from "@/components/ui/button";
import type { Role } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import { chartTeams } from "@/lib/org-chart/teams";
import type { ChartNodeDTO } from "@/lib/org-chart/types";
import { withOrgTx } from "@/server/db/context";
import { getPublishedOrgChart } from "@/server/org-chart/queries";

import { ChartHeaderActions } from "./chart-header-actions";

export interface OrgChartSection {
  /** "12 positions, 3 teams, version 4, published Oct 2", or null with no chart. */
  summary: string | null;
  /** Edit chart (or Continue draft) and the "…" menu, for editors. */
  actions: ReactNode;
  /** The chart, or the empty state with the ways to start one. */
  body: ReactNode;
}

/**
 * The published org chart as People's Org chart view (?view=chart): the
 * chart from the cached loader (tags.orgChart), the editor's actions, and
 * a one-line summary. ?position={key} opens a position's panel. The caller
 * has already checked membership (getOrgContextBySlug).
 */
export async function loadOrgChartSection({
  orgSlug,
  organization,
  role,
  selectedKey,
}: {
  orgSlug: string;
  organization: { id: string; name: string; timezone: string };
  role: Role | null | undefined;
  selectedKey: string | null;
}): Promise<OrgChartSection> {
  const canEdit = can({ role }, "orgchart.write");
  const chart = await getPublishedOrgChart(organization.id);
  const openDraft = canEdit
    ? await withOrgTx(organization.id, ({ db }) =>
        db.orgChartVersion.findFirst({
          where: { organizationId: organization.id, status: "DRAFT" },
          orderBy: { createdAt: "desc" },
          select: { id: true, number: true },
        }),
      )
    : null;
  const base = `/app/${orgSlug}/org-chart`;
  const draftHref = openDraft ? `${base}/drafts/${openDraft.id}` : null;

  const nodes: ChartNodeDTO[] = (chart?.positions ?? []).map((p) => ({
    id: p.id,
    key: p.key,
    title: p.title,
    personName: p.personName,
    userId: p.userId,
    user: p.user
      ? { id: p.user.id, name: p.user.name, image: p.user.image, avatar: p.user.avatar }
      : null,
    reportsToId: p.reportsToId,
    alsoReportsToIds: p.alsoReportsToIds,
    isOpen: p.isOpen,
    isAdvisor: p.isAdvisor,
    responsibilities: p.responsibilities,
    decidesAlone: p.decidesAlone,
    rank: p.rank,
    teamId: p.teamId,
  }));
  const namedTeams = chart?.teams ?? [];
  const hrefFor = (key: string) =>
    `/app/${orgSlug}/people?view=chart&position=${encodeURIComponent(key)}`;

  const teamCount = chartTeams(nodes, namedTeams).teams.length;
  const openCount = nodes.filter((n) => n.isOpen).length;
  const summary = chart
    ? [
        `${nodes.length} ${nodes.length === 1 ? "position" : "positions"}`,
        teamCount > 0 && `${teamCount} ${teamCount === 1 ? "team" : "teams"}`,
        openCount > 0 && `${openCount} open`,
        `version ${chart.number}${
          chart.publishedAt
            ? `, published ${new Date(chart.publishedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: organization.timezone,
              })}`
            : ""
        }`,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  const actions = (
    <ChartHeaderActions
      orgId={organization.id}
      orgSlug={orgSlug}
      hasChart={Boolean(chart)}
      canEdit={canEdit}
      draft={draftHref && openDraft ? { href: draftHref, number: openDraft.number } : null}
    />
  );

  const body =
    chart && nodes.length > 0 ? (
      <Suspense fallback={<ChartList nodes={nodes} hrefFor={hrefFor} />}>
        <ChartView
          orgId={organization.id}
          orgSlug={orgSlug}
          orgName={organization.name}
          nodes={nodes}
          teams={namedTeams}
          mode="chart"
          canEdit={canEdit}
          draftHref={draftHref}
          listFallback={<ChartList nodes={nodes} hrefFor={hrefFor} selectedKey={selectedKey} />}
        />
      </Suspense>
    ) : (
      <EmptyState
        title={canEdit ? "No org chart yet" : "Not published yet"}
        action={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`${base}/import`}>
                  <FileUp className="size-4" aria-hidden="true" />
                  Import
                </Link>
              </Button>
              {draftHref ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={draftHref}>Continue draft v{openDraft?.number}</Link>
                </Button>
              ) : (
                <>
                  <StartDraftButton
                    orgId={organization.id}
                    orgSlug={orgSlug}
                    from="blank"
                    variant="create"
                  >
                    Type it
                  </StartDraftButton>
                  <StartDraftButton orgId={organization.id} orgSlug={orgSlug} from="members">
                    From members
                  </StartDraftButton>
                  <StartDraftButton orgId={organization.id} orgSlug={orgSlug} from="starter">
                    Template
                  </StartDraftButton>
                </>
              )}
            </div>
          ) : undefined
        }
      />
    );

  return { summary, actions, body };
}
