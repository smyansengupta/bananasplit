"use client";

import { CalendarDays, Check, Clock, Globe, MapPin, Video } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  cancelBookingAction,
  confirmBookingAction,
  rescheduleBookingAction,
} from "@/app/book/m/[token]/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { longDay, timesByDay, zoneName } from "@/lib/crm/outreach/booking-calendar";
import { cn } from "@/lib/utils";

/**
 * The guest's booking (/book/m/{token}): one card with the time and how
 * to join, then Confirm it's me (until they have), Pick another time and
 * Cancel. Times show in the zone they booked in.
 */
export function ManageBooking({
  token,
  status,
  past,
  verified,
  startsAt,
  durationMin,
  tz,
  joinUrl,
  location,
  slots,
  bookAgainHref,
}: {
  token: string;
  status: "BOOKED" | "CANCELLED";
  past: boolean;
  verified: boolean;
  startsAt: string;
  durationMin: number;
  tz: string;
  joinUrl: string | null;
  location: string | null;
  slots: string[];
  bookAgainHref: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [reason, setReason] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const days = useMemo(() => timesByDay(slots, tz), [slots, tz]);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const when = new Date(startsAt).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });

  const run = async (fn: () => Promise<{ ok: true; when?: string } | { ok: false; error: string }>, done: string) => {
    setPending(true);
    setError(null);
    const r = await fn().catch(() => null);
    setPending(false);
    if (!r) return setError("That didn't go through. Try again.");
    if (!r.ok) return setError(r.error);
    setNote(r.when ? `${done} ${r.when}.` : done);
    setMode("view");
    router.refresh();
  };

  const cancelled = status === "CANCELLED";
  return (
    <div className="bg-card ring-foreground/8 space-y-6 rounded-[28px] p-6 ring-1 sm:p-8">
      <div className="flex flex-col gap-3 text-[15px]">
        <span className={cn("flex items-center gap-2.5", cancelled && "line-through")}>
          <CalendarDays className="size-[18px] shrink-0" aria-hidden="true" />
          {when}
        </span>
        <span className="flex items-center gap-2.5">
          <Clock className="size-[18px] shrink-0" aria-hidden="true" />
          {durationMin} minutes
        </span>
        {!cancelled && joinUrl && (
          <a href={joinUrl} className="flex items-center gap-2.5 font-semibold underline underline-offset-4">
            <Video className="size-[18px] shrink-0" aria-hidden="true" />
            Join the meeting
          </a>
        )}
        {!cancelled && !joinUrl && location && (
          <span className="flex items-center gap-2.5">
            <MapPin className="size-[18px] shrink-0" aria-hidden="true" />
            {location}
          </span>
        )}
        <span className="text-muted-foreground flex items-center gap-2.5 text-sm">
          <Globe className="size-[18px] shrink-0" aria-hidden="true" />
          Times are {zoneName(tz)}
        </span>
      </div>

      {note && (
        <p role="status" className="bg-muted flex items-center gap-2 rounded-2xl px-4 py-3 text-sm">
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-tint-danger-foreground text-sm">
          {error}
        </p>
      )}

      {cancelled ? (
        <div className="space-y-3">
          <p className="text-[15px]">This meeting is cancelled.</p>
          <Button asChild variant="outline" className="rounded-full">
            <Link href={bookAgainHref}>Book a new time</Link>
          </Button>
        </div>
      ) : past ? (
        <p className="text-muted-foreground text-[15px]">This meeting has started or is over.</p>
      ) : mode === "move" ? (
        <div className="space-y-4">
          <b className="text-lg">Pick another time</b>
          {days.length === 0 ? (
            <p className="text-muted-foreground text-sm">No other times are open right now.</p>
          ) : (
            <div className="max-h-[420px] space-y-4 overflow-y-auto pe-1">
              {days.map((d) => (
                <div key={d.key} className="space-y-2">
                  <span className="text-sm font-semibold">{longDay(d.key)}</span>
                  <div className="flex flex-wrap gap-2">
                    {d.slots.map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={pick === s}
                        onClick={() => setPick(s)}
                        className={cn(
                          "focus-glow h-10 rounded-full border px-4 text-sm outline-none",
                          pick === s ? "bg-foreground text-background border-foreground font-semibold" : "bg-card border-input hover:bg-muted",
                        )}
                      >
                        {time.format(new Date(s))}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-full"
              disabled={!pick || pending}
              onClick={() => run(() => rescheduleBookingAction(token, pick!), "Moved to")}
            >
              Move it here
            </Button>
            <Button variant="ghost" className="rounded-full" onClick={() => setMode("view")}>
              Keep the time I have
            </Button>
          </div>
        </div>
      ) : mode === "cancel" ? (
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Anything you want them to know (optional)</span>
            <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-3xl px-5 py-3.5" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={pending}
              onClick={() => run(() => cancelBookingAction(token, reason), "Cancelled. They've been told.")}
            >
              Cancel the meeting
            </Button>
            <Button variant="ghost" className="rounded-full" onClick={() => setMode("view")}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!verified && (
            <Button
              className="rounded-full"
              disabled={pending}
              onClick={() => run(() => confirmBookingAction(token), "Thanks, it's all set.")}
            >
              Confirm it&apos;s me
            </Button>
          )}
          <Button variant="outline" className="rounded-full" onClick={() => setMode("move")}>
            Pick another time
          </Button>
          <Button variant="ghost" className="rounded-full" onClick={() => setMode("cancel")}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
