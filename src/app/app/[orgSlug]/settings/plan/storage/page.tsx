import type { Metadata } from "next";
import Link from "next/link";

import { StorageBanner } from "@/components/billing/storage-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MixBar } from "@/components/ui/meters";
import { PLAN_NAMES } from "@/lib/billing/features";
import { spaceLimits } from "@/lib/billing/space";
import { formatStorage, formatUsed, storageLevel } from "@/lib/billing/storage";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { canManageStorage, readStorageUsed } from "@/server/storage/quota";
import { largestFiles, storageBreakdown } from "@/server/storage/usage";

import { SettingsNoAccess } from "../../settings-no-access";
import { PlanHeader } from "../plan-header";
import { EmptyTrashButton } from "./empty-trash-button";

export const metadata: Metadata = { title: "Storage" };

/**
 * Settings › Plan and storage › Storage (redesign guide 11.2): the meter
 * (files, receipts, note history, trash, and what's free), the largest
 * files, and Empty trash, the one destructive button. Owners and admins,
 * or the Personal owner. The headline is Organization.storageUsedBytes,
 * which the upload gate reads; the parts are re-added from the rows.
 */
export default async function StoragePage({
  params,
}: PageProps<"/app/[orgSlug]/settings/plan/storage">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!canManageStorage(role)) {
    return <SettingsNoAccess title="Storage" who="owners and admins" />;
  }
  const personal = organization.kind === "PERSONAL";
  const limits = spaceLimits(organization);
  const [usedBytes, parts, biggest] = await Promise.all([
    readStorageUsed(organization.id),
    storageBreakdown(organization.id),
    withOrgTx(organization.id, ({ db }) => largestFiles(db, organization.id)),
  ]);
  const limit = limits.storageBytes;
  const free = Math.max(0, limit - usedBytes);
  const level = storageLevel(usedBytes, limit);
  const base = `/app/${organization.slug}`;

  const segments = [
    { label: "Files", value: parts.filesBytes, color: "var(--chart-1)" },
    { label: "Receipts", value: parts.receiptsBytes, color: "var(--chart-2)" },
    { label: "Note history", value: parts.noteHistoryBytes, color: "var(--chart-3)" },
    { label: "Trash", value: parts.trashBytes, color: "var(--chart-4)" },
    { label: "Free", value: free, hatch: true },
  ].filter((s) => !(personal && s.label === "Receipts"));

  return (
    <div className="max-w-4xl space-y-7.5">
      <PlanHeader
        orgSlug={organization.slug}
        description={
          personal
            ? "What your notes and files use, and room to grow."
            : "What your organization's files, receipts and notes use."
        }
      />

      <StorageBanner
        orgSlug={organization.slug}
        usedBytes={usedBytes}
        limitBytes={limit}
        canManage
        personal={personal}
        showLink={false}
      />

      <section className="bg-card edge rounded-card space-y-6 p-6 max-sm:p-4.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="heading">Storage</h2>
          <Badge variant="secondary">{PLAN_NAMES[organization.plan]}</Badge>
          <span className="flex-1" />
          <Button asChild variant="outline" size="sm">
            <Link href={`${base}/settings/plan`}>Change plan</Link>
          </Button>
        </div>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={level === "full" ? "numeral text-destructive text-4xl" : "numeral text-4xl"}
          >
            {formatUsed(usedBytes, limit)}
          </span>
          <span className="text-muted-foreground">of {formatStorage(limit)} used</span>
        </p>
        <MixBar
          segments={segments}
          label={segments.map((s) => `${s.label} ${formatStorage(s.value)}`).join(", ")}
          height={28}
          legend={false}
        />
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          {segments.map((s) => (
            <li key={s.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                style={{ background: s.hatch ? undefined : s.color }}
                className={
                  s.hatch ? "bg-muted-strong size-2.5 rounded-[3px]" : "size-2.5 rounded-[3px]"
                }
              />
              {s.label} <b className="figure font-semibold">{formatStorage(s.value)}</b>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          {formatStorage(free)} free · up to {formatStorage(limits.maxFileBytes)} per file. Nothing
          is ever deleted for being over: uploads stop at 100% until there&apos;s room again.
        </p>
      </section>

      <section className="bg-card edge rounded-card space-y-3 p-6 max-sm:p-4.5">
        <div className="flex items-center gap-2">
          <h2 className="heading">Largest files</h2>
          {biggest.length > 0 && <Badge variant="secondary">{biggest.length}</Badge>}
        </div>
        {biggest.length === 0 ? (
          <p className="text-muted-foreground text-sm">No files yet.</p>
        ) : (
          <ul className="divide-border/60 divide-y">
            {biggest.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2.5 text-sm">
                <Link
                  href={`${base}/notes/files/${f.id}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {f.name}
                </Link>
                <span className="figure text-muted-foreground">{formatStorage(f.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card edge rounded-card flex flex-wrap items-center gap-3 p-6 max-sm:p-4.5">
        <div className="min-w-0 flex-1">
          <h2 className="heading">
            Trash, {parts.trashItems} {parts.trashItems === 1 ? "item" : "items"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {formatStorage(parts.trashBytes)}. Deleted notes and files count until the trash is
            emptied.
          </p>
        </div>
        <EmptyTrashButton
          orgId={organization.id}
          items={parts.trashItems}
          size={formatStorage(parts.trashBytes)}
        />
      </section>
    </div>
  );
}
