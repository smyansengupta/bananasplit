"use client";

import { Merge, Search } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { resolveDuplicateAction, scanDuplicatesAction } from "@/app/app/[orgSlug]/crm/actions";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";

export interface DuplicateView {
  id: string;
  object: "person" | "company";
  score: number;
  reasons: string[];
  records: { id: string; name: string; sub: string | null; added: string }[];
}

/**
 * The duplicates review (docs/features/crm.md: "suggest merges in a review
 * list"): each likely pair with why, and one click to keep one of them (the
 * other merges into it) or to say they're different people.
 */
export function Duplicates({ orgId, orgSlug, items }: { orgId: string; orgSlug: string; items: DuplicateView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const resolve = async (id: string, decision: { accept: false } | { accept: true; keepId: string }) => {
    setBusy(id);
    const r = await resolveDuplicateAction(orgId, id, decision).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
      return;
    }
    toast({ title: decision.accept ? "Merged." : "Marked as different. It won't be suggested again." });
    router.refresh();
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          disabled={scanning}
          onClick={async () => {
            setScanning(true);
            const r = await scanDuplicatesAction(orgId).catch(() => null);
            setScanning(false);
            if (!r || !r.ok) {
              toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
              return;
            }
            toast({ title: r.people + r.companies === 0 ? "No new duplicates found." : `Found ${r.people + r.companies} to look at.` });
            router.refresh();
          }}
        >
          <Search className="size-4" aria-hidden="true" />
          {scanning ? "Looking…" : "Look for duplicates"}
        </Button>
      </div>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={Merge} title="No duplicates to look at" description="New ones show up here after imports and every night." />
        </Card>
      ) : (
        items.map((d) => (
          <Card key={d.id} className="gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={d.score >= 90 ? "destructive" : "secondary"}>{d.score >= 90 ? "Very likely" : "Likely"}</Badge>
              <span className="text-muted-foreground text-sm">{d.reasons.join(", ")}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {d.records.map((r) => (
                <div key={r.id} className="bg-muted/45 flex flex-col gap-2 rounded-2xl p-4">
                  <Link href={crmRecordHref(orgSlug, d.object, r.id)} className="font-semibold hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-muted-foreground text-sm">{r.sub ?? " "}</span>
                  <span className="text-muted-foreground text-xs">Added {new Date(r.added).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  <Button size="sm" disabled={busy === d.id} onClick={() => resolve(d.id, { accept: true, keepId: r.id })}>
                    Keep this one
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="self-start" disabled={busy === d.id} onClick={() => resolve(d.id, { accept: false })}>
              They&apos;re different
            </Button>
          </Card>
        ))
      )}
    </div>
  );
}
