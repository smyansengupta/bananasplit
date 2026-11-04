"use client";

import { Link2, Loader2 } from "@/components/icons";
import Link from "next/link";
import { useEffect, useState } from "react";

import { linkedFromAction } from "@/app/app/[orgSlug]/databases/custom-actions";
import type { RelationRef } from "@/lib/databases/fields";
import type { LinkedGroup, LinkedRollup } from "@/server/databases/relations";

/**
 * "Linked from": the rows of other databases (and the CRM's own) whose
 * Relation fields point here, grouped by database and field, with each
 * group's count and its totals (the sum of its number and money fields,
 * the latest of its dates). Takes the groups linkedFrom()
 * (src/server/databases/relations.ts) already loaded, so a server page
 * (a CRM record) renders it straight; LinkedFromLoader fetches them for a
 * row opened in a database's grid.
 */

function rollupText(r: LinkedRollup): string {
  if (r.kind === "latest") {
    const d = new Date(`${r.value}T00:00:00Z`);
    const day = Number.isNaN(d.getTime())
      ? String(r.value)
      : d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        });
    return `Latest ${r.fieldName.toLowerCase()} ${day}`;
  }
  const n = typeof r.value === "number" ? r.value : Number(r.value);
  const amount = r.money
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return `${r.fieldName} ${amount} in all`;
}

export function LinkedFrom({
  groups,
  title = "Linked from",
}: {
  groups: readonly LinkedGroup[];
  title?: string;
}) {
  if (groups.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Link2 className="text-muted-foreground size-4" aria-hidden="true" />
        {title}
      </h3>
      <ul className="space-y-3">
        {groups.map((g) => (
          <li key={`${g.databaseId}:${g.fieldId}`} className="space-y-1.5">
            <p className="text-[13px] font-medium">
              {g.databaseName} <span className="text-muted-foreground">{g.fieldName}</span>{" "}
              <span className="text-muted-foreground tabular-nums">({g.count})</span>
            </p>
            <ul className="flex flex-wrap gap-1">
              {g.rows.map((r) => (
                <li key={r.id} className="max-w-full">
                  {r.href ? (
                    <Link
                      href={r.href}
                      className="bg-muted hover:bg-muted-strong inline-flex h-6 max-w-full items-center rounded-full px-2.5 text-xs font-semibold"
                    >
                      <span className="truncate">{r.label}</span>
                    </Link>
                  ) : (
                    <span className="bg-muted inline-flex h-6 max-w-full items-center rounded-full px-2.5 text-xs font-semibold">
                      <span className="truncate">{r.label}</span>
                    </span>
                  )}
                </li>
              ))}
              {g.count > g.rows.length && (
                <li className="text-muted-foreground inline-flex h-6 items-center text-xs">
                  and {g.count - g.rows.length} more
                </li>
              )}
            </ul>
            {g.rollups.length > 0 && (
              <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">
                {g.rollups.map((r) => (
                  <li key={`${r.kind}:${r.fieldName}`}>{rollupText(r)}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Loads and shows what links to one row or record (for a row opened in a grid). */
export function LinkedFromLoader({ orgId, refValue }: { orgId: string; refValue: RelationRef }) {
  const [groups, setGroups] = useState<LinkedGroup[] | null>(null);
  const { kind, id } = refValue;
  useEffect(() => {
    let live = true;
    void linkedFromAction(orgId, { kind, id }).then((r) => {
      if (live) setGroups(r.data ?? []);
    });
    return () => {
      live = false;
    };
  }, [orgId, kind, id]);
  if (groups === null) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Looking for links
      </p>
    );
  }
  return <LinkedFrom groups={groups} />;
}
