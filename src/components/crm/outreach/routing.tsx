"use client";

import { Plus, Trash2 } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveDailyCapAction, saveRoutingAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import type { Routing, RoutingRule } from "@/lib/crm/outreach/assign";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

const FIELDS: { value: RoutingRule["field"]; label: string }[] = [
  { value: "relationship", label: "Relationship" },
  { value: "source", label: "Source" },
  { value: "company", label: "Company" },
  { value: "location", label: "Location" },
  { value: "title", label: "Title" },
  { value: "email", label: "Email" },
];

/**
 * Outreach settings on the CRM's Settings: who new people from forms go
 * to (nobody, in turn, or by rules then in turn), and the daily cap on
 * sequence and campaign mail per mailbox. Handover lives on its own page.
 * A Personal space (`personal`) has only the cap: there's nobody to route
 * people to or hand them over to.
 */
export function OutreachSettings({
  orgId,
  orgSlug,
  routing: initial,
  members,
  dailySendCap,
  personal = false,
}: {
  orgId: string;
  orgSlug: string;
  routing: Routing;
  members: { id: string; name: string }[];
  dailySendCap: number;
  personal?: boolean;
}) {
  const router = useRouter();
  const [routing, setRouting] = useState(initial);
  const [cap, setCap] = useState(String(dailySendCap));
  const save = async () => {
    const r = await runAction(() => saveRoutingAction(orgId, routing));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: "Saved", tone: "success" });
    router.refresh();
  };
  const setRule = (i: number, patch: Partial<RoutingRule>) => setRouting({ ...routing, rules: routing.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const dailyCap = (
    <>
      <span className="text-muted-foreground">Most sequence and campaign emails one mailbox sends a day</span>
      <div className="flex items-center gap-2">
        <Input type="number" min={10} max={2000} value={cap} onChange={(e) => setCap(e.target.value)} className="h-9 w-28" />
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const r = await runAction(() => saveDailyCapAction(orgId, Number(cap)));
            if (!r) return;
            if (!r.ok) return toast({ title: r.error, tone: "error" });
            toast({ title: "Saved", tone: "success" });
          }}
        >
          Save
        </Button>
      </div>
    </>
  );
  if (personal) {
    return (
      <section className="bg-card ring-foreground/6 rounded-card grid gap-1.5 p-5 text-sm ring-1">
        <h2 className="heading text-base">Sending</h2>
        {dailyCap}
        <p className="text-muted-foreground text-xs">Past it, the rest wait for tomorrow.</p>
      </section>
    );
  }
  return (
    <section className="bg-card ring-foreground/6 rounded-card space-y-4 p-5 ring-1">
      <div>
        <h2 className="heading text-base">New people get an owner</h2>
        <p className="text-muted-foreground text-sm">For forms set to give new people an owner. They&apos;re told, and it&apos;s in their Inbox.</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Routing">
        {(
          [
            ["off", "Nobody, they wait in the queue"],
            ["round-robin", "In turn"],
            ["rules", "By rules, then in turn"],
          ] as const
        ).map(([v, l]) => (
          <button key={v} type="button" className={cn(chipClass(routing.mode === v), "h-8 px-3")} onClick={() => setRouting({ ...routing, mode: v })}>
            {l}
          </button>
        ))}
      </div>
      {routing.mode === "rules" && (
        <div className="space-y-2">
          {routing.rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">When</span>
              <FieldSelect value={r.field} onChange={(e) => setRule(i, { field: e.target.value as RoutingRule["field"] })} className="w-36">
                {FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </FieldSelect>
              <button type="button" className={cn(chipClass(r.op === "contains"), "h-8 px-3")} onClick={() => setRule(i, { op: r.op === "is" ? "contains" : "is" })}>
                {r.op === "is" ? "is" : "has"}
              </button>
              <Input value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} className="h-8 w-36" aria-label="Value" />
              <span className="text-muted-foreground">give them to</span>
              <FieldSelect value={r.ownerId} onChange={(e) => setRule(i, { ownerId: e.target.value })} className="w-40">
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </FieldSelect>
              <Button variant="ghost" size="icon-sm" aria-label="Remove rule" onClick={() => setRouting({ ...routing, rules: routing.rules.filter((_, j) => j !== i) })}>
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={!members.length}
            onClick={() => setRouting({ ...routing, rules: [...routing.rules, { field: "relationship", op: "is", value: "", ownerId: members[0]!.id }] })}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a rule
          </Button>
        </div>
      )}
      {routing.mode !== "off" && (
        <div className="grid gap-1.5 text-sm">
          <span className="text-muted-foreground">In turn among</span>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn(chipClass(routing.pool.includes(m.id)), "h-8 px-3")}
                onClick={() => setRouting({ ...routing, pool: routing.pool.includes(m.id) ? routing.pool.filter((x) => x !== m.id) : [...routing.pool, m.id] })}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <Button onClick={save}>Save</Button>
      <div className="grid gap-1.5 border-t pt-4 text-sm">
        {dailyCap}
        <p className="text-muted-foreground text-xs">
          Past it, the rest wait for tomorrow. Handing someone&apos;s relationships over is on{" "}
          <Link href={`/app/${orgSlug}/crm/handover`} className="underline underline-offset-4">
            Handover
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
