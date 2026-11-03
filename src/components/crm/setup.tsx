"use client";

import {
  ArrowRight,
  Briefcase,
  Check,
  FileSpreadsheet,
  GraduationCap,
  HandCoins,
  Handshake,
  Mic,
  Package,
  PiggyBank,
  UserPlus,
  Users,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { bringInAction, runSetupAction } from "@/app/app/[orgSlug]/crm/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { setupKindInfo, setupKindsFor, type SetupKind } from "@/lib/crm/templates";
import { cn } from "@/lib/utils";

const ICONS: Record<string, IconComponent> = {
  UserPlus,
  HandCoins,
  Handshake,
  Mic,
  GraduationCap,
  Package,
  Briefcase,
  PiggyBank,
};

type Counts = { members: number; contacts: number; forms: number; sponsors: number } | null;

/**
 * "What do you mostly reach out to?": big buttons, pick any, one Set up.
 * Then the people Bananasplit already knows, each brought in with one click,
 * and a spreadsheet for everyone else. In a Personal space (`personal`):
 * its own few answers, and only the people who RSVP'd to your events (there
 * are no members or forms to bring in).
 */
export function CrmSetup({
  orgId,
  orgSlug,
  done,
  picked,
  counts,
  pipelines,
  personal = false,
}: {
  orgId: string;
  orgSlug: string;
  personal?: boolean;
  done: boolean;
  picked: string[];
  counts: Counts;
  pipelines: { id: string; name: string; stages: number }[];
}) {
  const router = useRouter();
  const [kinds, setKinds] = useState<Set<SetupKind>>(new Set(picked as SetupKind[]));
  const [pending, start] = useTransition();
  const [bringing, setBringing] = useState<string | null>(null);
  const base = `/app/${orgSlug}/crm`;
  const offered = setupKindsFor(personal);
  const fresh = offered.filter((k) => kinds.has(k) && !picked.includes(k));

  const toggle = (k: SetupKind) =>
    setKinds((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="space-y-7">
      <section className="space-y-4" aria-labelledby="crm-setup-q">
        <h2 id="crm-setup-q" className="display-title text-[22px]">
          What do you mostly reach out to?
        </h2>
        <p className="text-muted-foreground text-[15px]">Pick any. You can add more later.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {offered.map((k) => {
            const info = setupKindInfo(k, personal);
            const Icon = ICONS[info.icon] ?? Users;
            const on = kinds.has(k);
            const locked = picked.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                disabled={locked}
                onClick={() => toggle(k)}
                className={cn(
                  "rounded-card flex min-h-28 flex-col items-start gap-2 border p-4 text-left transition-colors",
                  on
                    ? "border-primary bg-primary/8 ring-primary ring-1"
                    : "border-border hover:bg-muted/60",
                  locked && "opacity-70",
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <Icon className="size-5" aria-hidden="true" />
                  <b className="flex-1 text-[15px]">{info.label}</b>
                  {on && <Check className="text-primary size-4" aria-hidden="true" />}
                </span>
                <span className="text-muted-foreground text-[13px]">
                  {locked ? "Already set up" : info.hint}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          disabled={pending || (done ? fresh.length === 0 : kinds.size === 0)}
          onClick={() =>
            start(async () => {
              const r = await runSetupAction(orgId, [...kinds]).catch(() => null);
              if (!r || !r.ok) {
                toast({
                  title: r && !r.ok ? r.error : "That didn't work. Try again.",
                  tone: "error",
                });
                return;
              }
              const moved = r.result.sponsors;
              toast({
                title: moved
                  ? `Set up. ${moved.items} deals moved into the Deals pipeline.`
                  : r.result.pipelines > 0
                    ? `Set up, with ${r.result.pipelines} pipelines.`
                    : "Set up.",
              });
              router.refresh();
            })
          }
        >
          {pending ? "Setting up…" : done ? "Add these" : "Set up the CRM"}
        </Button>
      </section>

      {done && counts && (
        <section className="space-y-4" aria-labelledby="crm-setup-bring">
          <h2 id="crm-setup-bring" className="display-title text-[22px]">
            Bring in the people you already know
          </h2>
          <Card className="divide-border divide-y p-0">
            {(personal
              ? ([["contacts", "People who RSVP'd to your events", counts.contacts]] as const)
              : ([
                  ["members", "Your organization's members", counts.members],
                  ["contacts", "People who checked in or signed up", counts.contacts],
                  ["forms", "People who answered a form", counts.forms],
                ] as const)
            ).map(([source, label, n]) => (
              <div key={source} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <span className="min-w-0 flex-1">
                  <b className="block text-[15px]">{label}</b>
                  <span className="text-muted-foreground text-[13px]">
                    {n === 0 ? "Everyone's in already" : `${n.toLocaleString()} not in the CRM yet`}
                  </span>
                </span>
                <Button
                  variant="outline"
                  disabled={n === 0 || bringing !== null}
                  onClick={async () => {
                    setBringing(source);
                    const r = await bringInAction(orgId, source).catch(() => null);
                    setBringing(null);
                    if (!r || !r.ok) {
                      toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
                      return;
                    }
                    toast({
                      title: r.queued
                        ? `Bringing in ${r.queued.toLocaleString()} in the background.`
                        : `Added ${r.added}${r.linked ? `, linked ${r.linked}` : ""}.`,
                    });
                    router.refresh();
                  }}
                >
                  {bringing === source ? "Bringing in…" : "Bring in"}
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <span className="min-w-0 flex-1">
                <b className="block text-[15px]">From a spreadsheet or another CRM</b>
                <span className="text-muted-foreground text-[13px]">
                  CSV or Excel, vCard, Notion, Airtable, HubSpot, Salesforce or Pipedrive, notes
                  included
                </span>
              </span>
              <Button asChild variant="outline">
                <Link href={`${base}/import`}>
                  <FileSpreadsheet className="size-4" aria-hidden="true" />
                  Import a file
                </Link>
              </Button>
            </div>
          </Card>
          {counts.sponsors > 0 && (
            <p className="text-muted-foreground text-sm">
              {counts.sponsors} Finance partners aren&apos;t companies yet. Press Add these above to
              move them in.
            </p>
          )}
          {pipelines.length > 0 && (
            <p className="text-muted-foreground text-sm">
              Your pipelines: {pipelines.map((p) => p.name).join(", ")}.
            </p>
          )}
          <Button asChild>
            <Link href={base}>
              Open the CRM
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </section>
      )}
    </div>
  );
}
