"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveDailyCapAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { saveSendingAction } from "@/app/app/[orgSlug]/crm/settings-actions";
import { SettingsCard, SettingsStatus } from "@/app/app/[orgSlug]/settings/settings-card";
import { AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { hourLabel, type SendingPrefs } from "@/lib/crm/settings-prefs";

import { useSave } from "./use-save";

/**
 * CRM settings > Sending's own cards: the pace (daily cap, the hours group
 * mail goes in, weekends), and landing in the inbox (the sender's SPF and
 * DKIM, the unsubscribe line).
 */

function Line({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0 first:pt-0">
      <span className="min-w-0 flex-[1_1_14rem]">
        <b className="block text-[15px] font-semibold">{title}</b>
        {hint && <span className="text-muted-foreground block text-sm">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

const HOURS = Array.from({ length: 25 }, (_, h) => h);

export function PaceCard({
  orgId,
  cap,
  prefs,
}: {
  orgId: string;
  cap: number;
  prefs: SendingPrefs;
}) {
  const [daily, setDaily] = useState(String(cap));
  const [start, setStart] = useState(prefs.startHour);
  const [end, setEnd] = useState(prefs.endHour);
  const [weekends, setWeekends] = useState(prefs.weekends);
  const { pending, status, save } = useSave();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(async () => {
          const n = Number(daily);
          if (n !== cap) {
            const r = await saveDailyCapAction(orgId, n);
            if (!r.ok) return r;
          }
          return saveSendingAction(orgId, { startHour: start, endHour: end, weekends });
        });
      }}
    >
      <SettingsCard
        title="Pace"
        description="Spreads group emails out so mailboxes stay healthy. One-to-one email always goes right away."
        status={<SettingsStatus status={status} />}
        footer={
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        }
      >
        <Line title="Daily cap" hint="Per mailbox. The rest wait for tomorrow.">
          <Input
            type="number"
            min={10}
            max={2000}
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
            className="w-28"
            aria-label="Daily cap"
          />
          <span className="text-muted-foreground text-sm">emails a day</span>
        </Line>
        <Line title="Sending hours" hint="In your organization's time zone.">
          <span className="text-muted-foreground text-sm">From</span>
          <FieldSelect
            value={String(start)}
            onChange={(e) => setStart(Number(e.target.value))}
            className="w-28"
            aria-label="From"
          >
            {HOURS.slice(0, 24).map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </FieldSelect>
          <span className="text-muted-foreground text-sm">to</span>
          <FieldSelect
            value={String(end)}
            onChange={(e) => setEnd(Number(e.target.value))}
            className="w-28"
            aria-label="To"
          >
            {HOURS.slice(1).map((h) => (
              <option key={h} value={h}>
                {h === 24 ? "Midnight" : hourLabel(h)}
              </option>
            ))}
          </FieldSelect>
        </Line>
        <Line
          title="Send on weekends"
          hint={weekends ? "Group emails go any day." : "Off: weekend sends wait for Monday."}
        >
          <Switch checked={weekends} onCheckedChange={setWeekends} aria-label="Send on weekends" />
        </Line>
      </SettingsCard>
    </form>
  );
}

export function InboxCard({
  orgId,
  domain,
  verified,
  problem,
  unsubscribeLine,
}: {
  orgId: string;
  /** The sender's domain, when there's one. */
  domain: string | null;
  verified: boolean;
  problem: string | null;
  unsubscribeLine: string;
}) {
  const router = useRouter();
  const [line, setLine] = useState(unsubscribeLine);
  const { pending, status, save } = useSave();
  const state = (ok: boolean) =>
    ok ? (
      <Badge variant="success">Passing</Badge>
    ) : (
      <Badge variant="destructive">{domain ? "Not verified" : "No sender yet"}</Badge>
    );
  return (
    <form
      id="inbox"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveSendingAction(orgId, { unsubscribeLine: line }));
      }}
    >
      <SettingsCard
        title="Landing in the inbox"
        description={
          domain
            ? `Checks that ${domain} lets us send for you, and adds a way to unsubscribe.`
            : "Checks that your domain lets us send for you, and adds a way to unsubscribe."
        }
        status={<SettingsStatus status={status} />}
        footer={
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        }
      >
        <Line title="SPF" hint={`Says which servers may send for ${domain ?? "your domain"}.`}>
          {state(verified)}
        </Line>
        <Line title="DKIM" hint="Signs each email so it can't be faked.">
          {!verified && (
            <span className="flex flex-col items-end gap-1">
              <span className="flex items-center gap-1.5">
                <AmbientButton
                  action={{
                    key: "check",
                    label: "Check again",
                    tone: "solid",
                    reason: "Mail may land in spam",
                    run: async () => {
                      router.refresh();
                      return {};
                    },
                  }}
                />
                {state(false)}
              </span>
              <AmbientWhy>{problem ?? "Mail may land in spam"}</AmbientWhy>
            </span>
          )}
          {verified && state(true)}
        </Line>
        <Line title="Unsubscribe line" hint="Added under group emails, never one-to-one.">
          <Input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            className="min-w-0 flex-[1_1_18rem]"
            aria-label="Unsubscribe line"
          />
        </Line>
      </SettingsCard>
    </form>
  );
}
