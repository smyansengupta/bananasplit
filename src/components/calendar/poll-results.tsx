"use client";

import { Check, X } from "lucide-react";
import type { CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PollAvailability } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { intervalParts } from "./poll-format";
import {
  HEAT_INK_SWITCH_PERCENT,
  heatPercent,
  legendSteps,
  type PollResponseLite,
  type PollSlotLite,
  type RankedSlot,
  type SlotSummary,
} from "./poll-grid-utils";

/**
 * The poll's read-outs: how the two grids are encoded (the legend), who can
 * make a given time (the details panel), the shortlist of best times and
 * who has answered. Colour is never the only cue: answers carry an icon or a
 * texture, heatmap cells carry their count, and every list names people.
 */

// ---------------------------------------------------------------------------
// Encodings

/** The single availability hue, mixed into the page surface by `percent`. */
export function heatFill(percent: number): CSSProperties | undefined {
  if (percent <= 0) return undefined;
  return {
    backgroundColor: `color-mix(in oklab, var(--success) ${percent}%, var(--background))`,
    borderColor: "transparent",
  };
}

/** Text on a heat cell: the page's own ink, except on the brightest fills in dark mode. */
export function heatTextClass(percent: number): string | undefined {
  return percent >= HEAT_INK_SWITCH_PERCENT ? "dark:text-success-foreground" : undefined;
}

/** "If needed" is striped: a texture, so it never depends on telling amber from green. */
export const IF_NEEDED_STYLE: CSSProperties = {
  backgroundColor: "color-mix(in oklab, var(--warning) 14%, var(--background))",
  backgroundImage:
    "repeating-linear-gradient(135deg, color-mix(in oklab, var(--warning) 70%, transparent) 0 2px, transparent 2px 6px)",
  borderColor: "color-mix(in oklab, var(--warning) 60%, transparent)",
};

export const AVAILABILITY_META: Record<
  PollAvailability,
  { label: string; spoken: string; cellClass: string; style?: CSSProperties; icon?: typeof Check }
> = {
  YES: {
    label: "Available",
    spoken: "available",
    cellClass: "border-success bg-success text-success-foreground",
    icon: Check,
  },
  IF_NEEDED: {
    label: "If needed",
    spoken: "available if needed",
    cellClass: "text-foreground",
    style: IF_NEEDED_STYLE,
  },
  NO: {
    label: "Unavailable",
    spoken: "unavailable",
    cellClass: "border-transparent bg-muted text-muted-foreground",
    icon: X,
  },
};

/** A small swatch drawn exactly like a cell in the "your availability" grid. */
export function AnswerSwatch({
  value,
  className,
}: {
  value: PollAvailability | null;
  className?: string;
}) {
  const meta = value ? AVAILABILITY_META[value] : null;
  const Icon = meta?.icon;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
        meta ? meta.cellClass : "border-border bg-background",
        className,
      )}
      style={meta?.style}
    >
      {Icon && <Icon className="size-3" strokeWidth={3} />}
    </span>
  );
}

/** The corner mark on a heat cell where some of the people counted said "if needed". */
export function IfNeededMark() {
  return (
    <span
      aria-hidden
      className="bg-foreground/40 absolute top-0 right-0 size-[5px] rounded-tr-[3px] [clip-path:polygon(0_0,100%_0,100%_100%)]"
    />
  );
}

export function HeatLegend({ total }: { total: number }) {
  const steps = legendSteps(total);
  if (steps.length === 0) return null;
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span>Available</span>
        <ol
          className="flex items-end gap-0.5"
          aria-label={`Shading from 0 to ${total} people available`}
        >
          {steps.map((count) => {
            const percent = heatPercent(count, total);
            return (
              <li key={count} className="flex flex-col items-center gap-0.5">
                <span
                  aria-hidden
                  className={cn("h-3.5 w-6 rounded-[3px] border", percent === 0 && "bg-background")}
                  style={heatFill(percent)}
                />
                <span className="text-[10px] leading-none tabular-nums">{count}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="bg-muted relative inline-block h-3.5 w-6 rounded-[3px] border">
          <IfNeededMark />
        </span>
        Some only if needed
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Who can make a time

function Names({ people, empty }: { people: { label?: string }[]; empty: string }) {
  if (people.length === 0) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="break-words">{people.map((p) => p.label ?? "Respondent").join(", ")}</span>
  );
}

export function SlotDetails({
  slot,
  summary,
  total,
  unanswered,
  timeZone,
  onSchedule,
  scheduleHint,
  className,
}: {
  slot: PollSlotLite | null;
  summary: SlotSummary | null;
  total: number;
  /** Respondents who answered other slots but not this one. */
  unanswered: { label?: string }[];
  timeZone: string;
  onSchedule?: () => void;
  /** Why this time can't be scheduled (e.g. the meeting would run past the day's last slot). */
  scheduleHint?: string | null;
  className?: string;
}) {
  if (!slot || !summary) {
    return (
      <section
        className={cn("bg-card rounded-lg border p-3 text-sm", className)}
        aria-label="Who can make it"
      >
        <p className="text-muted-foreground">
          {total === 0
            ? "Nobody has answered yet."
            : "Point at a time, or tab to it, to see who can make it."}
        </p>
      </section>
    );
  }
  const { day, time } = intervalParts(slot.startsAt, slot.endsAt, timeZone);
  return (
    <section
      className={cn("bg-card space-y-2 rounded-lg border p-3 text-sm", className)}
      aria-label="Who can make it"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">
          {day}, {time}
        </h3>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          <span className="text-foreground font-semibold">{summary.available}</span> of {total}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
        <dt className="flex items-center gap-1.5 font-medium">
          <AnswerSwatch value="YES" className="size-3.5" /> {summary.yes.length}
        </dt>
        <dd>
          <span className="sr-only">Available: </span>
          <Names people={summary.yes} empty="Nobody available" />
        </dd>
        {summary.ifNeeded.length > 0 && (
          <>
            <dt className="flex items-center gap-1.5 font-medium">
              <AnswerSwatch value="IF_NEEDED" className="size-3.5" /> {summary.ifNeeded.length}
            </dt>
            <dd>
              <span className="sr-only">If needed: </span>
              <Names people={summary.ifNeeded} empty="" />
            </dd>
          </>
        )}
        {summary.no.length > 0 && (
          <>
            <dt className="flex items-center gap-1.5 font-medium">
              <AnswerSwatch value="NO" className="size-3.5" /> {summary.no.length}
            </dt>
            <dd>
              <span className="sr-only">Unavailable: </span>
              <Names people={summary.no} empty="" />
            </dd>
          </>
        )}
        {unanswered.length > 0 && (
          <>
            <dt className="flex items-center gap-1.5 font-medium">
              <AnswerSwatch value={null} className="size-3.5" /> {unanswered.length}
            </dt>
            <dd className="text-muted-foreground">
              <span className="sr-only">No answer for this time: </span>
              <Names people={unanswered} empty="" />
            </dd>
          </>
        )}
      </dl>
      {onSchedule && (
        <div className="flex items-center justify-between gap-2 pt-1">
          {scheduleHint ? (
            <p className="text-muted-foreground text-xs">{scheduleHint}</p>
          ) : (
            <Button size="sm" variant="outline" className="ml-auto" onClick={onSchedule}>
              Schedule at this time
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Best times and respondents

export function BestTimes({
  windows,
  total,
  timeZone,
  durationMinutes,
  selectedStartId,
  onSelect,
  onSchedule,
}: {
  windows: RankedSlot[];
  total: number;
  timeZone: string;
  durationMinutes: number;
  selectedStartId: string | null;
  onSelect: (window: RankedSlot) => void;
  onSchedule?: (window: RankedSlot) => void;
}) {
  return (
    <section className="space-y-2" aria-labelledby="poll-best-times">
      <div>
        <h2 id="poll-best-times" className="text-sm font-medium">
          Best times
        </h2>
        <p className="text-muted-foreground text-xs">
          {durationMinutes}-minute windows that suit the most people.
        </p>
      </div>
      {windows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          {total === 0
            ? "No answers yet. The best times show up here as people respond."
            : "No time works for anyone yet."}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {windows.map((w, index) => {
            const { day, time } = intervalParts(w.slot.startsAt, w.endsAt, timeZone);
            const selected = selectedStartId === w.slot.id;
            return (
              <li
                key={w.slot.id}
                className={cn(
                  "bg-card flex items-center gap-2 rounded-lg border p-2 transition-colors",
                  selected && "border-foreground/40 bg-muted/50",
                )}
              >
                <button
                  type="button"
                  className="focus-visible:ring-ring/50 min-w-0 flex-1 rounded-md px-1 text-left outline-none focus-visible:ring-3"
                  aria-pressed={selected}
                  onClick={() => onSelect(w)}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      <span className="sr-only">Option {index + 1}: </span>
                      {day}
                    </span>
                    <span className="text-xs tabular-nums">
                      <span className="font-semibold">{w.score}</span>
                      <span className="text-muted-foreground"> of {total}</span>
                    </span>
                  </span>
                  <span className="text-muted-foreground flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate">{time}</span>
                    {w.ifNeededKeys.length > 0 && (
                      <span className="shrink-0">{w.ifNeededKeys.length} if needed</span>
                    )}
                  </span>
                  <ScoreBar score={w.score} ifNeeded={w.ifNeededKeys.length} total={total} />
                </button>
                {onSchedule && (
                  <Button size="sm" variant="outline" onClick={() => onSchedule(w)}>
                    Schedule
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Share of respondents who can make a window: solid for yes, striped for if-needed. */
function ScoreBar({ score, ifNeeded, total }: { score: number; ifNeeded: number; total: number }) {
  if (total <= 0) return null;
  const yes = ((score - ifNeeded) / total) * 100;
  const maybe = (ifNeeded / total) * 100;
  return (
    <span aria-hidden className="bg-muted mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-full">
      {yes > 0 && <span className="bg-success h-full rounded-full" style={{ width: `${yes}%` }} />}
      {maybe > 0 && (
        <span className="h-full rounded-full" style={{ width: `${maybe}%`, ...IF_NEEDED_STYLE }} />
      )}
    </span>
  );
}

export function RespondentList({
  respondents,
}: {
  respondents: { key: string; name: string; isGuest: boolean }[];
}) {
  // On the public link members aren't named (poll-view.ts): one chip, not a row of "Member".
  const anonymousMembers = respondents.filter((r) => !r.isGuest && r.name === "Member").length;
  const named = respondents.filter((r) => r.isGuest || r.name !== "Member");
  return (
    <section className="space-y-2" aria-labelledby="poll-respondents">
      <h2 id="poll-respondents" className="text-sm font-medium">
        Responded{" "}
        <span className="text-muted-foreground font-normal tabular-nums">
          ({respondents.length})
        </span>
      </h2>
      {respondents.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {named.map((r) => (
            <li key={r.key}>
              <Badge variant="outline" className="h-6 max-w-48 gap-1 font-normal">
                <span className="truncate">{r.name}</span>
                {r.isGuest && <span className="text-muted-foreground">· guest</span>}
              </Badge>
            </li>
          ))}
          {anonymousMembers > 0 && (
            <li>
              <Badge variant="outline" className="h-6 font-normal">
                {anonymousMembers === 1 ? "1 member" : `${anonymousMembers} members`}
              </Badge>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Members and guests available at a window's first slot: who finalizing invites, and who it can't. */
export function inviteesAt(
  slotId: string,
  responses: PollResponseLite[],
): { members: number; guests: number } {
  let members = 0;
  let guests = 0;
  for (const r of responses) {
    if (r.slotId !== slotId || r.availability === "NO") continue;
    if (r.isGuest) guests++;
    else members++;
  }
  return { members, guests };
}
