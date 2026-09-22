"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { finalizePoll } from "@/app/app/[orgSlug]/calendar/polls/actions";
import { submitPollResponse } from "@/app/poll/[pollId]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PollAvailability } from "@/generated/prisma/enums";
import type { PollView } from "@/lib/polls/poll-view";
import { cn } from "@/lib/utils";

import {
  buildPollGrid,
  distinctRespondents,
  localDayKey,
  localTimeKey,
  rankSlotsByAvailability,
  type PollResponseLite,
} from "./poll-grid-utils";

const BRUSH_OPTIONS = [
  { value: PollAvailability.YES, label: "Available", className: "bg-emerald-500" },
  { value: PollAvailability.IF_NEEDED, label: "If needed", className: "bg-amber-500" },
  { value: PollAvailability.NO, label: "Unavailable", className: "bg-rose-500" },
] as const;

const CELL_COLOR: Record<PollAvailability, string> = {
  YES: "bg-emerald-500",
  IF_NEEDED: "bg-amber-500",
  NO: "bg-transparent",
};

const AVAILABILITY_LABEL: Record<PollAvailability, string> = {
  YES: "available",
  IF_NEEDED: "available if needed",
  NO: "unavailable",
};

export function PollResponder({
  poll,
  respondAs,
  orgId,
  orgSlug,
  canFinalize,
}: {
  /** The stripped DTO (src/lib/polls/poll-view.ts): no ids, emails or keys. */
  poll: PollView;
  /** Members of the poll's org answer as themselves; everyone else as a guest. */
  respondAs: "member" | "guest";
  orgId?: string;
  orgSlug?: string;
  canFinalize: boolean;
}) {
  const router = useRouter();
  const isGuest = respondAs === "guest";
  const [guestName, setGuestName] = useState(poll.myGuestName ?? "");
  const [brush, setBrush] = useState<PollAvailability>(PollAvailability.YES);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draggingRef = useRef(false);

  const [myResponses, setMyResponses] = useState<Record<string, PollAvailability>>(() => ({
    ...poll.myResponses,
  }));

  const grid = useMemo(() => buildPollGrid(poll.slots), [poll.slots]);

  const responseCountBySlot = useMemo(() => {
    const map = new Map<string, PollResponseLite[]>();
    for (const r of poll.responses) {
      const list = map.get(r.slotId) ?? [];
      list.push(r);
      map.set(r.slotId, list);
    }
    return map;
  }, [poll.responses]);

  const respondents = useMemo(() => distinctRespondents(poll.responses), [poll.responses]);

  const ranked = useMemo(
    () => rankSlotsByAvailability(poll.slots, poll.responses, poll.durationMinutes).slice(0, 8),
    [poll.slots, poll.responses, poll.durationMinutes],
  );

  const isFinalized = poll.isFinalized;
  const isClosed = isFinalized || (poll.closesAt ? poll.closesAt < new Date() : false);
  const canRespond = !isClosed && (!isGuest || Boolean(guestName.trim()));

  function paintCell(slotId: string) {
    setMyResponses((prev) => ({ ...prev, [slotId]: brush }));
  }

  async function flush(next: Record<string, PollAvailability>) {
    setIsSaving(true);
    setError(null);
    const result = await submitPollResponse({
      pollId: poll.id,
      guestName: isGuest ? guestName.trim() : null,
      entries: Object.entries(next).map(([slotId, availability]) => ({ slotId, availability })),
    });
    setIsSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function handlePointerDown(slotId: string) {
    if (!canRespond) return;
    draggingRef.current = true;
    setMyResponses((prev) => {
      const next = { ...prev, [slotId]: brush };
      return next;
    });
  }

  function handlePointerEnter(slotId: string) {
    if (!draggingRef.current || !canRespond) return;
    paintCell(slotId);
  }

  function handlePointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    void flush(myResponses);
  }

  // Cell buttons paint via pointerdown/pointerenter/pointerup for mouse and
  // touch drag. Keyboard activation (Enter/Space) fires a synthetic click
  // with event.detail === 0 (pointer-driven clicks have detail >= 1) — that's
  // the only path with no pointer events already handling it, so this is the
  // keyboard alternative to the drag-paint gesture.
  function handleCellKeyboardActivate(slotId: string, event: React.MouseEvent) {
    if (event.detail !== 0 || !canRespond) return;
    const next = { ...myResponses, [slotId]: brush };
    setMyResponses(next);
    void flush(next);
  }

  async function handleFinalize(slotId: string) {
    if (!orgId) return;
    const result = await finalizePoll(orgId, poll.id, slotId);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.excludedGuestCount) {
      setError(
        `${result.excludedGuestCount} respondent(s) weren't added as attendees: only members of this organization can be invited.`,
      );
    }
    if (orgSlug && result.eventId) {
      router.push(`/app/${orgSlug}/calendar/${result.eventId}`);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-6" onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{poll.title}</h1>
        {poll.description && (
          <p className="text-muted-foreground mt-1 text-sm">{poll.description}</p>
        )}
        <p className="text-muted-foreground mt-1 text-xs">
          Poll timezone: {poll.timezone} · Meeting length: {poll.durationMinutes} min
          {isFinalized && " · Finalized"}
          {!isFinalized && isClosed && " · Closed"}
        </p>
        {isFinalized && poll.finalizedEventId && orgSlug && (
          <p className="mt-1 text-sm">
            <Link
              href={`/app/${orgSlug}/calendar/${poll.finalizedEventId}`}
              className="text-primary hover:underline"
            >
              View the scheduled event →
            </Link>
          </p>
        )}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {!isClosed && (
        <div className="space-y-3">
          {isGuest && (
            <div className="max-w-xs space-y-1.5">
              <label htmlFor="guest-name" className="text-sm font-medium">
                Your name
              </label>
              <Input
                id="guest-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="So we know who responded"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Mark as:</span>
            {BRUSH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setBrush(option.value)}
                aria-pressed={brush === option.value}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
                  brush === option.value ? "border-foreground" : "border-transparent opacity-60",
                )}
              >
                <span className={cn("size-2.5 rounded-full", option.className)} />
                {option.label}
              </button>
            ))}
            {isSaving && <span className="text-muted-foreground text-xs">Saving…</span>}
          </div>
        </div>
      )}

      <p id="poll-grid-instructions" className="sr-only">
        Availability grid. Tab to a time slot and press Enter or Space to mark it with the
        currently selected availability.
      </p>
      <div className="overflow-x-auto">
        <table
          className="border-separate border-spacing-0.5"
          aria-describedby="poll-grid-instructions"
        >
          <thead>
            <tr>
              <th className="w-16" />
              {grid.days.map((day) => (
                <th key={day} className="text-muted-foreground px-1 pb-1 text-xs font-medium">
                  {formatDayHeader(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.times.map((time) => (
              <tr key={time}>
                <td className="text-muted-foreground pr-2 text-right text-xs">{time}</td>
                {grid.days.map((day) => {
                  const slot = grid.cellFor(day, time);
                  if (!slot) return <td key={day} />;
                  const count = responseCountBySlot.get(slot.id)?.length ?? 0;
                  const mine = myResponses[slot.id];
                  const who = (responseCountBySlot.get(slot.id) ?? [])
                    .map((r) => r.label)
                    .join(", ");
                  return (
                    <td key={day} className="p-0">
                      <button
                        type="button"
                        title={count > 0 ? who : undefined}
                        disabled={!canRespond}
                        onPointerDown={() => handlePointerDown(slot.id)}
                        onPointerEnter={() => handlePointerEnter(slot.id)}
                        onClick={(e) => handleCellKeyboardActivate(slot.id, e)}
                        aria-label={`${formatDayHeader(day)} at ${time}: ${
                          mine ? `marked ${AVAILABILITY_LABEL[mine]}` : "no response yet"
                        }${count > 0 ? `, ${count} response${count === 1 ? "" : "s"} so far` : ""}`}
                        className={cn(
                          "relative size-7 rounded-sm border disabled:cursor-not-allowed",
                          count === 0 && "bg-muted/40",
                        )}
                        style={
                          count > 0
                            ? { backgroundColor: heatColor(count, respondents.length || 1) }
                            : undefined
                        }
                      >
                        {mine && (
                          <span
                            className={cn(
                              "absolute inset-1 rounded-sm opacity-70",
                              CELL_COLOR[mine],
                            )}
                          />
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Best times ({respondents.length} responded)</p>
        {ranked.length === 0 ? (
          <p className="text-muted-foreground text-sm">No responses yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {ranked.map((r) => (
              <li
                key={r.slot.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <span>
                  {formatDayHeader(localDayKey(r.slot.startsAt))} at {localTimeKey(r.slot.startsAt)}
                  <span className="text-muted-foreground ml-2">{r.score} available</span>
                </span>
                {canFinalize && !isFinalized && (
                  <Button size="sm" variant="outline" onClick={() => handleFinalize(r.slot.id)}>
                    Finalize
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatDayHeader(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(y, m - 1, d),
  );
}

function heatColor(count: number, total: number): string {
  const intensity = Math.min(1, count / Math.max(1, total));
  const alpha = 0.15 + intensity * 0.65;
  return `rgba(16, 185, 129, ${alpha})`;
}
