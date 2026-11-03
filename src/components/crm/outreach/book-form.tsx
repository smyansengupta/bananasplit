"use client";

import { Check } from "@/components/icons";
import { useMemo, useState } from "react";

import { bookAction } from "@/app/book/[slug]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Pick a day, a time, then who you are. Times show in the organization's timezone. */
export function BookForm({
  slug,
  tz,
  durationMin,
  slots,
  questions,
}: {
  slug: string;
  tz: string;
  durationMin: number;
  slots: string[];
  questions: { id: string; label: string; required: boolean }[];
}) {
  const days = useMemo(() => {
    const out: { key: string; label: string; slots: string[] }[] = [];
    const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const labelFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
    for (const s of slots) {
      const d = new Date(s);
      const key = keyFmt.format(d);
      const last = out[out.length - 1];
      if (last?.key === key) last.slots.push(s);
      else out.push({ key, label: labelFmt.format(d), slots: [s] });
    }
    return out;
  }, [slots, tz]);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const [day, setDay] = useState(days[0]?.key ?? "");
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [honey, setHoney] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ when: string; hostName: string } | null>(null);

  if (done) {
    return (
      <div className="bg-card ring-foreground/6 rounded-card space-y-2 p-6 ring-1">
        <p className="heading flex items-center gap-2 text-lg">
          <Check className="size-5" aria-hidden="true" />
          You're booked
        </p>
        <p className="text-[15px]">
          {done.when}, with {done.hostName}. A confirmation is on its way to {email}.
        </p>
      </div>
    );
  }
  if (days.length === 0) {
    return <p className="text-muted-foreground text-[15px]">No times are open right now. Check back soon.</p>;
  }
  const current = days.find((d) => d.key === day) ?? days[0]!;
  const submit = async () => {
    if (!slot) return;
    setPending(true);
    setError(null);
    const r = await bookAction(slug, { start: slot, name, email, answers, website: honey }).catch(() => null);
    setPending(false);
    if (!r) return setError("That didn't go through. Try again.");
    if (!r.ok) return setError(r.error);
    setDone({ when: r.when, hostName: r.hostName });
  };
  return (
    <div className="space-y-5">
      <section className="bg-card ring-foreground/6 rounded-card space-y-4 p-5 ring-1">
        <p className="text-muted-foreground text-sm">
          {durationMin} minutes. Times in {tz.replace(/_/g, " ")}.
        </p>
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Day">
          {days.map((d) => (
            <button
              key={d.key}
              type="button"
              className={cn(chipClass(d.key === current.key), "h-9 shrink-0 px-3")}
              onClick={() => {
                setDay(d.key);
                setSlot(null);
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" role="group" aria-label="Time">
          {current.slots.map((s) => (
            <button key={s} type="button" className={cn(chipClass(slot === s), "h-9 justify-center px-2")} onClick={() => setSlot(s)}>
              {time.format(new Date(s))}
            </button>
          ))}
        </div>
      </section>
      {slot && (
        <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Your name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Email</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          {questions.map((q) => (
            <label key={q.id} className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">
                {q.label}
                {q.required ? "" : " (optional)"}
              </span>
              <Textarea rows={3} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
            </label>
          ))}
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={honey} onChange={(e) => setHoney(e.target.value)} name="website" />
          {error && <p className="text-tint-danger-foreground text-sm">{error}</p>}
          <Button disabled={pending || !name.trim() || !email.trim()} onClick={submit}>
            Book {time.format(new Date(slot))}
          </Button>
        </section>
      )}
    </div>
  );
}
