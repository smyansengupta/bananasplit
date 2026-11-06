"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveDailyCapAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { saveSendingAction } from "@/app/app/[orgSlug]/crm/settings-actions";
import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { SavedMark } from "@/components/ui/autosave";
import { Badge } from "@/components/ui/badge";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { hourLabel, type SendingPrefs } from "@/lib/crm/settings-prefs";
import { crmSettingsHref } from "@/lib/crm/settings-sections";

import { useAutoSave } from "./use-save";

/**
 * CRM settings > Automations and sending: how group mail goes out (who it's
 * from, the daily cap, the hours, weekends, whether the domain passes), each
 * saved as it changes, and the unsubscribe line. One-to-one email always
 * goes right away.
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

export function SendingCard({
  orgId,
  orgSlug,
  cap,
  prefs,
  domain,
  verified,
  from,
}: {
  orgId: string;
  orgSlug: string;
  cap: number;
  prefs: SendingPrefs;
  /** The sender's domain, when there's one. */
  domain: string | null;
  verified: boolean;
  /** The address group mail goes from, when there's one. */
  from: string | null;
}) {
  const router = useRouter();
  const [start, setStart] = useState(prefs.startHour);
  const [end, setEnd] = useState(prefs.endHour);
  const [weekends, setWeekends] = useState(prefs.weekends);
  const pace = useAutoSave((patch: Partial<SendingPrefs>) => saveSendingAction(orgId, patch));
  const daily = useAutoSave((n: number) => saveDailyCapAction(orgId, n));
  const mark = daily.status !== "idle" ? daily : pace;
  return (
    <SettingsCard
      id="sending"
      title="Sending"
      action={<SavedMark status={mark.status} error={mark.error} />}
    >
      <Line title="Sends from" hint={from ?? "Bananasplit, on your behalf"}>
        <Link
          href={crmSettingsHref(orgSlug, "connections", "#email")}
          className="text-sm font-semibold underline-offset-2 hover:underline"
        >
          Change it
        </Link>
      </Line>
      <Line title="Daily cap" hint="Per mailbox. The rest wait for tomorrow.">
        <Input
          type="number"
          min={10}
          max={2000}
          defaultValue={cap}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (n !== cap) void daily.save(n);
          }}
          className="w-28"
          aria-label="Daily cap"
        />
      </Line>
      <Line title="Sending hours">
        <FieldSelect
          value={String(start)}
          onChange={(e) => {
            const startHour = Number(e.target.value);
            setStart(startHour);
            void pace.save({ startHour, endHour: end });
          }}
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
          onChange={(e) => {
            const endHour = Number(e.target.value);
            setEnd(endHour);
            void pace.save({ startHour: start, endHour });
          }}
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
      <Line title="Send on weekends">
        <Switch
          checked={weekends}
          onCheckedChange={(next) => {
            setWeekends(next);
            void pace.save({ weekends: next });
          }}
          aria-label="Send on weekends"
        />
      </Line>
      <Line title="SPF and DKIM" hint={domain ?? "No sender yet"}>
        {verified ? (
          <Badge variant="success">Passing</Badge>
        ) : (
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
              <Badge variant="destructive">{domain ? "Not verified" : "No sender yet"}</Badge>
            </span>
            <AmbientWhy>Mail may land in spam</AmbientWhy>
          </span>
        )}
      </Line>
    </SettingsCard>
  );
}

/** The line under group emails, never one-to-one. */
export function UnsubscribeCard({ orgId, initial }: { orgId: string; initial: string }) {
  const auto = useAutoSave((unsubscribeLine: string) =>
    saveSendingAction(orgId, { unsubscribeLine }),
  );
  return (
    <SettingsCard
      title="Unsubscribe line"
      action={<SavedMark status={auto.status} error={auto.error} />}
    >
      <Input
        defaultValue={initial}
        onBlur={(e) => {
          if (e.target.value !== initial) void auto.save(e.target.value);
        }}
        aria-label="Unsubscribe line"
      />
    </SettingsCard>
  );
}
