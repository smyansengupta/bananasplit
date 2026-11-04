"use client";

import { UserX } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { giveOwnerAction, handOverAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { crmRecordHref } from "@/lib/crm/href";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * Handover (CRM settings > Team): hand a member's relationships
 * to someone else (or to a position, so they follow whoever holds it) in
 * one step, and give anyone left with no owner to someone.
 */

export interface OwnerChoice {
  value: string;
  label: string;
}

function OwnerChips({ choices, value, onPick }: { choices: OwnerChoice[]; value: string | null; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="To">
      {choices.map((c) => (
        <button key={c.value} type="button" className={cn(chipClass(value === c.value), "h-8 px-3")} onClick={() => onPick(c.value)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function HandOverCard({
  orgId,
  from,
  choices,
}: {
  orgId: string;
  from: { userId: string; name: string; people: number; left: boolean };
  choices: OwnerChoice[];
}) {
  const router = useRouter();
  const [to, setTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const go = async () => {
    if (!to) return;
    setPending(true);
    const r = await runAction(() => handOverAction(orgId, { fromUserId: from.userId, to }));
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `Handed over ${r.people} people, ${r.companies} companies, ${r.deals} deals`, tone: "success" });
    router.refresh();
  };
  return (
    <li className="bg-card ring-foreground/6 rounded-card space-y-3 p-4 ring-1">
      <p className="heading flex items-center gap-2 text-[15px]">
        {from.left && <UserX className="text-muted-foreground size-4" aria-hidden="true" />}
        {from.name}
        <span className="text-muted-foreground text-sm font-normal">
          {from.left ? "left" : "looks after"} {from.people} {from.people === 1 ? "person" : "people"}
        </span>
      </p>
      <OwnerChips choices={choices.filter((c) => c.value !== `u:${from.userId}`)} value={to} onPick={setTo} />
      <Button disabled={!to || pending} onClick={go}>
        Hand them all over
      </Button>
    </li>
  );
}

export function Unowned({
  orgId,
  orgSlug,
  rows,
  choices,
}: {
  orgId: string;
  orgSlug: string;
  rows: { id: string; name: string; why: string }[];
  choices: OwnerChoice[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState<string | null>(null);
  const give = async () => {
    if (!to) return;
    const r = await runAction(() => giveOwnerAction(orgId, [...picked], to));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `${r.changed} now have an owner`, tone: "success" });
    setPicked(new Set());
    router.refresh();
  };
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">Everyone has an owner.</p>;
  return (
    <div className="space-y-3">
      <ul className="bg-card ring-foreground/6 rounded-card divide-border max-h-96 divide-y overflow-y-auto ring-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-2">
            <Checkbox
              checked={picked.has(r.id)}
              onCheckedChange={(v) => {
                const n = new Set(picked);
                if (v) n.add(r.id);
                else n.delete(r.id);
                setPicked(n);
              }}
              aria-label={`Pick ${r.name}`}
            />
            <Link href={crmRecordHref(orgSlug, "person", r.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {r.name}
            </Link>
            <span className="text-muted-foreground text-sm">{r.why}</span>
          </li>
        ))}
      </ul>
      {picked.size > 0 && (
        <div className="space-y-2">
          <OwnerChips choices={choices} value={to} onPick={setTo} />
          <Button disabled={!to} onClick={give}>
            Give {picked.size} to them
          </Button>
        </div>
      )}
    </div>
  );
}
