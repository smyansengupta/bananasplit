"use client";

import { ChevronDown, Plus, Trash2, X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { saveBookingLinkAction } from "@/app/app/[orgSlug]/meetings/booking/actions";
import { ReminderPicker } from "@/components/meetings/reminder-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHead } from "@/components/ui/dialog";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chipClass, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import {
  BOOKING_DURATIONS,
  DAY_NAMES,
  DEFAULT_HOURS,
  ISO_DAYS,
  minuteInput,
  parseMinuteInput,
  type DateOverride,
  type IsoDay,
  type MinuteRange,
  type WeeklyHours,
} from "@/lib/booking/hours";
import type { BookingQuestion } from "@/lib/crm/outreach/booking";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type { BookingLinkState } from "@/server/booking/view";

/**
 * A booking link's editor, as the app's centered dialog (the New event
 * dialog's look: the title, then the fields that matter, the rest behind
 * More options). The heart of it is "fill in the times you're free": each
 * weekday's ranges, plus one-off dates (a day off, or other hours that day).
 * Busy times on your calendar, in every space you're in, are always left
 * out on top of these.
 */
export function LinkDialog({
  orgId,
  link,
  members,
  pipelines,
  timeZones,
  orgTimeZone,
  crmOn,
  onOpenChange,
}: {
  orgId: string;
  link: BookingLinkState;
  members: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
  timeZones: string[];
  orgTimeZone: string;
  crmOn: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState(link.title);
  const [description, setDescription] = useState(link.description);
  const [durationMin, setDurationMin] = useState(link.durationMin);
  const [durations, setDurations] = useState<number[]>(link.durations);
  const [useHours, setUseHours] = useState(link.personal || link.hours !== null);
  const [hours, setHours] = useState<WeeklyHours>(link.hours ?? DEFAULT_HOURS);
  const [overrides, setOverrides] = useState<DateOverride[]>(link.dateOverrides);
  const [timezone, setTimezone] = useState(link.timezone || orgTimeZone);
  const [bufferMin, setBufferMin] = useState(link.bufferMin);
  const [minNoticeHours, setMinNoticeHours] = useState(link.minNoticeHours);
  const [maxDaysAhead, setMaxDaysAhead] = useState(link.maxDaysAhead);
  const [maxPerDay, setMaxPerDay] = useState<number | null>(link.maxPerDay);
  const [hostIds, setHostIds] = useState(link.hostIds);
  const [video, setVideo] = useState(link.video);
  const [location, setLocation] = useState(link.location);
  const [reminders, setReminders] = useState(link.reminderMinutes);
  const [questions, setQuestions] = useState<BookingQuestion[]>(link.questions);
  const [pipelineId, setPipelineId] = useState(link.pipelineId ?? "");
  const [active, setActive] = useState(link.active);
  const [slug, setSlug] = useState(link.slug);
  const [more, setMore] = useState(false);
  const [hostFilter, setHostFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const shownMembers = useMemo(() => {
    const q = hostFilter.trim().toLowerCase();
    const list = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members;
    return list.slice(0, 40);
  }, [members, hostFilter]);

  const save = async () => {
    setSaving(true);
    const r = await runAction(() =>
      saveBookingLinkAction(orgId, link.id, {
        title,
        description: description || null,
        durationMin,
        durations: durations.filter((d) => d !== durationMin),
        bufferMin,
        minNoticeHours,
        maxDaysAhead,
        maxPerDay,
        timezone: useHours ? timezone : null,
        hours: useHours ? hours : null,
        dateOverrides: useHours ? overrides : [],
        questions: questions.filter((q) => q.label.trim()),
        video,
        location: location || null,
        reminderMinutes: reminders,
        active,
        slug,
        ...(link.personal ? {} : { hostIds, pipelineId: pipelineId || null }),
      }),
    );
    setSaving(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: "Saved" });
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] gap-4 overflow-x-hidden overflow-y-auto sm:max-w-lg">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogHead className="-me-2 -mt-2" title={link.personal ? "Your booking link" : "Edit booking link"}>
            <DialogDescription className="sr-only">When people can book this link, and for how long.</DialogDescription>
          </DialogHead>

          <div className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-title`}>Name</Label>
              <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
            </div>

            <div className="grid gap-1.5">
              <span className="text-sm leading-none font-medium">How long</span>
              <div className={cn(segmentedTrack, "flex-wrap self-start")} role="group" aria-label="Default length">
                {BOOKING_DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={durationMin === d}
                    className={segmentedItem(durationMin === d)}
                    onClick={() => {
                      setDurationMin(d);
                      setDurations(durations.filter((x) => x !== d));
                    }}
                  >
                    {d} min
                  </button>
                ))}
              </div>
              <span className="text-muted-foreground pt-1 text-xs">Also let them pick</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {BOOKING_DURATIONS.filter((d) => d !== durationMin).map((d) => {
                  const on = durations.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      className={chipClass(on)}
                      onClick={() => setDurations(on ? durations.filter((x) => x !== d) : [...durations, d].slice(0, 3))}
                    >
                      {d} min
                    </button>
                  );
                })}
              </div>
            </div>

            <fieldset className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <legend className="text-sm font-medium">When you&apos;re free</legend>
                {!link.personal && (
                  <div className="flex items-center gap-2">
                    <Switch id={`${id}-own`} checked={useHours} onCheckedChange={setUseHours} />
                    <Label htmlFor={`${id}-own`} className="text-sm font-normal">
                      Set hours for this link
                    </Label>
                  </div>
                )}
              </div>
              {useHours ? (
                <>
                  <WeekEditor hours={hours} onChange={setHours} />
                  <DateOverrides overrides={overrides} onChange={setOverrides} />
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-tz`}>Time zone</Label>
                    <FieldSelect id={`${id}-tz`} value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full">
                      {!timeZones.includes(timezone) && <option value={timezone}>{timezone}</option>}
                      {timeZones.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </FieldSelect>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Each host&apos;s availability (Find a time), or weekdays 9 to 5 for a host who never set it.
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                Anything already on {link.personal ? "your" : "a host's"} calendar, in any space, is never offered.
              </p>
            </fieldset>

            {!link.personal && (
              <div className="grid gap-1.5">
                <span className="text-sm leading-none font-medium">Hosts</span>
                <p className="text-muted-foreground text-xs">
                  One host books them every time. Several take turns: each booking goes to whoever is free and has had the fewest lately.
                </p>
                {members.length > 12 && (
                  <Input value={hostFilter} onChange={(e) => setHostFilter(e.target.value)} placeholder="Find someone" aria-label="Find a member" />
                )}
                <div className="flex flex-wrap gap-1.5">
                  {shownMembers.map((m) => {
                    const on = hostIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={on}
                        className={chipClass(on)}
                        onClick={() => setHostIds(on ? hostIds.filter((h) => h !== m.id) : [...hostIds, m.id])}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`${id}-video`}>Online, with a video link</Label>
                <Switch id={`${id}-video`} checked={video} onCheckedChange={setVideo} />
              </div>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={300}
                aria-label={video ? "A standing video link" : "Where"}
                placeholder={video ? "A standing video link, if no account is connected" : "An address or a room"}
              />
              {video && (
                <p className="text-muted-foreground text-xs">
                  The organization&apos;s connected Meet, Zoom or Teams makes a link for each booking.
                </p>
              )}
            </div>

            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore(!more)}
              className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 border-t pt-3 text-sm font-medium transition-colors"
            >
              <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} aria-hidden="true" />
              More options
            </button>
            {more && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Gap between meetings (minutes)" value={bufferMin} min={0} max={120} onChange={setBufferMin} />
                  <NumberField label="Least notice (hours)" value={minNoticeHours} min={0} max={336} onChange={setMinNoticeHours} />
                  <NumberField label="How far ahead (days)" value={maxDaysAhead} min={1} max={90} onChange={setMaxDaysAhead} />
                  <NumberField
                    label="Most a day (blank for no limit)"
                    value={maxPerDay ?? ""}
                    min={1}
                    max={24}
                    onChange={(n) => setMaxPerDay(n || null)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <span className="text-sm leading-none font-medium">Reminders, to you and the guest</span>
                  <ReminderPicker value={reminders} onChange={setReminders} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-desc`}>About it</Label>
                  <Textarea id={`${id}-desc`} rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <span className="text-sm leading-none font-medium">Questions</span>
                  {questions.map((q, i) => (
                    <div key={q.id} className="flex items-center gap-2">
                      <Input
                        value={q.label}
                        maxLength={200}
                        aria-label={`Question ${i + 1}`}
                        onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      />
                      <button
                        type="button"
                        aria-pressed={q.required}
                        className={chipClass(q.required)}
                        onClick={() => setQuestions(questions.map((x, j) => (j === i ? { ...x, required: !x.required } : x)))}
                      >
                        Required
                      </button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove the question" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  {questions.length < 10 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() => setQuestions([...questions, { id: `q${Date.now().toString(36)}`, label: "", required: false }])}
                    >
                      <Plus aria-hidden="true" />
                      Add a question
                    </Button>
                  )}
                </div>
                {!link.personal && crmOn && pipelines.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-pipe`}>Also open a deal in</Label>
                    <FieldSelect id={`${id}-pipe`} value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="w-full">
                      <option value="">No deal</option>
                      {pipelines.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </FieldSelect>
                  </div>
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-slug`}>Link</Label>
                  <Input id={`${id}-slug`} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={48} />
                  <p className="text-muted-foreground text-xs">/book/{slug}</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`${id}-active`}>Taking bookings</Label>
                  <Switch id={`${id}-active`} checked={active} onCheckedChange={setActive} />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={saving || !title.trim() || (!link.personal && hostIds.length === 0)}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | "";
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Math.min(max, Math.max(min, Number(e.target.value))))}
      />
    </div>
  );
}

/** Each weekday's free ranges: a switch per day, then its ranges as from-to times. */
function WeekEditor({ hours, onChange }: { hours: WeeklyHours; onChange: (h: WeeklyHours) => void }) {
  const set = (d: IsoDay, ranges: MinuteRange[]) => onChange({ ...hours, [d]: ranges });
  return (
    <div className="divide-border rounded-lg border">
      {ISO_DAYS.map((d) => {
        const ranges = hours[d];
        const on = ranges.length > 0;
        return (
          <div key={d} className="flex items-start gap-2 border-b px-3 py-2 last:border-b-0">
            <div className="flex w-[4.75rem] shrink-0 items-center gap-2 pt-1">
              <Switch
                checked={on}
                aria-label={`Free on ${DAY_NAMES[d]}`}
                onCheckedChange={(v) => set(d, v ? [[540, 1020]] : [])}
              />
              <span className="text-sm">{DAY_NAMES[d].slice(0, 3)}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {!on ? (
                <span className="text-muted-foreground pt-1.5 text-sm">Not free</span>
              ) : (
                ranges.map((r, i) => (
                  <RangeRow
                    key={i}
                    range={r}
                    label={DAY_NAMES[d]}
                    onChange={(next) => set(d, ranges.map((x, j) => (j === i ? next : x)))}
                    onRemove={() => set(d, ranges.filter((_, j) => j !== i))}
                    onAdd={i === ranges.length - 1 && ranges.length < 8 ? () => set(d, [...ranges, nextRange(r)]) : undefined}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function nextRange(after: MinuteRange): MinuteRange {
  const start = Math.min(after[1] + 60, 1380);
  return [start, Math.min(start + 120, 1440)];
}

function RangeRow({
  range,
  label,
  onChange,
  onRemove,
  onAdd,
}: {
  range: MinuteRange;
  label: string;
  onChange: (r: MinuteRange) => void;
  onRemove: () => void;
  onAdd?: () => void;
}) {
  const bad = range[1] <= range[0];
  return (
    <div className="flex items-center gap-1">
      <Input
        type="time"
        step={900}
        className="h-8 w-[6.75rem] px-2"
        aria-label={`${label} from`}
        value={minuteInput(range[0])}
        onChange={(e) => {
          const v = parseMinuteInput(e.target.value);
          if (v !== null) onChange([Math.min(v, 1425), range[1]]);
        }}
      />
      <span className="text-muted-foreground text-sm">to</span>
      <Input
        type="time"
        step={900}
        className={cn("h-8 w-[6.75rem] px-2", bad && "border-destructive")}
        aria-label={`${label} until`}
        value={minuteInput(range[1])}
        onChange={(e) => {
          const v = parseMinuteInput(e.target.value);
          if (v !== null) onChange([range[0], v === 0 ? 1440 : v]);
        }}
      />
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove these ${label} hours`} onClick={onRemove}>
        <X className="size-4" aria-hidden="true" />
      </Button>
      {onAdd && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Add more ${label} hours`} onClick={onAdd}>
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/** One-off dates: a day off, or other hours that day. */
function DateOverrides({ overrides, onChange }: { overrides: DateOverride[]; onChange: (o: DateOverride[]) => void }) {
  const [date, setDate] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = overrides.filter((o) => o.date >= today);
  const add = (off: boolean) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const rest = overrides.filter((o) => o.date !== date);
    onChange([...rest, { date, ranges: off ? [] : ([[540, 1020]] as MinuteRange[]) }].sort((a, b) => a.date.localeCompare(b.date)));
    setDate("");
  };
  const label = (key: string) =>
    new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div className="grid gap-2">
      <span className="text-sm leading-none font-medium">One-off dates</span>
      {upcoming.map((o) => (
        <div key={o.date} className="flex flex-wrap items-start gap-3">
          <span className="w-[4.75rem] shrink-0 pt-1.5 text-sm">{label(o.date)}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {o.ranges.length === 0 ? (
              <span className="text-muted-foreground pt-1.5 text-sm">Not free all day</span>
            ) : (
              o.ranges.map((r, i) => (
                <RangeRow
                  key={i}
                  range={r}
                  label={label(o.date)}
                  onChange={(next) =>
                    onChange(overrides.map((x) => (x.date === o.date ? { ...x, ranges: x.ranges.map((y, j) => (j === i ? next : y)) } : x)))
                  }
                  onRemove={() => onChange(overrides.map((x) => (x.date === o.date ? { ...x, ranges: x.ranges.filter((_, j) => j !== i) } : x)))}
                />
              ))
            )}
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Forget ${label(o.date)}`} onClick={() => onChange(overrides.filter((x) => x.date !== o.date))}>
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" min={today} className="h-8 w-auto" aria-label="A date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button type="button" variant="outline" size="sm" disabled={!date} onClick={() => add(true)}>
          Not free that day
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!date} onClick={() => add(false)}>
          Other hours that day
        </Button>
      </div>
    </div>
  );
}
