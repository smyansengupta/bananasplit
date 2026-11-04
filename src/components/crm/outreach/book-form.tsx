"use client";

import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Globe } from "@/components/icons";
import { useMemo, useState, useSyncExternalStore } from "react";

import { bookAction } from "@/app/book/[slug]/actions";
import { CrmAvatar } from "@/components/crm/card/crm-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import {
  longDay,
  monthGrid,
  monthOf,
  monthsBetween,
  shortDay,
  timesByDay,
  zoneName,
} from "@/lib/crm/outreach/booking-calendar";
import { cn } from "@/lib/utils";

/**
 * The public booking card (the Booking design): who you're meeting and how
 * long on the left; a month calendar (open days filled), that day's times
 * and, once a time is picked, a short form and Book on the right; then
 * "You're booked" with what was booked and Pick again. Times show in the
 * visitor's own time zone (their browser's), with the link's one a click
 * away; a link with several lengths offers them as a switch.
 */
export function BookForm({
  slug,
  tz,
  durations,
  slots: slotsByLength,
  questions,
  heading,
  hostName,
  description,
}: {
  slug: string;
  tz: string;
  durations: number[];
  /** Open starts (ISO) for each length offered. */
  slots: Record<number, string[]>;
  questions: { id: string; label: string; required: boolean }[];
  heading: string;
  hostName: string | null;
  description: string | null;
}) {
  const [durationMin, setDurationMin] = useState(durations[0] ?? 30);
  const slots = useMemo(() => slotsByLength[durationMin] ?? [], [slotsByLength, durationMin]);
  // The visitor's own zone once we know it (the server renders the link's).
  const browserZone = useSyncExternalStore(noSubscribe, readBrowserZone, () => null);
  const ownZone = browserZone && browserZone !== tz ? browserZone : null;
  const [useLinkZone, setUseLinkZone] = useState(false);
  const zone = ownZone && !useLinkZone ? ownZone : tz;
  const days = useMemo(() => timesByDay(slots, zone), [slots, zone]);
  const open = useMemo(() => new Map(days.map((d) => [d.key, d.slots])), [days]);
  const months = useMemo(
    () =>
      days.length ? monthsBetween(monthOf(days[0]!.key), monthOf(days[days.length - 1]!.key)) : [],
    [days],
  );
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  });
  const [monthPick, setMonth] = useState(0);
  const [dayPick, setDay] = useState(days[0]?.key ?? "");
  const [slotPick, setSlot] = useState<string | null>(null);
  // A new length or zone can leave the picks behind: fall back to the first open day.
  const dayValid = open.has(dayPick);
  const day = dayValid ? dayPick : (days[0]?.key ?? "");
  const month = dayValid
    ? Math.min(monthPick, Math.max(0, months.length - 1))
    : Math.max(0, months.indexOf(monthOf(day)));
  const slot = slotPick && (open.get(day) ?? []).includes(slotPick) ? slotPick : null;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [honey, setHoney] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ when: string; hostName: string; ics: string | null } | null>(null);

  const grid = months[month] ? monthGrid(months[month]!) : null;
  const showMonth = (i: number) => {
    setMonth(i);
    const first = days.find((d) => monthOf(d.key) === months[i]);
    if (first) {
      setDay(first.key);
      setSlot(null);
    }
  };
  const daySlots = open.get(day) ?? [];
  const summary = slot
    ? `${durationMin} min on ${shortDay(day)} at ${time.format(new Date(slot))}`
    : "";
  const firstQuestion = questions[0];

  const submit = async () => {
    if (!slot) return;
    setPending(true);
    setError(null);
    const r = await bookAction(slug, {
      start: slot,
      durationMin,
      name,
      email,
      answers,
      timeZone: zone,
      website: honey,
    }).catch(() => null);
    setPending(false);
    if (!r) return setError("That didn't go through. Try again.");
    if (!r.ok) return setError(r.error);
    setDone({
      when: `${shortDay(day)} at ${time.format(new Date(slot))}`,
      hostName: r.hostName || hostName || "",
      ics: r.start && r.end ? icsHref(r.title ?? heading, r.start, r.end) : null,
    });
  };

  return (
    <div className="bg-card ring-foreground/8 flex w-full max-w-[1120px] flex-wrap overflow-hidden rounded-[32px] shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1">
      <aside className="border-border/60 flex max-w-full flex-[1_1_300px] flex-col gap-5 border-b px-8 py-9 sm:max-w-[360px] sm:border-e sm:border-b-0">
        {hostName && <CrmAvatar name={hostName} size={64} />}
        <h1 className="display-title text-[40px] leading-none">{heading}</h1>
        {description && (
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{description}</p>
        )}
        <div className={cn(segmentedTrack, "self-start")} role="group" aria-label="How long">
          {durations.length > 1 ? (
            durations.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === durationMin}
                className={segmentedItem(d === durationMin)}
                onClick={() => setDurationMin(d)}
              >
                {d} min
              </button>
            ))
          ) : (
            <span className={segmentedItem(true)}>{durationMin} min</span>
          )}
        </div>
        <div className="text-muted-foreground flex flex-col gap-3 pt-1 text-sm">
          <span className="flex items-center gap-2.5">
            <CalendarDays className="size-[18px] shrink-0" aria-hidden="true" />A confirmation
            comes by email
          </span>
          <span className="flex items-center gap-2.5">
            <Globe className="size-[18px] shrink-0" aria-hidden="true" />
            <span>
              Times are {zoneName(zone)}
              {ownZone && (
                <>
                  .{" "}
                  <button
                    type="button"
                    className="text-foreground font-semibold underline underline-offset-4"
                    onClick={() => setUseLinkZone(!useLinkZone)}
                  >
                    Show {zoneName(zone === tz ? ownZone : tz)}
                  </button>
                </>
              )}
            </span>
          </span>
        </div>
      </aside>

      {done ? (
        <div className="flex min-w-0 flex-[999_1_560px] flex-col items-center justify-center gap-4 px-6 py-16 text-center sm:px-12">
          <span className="bg-foreground text-background grid size-[72px] place-items-center rounded-full">
            <Check className="size-8" aria-hidden="true" />
          </span>
          <h2 className="display-title max-w-[520px] text-[36px] leading-tight">
            You&apos;re booked, {done.when}.
          </h2>
          <p className="max-w-[460px] text-base">
            We sent the details to {email}. Open it and tap Confirm it&apos;s me so it&apos;s all
            set.
          </p>
          <div className="bg-muted mt-2 flex flex-col gap-2.5 rounded-3xl px-6 py-4 text-start text-[15px]">
            <span className="flex items-center gap-2.5">
              <Clock className="size-[18px]" aria-hidden="true" />
              {durationMin} minutes{done.hostName ? ` with ${done.hostName}` : ""}
            </span>
            <span className="flex items-center gap-2.5">
              <CalendarDays className="size-[18px]" aria-hidden="true" />
              {done.ics ? (
                <a href={done.ics} download="meeting.ics" className="font-semibold underline underline-offset-4">
                  Add it to your calendar
                </a>
              ) : (
                "Move or cancel from the email"
              )}
            </span>
          </div>
          <span className="text-muted-foreground pt-1.5 text-sm">
            Need another time? Use the link in the email, or{" "}
            <button
              type="button"
              className="text-foreground font-semibold underline underline-offset-4"
              onClick={() => {
                setDone(null);
                setSlot(null);
              }}
            >
              Pick again
            </button>
          </span>
        </div>
      ) : (
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-7 px-6 py-8 sm:px-9">
          {!grid ? (
            <p className="text-muted-foreground text-[15px]">
              No times are open right now. Check back soon.
            </p>
          ) : (
            <div className="flex flex-wrap gap-8">
              <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5">
                <div className="flex items-center gap-2">
                  <b className="flex-1 text-lg">{grid.label}</b>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Previous month"
                    disabled={month === 0}
                    onClick={() => showMonth(Math.max(0, month - 1))}
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Next month"
                    disabled={month >= months.length - 1}
                    onClick={() => showMonth(Math.min(months.length - 1, month + 1))}
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div
                  className="grid grid-cols-7 gap-1.5 text-center"
                  role="group"
                  aria-label={grid.label}
                >
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => (
                    <span key={w} className="text-muted-foreground pb-1 text-xs font-semibold">
                      {w}
                    </span>
                  ))}
                  {grid.cells.map((key, i) => {
                    if (!key) return <span key={`b${i}`} />;
                    const ok = open.has(key);
                    const on = ok && key === day;
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!ok}
                        aria-pressed={on}
                        aria-label={`${longDay(key)}, ${ok ? "open" : "not open"}`}
                        onClick={() => {
                          setDay(key);
                          setSlot(null);
                        }}
                        className={cn(
                          "focus-glow mx-auto grid size-11 place-items-center rounded-full text-[15px] outline-none",
                          on
                            ? "bg-foreground text-background font-bold"
                            : ok
                              ? "bg-muted hover:bg-muted/70 font-semibold"
                              : "text-muted-foreground/50 cursor-default",
                        )}
                      >
                        {Number(key.slice(8))}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-2.5">
                <b className="text-lg">{day ? longDay(day) : "Pick a day"}</b>
                <div
                  className="-me-2 flex max-h-[360px] flex-col gap-2 overflow-y-auto pe-2"
                  role="group"
                  aria-label="Times"
                >
                  {daySlots.length === 0 && (
                    <span className="text-muted-foreground text-sm">No times this day.</span>
                  )}
                  {daySlots.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={slot === s}
                      onClick={() => setSlot(s)}
                      className={cn(
                        "focus-glow h-[46px] rounded-full border text-[15px] outline-none",
                        slot === s
                          ? "bg-foreground text-background border-foreground font-semibold"
                          : "bg-card border-input hover:bg-muted",
                      )}
                    >
                      {time.format(new Date(s))}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {slot && (
            <div
              role="form"
              aria-label="Your details"
              className="border-border/60 flex flex-col gap-3.5 border-t pt-6"
            >
              <b className="text-lg">{summary}</b>
              <div className="flex flex-wrap gap-3.5">
                <label className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5 text-sm">
                  <span className="text-muted-foreground">Your name</span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    maxLength={80}
                    placeholder="Sam Rivera"
                    className="h-12 rounded-full px-5"
                  />
                </label>
                <label className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5 text-sm">
                  <span className="text-muted-foreground">Email</span>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    maxLength={254}
                    placeholder="sam@example.com"
                    className="h-12 rounded-full px-5"
                  />
                </label>
              </div>
              {questions.map((q) => (
                <label key={q.id} className="flex flex-col gap-1.5 text-sm">
                  <span className="text-muted-foreground">
                    {q.label}
                    {q.required ? "" : " (optional)"}
                  </span>
                  <Textarea
                    rows={3}
                    value={answers[q.id] ?? ""}
                    placeholder={
                      q === firstQuestion && hostName
                        ? `A sentence or two so ${hostName.split(" ")[0]} can come ready`
                        : undefined
                    }
                    maxLength={1000}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    className="resize-none rounded-3xl px-5 py-3.5 leading-relaxed"
                  />
                </label>
              ))}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
                value={honey}
                onChange={(e) => setHoney(e.target.value)}
                name="website"
              />
              {error && (
                <p role="alert" className="text-tint-danger-foreground text-sm">
                  {error}
                </p>
              )}
              <Button
                size="lg"
                className="h-[52px] self-start rounded-full px-8 text-base"
                disabled={pending || !name.trim() || !email.trim()}
                onClick={submit}
              >
                Book
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const noSubscribe = () => () => {};

function readBrowserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * The booked meeting as a calendar file, made here from what was just
 * booked (no link back to the booking in it), so the guest has it even when
 * no email reaches them.
 */
function icsHref(title: string, start: string, end: string): string {
  const CRLF = String.fromCharCode(13, 10);
  const stamp = (iso: string) => iso.slice(0, 19).replace(/[-:]/g, "") + "Z";
  // ICS text: a backslash, semicolon or comma is escaped, and line breaks become spaces.
  const BACKSLASH = String.fromCharCode(92);
  const text = [...title]
    .map((c) => (c === BACKSLASH || c === ";" || c === "," ? BACKSLASH + c : c.charCodeAt(0) < 32 ? " " : c))
    .join("");
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bananasplit//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${stamp(start)}-${Math.random().toString(36).slice(2)}@bananasplit`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join(CRLF);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}
