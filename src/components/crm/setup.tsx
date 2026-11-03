"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { bringInAction, runSetupAction, startImportAction } from "@/app/app/[orgSlug]/crm/actions";
import { shareOutOwnersAction } from "@/app/app/[orgSlug]/crm/settings-actions";
import { SheetDrop, SheetMatches, type DroppedSheet } from "@/components/crm/settings/sheet-drop";
import { Check } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { chipClass } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { crmSettingsHref, type CrmSettingsSectionId } from "@/lib/crm/settings-sections";
import { OWNER_MODES, setupSummary, startingKinds, type OwnerMode } from "@/lib/crm/setup-owners";
import { setupKindInfo, setupKindsFor, type SetupKind } from "@/lib/crm/templates";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * First-time setup (docs/features/crm.md, "Redesign", Setup): what you
 * mostly reach out to, filled in already, then three numbered steps:
 * 1 Bring people in (a spreadsheet, with its columns matched, beside the
 * people Bananasplit already knows), 2 Who looks after them, 3 Connect, if
 * you like. A floating summary sits next to "Set up the CRM", which runs it
 * all in order and then opens the first thing picked to connect. Run again
 * later, it brings more people in.
 *
 * In a Personal space (`personal`): its own few answers (setupKindsFor,
 * setupKindInfo), only "People who RSVP'd to your events" to bring in,
 * and no step 2 (one person looks after everyone).
 */

type Source = "members" | "contacts" | "forms";

export interface SetupCounts {
  members: number;
  contacts: number;
  forms: number;
  /** Finance's partners not in the CRM yet: they come along with setup. */
  sponsors: number;
}

const CONNECT: { id: CrmSettingsSectionId; title: string; text: string; personalText?: string }[] =
  [
    {
      id: "ai",
      title: "Your organization's Claude",
      text: "Writes the drafts and summaries. Nothing sends by itself.",
      personalText: "Your own Claude writes the drafts and summaries. Nothing sends by itself.",
    },
    {
      id: "phone",
      title: "Calls and texts",
      text: "Your own Telnyx or Twilio account. Calls log themselves.",
    },
  ];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card
      className="gap-4.5 rounded-[1.75rem] p-6"
      aria-labelledby={`setup-step-${n}`}
      role="region"
    >
      <div className="flex items-center gap-3.5">
        <span className="bg-foreground text-background grid size-9 shrink-0 place-items-center rounded-full text-[15px] font-bold">
          {n}
        </span>
        <h2 id={`setup-step-${n}`} className="heading text-[22px]">
          {title}
        </h2>
      </div>
      {children}
    </Card>
  );
}

export function CrmSetup({
  orgId,
  orgSlug,
  done,
  picked,
  counts,
  personal = false,
  admin,
}: {
  orgId: string;
  orgSlug: string;
  /** The CRM is set up already: this brings more people in. */
  done: boolean;
  picked: string[];
  counts: SetupCounts;
  personal?: boolean;
  /** Owners and admins may connect keys and phones (step 3). */
  admin: boolean;
}) {
  const router = useRouter();
  const base = `/app/${orgSlug}/crm`;
  const offered = setupKindsFor(personal);
  const [kinds, setKinds] = useState<Set<SetupKind>>(
    () => new Set(startingKinds(personal, picked, counts.sponsors > 0)),
  );
  const sources: { id: Source; name: string; note: string; n: number }[] = personal
    ? [
        {
          id: "contacts",
          name: "People who RSVP'd to your events",
          note: `${counts.contacts.toLocaleString("en-US")} not here yet`,
          n: counts.contacts,
        },
      ]
    : [
        {
          id: "members",
          name: "Members",
          note: `${counts.members.toLocaleString("en-US")} people in your organization`,
          n: counts.members,
        },
        {
          id: "contacts",
          name: "Event guests",
          note: `${counts.contacts.toLocaleString("en-US")} people who came to something`,
          n: counts.contacts,
        },
        {
          id: "forms",
          name: "Form answers",
          note: `${counts.forms.toLocaleString("en-US")} people who filled in a form`,
          n: counts.forms,
        },
      ];
  const [on, setOn] = useState<Set<Source>>(
    () => new Set(sources.filter((s) => s.n > 0).map((s) => s.id)),
  );
  const [sheet, setSheet] = useState<DroppedSheet | null>(null);
  const [owner, setOwner] = useState<OwnerMode>("split");
  const [connect, setConnect] = useState<Set<CrmSettingsSectionId>>(new Set());
  const [pending, start] = useTransition();
  const [step, setStep] = useState<string | null>(null);

  const fresh = offered.filter((k) => kinds.has(k) && !picked.includes(k));
  const people =
    sources.filter((s) => on.has(s.id)).reduce((n, s) => n + s.n, 0) +
    (sheet?.total ?? 0) +
    (done ? 0 : counts.sponsors);
  const summary =
    done && people === 0
      ? "Everyone you know is in. Drop a spreadsheet for more."
      : setupSummary(people, personal ? null : owner);
  const flip = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const go = (skip = false) =>
    start(async () => {
      const since = new Date().toISOString();
      const fail = (error?: string) => {
        toast({ title: error ?? "That didn't work. Try again.", tone: "error" });
        setStep(null);
      };
      if (!done || fresh.length > 0) {
        setStep("Making your pipelines and lists");
        const r = await runAction(() => runSetupAction(orgId, [...kinds]));
        if (!r) return setStep(null);
        if (!r.ok) return fail(r.error);
      }
      let queued = 0;
      if (!skip) {
        for (const s of sources) {
          if (!on.has(s.id) || s.n === 0) continue;
          setStep(`Bringing in ${s.name.toLowerCase()}`);
          const r = await runAction(() => bringInAction(orgId, s.id));
          if (r && !r.ok) return fail(r.error);
          if (r?.ok) queued += r.queued;
        }
        if (sheet) {
          setStep(`Reading ${sheet.fileName}`);
          const r = await runAction(() =>
            startImportAction(orgId, sheet.importId, { object: "person", mapping: sheet.mapping }),
          );
          if (r && !r.ok) return fail(r.error);
          if (r?.ok && r.log.status !== "done") queued += r.log.total;
        }
        if (!personal) {
          setStep("Sharing them out");
          const r = await runAction(() => shareOutOwnersAction(orgId, owner, since));
          if (r && !r.ok) return fail(r.error);
        }
      }
      setStep(null);
      toast({
        title: skip
          ? "The CRM is set up. Bring people in whenever you like."
          : queued
            ? `Set up. ${queued.toLocaleString("en-US")} more are coming in the background.`
            : "Set up. Everyone's in.",
      });
      const next = CONNECT.find((c) => connect.has(c.id));
      router.push(next ? crmSettingsHref(orgSlug, next.id) : base);
      router.refresh();
    });

  return (
    <div className="mx-auto max-w-[1000px] space-y-5.5 pb-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-[1_1_24rem] space-y-2.5">
          <h1 className="page-title">{done ? "Bring people in" : "Set up the CRM"}</h1>
          <p className="text-muted-foreground text-[17px]">
            {done
              ? "Add more of who you reach out to, and who looks after them."
              : "About two minutes. We filled in what we could from your workspace."}
          </p>
        </div>
        {done ? (
          <Link href={base} className="text-[15px] font-semibold hover:underline">
            Back to the CRM
          </Link>
        ) : (
          <button
            type="button"
            className="text-[15px] font-semibold hover:underline"
            disabled={pending || kinds.size === 0}
            onClick={() => go(true)}
          >
            Skip for now
          </button>
        )}
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="What you mostly reach out to"
      >
        <span className="text-muted-foreground me-1 text-sm">You mostly reach out to</span>
        {offered.map((k) => {
          const info = setupKindInfo(k, personal);
          const locked = picked.includes(k);
          const active = kinds.has(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              disabled={locked}
              title={locked ? "Already set up" : info.hint}
              onClick={() => setKinds((cur) => flip(cur, k))}
              className={cn(chipClass(active), "h-8 px-3 text-[13px]", locked && "opacity-70")}
            >
              {active && <Check aria-hidden="true" />}
              {info.label}
            </button>
          );
        })}
      </div>

      <Step n={1} title="Bring people in">
        <div className="flex flex-wrap items-stretch gap-4">
          <div className="flex min-w-0 flex-[1_1_24rem] flex-col">
            {sheet ? (
              <SheetMatches sheet={sheet} onRemove={() => setSheet(null)} />
            ) : (
              <SheetDrop
                big
                orgSlug={orgSlug}
                onDropped={setSheet}
                hint="CSV or Excel, or an export from another CRM."
              />
            )}
          </div>
          <div className="bg-muted/60 flex min-w-0 flex-[1_1_17rem] flex-col gap-1 rounded-[1.5rem] p-5">
            <b className="mb-1.5 text-base">Already in Bananasplit</b>
            {sources.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 py-2.5",
                  s.n === 0 && "cursor-default opacity-60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <b className="block text-[15px]">{s.name}</b>
                  <span className="text-muted-foreground text-[13px]">
                    {s.n === 0 ? "Everyone's in already" : s.note}
                  </span>
                </span>
                <Switch
                  checked={on.has(s.id) && s.n > 0}
                  disabled={s.n === 0}
                  onCheckedChange={() => setOn((cur) => flip(cur, s.id))}
                  aria-label={s.name}
                />
              </label>
            ))}
            {!personal && counts.sponsors > 0 && (
              <div className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <b className="block text-[15px]">Partners in Finance</b>
                  <span className="text-muted-foreground text-[13px]">
                    {counts.sponsors} companies, with their deals
                  </span>
                </span>
                <Badge variant="secondary">Come along</Badge>
              </div>
            )}
          </div>
        </div>
      </Step>

      {!personal && (
        <Step n={2} title="Who looks after them?">
          <div
            className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]"
            role="radiogroup"
            aria-label="Who looks after them"
          >
            {OWNER_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={owner === m.id}
                onClick={() => setOwner(m.id)}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-[1.25rem] p-4.5 text-left transition-colors",
                  owner === m.id
                    ? "bg-muted ring-foreground ring-2"
                    : "ring-border hover:bg-muted/50 ring-1",
                )}
              >
                <b className="text-base">{m.title}</b>
                <span className="text-muted-foreground text-sm leading-normal">{m.text}</span>
              </button>
            ))}
          </div>
        </Step>
      )}

      <Step n={personal ? 2 : 3} title="Connect, if you like">
        <ul className="divide-border divide-y">
          {CONNECT.filter((c) => admin || c.id !== "phone").map((c) => {
            const chosen = connect.has(c.id);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                <span className="min-w-0 flex-[1_1_16rem]">
                  <b className="block text-[15px]">{c.title}</b>
                  <span className="text-muted-foreground text-sm">
                    {personal && c.personalText ? c.personalText : c.text}
                  </span>
                </span>
                <Button
                  type="button"
                  variant={chosen ? "default" : "outline"}
                  aria-pressed={chosen}
                  onClick={() => setConnect((cur) => flip(cur, c.id))}
                >
                  {chosen ? (
                    <>
                      <Check className="size-4" aria-hidden="true" />
                      Next, after setup
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              </li>
            );
          })}
          <li className="flex flex-wrap items-center gap-3 py-3 last:pb-0">
            <span className="min-w-0 flex-[1_1_16rem]">
              <b className="block text-[15px]">Gmail and Outlook</b>
              <span className="text-muted-foreground text-sm">
                {personal ? "Connect your own mailbox." : "Each member connects their own mailbox."}
              </span>
            </span>
            <Badge variant="secondary">Coming soon</Badge>
          </li>
        </ul>
      </Step>

      <div className="bg-card border-border sticky bottom-4 z-10 flex flex-wrap items-center gap-3.5 rounded-[1.75rem] border py-3 ps-6 pe-3 shadow-lg sm:rounded-full">
        <span className="min-w-0 flex-[1_1_16rem] text-[15px]" aria-live="polite">
          {step ? `${step}…` : summary}
        </span>
        <Button
          size="lg"
          disabled={pending || kinds.size === 0 || (done && fresh.length === 0 && people === 0)}
          onClick={() => go()}
        >
          {pending ? "Setting up…" : done ? "Bring them in" : "Set up the CRM"}
        </Button>
      </div>
    </div>
  );
}
