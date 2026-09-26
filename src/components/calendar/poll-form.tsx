"use client";

import { ArrowLeft, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";

import { createPoll } from "@/app/app/[orgSlug]/calendar/polls/actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { pollSlots } from "@/lib/calendar/poll-slots";

import { useViewerTimeZone } from "./hooks";
import { dayLabel, intervalParts, timeOfDayLabel, timeZoneDisplayName } from "./poll-format";
import { TimeZoneCombobox } from "./time-zone-combobox";

const MAX_SLOTS = 2000;
const MAX_DATES = 31;

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutesFromTimeInput(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function PollForm({
  orgId,
  orgSlug,
  defaultTimezone,
}: {
  orgId: string;
  orgSlug: string;
  /** The org's timezone; the viewer's own is the fallback. */
  defaultTimezone?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const deviceZone = useViewerTimeZone(defaultTimezone ?? "UTC");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dates, setDates] = useState<Date[]>([]);
  const [dailyStart, setDailyStart] = useState("09:00");
  const [dailyEnd, setDailyEnd] = useState("17:00");
  const [granularity, setGranularity] = useState<15 | 30 | 60>(30);
  const [duration, setDuration] = useState(60);
  const [closesAt, setClosesAt] = useState("");
  const [chosenZone, setChosenZone] = useState<string | null>(defaultTimezone ?? null);
  const timezone = chosenZone ?? deviceZone;
  const [today] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const dateKeys = useMemo(() => dates.map(localDate).sort(), [dates]);
  const startMinutes = minutesFromTimeInput(dailyStart || "00:00");
  const endMinutes = minutesFromTimeInput(dailyEnd || "00:00");
  const windowError =
    dailyStart && dailyEnd && endMinutes <= startMinutes
      ? "The end must be after the start."
      : null;
  const slotCount = useMemo(() => {
    if (windowError || dateKeys.length === 0) return 0;
    return pollSlots({
      timezone,
      dates: dateKeys,
      dailyStartMinutes: startMinutes,
      dailyEndMinutes: endMinutes,
      granularityMinutes: granularity,
    }).length;
  }, [windowError, dateKeys, timezone, startMinutes, endMinutes, granularity]);
  const perDay = dateKeys.length ? Math.round(slotCount / dateKeys.length) : 0;
  const durationError =
    !Number.isFinite(duration) || duration < 15
      ? "At least 15 minutes."
      : duration > 24 * 60
        ? "At most 24 hours."
        : null;

  // What the daily window is in the creator's own zone, when the poll's differs.
  const localEcho = useMemo(() => {
    if (timezone === deviceZone || windowError || !dailyStart || !dailyEnd) return null;
    const slots = pollSlots({
      timezone,
      dates: [dateKeys[0] ?? localDate(today)],
      dailyStartMinutes: startMinutes,
      dailyEndMinutes: endMinutes,
      granularityMinutes: endMinutes - startMinutes,
    });
    if (slots.length === 0) return null;
    return intervalParts(slots[0].startsAt, slots[0].endsAt, deviceZone).time;
  }, [
    timezone,
    deviceZone,
    windowError,
    dailyStart,
    dailyEnd,
    dateKeys,
    today,
    startMinutes,
    endMinutes,
  ]);

  const tooMany = slotCount > MAX_SLOTS;
  const canSubmit =
    Boolean(title.trim()) &&
    dateKeys.length > 0 &&
    !windowError &&
    !durationError &&
    slotCount > 0 &&
    !tooMany;

  function removeDate(key: string) {
    setDates((prev) => prev.filter((d) => localDate(d) !== key));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await createPoll(orgId, {
        title,
        description: description || null,
        timezone,
        dates: dateKeys,
        dailyStartMinutes: startMinutes,
        dailyEndMinutes: endMinutes,
        granularityMinutes: granularity,
        durationMinutes: duration,
        // datetime-local is the viewer's wall time; send the instant.
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/app/${orgSlug}/calendar/polls/${result.pollId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-8" noValidate>
      <div className="space-y-3">
        <Link
          href={`/app/${orgSlug}/calendar/polls`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Availability polls
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New availability poll</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Offer some days and hours; people mark when they&apos;re free, and an admin schedules
            the best time.
          </p>
        </div>
      </div>

      <Section title="What it's for">
        <div className="grid gap-1.5">
          <Label htmlFor="poll-title">Title</Label>
          <Input
            id="poll-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Spring kickoff planning"
            autoFocus
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="poll-description">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="poll-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Anything people should know before they answer"
          />
        </div>
      </Section>

      <Section title="Days and hours">
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="grid gap-1.5">
            <span id="poll-dates-label" className="text-sm leading-none font-medium">
              Days to offer
            </span>
            <Calendar
              mode="multiple"
              selected={dates}
              onSelect={(value) => setDates((value ?? []).slice(0, MAX_DATES))}
              disabled={{ before: today }}
              max={MAX_DATES}
              aria-labelledby="poll-dates-label"
              className="w-fit rounded-lg border [--cell-size:--spacing(9)]"
            />
          </div>
          <div className="grid content-start gap-1.5">
            <span className="text-sm leading-none font-medium">
              {dateKeys.length === 0
                ? "No days picked yet"
                : `${dateKeys.length} ${dateKeys.length === 1 ? "day" : "days"} picked`}
            </span>
            {dateKeys.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Pick one or more days on the calendar.
              </p>
            ) : (
              <>
                <ul className="flex flex-wrap gap-1.5" aria-label="Days picked">
                  {dateKeys.map((key) => (
                    <li key={key}>
                      <span className="bg-muted inline-flex h-7 items-center gap-1 rounded-md pr-1 pl-2 text-xs font-medium">
                        {dayLabel(key)}
                        <button
                          type="button"
                          onClick={() => removeDate(key)}
                          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm p-0.5 outline-none focus-visible:ring-3"
                          aria-label={`Remove ${dayLabel(key)}`}
                        >
                          <X aria-hidden className="size-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() => setDates([])}
                >
                  Clear all
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="poll-start">From</Label>
            <Input
              id="poll-start"
              type="time"
              step={900}
              value={dailyStart}
              onChange={(e) => setDailyStart(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="poll-end">Until</Label>
            <Input
              id="poll-end"
              type="time"
              step={900}
              value={dailyEnd}
              aria-invalid={windowError ? true : undefined}
              aria-describedby={windowError ? "poll-window-error" : undefined}
              onChange={(e) => setDailyEnd(e.target.value)}
            />
          </div>
          {windowError && (
            <p id="poll-window-error" className="text-destructive text-xs sm:col-span-2">
              {windowError}
            </p>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="poll-timezone">Time zone for these hours</Label>
            <TimeZoneCombobox
              id="poll-timezone"
              value={timezone}
              onChange={setChosenZone}
              orgTimeZone={defaultTimezone}
              deviceTimeZone={deviceZone}
              aria-describedby="poll-timezone-help"
            />
            <p id="poll-timezone-help" className="text-muted-foreground text-xs">
              {localEcho
                ? `${timeOfDayLabel(dailyStart)} – ${timeOfDayLabel(dailyEnd)} in ${timeZoneDisplayName(timezone)} is ${localEcho} for you. Everyone sees the times in their own zone.`
                : "Everyone sees the times in their own time zone."}
            </p>
          </div>
        </div>
      </Section>

      <Section title="Options">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="poll-duration">Meeting length (minutes)</Label>
            <Input
              id="poll-duration"
              type="number"
              inputMode="numeric"
              min={15}
              max={1440}
              step={15}
              value={Number.isFinite(duration) ? duration : ""}
              aria-invalid={durationError ? true : undefined}
              aria-describedby="poll-duration-help"
              onChange={(e) => setDuration(e.target.valueAsNumber)}
            />
            <p
              id="poll-duration-help"
              className={
                durationError ? "text-destructive text-xs" : "text-muted-foreground text-xs"
              }
            >
              {durationError ?? "The best times are windows this long."}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="poll-granularity">Time step</Label>
            <Select
              value={String(granularity)}
              onValueChange={(v) => setGranularity(Number(v) as 15 | 30 | 60)}
            >
              <SelectTrigger
                id="poll-granularity"
                className="w-full"
                aria-describedby="poll-granularity-help"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">Every 15 minutes</SelectItem>
                <SelectItem value="30">Every 30 minutes</SelectItem>
                <SelectItem value="60">Every hour</SelectItem>
              </SelectContent>
            </Select>
            <p id="poll-granularity-help" className="text-muted-foreground text-xs">
              How finely people mark their time.
            </p>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="poll-closes">
              Stop taking answers{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="poll-closes"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              aria-describedby="poll-closes-help"
              className="sm:max-w-xs"
            />
            <p id="poll-closes-help" className="text-muted-foreground text-xs">
              In your time zone. Leave empty to keep it open until someone schedules a time.
            </p>
          </div>
        </div>
      </Section>

      <div className="space-y-3 border-t pt-4">
        <p
          className={tooMany ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
          role="status"
        >
          {slotCount > 0
            ? `${dateKeys.length} ${dateKeys.length === 1 ? "day" : "days"} × ${perDay} times = ${slotCount} slots to answer.${
                tooMany
                  ? ` That's more than ${MAX_SLOTS}: pick fewer days or a bigger time step.`
                  : ""
              }`
            : !title.trim()
              ? "Add a title and pick at least one day."
              : dateKeys.length === 0
                ? "Pick at least one day."
                : windowError
                  ? "Fix the hours to continue."
                  : "Those hours don't fit a single slot at this time step."}
        </p>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href={`/app/${orgSlug}/calendar/polls`}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={isPending || !canSubmit}>
            {isPending && <Loader2 aria-hidden className="size-4 animate-spin" />}
            Create poll
          </Button>
        </div>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-base font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}
