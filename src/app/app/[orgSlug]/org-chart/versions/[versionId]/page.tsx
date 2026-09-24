import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChartList } from "@/components/org-chart/chart-list";
import { RollbackButton } from "@/components/org-chart/rollback-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { diffCharts, type DiffChange, type DiffPosition } from "@/lib/org-chart/diff";
import { personLabel, type ChartNodeDTO } from "@/lib/org-chart/types";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listVersions, loadVersion, type VersionDetail } from "@/server/org-chart/service";

export const metadata: Metadata = { title: "Org chart version" };

function toNodes(detail: VersionDetail): ChartNodeDTO[] {
  return detail.positions.map((p) => ({
    id: p.id,
    key: p.key,
    title: p.title,
    personName: p.personName,
    userId: p.userId,
    user: p.user ? { id: p.user.id, name: p.user.name, image: p.user.image, avatar: p.user.avatar } : null,
    reportsToId: p.reportsToId,
    isOpen: p.isOpen,
    isAdvisor: p.isAdvisor,
    responsibilities: p.responsibilities,
    decidesAlone: p.decidesAlone,
    rank: p.rank,
  }));
}

function toDiff(detail: VersionDetail): DiffPosition[] {
  const byId = new Map(detail.positions.map((p) => [p.id, p]));
  return toNodes(detail).map((n) => ({
    key: n.key,
    title: n.title,
    reportsToKey: n.reportsToId ? (byId.get(n.reportsToId)?.key ?? null) : null,
    userId: n.userId,
    personLabel: personLabel(n),
    personName: n.isOpen ? null : (n.user?.name ?? n.personName),
    isOpen: n.isOpen,
    isAdvisor: n.isAdvisor,
    responsibilities: n.responsibilities,
    decidesAlone: n.decidesAlone,
  }));
}

function describe(change: DiffChange): string {
  switch (change.type) {
    case "added":
      return `Added ${change.title} (${change.person})`;
    case "removed":
      return `Removed ${change.title} (${change.person})`;
    case "retitled":
      return `Renamed ${change.from} to ${change.to}`;
    case "reparented":
      return `${change.title} now reports to ${change.to ?? "nobody (top of the chart)"} instead of ${change.from ?? "nobody"}`;
    case "person":
      return `${change.title}: ${change.from} → ${change.to}`;
    case "advisor":
      return `${change.title} is ${change.value ? "now an advisor" : "no longer an advisor"}`;
    case "content": {
      const field = change.field === "responsibilities" ? "responsibilities" : "decides alone";
      const parts = [
        change.added.length ? `${change.added.length} added` : "",
        change.removed.length ? `${change.removed.length} removed` : "",
      ].filter(Boolean);
      return `${change.title}: ${field} changed (${parts.join(", ")})`;
    }
  }
}

/** A read-only version (OWNER/ADMIN) with a diff against another version (?compare=). */
export default async function VersionPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/org-chart/versions/[versionId]">) {
  const { orgSlug, versionId } = await params;
  const query = await searchParams;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "orgchart.write")) notFound();

  const data = await withOrgTx(organization.id, async (ctx) => {
    const detail = await loadVersion(ctx, versionId);
    if (!detail) return null;
    const versions = await listVersions(ctx);
    const requested = typeof query.compare === "string" ? query.compare : null;
    const fallback =
      versions.find((v) => v.isActive && v.id !== versionId)?.id ??
      detail.version.basedOnVersionId ??
      versions.find((v) => v.number < detail.version.number && v.status !== "DISCARDED")?.id ??
      null;
    const compareId = requested && requested !== versionId ? requested : fallback;
    const other = compareId ? await loadVersion(ctx, compareId) : null;
    return { detail, versions, other };
  });
  if (!data) notFound();
  const { detail, versions, other } = data;
  const { version } = detail;
  const base = `/app/${orgSlug}/org-chart`;

  // Changes from the compared version (older state) to this one.
  const olderFirst = other ? other.version.number < version.number : true;
  const changes = other
    ? olderFirst
      ? diffCharts(toDiff(other), toDiff(detail))
      : diffCharts(toDiff(detail), toDiff(other))
    : [];
  const from = other ? (olderFirst ? other.version.number : version.number) : null;
  const to = other ? (olderFirst ? version.number : other.version.number) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`${base}/versions`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Version history
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            Version {version.number}
            {version.isActive ? <Badge>Published</Badge> : <Badge variant="outline">{version.status.toLowerCase()}</Badge>}
          </h1>
          <p className="text-muted-foreground text-sm">{detail.positions.length} positions</p>
        </div>
        {!version.isActive && (version.status === "ARCHIVED" || version.status === "PUBLISHED") && (
          <RollbackButton orgId={organization.id} orgSlug={orgSlug} versionId={version.id} number={version.number} />
        )}
      </div>

      <section className="space-y-3 rounded-xl border p-4">
        <form className="flex flex-wrap items-center gap-2" method="get">
          <label htmlFor="compare" className="text-sm font-medium">
            Compare with
          </label>
          <select
            id="compare"
            name="compare"
            defaultValue={other?.version.id ?? ""}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          >
            {versions
              .filter((v) => v.id !== version.id)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.number}
                  {v.isActive ? " (published)" : ` (${v.status.toLowerCase()})`}
                </option>
              ))}
          </select>
          <Button type="submit" size="sm" variant="outline">
            Compare
          </Button>
        </form>
        {other ? (
          changes.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No differences between v{from} and v{to}.
            </p>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">
                From v{from} to v{to}: {changes.length} change{changes.length === 1 ? "" : "s"}
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {changes.map((c, i) => (
                  <li key={i}>{describe(c)}</li>
                ))}
              </ul>
            </div>
          )
        ) : (
          <p className="text-muted-foreground text-sm">There is no other version to compare with.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Positions in version {version.number}</h2>
        {detail.positions.length === 0 ? (
          <p className="text-muted-foreground text-sm">This version has no positions.</p>
        ) : (
          <ChartList nodes={toNodes(detail)} className="max-w-3xl" />
        )}
      </section>
    </div>
  );
}
