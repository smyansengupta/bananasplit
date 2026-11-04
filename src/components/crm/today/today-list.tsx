"use client";

import { ArrowRight, Ban } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { resolveDuplicateAction } from "@/app/app/[orgSlug]/crm/actions";
import {
  acceptSuggestionAction,
  rejectSuggestionAction,
  undoSuggestionAction,
} from "@/app/app/[orgSlug]/crm/ai-actions";
import {
  closeStepAction,
  composeEmailAction,
  setFollowUpAction,
  snoozeAction,
} from "@/app/app/[orgSlug]/crm/outreach/actions";
import {
  snoozePowerHourAction,
  unsnoozePowerHourAction,
} from "@/app/app/[orgSlug]/crm/today-actions";
import {
  AMBIENT_BUTTON,
  AmbientButton,
  AmbientWhy,
  MAX_AMBIENT,
  type AmbientAction,
} from "@/components/ambient/ambient-button";
import { CrmAvatar } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { EmptyState } from "@/components/empty-state";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type { TodayAction, TodayGroup, TodayRow } from "@/server/crm/today";

/**
 * Today's list (docs/features/crm.md, "Redesign"): Power hour as one light
 * strip (or, snoozed, a quiet line with Undo), then who needs you in four
 * groups with a count each. A row is a name (its card opens over Today),
 * what happened, and at most two ambient buttons with the reason beside
 * them on the same line. A row that's been dealt with shrinks to one line,
 * with Undo where there is one.
 */

const HOLD_MS = 10_000;
const OUTLINE =
  "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-muted";

export interface PowerHourStrip {
  people: number;
  minutes: number;
  drafts: number;
  /** Snoozed until this, in words ("Power hour is back at 2 PM"), or null. */
  snoozed: string | null;
}

export function TodayList({
  orgId,
  groups,
  rows,
  power,
}: {
  orgId: string;
  groups: readonly { id: TodayGroup; label: string }[];
  rows: TodayRow[];
  power: PowerHourStrip;
}) {
  const router = useRouter();
  const { hrefFor } = useCrmOpen();
  const [done, setDone] = useState<Record<string, { text: string; undo?: () => Promise<void> }>>(
    {},
  );
  const held = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; fire: () => Promise<void> }>(),
  );
  // Anything still held goes out when you leave Today.
  // A held send goes when the list goes, or the tab is hidden or left.
  useEffect(() => {
    const pending = held.current;
    const fireAll = () => {
      for (const h of [...pending.values()]) {
        clearTimeout(h.timer);
        void h.fire();
      }
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") fireAll();
    };
    window.addEventListener("pagehide", fireAll);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", fireAll);
      document.removeEventListener("visibilitychange", onHidden);
      fireAll();
    };
  }, []);
  const left = rows.filter((r) => !done[r.key]).length;

  const mark = (key: string, text: string, undo?: () => Promise<void>) =>
    setDone((d) => ({ ...d, [key]: { text, undo } }));
  const unmark = (key: string) =>
    setDone((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  const toAmbient = (row: TodayRow, a: TodayAction, index: number): AmbientAction => {
    const first = row.name.split(" ")[0] ?? row.name;
    const tone = index === 0 ? "solid" : "outline";
    switch (a.type) {
      case "open":
        return {
          key: `open-${index}`,
          label: a.label,
          tone: a.tone,
          reason: row.why,
          href: hrefFor(a.open),
        };
      case "call":
        return {
          key: "call",
          label: a.label,
          tone: "solid",
          reason: row.why,
          href: `tel:${a.phone}`,
        };
      case "send-draft":
        return {
          key: "send",
          label: a.label,
          tone: "solid",
          reason: row.why,
          run: async () => {
            // Held here for ten seconds, so Undo keeps the draft as it was.
            const fire = async () => {
              held.current.delete(row.key);
              const r = await runAction(() =>
                composeEmailAction(orgId, {
                  personId: a.personId,
                  subject: a.subject || "Following up",
                  body: a.body,
                  draftId: a.draftId,
                  replyToMessageId: a.replyTo,
                  confirmConflict: true,
                }),
              );
              if (r && !r.ok) {
                toast({ title: r.error, tone: "error" });
                unmark(row.key);
              }
              router.refresh();
            };
            held.current.set(row.key, { timer: setTimeout(() => void fire(), HOLD_MS), fire });
            mark(row.key, `Email to ${first} goes out in 10 seconds.`, async () => {
              const h = held.current.get(row.key);
              // Sent early (the tab was hidden or left): it's gone, say so.
              if (!h) {
                toast({ title: `The email to ${first} already went.` });
                return;
              }
              clearTimeout(h.timer);
              held.current.delete(row.key);
            });
            return {};
          },
        };
      case "snooze":
        return {
          key: "snooze",
          label: "Snooze",
          tone: "outline",
          reason: "Back tomorrow",
          run: async () => {
            const r = await snoozeAction(orgId, a.id, "tomorrow");
            if (r.ok) mark(row.key, `${row.name} is back tomorrow.`);
            return r;
          },
        };
      case "push":
        return {
          key: "push",
          label: "Push to tomorrow",
          tone: "outline",
          reason: "Moves the follow-up a day",
          run: async () => {
            const r = await setFollowUpAction(orgId, a.personId, 1);
            if (r.ok) mark(row.key, `Pushed ${first} to tomorrow.`);
            return r;
          },
        };
      case "step-done":
        return {
          key: "step",
          label: "Done",
          tone,
          reason: row.why,
          run: async () => {
            const r = await closeStepAction(orgId, a.stepId);
            if (r.ok) mark(row.key, `Done with ${first}.`);
            return r;
          },
        };
      case "accept":
        return {
          key: "accept",
          label: a.label,
          tone: "solid",
          reason: row.why,
          run: async () => {
            const r = await acceptSuggestionAction(orgId, a.suggestionId);
            if (r.ok)
              mark(
                row.key,
                `${a.label === "Send" ? "Sent" : "Done"}: ${row.text.replace(/\.$/, "")}.`,
                async () => {
                  const u = await runAction(() => undoSuggestionAction(orgId, a.suggestionId));
                  if (u && !u.ok) toast({ title: u.error, tone: "error" });
                },
              );
            return r;
          },
        };
      case "reject":
        return {
          key: "reject",
          label: a.label,
          tone: "outline",
          reason: row.why,
          run: async () => {
            const r = await rejectSuggestionAction(orgId, a.suggestionId);
            if (r.ok) mark(row.key, "Left as it was.");
            return r;
          },
        };
      case "merge":
        return {
          key: "merge",
          label: "Merge",
          tone: "solid",
          reason: row.why,
          run: async () => {
            const r = await resolveDuplicateAction(orgId, a.suggestionId, {
              accept: true,
              keepId: a.keepId,
            });
            if (r.ok) mark(row.key, `Merged into ${first}.`);
            return r;
          },
        };
      case "not-dupe":
        return {
          key: "apart",
          label: "They're different",
          tone: "outline",
          reason: row.why,
          run: async () => {
            const r = await resolveDuplicateAction(orgId, a.suggestionId, { accept: false });
            if (r.ok) mark(row.key, "Kept apart.");
            return r;
          },
        };
    }
  };

  return (
    <section aria-label="Who needs you" className="flex min-w-0 flex-col gap-6">
      <PowerStrip
        orgId={orgId}
        power={power}
        left={left}
        startHref={hrefFor("power")}
        onChange={() => router.refresh()}
      />
      {rows.length === 0 && (
        <EmptyState
          title="Nobody needs you today"
          description="Replies, follow-ups and anything to approve show up here."
        />
      )}
      {groups.map((g) => {
        const list = rows.filter((r) => r.group === g.id);
        if (list.length === 0) return null;
        const waiting = list.filter((r) => !done[r.key]).length;
        // Two or more calls due: the dialer works down them one after another.
        const inARow = g.id === "calls" && waiting >= 2;
        return (
          <div key={g.id} className="flex flex-col gap-2.5">
            <h2 className="flex items-center gap-2.5 px-1 pt-1">
              <span className="heading text-base">{g.label}</span>
              <span className="bg-muted grid h-7 min-w-7 place-items-center rounded-full px-2 text-sm font-semibold tabular-nums">
                {waiting}
              </span>
              {inARow && (
                <span className="ms-auto flex min-w-0 items-center gap-2 text-sm font-normal">
                  <AmbientButton
                    action={{
                      key: "calls-in-a-row",
                      label: "Call them in a row",
                      tone: "solid",
                      reason: `${waiting} calls due`,
                      href: hrefFor("calls"),
                    }}
                  />
                  <AmbientWhy className="min-w-0 truncate max-sm:hidden">{waiting} calls due</AmbientWhy>
                </span>
              )}
            </h2>
            {list.map((row) => {
              const gone = done[row.key];
              if (gone) {
                return (
                  <div
                    key={row.key}
                    className="bg-card ring-foreground/6 flex items-center gap-3 rounded-[22px] px-5 py-3.5 ring-1"
                  >
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                      {gone.text}
                    </span>
                    {gone.undo && (
                      <button
                        type="button"
                        className={cn(AMBIENT_BUTTON, OUTLINE)}
                        onClick={async () => {
                          await gone.undo!();
                          unmark(row.key);
                          router.refresh();
                        }}
                      >
                        Undo
                      </button>
                    )}
                  </div>
                );
              }
              const actions = row.actions.slice(0, MAX_AMBIENT).map((a, i) => toAmbient(row, a, i));
              return (
                <article
                  key={row.key}
                  data-today-row
                  className="bg-card ring-foreground/6 flex gap-4 rounded-[22px] p-5 ring-1"
                >
                  <CrmAvatar name={row.name} size={44} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {row.open ? (
                        <Link
                          href={hrefFor(row.open)}
                          scroll={false}
                          className="text-[17px] leading-snug font-semibold hover:underline"
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <b className="text-[17px] leading-snug">{row.name}</b>
                      )}
                      {row.tag && (
                        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold">
                          {row.tag}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-[15px] leading-relaxed">{row.text}</p>
                    {row.draft && (
                      <p className="bg-muted line-clamp-4 rounded-2xl px-3.5 py-3 text-sm leading-relaxed whitespace-pre-line">
                        {row.draft}
                      </p>
                    )}
                    {row.change && (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {row.change.before && (
                          <span className="text-muted-foreground line-through">
                            {row.change.before}
                          </span>
                        )}
                        <ArrowRight className="text-muted-foreground size-4" aria-hidden="true" />
                        <span className="bg-muted rounded-full px-3 py-1 font-semibold">
                          {row.change.after}
                        </span>
                      </div>
                    )}
                    {row.warn && (
                      <p className="text-destructive flex items-center gap-2 text-sm">
                        <Ban className="size-4 shrink-0" aria-hidden="true" />
                        {row.warn}
                      </p>
                    )}
                    {actions.length > 0 && (
                      <div className="flex min-w-0 flex-nowrap items-center gap-2 pt-0.5">
                        {actions.map((a) => (
                          <AmbientButton key={a.key} action={a} />
                        ))}
                        <AmbientWhy className="ms-1 min-w-0 truncate whitespace-nowrap">
                          {row.why}
                        </AmbientWhy>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

/** Power hour: one light strip, or a quiet line once snoozed. */
function PowerStrip({
  orgId,
  power,
  left,
  startHref,
  onChange,
}: {
  orgId: string;
  power: PowerHourStrip;
  left: number;
  startHref: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (power.people === 0) return null;
  if (power.snoozed) {
    return (
      <div className="flex flex-wrap items-center gap-3 px-1">
        <b className="text-[22px] leading-tight">{left} need you today</b>
        <span className="text-muted-foreground text-sm">{power.snoozed}</span>
        <button
          type="button"
          disabled={busy}
          className={cn(AMBIENT_BUTTON, OUTLINE)}
          onClick={async () => {
            setBusy(true);
            const r = await runAction(() => unsnoozePowerHourAction(orgId));
            setBusy(false);
            if (r && !r.ok) toast({ title: r.error, tone: "error" });
            onChange();
          }}
        >
          Undo
        </button>
      </div>
    );
  }
  const drafts =
    power.drafts === power.people
      ? ", every draft ready"
      : power.drafts > 0
        ? `, ${power.drafts} drafts ready`
        : "";
  return (
    <div className="bg-muted flex flex-wrap items-center gap-3 rounded-[22px] px-5 py-3.5">
      <span className="min-w-0 flex-[1_1_260px] text-[15px]">
        <b>Power hour</b>{" "}
        <span className="text-muted-foreground">
          {power.people} {power.people === 1 ? "person" : "people"}, about {power.minutes} minutes
          {drafts}
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        className={cn(AMBIENT_BUTTON, OUTLINE)}
        title="Hide it until 2 PM, or tomorrow morning"
        onClick={async () => {
          setBusy(true);
          const r = await runAction(() => snoozePowerHourAction(orgId));
          setBusy(false);
          if (r && !r.ok) toast({ title: r.error, tone: "error" });
          onChange();
        }}
      >
        Snooze
      </button>
      <Link
        href={startHref}
        scroll={false}
        className={cn(
          AMBIENT_BUTTON,
          "bg-foreground text-background hover:bg-foreground/90 h-9 px-[18px] text-sm",
        )}
      >
        Start
      </Link>
    </div>
  );
}
