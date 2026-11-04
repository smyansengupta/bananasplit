"use client";

import { CalendarDays, FileText, Mail, Send, Users } from "@/components/icons";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { createPlanAction, startPlanAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { AmbientButton, AmbientWhy, type AmbientAction } from "@/components/ambient/ambient-button";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { CrmFilterPick, CrmRoundToggle, CrmToolbar } from "@/components/crm/chrome/crm-toolbar";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { CreateSplitButton } from "@/components/ui/create-split-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import type { ResolvedCrmTab } from "@/lib/crm/nav";
import { PLAN_STATUS_LABEL, type PlanStatus, type StepPreview } from "@/lib/crm/outreach/plans";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * The Outreach tab (docs/features/crm.md, "Redesign"; the Outreach design):
 * one list of plans, whatever each is underneath (steps over days, a list
 * split among members, one email to a list). Each plan is a card: its
 * first steps on a coloured band, its name and status, who it's for, where
 * it stands, and at most two ambient buttons with the reason beside them.
 * Details opens the plan's card over the page. Templates is the bar's
 * second round button; your booking link closes the list.
 */

export interface PlanTile {
  type: "sequence" | "campaign";
  id: string;
  name: string;
  status: PlanStatus;
  who: string;
  note: string;
  preview: StepPreview[];
  ambient: { key: "start" | "replies" | "share"; label: string; reason: string } | null;
}

const BANDS = [
  "var(--tag-forest)",
  "var(--tag-ochre)",
  "var(--tag-plum)",
  "var(--tag-navy)",
  "var(--tag-teal)",
  "var(--tag-rust)",
];

function band(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BANDS[h % BANDS.length]!;
}

const STATUS_TONE: Record<PlanStatus, string> = {
  running: "var(--tag-forest)",
  draft: "var(--muted-foreground)",
  done: "var(--tag-navy)",
  paused: "var(--tag-ochre)",
};

function StatusBadge({ status }: { status: PlanStatus }) {
  return (
    <span
      className="text-foreground inline-flex h-[26px] shrink-0 items-center rounded-full px-2.5 text-xs font-semibold"
      style={{ background: `color-mix(in oklab, ${STATUS_TONE[status]} 18%, var(--card))` }}
    >
      {PLAN_STATUS_LABEL[status]}
    </span>
  );
}

/** Outreach's header create: New plan, with one email to a list and splitting a list in its menu. */
export function NewPlanButton({ orgId }: { orgId: string }) {
  const { setOpen } = useCrmOpen();
  const [pending, setPending] = useState(false);
  const create = async () => {
    setPending(true);
    const r = await runAction(() => createPlanAction(orgId));
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setOpen({ kind: "plan", type: "sequence", id: r.id });
  };
  return (
    <CreateSplitButton
      label="New plan"
      title="New plan"
      onClick={create}
      pending={pending}
      menuLabel="More plans"
    >
      <DropdownMenuItem onSelect={create}>
        <Send className="size-4" aria-hidden="true" />
        <span className="flex flex-col">
          Steps over days
          <span className="text-muted-foreground text-xs">
            Emails, texts and tasks that stop when they reply
          </span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setOpen({ kind: "plan", type: "email", id: null })}>
        <Mail className="size-4" aria-hidden="true" />
        <span className="flex flex-col">
          One email to a list
          <span className="text-muted-foreground text-xs">
            From the organization, to everyone on it
          </span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setOpen({ kind: "plan", type: "split", id: null })}>
        <Users className="size-4" aria-hidden="true" />
        <span className="flex flex-col">
          Split a list among members
          <span className="text-muted-foreground text-xs">
            Each reaches their share from their own mailbox
          </span>
        </span>
      </DropdownMenuItem>
    </CreateSplitButton>
  );
}

/** Outreach's bar: the tabs, Plans, Templates and Your mail as round buttons, Filters and search. */
export function OutreachToolbar({
  tabs,
  view,
}: {
  tabs: readonly ResolvedCrmTab[];
  view: "plans" | "templates" | "mail";
}) {
  const params = useSearchParams();
  return (
    <CrmToolbar
      tabs={tabs}
      filterCount={params.get("status") ? 1 : 0}
      filters={
        view !== "plans"
          ? undefined
          : [
              {
                name: "Show",
                node: (
                  <CrmFilterPick
                    param="status"
                    options={[
                      { value: "", label: "Every plan" },
                      { value: "running", label: "Running" },
                      { value: "draft", label: "Drafts" },
                      { value: "paused", label: "Paused" },
                      { value: "done", label: "Done" },
                    ]}
                  />
                ),
              },
            ]
      }
      search={{
        placeholder: view === "templates" ? "Search templates, or ask" : "Search plans, or ask",
      }}
    >
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Show">
        <CrmRoundToggle icon={Send} label="Plans" param="view" value="plans" isDefault />
        <CrmRoundToggle icon={FileText} label="Templates" param="view" value="templates" />
        <CrmRoundToggle icon={Mail} label="Your mail" param="view" value="mail" />
      </div>
    </CrmToolbar>
  );
}

function PlanCardTile({ orgId, plan }: { orgId: string; plan: PlanTile }) {
  const { hrefFor } = useCrmOpen();
  const href = hrefFor({ kind: "plan", type: plan.type, id: plan.id });
  const tone = band(plan.id);
  const action: AmbientAction | null = plan.ambient
    ? plan.ambient.key === "start"
      ? {
          key: "start",
          label: plan.ambient.label,
          tone: "solid",
          reason: plan.ambient.reason,
          run: () => startPlanAction(orgId, plan.id),
          done: "Started",
        }
      : {
          key: plan.ambient.key,
          label: plan.ambient.label,
          tone: plan.ambient.key === "share" ? "solid" : "spark",
          reason: plan.ambient.reason,
          href,
        }
    : null;
  return (
    <article className="bg-card ring-foreground/8 flex flex-col overflow-hidden rounded-[32px] ring-1">
      <Link
        href={href}
        scroll={false}
        aria-label={`Open ${plan.name}`}
        className="flex flex-col gap-2 px-7 pt-10 pb-0"
        style={{ background: `color-mix(in oklab, ${tone} 16%, var(--card))` }}
      >
        {plan.preview.length === 0 && (
          <span className="text-muted-foreground pb-5 text-sm">No steps yet</span>
        )}
        {plan.preview.map((v, i) => (
          <div
            key={i}
            className={cn(
              "bg-card flex items-center gap-2.5 rounded-t-2xl px-3.5 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.06)]",
              i < plan.preview.length - 1 && "rounded-b-2xl",
            )}
          >
            <b className="min-w-0 flex-1 truncate text-sm">{v.what}</b>
            <span
              className="text-foreground/80 inline-flex h-[26px] shrink-0 items-center rounded-full px-2.5 text-xs font-semibold"
              style={{
                background:
                  v.kind === "call" || v.kind === "task"
                    ? "color-mix(in oklab, var(--tag-ochre) 20%, var(--card))"
                    : v.kind === "text"
                      ? "color-mix(in oklab, var(--tag-forest) 20%, var(--card))"
                      : "var(--muted)",
              }}
            >
              {v.when}
            </span>
          </div>
        ))}
      </Link>
      <div className="flex flex-1 flex-col gap-2 px-7 pt-5 pb-6">
        <div className="flex items-center gap-2.5">
          <b className="min-w-0 flex-1 truncate text-lg">{plan.name}</b>
          <StatusBadge status={plan.status} />
        </div>
        <div className="text-[15px]">{plan.who}</div>
        <div className="text-muted-foreground text-sm">{plan.note}</div>
        <span className="flex-1" />
        <div className="flex flex-nowrap items-center gap-2 pt-2">
          {action && (
            <>
              <AmbientButton action={action} className="shrink-0" />
              <AmbientWhy className="min-w-0 truncate">{action.reason}</AmbientWhy>
            </>
          )}
          <span className="flex-1" />
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <Link href={href} scroll={false}>
              Details
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

export function PlansGrid({
  orgId,
  orgSlug,
  plans,
  filtered,
  booking,
}: {
  orgId: string;
  orgSlug: string;
  plans: PlanTile[];
  /** A filter or search is on (so an empty list says so). */
  filtered: boolean;
  booking: { id: string; title: string; url: string; path: string; mine: boolean } | null;
}) {
  const [copied, setCopied] = useState(false);
  const base = `/app/${orgSlug}/crm/outreach/booking`;
  return (
    <section
      aria-label="Plans"
      className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5"
    >
      {plans.length === 0 && (
        <div className="col-span-full">
          <EmptyState
            title={filtered ? "No plans match" : "No plans yet"}
            description={
              filtered
                ? "Try another filter, or clear the search."
                : "A plan is who it goes to, the steps and who sends. Start one with New plan."
            }
          />
        </div>
      )}
      {plans.map((p) => (
        <PlanCardTile key={`${p.type}:${p.id}`} orgId={orgId} plan={p} />
      ))}
      <article className="bg-card ring-foreground/8 flex flex-col overflow-hidden rounded-[32px] ring-1">
        <div
          className="grid grid-cols-5 gap-1.5 px-7 pt-10 pb-6 text-center text-xs"
          style={{ background: "color-mix(in oklab, var(--tag-navy) 14%, var(--card))" }}
          aria-hidden="true"
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
            <span key={d} className="text-muted-foreground font-semibold">
              {d}
            </span>
          ))}
          {["10:00", "2:00", "11:30", "3:00", "9:30"].map((t) => (
            <span key={t} className="bg-card rounded-full py-1 font-semibold">
              {t}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-2 px-7 pt-5 pb-6">
          <div className="flex items-center gap-2.5">
            <b className="min-w-0 flex-1 truncate text-lg">
              {booking?.mine ? "Your booking link" : "Booking pages"}
            </b>
            {booking && <StatusBadge status="running" />}
          </div>
          <div className="text-[15px]">
            {booking
              ? `People pick a time you're free for "${booking.title}". It lands in Meetings and on their timeline.`
              : "One link, and people pick a time you're free. Set one up once and put it in any email."}
          </div>
          {booking && <div className="text-muted-foreground truncate text-sm">{booking.path}</div>}
          <span className="flex-1" />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {booking ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(booking.url).catch(() => undefined);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy my link"}
                </Button>
                <span className="flex-1" />
                <Button asChild variant="ghost" size="sm">
                  <Link href={`${base}/${booking.id}`}>Details</Link>
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1" />
                <Button asChild variant="ghost" size="sm">
                  <Link href={base}>
                    <CalendarDays className="size-4" aria-hidden="true" />
                    Booking pages
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </article>
    </section>
  );
}
