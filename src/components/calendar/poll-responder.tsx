"use client";

import {
  CalendarCheck,
  Check,
  Clock,
  Globe,
  Loader2,
  Lock,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

import { finalizePoll } from "@/app/app/[orgSlug]/calendar/polls/actions";
import { submitPollResponse } from "@/app/poll/[pollId]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PollAvailability } from "@/generated/prisma/enums";
import type { PollView } from "@/lib/polls/poll-view";
import { cn } from "@/lib/utils";

import { useViewerTimeZone } from "./hooks";
import { intervalLabel, momentLabel, timeZoneDisplayName } from "./poll-format";
import { PollGridFrame } from "./poll-grid";
import {
  buildPollGrid,
  distinctRespondents,
  heatPercent,
  paintRect,
  pickDistinctWindows,
  rankSlotsByAvailability,
  strokeValue,
  summarizeSlots,
  summaryFor,
  type GridPosition,
  type PollResponseLite,
  type PollSlotLite,
  type RankedSlot,
} from "./poll-grid-utils";
import {
  AVAILABILITY_META,
  AnswerSwatch,
  BestTimes,
  HeatLegend,
  IfNeededMark,
  RespondentList,
  SlotDetails,
  heatFill,
  heatTextClass,
  inviteesAt,
} from "./poll-results";

/**
 * An availability poll, for anyone answering it: members in the app and
 * guests on the public link (the same component, fed the stripped PollView).
 *
 * Two grids on one set of axes. "Your availability" is painted: pick a
 * brush, then click, drag a rectangle (mouse or touch) or use the keyboard.
 * "Everyone" is a heatmap of how many people can make each slot, with the
 * names for any slot you point at, focus or tap. Times are drawn in the
 * viewer's timezone, which the page says, with a switch to the poll's own.
 */

const BRUSHES = [PollAvailability.YES, PollAvailability.IF_NEEDED, PollAvailability.NO] as const;
const KEYBOARD_SAVE_DELAY_MS = 700;

type SaveState = "idle" | "saving" | "saved" | "error";

interface Stroke {
  anchor: GridPosition;
  last: GridPosition;
  base: Record<string, PollAvailability>;
  value: PollAvailability;
}

export function PollResponder({
  poll,
  respondAs,
  orgId,
  orgSlug,
  canFinalize,
  actions,
  notices,
  aside,
}: {
  /** The stripped DTO (src/lib/polls/poll-view.ts): no ids, emails or keys. */
  poll: PollView;
  /** Members of the poll's org answer as themselves; everyone else as a guest. */
  respondAs: "member" | "guest";
  orgId?: string;
  orgSlug?: string;
  canFinalize: boolean;
  /** Buttons for the header (the app's share and delete). */
  actions?: ReactNode;
  /** Page-specific notes shown under the header. */
  notices?: ReactNode;
  /** Extra panels at the top of the side column. */
  aside?: ReactNode;
}) {
  const router = useRouter();
  const isGuest = respondAs === "guest";

  // --- time zone -----------------------------------------------------------
  const viewerZone = useViewerTimeZone(poll.timezone);
  const [showPollZone, setShowPollZone] = useState(false);
  const zone = showPollZone ? poll.timezone : viewerZone;
  const zonesDiffer = viewerZone !== poll.timezone;
  const grid = useMemo(() => buildPollGrid(poll.slots, zone), [poll.slots, zone]);
  const granularityMinutes = poll.slots[0]
    ? Math.round((poll.slots[0].endsAt.getTime() - poll.slots[0].startsAt.getTime()) / 60_000)
    : 30;

  // --- status --------------------------------------------------------------
  // Read once per render; the page re-renders on every save and refresh.
  const [now] = useState(() => Date.now());
  const isFinalized = poll.isFinalized;
  const isClosed = isFinalized || (poll.closesAt ? poll.closesAt.getTime() < now : false);

  // --- my answers ----------------------------------------------------------
  const [myResponses, setMyResponses] = useState<Record<string, PollAvailability>>(() => ({
    ...poll.myResponses,
  }));
  const [brush, setBrush] = useState<PollAvailability>(PollAvailability.YES);
  const [guestName, setGuestName] = useState(poll.myGuestName ?? "");
  const [savedName, setSavedName] = useState(poll.myGuestName ?? "");
  const [needsName, setNeedsName] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const keyboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const hasAnswered = Object.keys(myResponses).length > 0;

  // --- group view ----------------------------------------------------------
  const myKey = poll.myRespondentKey ?? "__me__";
  const groupResponses = useMemo<PollResponseLite[]>(() => {
    const others = poll.responses.filter((r) => r.respondentKey !== poll.myRespondentKey);
    const mine = Object.entries(myResponses).map(([slotId, availability]) => ({
      slotId,
      respondentKey: myKey,
      label: "You",
      isGuest,
      availability,
    }));
    return [...others, ...mine];
  }, [poll.responses, poll.myRespondentKey, myResponses, myKey, isGuest]);
  const respondents = useMemo(() => {
    const all = distinctRespondents(groupResponses);
    return [...all.filter((r) => r.key === myKey), ...all.filter((r) => r.key !== myKey)];
  }, [groupResponses, myKey]);
  const total = respondents.length;
  const summaries = useMemo(() => summarizeSlots(groupResponses), [groupResponses]);
  const ranked = useMemo(
    () => rankSlotsByAvailability(poll.slots, groupResponses, poll.durationMinutes),
    [poll.slots, groupResponses, poll.durationMinutes],
  );
  const bestWindows = useMemo(() => pickDistinctWindows(ranked, 5), [ranked]);
  const windowByStart = useMemo(() => new Map(ranked.map((w) => [w.slot.id, w])), [ranked]);
  const slotById = useMemo(() => new Map(poll.slots.map((s) => [s.id, s])), [poll.slots]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const activeSlot = slotById.get(hoveredId ?? pinnedId ?? "") ?? null;
  const highlighted = useMemo(() => new Set(highlight), [highlight]);
  const scheduledIds = useMemo(() => {
    if (!poll.scheduled) return new Set<string>();
    const from = poll.scheduled.startsAt.getTime();
    const to = poll.scheduled.endsAt.getTime();
    return new Set(
      poll.slots
        .filter((s) => s.startsAt.getTime() >= from && s.startsAt.getTime() < to)
        .map((s) => s.id),
    );
  }, [poll.scheduled, poll.slots]);

  const canEdit = !isClosed;
  const [tab, setTab] = useState<"mine" | "group">(canEdit && !hasAnswered ? "mine" : "group");
  const currentTab = canEdit ? tab : "group";

  // --- finalizing ----------------------------------------------------------
  const [scheduleTarget, setScheduleTarget] = useState<RankedSlot | null>(null);
  const [isScheduling, startScheduling] = useTransition();
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const canSchedule = canFinalize && !isFinalized && Boolean(orgId);

  useEffect(
    () => () => {
      if (keyboardTimer.current) clearTimeout(keyboardTimer.current);
    },
    [],
  );

  async function save(next: Record<string, PollAvailability>, name = guestName) {
    if (isGuest && !name.trim()) {
      setDirty(true);
      setNeedsName(true);
      return;
    }
    setSaveState("saving");
    setError(null);
    const result = await submitPollResponse({
      pollId: poll.id,
      guestName: isGuest ? name.trim() : null,
      entries: Object.entries(next).map(([slotId, availability]) => ({ slotId, availability })),
    });
    if (result.error) {
      setSaveState("error");
      setError(result.error);
      return;
    }
    setDirty(false);
    setNeedsName(false);
    if (isGuest) setSavedName(name.trim());
    setSaveState("saved");
    router.refresh();
  }

  // Pointer strokes: the value comes from the cell the stroke starts on, and
  // the stroke paints the rectangle from there to the pointer.
  function startStroke(slot: PollSlotLite, position: GridPosition, event: React.PointerEvent) {
    if (!canEdit || event.button !== 0) return;
    if (keyboardTimer.current) clearTimeout(keyboardTimer.current);
    const value = strokeValue(myResponses[slot.id], brush);
    stroke.current = { anchor: position, last: position, base: myResponses, value };
    setMyResponses(paintRect(myResponses, grid, position, position, value));
    const end = () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const s = stroke.current;
      stroke.current = null;
      if (!s) return;
      const next = paintRect(s.base, grid, s.anchor, s.last, s.value);
      setMyResponses(next);
      void save(next);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function continueStroke(_slot: PollSlotLite, position: GridPosition) {
    const s = stroke.current;
    if (!s) return;
    s.last = position;
    setMyResponses(paintRect(s.base, grid, s.anchor, position, s.value));
  }

  function paintWithKeyboard(
    slot: PollSlotLite,
    _position: GridPosition,
    { extend }: { extend: boolean },
  ) {
    if (!canEdit) return;
    const value = extend ? brush : strokeValue(myResponses[slot.id], brush);
    const next = { ...myResponses, [slot.id]: value };
    setMyResponses(next);
    if (keyboardTimer.current) clearTimeout(keyboardTimer.current);
    keyboardTimer.current = setTimeout(() => void save(next), KEYBOARD_SAVE_DELAY_MS);
  }

  function commitName() {
    const name = guestName.trim();
    if (!name) return;
    if (dirty || (hasAnswered && name !== savedName)) void save(myResponses, name);
  }

  function openSchedule(window: RankedSlot) {
    setScheduleError(null);
    setScheduleTarget(window);
  }

  function confirmSchedule() {
    if (!scheduleTarget || !orgId) return;
    startScheduling(async () => {
      const result = await finalizePoll(orgId, poll.id, scheduleTarget.slot.id);
      if (result.error) {
        setScheduleError(result.error);
        return;
      }
      if (orgSlug && result.eventId) router.push(`/app/${orgSlug}/calendar/${result.eventId}`);
      else router.refresh();
      setScheduleTarget(null);
    });
  }

  function selectWindow(window: RankedSlot) {
    setTab("group");
    setPinnedId(window.slot.id);
    setHighlight(window.slotIds);
  }

  // --- cell renderers --------------------------------------------------------
  function renderMine(slot: PollSlotLite) {
    const mine = myResponses[slot.id];
    const meta = mine ? AVAILABILITY_META[mine] : null;
    const Icon = meta?.icon;
    return {
      className: cn(
        meta ? meta.cellClass : "border-border bg-background",
        canEdit && "hover:brightness-95 dark:hover:brightness-110",
      ),
      style: meta?.style,
      content: Icon ? <Icon className="size-3" strokeWidth={3} /> : null,
      ariaLabel: `${intervalLabel(slot.startsAt, slot.endsAt, zone)}: ${meta ? meta.spoken : "not answered"}`,
    };
  }

  function renderGroup(slot: PollSlotLite) {
    const s = summaryFor(summaries, slot.id);
    const percent = heatPercent(s.available, total);
    const isHighlighted = highlighted.has(slot.id) || scheduledIds.has(slot.id);
    const isPinned = pinnedId === slot.id;
    const names = [
      s.yes.length ? `Available: ${s.yes.map((r) => r.label).join(", ")}` : "",
      s.ifNeeded.length ? `If needed: ${s.ifNeeded.map((r) => r.label).join(", ")}` : "",
      s.no.length ? `Unavailable: ${s.no.map((r) => r.label).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(". ");
    return {
      className: cn(
        "relative",
        percent === 0 && "border-border bg-background text-muted-foreground",
        heatTextClass(percent),
        (isHighlighted || isPinned) && "outline-foreground outline-2 -outline-offset-2",
      ),
      style: heatFill(percent),
      content:
        s.available > 0 ? (
          <>
            {s.available}
            {s.ifNeeded.length > 0 && <IfNeededMark />}
          </>
        ) : null,
      ariaLabel: `${intervalLabel(slot.startsAt, slot.endsAt, zone)}: ${s.available} of ${total} available${
        s.ifNeeded.length ? `, ${s.ifNeeded.length} only if needed` : ""
      }${scheduledIds.has(slot.id) ? ", the scheduled time" : ""}.${names ? ` ${names}.` : ""}`,
    };
  }

  const activeSummary = activeSlot ? summaryFor(summaries, activeSlot.id) : null;
  const activeUnanswered = activeSlot
    ? respondents
        .filter(
          (r) =>
            !groupResponses.some((g) => g.slotId === activeSlot.id && g.respondentKey === r.key),
        )
        .map((r) => ({ label: r.name }))
    : [];
  const activeWindow = activeSlot ? windowByStart.get(activeSlot.id) : undefined;
  const details = (className?: string) => (
    <SlotDetails
      className={className}
      slot={activeSlot}
      summary={activeSummary}
      total={total}
      unanswered={activeUnanswered}
      timeZone={zone}
      onSchedule={
        canSchedule && activeSlot ? () => activeWindow && openSchedule(activeWindow) : undefined
      }
      scheduleHint={
        activeSlot && !activeWindow
          ? `A ${poll.durationMinutes}-minute meeting doesn't fit from this time.`
          : null
      }
    />
  );

  // On a phone the read-out floats over the grid's bottom edge, so it only
  // appears once a time is picked, and can be put away.
  const mobileDetails = activeSlot ? (
    <div className="sticky bottom-3 z-40 lg:hidden">
      {details("shadow-md pr-9")}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1.5 right-1.5"
        aria-label="Close"
        onClick={() => {
          setPinnedId(null);
          setHoveredId(null);
          setHighlight([]);
        }}
      >
        <X className="size-4" />
      </Button>
    </div>
  ) : null;

  const scheduleInvitees = scheduleTarget
    ? inviteesAt(scheduleTarget.slot.id, groupResponses)
    : null;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- header */}
      {/* Not a <header>: on the public link the org frame owns the page header. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="page-title break-words">{poll.title}</h1>
          {poll.description && (
            <p className="text-muted-foreground max-w-prose text-sm whitespace-pre-wrap">
              {poll.description}
            </p>
          )}
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <StatusBadge finalized={isFinalized} closed={isClosed} />
            {!isClosed && poll.closesAt && <span>Closes {momentLabel(poll.closesAt, zone)}</span>}
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden className="size-3.5" />
              {poll.durationMinutes}-minute meeting
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users aria-hidden className="size-3.5" />
              {total} responded
            </span>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>

      {/* --------------------------------------------------------------- notices */}
      {isFinalized && (
        <Note icon={<CalendarCheck aria-hidden className="size-4" />}>
          {poll.scheduled ? (
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Scheduled for{" "}
                <strong className="font-medium">
                  {intervalLabel(poll.scheduled.startsAt, poll.scheduled.endsAt, zone)}
                </strong>
                . The outlined cells below are that time.
              </span>
              {poll.finalizedEventId && orgSlug && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/app/${orgSlug}/calendar/${poll.finalizedEventId}`}>View event</Link>
                </Button>
              )}
            </span>
          ) : (
            "The organizers have picked a time, so this poll no longer takes answers."
          )}
        </Note>
      )}
      {!isFinalized && isClosed && (
        <Note icon={<Lock aria-hidden className="size-4" />}>
          This poll closed {poll.closesAt ? momentLabel(poll.closesAt, zone) : ""}, so answers
          can&apos;t change.
          {canSchedule && " You can still schedule one of the best times."}
        </Note>
      )}
      {/* Server-made elements go in a wrapper of their own: rendered straight into a list of
          siblings, React (dev) reads the not-yet-resolved element as an unkeyed list child. */}
      {notices && <div>{notices}</div>}

      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Globe aria-hidden className="size-4 shrink-0" />
        <span>
          {!zonesDiffer
            ? "Times in "
            : showPollZone
              ? "Times in the poll's time zone, "
              : "Times in your time zone, "}
          <span className="text-foreground font-medium">{timeZoneDisplayName(zone)}</span>.
        </span>
        {zonesDiffer && (
          <button
            type="button"
            className="text-primary focus-visible:ring-ring/50 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3"
            onClick={() => setShowPollZone((v) => !v)}
          >
            {showPollZone
              ? "Show in my time zone"
              : `Show in ${timeZoneDisplayName(poll.timezone)}`}
          </button>
        )}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        {/* ------------------------------------------------------------ grids */}
        <div className="min-w-0">
          {canEdit ? (
            <Tabs
              value={currentTab}
              onValueChange={(v) => setTab(v as "mine" | "group")}
              className="gap-4"
            >
              <TabsList className="w-full sm:w-fit">
                <TabsTrigger value="mine" className="sm:px-3">
                  Your availability
                </TabsTrigger>
                <TabsTrigger value="group" className="sm:px-3">
                  Everyone <span className="text-muted-foreground tabular-nums">({total})</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="mine" className="space-y-3">
                {isGuest && (
                  <div className="grid max-w-sm gap-1.5">
                    <Label htmlFor="guest-name">Your name</Label>
                    <Input
                      ref={nameInput}
                      id="guest-name"
                      value={guestName}
                      autoComplete="name"
                      maxLength={100}
                      aria-invalid={needsName && !guestName.trim() ? true : undefined}
                      aria-describedby="guest-name-help"
                      onChange={(e) => setGuestName(e.target.value)}
                      onBlur={commitName}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitName();
                      }}
                      placeholder="So the organizers know who answered"
                    />
                    <p
                      id="guest-name-help"
                      className={cn(
                        "text-xs",
                        needsName && !guestName.trim()
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {needsName && !guestName.trim()
                        ? "Add your name to save the times you marked."
                        : "Everyone with the link sees this name next to your answers."}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <BrushPicker value={brush} onChange={setBrush} />
                  <SaveStatus
                    state={saveState}
                    dirty={dirty}
                    needsName={needsName && !guestName.trim()}
                  />
                </div>
                <p id="poll-paint-help" className="text-muted-foreground text-xs">
                  Click a time, or drag across several, to mark them. Start on a time you&apos;ve
                  already marked to undo. Empty boxes are times you haven&apos;t answered.
                  <span className="hidden pointer-coarse:inline">
                    {" "}
                    Drag the time column to scroll.
                  </span>
                  <span className="sr-only">
                    {" "}
                    With the keyboard: arrow keys move, Space marks the time, Shift with an arrow
                    marks as you move.
                  </span>
                </p>
                <PollGridFrame
                  grid={grid}
                  label="Your availability"
                  describedBy="poll-paint-help"
                  granularityMinutes={granularityMinutes}
                  paintable
                  renderCell={renderMine}
                  onActivate={paintWithKeyboard}
                  onCellPointerDown={startStroke}
                  onPointerOverCell={continueStroke}
                />
              </TabsContent>

              <TabsContent value="group" className="space-y-3">
                <GroupView
                  total={total}
                  grid={
                    <PollGridFrame
                      grid={grid}
                      label="Everyone's availability"
                      describedBy="poll-heat-help"
                      granularityMinutes={granularityMinutes}
                      renderCell={renderGroup}
                      onHoverSlot={(slot) => setHoveredId(slot?.id ?? null)}
                      onFocusSlot={(slot) => setPinnedId(slot.id)}
                      onCellPointerDown={(slot) => {
                        setPinnedId(slot.id);
                        setHighlight([]);
                      }}
                      onActivate={(slot) => setPinnedId(slot.id)}
                    />
                  }
                  details={mobileDetails}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-3">
              <h2 className="text-sm font-medium">Everyone&apos;s availability</h2>
              <GroupView
                total={total}
                grid={
                  <PollGridFrame
                    grid={grid}
                    label="Everyone's availability"
                    describedBy="poll-heat-help"
                    granularityMinutes={granularityMinutes}
                    renderCell={renderGroup}
                    onHoverSlot={(slot) => setHoveredId(slot?.id ?? null)}
                    onFocusSlot={(slot) => setPinnedId(slot.id)}
                    onCellPointerDown={(slot) => {
                      setPinnedId(slot.id);
                      setHighlight([]);
                    }}
                    onActivate={(slot) => setPinnedId(slot.id)}
                  />
                }
                details={mobileDetails}
              />
            </div>
          )}

          {error && (
            <p className="text-destructive mt-3 flex items-center gap-1.5 text-sm" role="alert">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        {/* ------------------------------------------------------------- aside */}
        <aside className="min-w-0 space-y-6 lg:sticky lg:top-4 lg:self-start">
          {currentTab === "group" && details("hidden lg:block")}
          {aside && <div>{aside}</div>}
          <BestTimes
            windows={bestWindows}
            total={total}
            timeZone={zone}
            durationMinutes={poll.durationMinutes}
            selectedStartId={highlight.length ? highlight[0] : null}
            onSelect={selectWindow}
            onSchedule={canSchedule ? openSchedule : undefined}
          />
          <RespondentList respondents={respondents} />
          {isGuest && !isClosed && (
            <p className="text-muted-foreground text-xs">
              An organizer picks the final time in the app once people have answered.
            </p>
          )}
        </aside>
      </div>

      {/* --------------------------------------------------------- schedule */}
      <Dialog
        open={scheduleTarget !== null}
        onOpenChange={(open) => !open && !isScheduling && setScheduleTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule this time?</DialogTitle>
            <DialogDescription>
              {scheduleTarget &&
                intervalLabel(scheduleTarget.slot.startsAt, scheduleTarget.endsAt, zone)}
            </DialogDescription>
          </DialogHeader>
          {scheduleTarget && scheduleInvitees && (
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
              <li>Creates an internal event, &ldquo;{poll.title}&rdquo;, and closes the poll.</li>
              <li>
                {scheduleInvitees.members === 0
                  ? "No members are invited: none marked the start time as available."
                  : `Invites the ${scheduleInvitees.members === 1 ? "member" : `${scheduleInvitees.members} members`} who can make the start time.`}
              </li>
              {scheduleInvitees.guests > 0 && (
                <li>
                  {scheduleInvitees.guests === 1 ? "1 guest" : `${scheduleInvitees.guests} guests`}{" "}
                  can make it but can&apos;t be invited (only members can), so let them know
                  yourself.
                </li>
              )}
            </ul>
          )}
          {scheduleError && (
            <p className="text-destructive text-sm" role="alert">
              {scheduleError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setScheduleTarget(null)}
              disabled={isScheduling}
            >
              Cancel
            </Button>
            <Button onClick={confirmSchedule} disabled={isScheduling}>
              {isScheduling && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupView({
  total,
  grid,
  details,
}: {
  total: number;
  grid: ReactNode;
  details: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <HeatLegend total={total} />
      </div>
      <p id="poll-heat-help" className="text-muted-foreground text-xs">
        {total === 0
          ? "Nobody has answered yet. Each time will show how many people can make it."
          : "Each time shows how many people can make it. Point at a time, tap it or tab to it to see who."}
      </p>
      {grid}
      {total > 0 && details}
    </>
  );
}

function StatusBadge({ finalized, closed }: { finalized: boolean; closed: boolean }) {
  if (finalized) return <Badge>Scheduled</Badge>;
  if (closed) return <Badge variant="secondary">Closed</Badge>;
  return (
    <Badge variant="outline" className="gap-1">
      <span aria-hidden className="bg-success size-1.5 rounded-full" />
      Open
    </Badge>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-muted/40 flex gap-2 rounded-lg border p-3 text-sm" role="note">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function BrushPicker({
  value,
  onChange,
}: {
  value: PollAvailability;
  onChange: (v: PollAvailability) => void;
}) {
  return (
    <fieldset className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <legend className="sr-only">Mark times as</legend>
      <span aria-hidden className="text-sm font-medium">
        Mark as
      </span>
      <div className="bg-muted flex w-full rounded-lg p-[3px] sm:inline-flex sm:w-auto">
        {BRUSHES.map((option) => (
          <label
            key={option}
            className={cn(
              "text-foreground/70 hover:text-foreground flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-sm font-medium whitespace-nowrap transition-colors sm:flex-none sm:px-2.5",
              "has-checked:bg-background has-checked:text-foreground dark:has-checked:border-input dark:has-checked:bg-input/30 has-checked:shadow-sm",
              "has-focus-visible:ring-ring/50 has-focus-visible:ring-3",
            )}
          >
            <input
              type="radio"
              name="poll-brush"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            <AnswerSwatch value={option} className="size-3.5" />
            {AVAILABILITY_META[option].label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SaveStatus({
  state,
  dirty,
  needsName,
}: {
  state: SaveState;
  dirty: boolean;
  needsName: boolean;
}) {
  let content: ReactNode = null;
  if (needsName) content = <span>Not saved yet</span>;
  else if (state === "saving")
    content = (
      <>
        <Loader2 aria-hidden className="size-3.5 animate-spin" /> Saving…
      </>
    );
  else if (state === "error")
    content = (
      <span className="text-destructive inline-flex items-center gap-1">
        <X aria-hidden className="size-3.5" /> Not saved
      </span>
    );
  else if (state === "saved" && !dirty)
    content = (
      <>
        <Check aria-hidden className="text-success size-3.5" /> Saved
      </>
    );
  return (
    <span
      role="status"
      className="text-muted-foreground inline-flex items-center gap-1 text-xs sm:min-h-5"
    >
      {content}
    </span>
  );
}
