"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ArrowRight, Phone } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { crmRecordHref } from "@/lib/crm/href";
import { formatNumber } from "@/lib/crm/phone";
import { cn } from "@/lib/utils";

import { LogCallForm } from "./call-log";
import { CallControls, useSoftphone, type PhoneCaps } from "./softphone";

/**
 * The power dialer (docs/features/crm.md module 5, "Calls"): work down a
 * list (the follow-ups due, or any saved view of people) one call after
 * another. Call, say how it went, and the next person comes up; Skip moves
 * on without logging. Without a provider it's the same list with tel:
 * links, so it works from a phone too. Predictive dialling (several lines
 * at once) is deliberately not here (docs: "Gaps we accept").
 */

export interface DialerPerson {
  id: string;
  name: string;
  phone: string;
  sub: string | null;
  lastContacted: string | null;
}

export function Dialer({
  orgId,
  orgSlug,
  people,
  caps,
  outsideHours,
}: {
  orgId: string;
  orgSlug: string;
  people: DialerPerson[];
  caps: PhoneCaps;
  /** It's outside the organization's calling hours (a hint, not a block). */
  outsideHours: string | null;
}) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Record<string, "called" | "skipped">>({});
  const [record, setRecord] = useState(false);
  const [logging, setLogging] = useState(false);
  const phone = useSoftphone(orgId, caps);
  const current = people[index] ?? null;
  const left = useMemo(() => people.filter((p) => !done[p.id]).length, [people, done]);
  const busy = phone.state === "starting" || phone.state === "ringing" || phone.state === "live";

  function next(mark: "called" | "skipped") {
    if (!current) return;
    setDone((d) => ({ ...d, [current.id]: mark }));
    setLogging(false);
    phone.reset();
    const after = people.findIndex((p, i) => i > index && !done[p.id]);
    setIndex(after === -1 ? people.length : after);
  }

  if (people.length === 0) {
    return <p className="text-muted-foreground text-sm">Nobody with a number on this list.</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="bg-card ring-foreground/6 rounded-card space-y-4 p-5 ring-1">
        {outsideHours && <p className="bg-tint-warning text-tint-warning-foreground rounded-tile p-3 text-sm">{outsideHours}</p>}
        {!current ? (
          <div className="space-y-2 py-6 text-center">
            <p className="heading text-lg">That&apos;s the list.</p>
            <p className="text-muted-foreground text-sm">
              {Object.values(done).filter((d) => d === "called").length} called,{" "}
              {Object.values(done).filter((d) => d === "skipped").length} skipped.
            </p>
            <Button type="button" variant="outline" onClick={() => setIndex(0)}>
              Start again
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <Link href={crmRecordHref(orgSlug, "person", current.id)} className="heading text-xl hover:underline">
                  {current.name}
                </Link>
                {current.sub && <p className="text-muted-foreground text-sm">{current.sub}</p>}
                <p className="text-sm tabular-nums">{formatNumber(current.phone)}</p>
              </div>
              <Badge variant="secondary">
                {index + 1} of {people.length}
              </Badge>
            </div>
            {phone.state === "idle" && !logging && (
              <div className="flex flex-wrap items-center gap-2">
                {caps.softphone ? (
                  <Button type="button" onClick={() => void phone.start(current.id, { record })}>
                    <Phone className="size-4" aria-hidden="true" />
                    Call
                  </Button>
                ) : (
                  <Button asChild>
                    <a href={`tel:${current.phone}`} onClick={() => setTimeout(() => setLogging(true), 400)}>
                      <Phone className="size-4" aria-hidden="true" />
                      Call
                    </a>
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => setLogging(true)}>
                  Log how it went
                </Button>
                <Button type="button" variant="ghost" onClick={() => next("skipped")}>
                  <ArrowRight className="size-4" aria-hidden="true" />
                  Skip
                </Button>
                {caps.softphone && caps.canRecord && caps.provider === "twilio" && (
                  <label className="ms-auto flex items-center gap-2 text-sm">
                    Record
                    <Switch checked={record} onCheckedChange={setRecord} />
                  </label>
                )}
              </div>
            )}
            {phone.state !== "idle" && <CallControls phone={phone} caps={caps} name={current.name} number={current.phone} />}
            {(logging || phone.state === "ended" || phone.state === "failed") && !busy && (
              <LogCallForm
                key={`${current.id}:${phone.callId ?? "manual"}`}
                orgId={orgId}
                target={{ personId: current.id }}
                callId={phone.callId}
                durationSec={phone.seconds || null}
                defaultOutcome={phone.callId ? (phone.seconds > 0 ? "connected" : "no-answer") : "connected"}
                submitLabel="Save and next"
                onSaved={() => next("called")}
                onCancel={phone.callId ? undefined : () => setLogging(false)}
              />
            )}
          </>
        )}
      </div>
      <ol className="bg-card ring-foreground/6 rounded-card max-h-[28rem] space-y-0.5 overflow-y-auto p-2 ring-1" aria-label={`${left} left to call`}>
        {people.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setLogging(false);
                phone.reset();
                setIndex(i);
              }}
              className={cn(
                "hover:bg-muted flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                i === index && "bg-muted",
                done[p.id] && "text-muted-foreground line-through",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.lastContacted && <span className="text-muted-foreground shrink-0 text-xs">{p.lastContacted}</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
