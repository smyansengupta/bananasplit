"use client";

import { X } from "lucide-react";
import { useState, useTransition } from "react";

import { DashedButton, FieldError } from "@/components/onboarding/step-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DAY_LABELS } from "@/lib/availability";
import { CADENCES, MAX_TEAMS, type Cadence, type TeamInput } from "@/lib/onboarding/org";
import { cn } from "@/lib/utils";
import type { TeamsSetupState } from "@/server/onboarding/org-setup";

import { goToNextOrgStep, saveTeamsStepAction } from "./actions";

/** 7 AM to 10 PM on the quarter hour... kept to half hours for a short list. */
const TIMES = Array.from({ length: 31 }, (_, i) => 7 * 60 + i * 30);

function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

const STARTER: TeamInput[] = [
  {
    name: "Executive board",
    leadUserId: null,
    meeting: { day: 0, minutes: 19 * 60, cadence: "weekly" },
  },
  { name: "Finance", leadUserId: null, meeting: { day: 3, minutes: 17 * 60, cadence: "biweekly" } },
  {
    name: "Operations",
    leadUserId: null,
    meeting: { day: 2, minutes: 18 * 60, cadence: "weekly" },
  },
];

/**
 * B5 · Org chart + calendars: the teams become the published org chart (the
 * first is the top), their meetings go on the calendar for about a
 * semester, and the org decides whether members see each other's busy times.
 */
export function TeamsStep({
  orgId,
  orgSlug,
  state,
  currentUserId,
}: {
  orgId: string;
  orgSlug: string;
  state: TeamsSetupState;
  currentUserId: string;
}) {
  const [teams, setTeams] = useState<TeamInput[]>(() =>
    STARTER.map((t, i) => (i === 0 ? { ...t, leadUserId: currentUserId } : t)),
  );
  const [addMeetings, setAddMeetings] = useState(true);
  const [showBusy, setShowBusy] = useState(state.showMemberAvailability);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function update(i: number, patch: Partial<TeamInput>) {
    setTeams(teams.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  function submit() {
    setError(null);
    start(async () => {
      const result = await saveTeamsStepAction(orgId, {
        teams,
        addMeetingsToCalendar: addMeetings,
        showMemberAvailability: showBusy,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await goToNextOrgStep(orgSlug, "teams");
    });
  }

  return (
    <div className="space-y-4">
      {state.hasPublishedChart && (
        <p className="bg-muted/40 rounded-lg border px-3 py-2 text-xs">
          This org already has an org chart. Finishing publishes these teams as a new version; the
          old one stays in the chart&apos;s history.
        </p>
      )}
      <div className="space-y-1.5">
        {teams.map((team, i) => (
          <div key={i} className={cn(i > 0 && "ml-3.5 border-l pl-4")}>
            <TeamRow
              team={team}
              top={i === 0}
              members={state.members}
              onChange={(patch) => update(i, patch)}
              onRemove={i === 0 ? undefined : () => setTeams(teams.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        {teams.length < MAX_TEAMS && (
          <div className="ml-3.5 border-l pl-4">
            <DashedButton
              className="w-full"
              onClick={() => setTeams([...teams, { name: "", leadUserId: null, meeting: null }])}
            >
              + Add team
            </DashedButton>
          </div>
        )}
      </div>

      <div className="space-y-2.5 border-t pt-3">
        <label className="flex items-center justify-between gap-3 text-xs">
          <span>
            Add team meetings to the calendar
            <span className="text-muted-foreground block text-[11px]">
              {state.googleConnected
                ? "The next 12 weeks. They mirror to your Google Calendar."
                : "The next 12 weeks. Connect Google Calendar (B2) to mirror them there."}
            </span>
          </span>
          <Switch checked={addMeetings} onCheckedChange={setAddMeetings} />
        </label>
        <label className="flex items-center justify-between gap-3 text-xs">
          <span>
            Members can see each other&apos;s busy times
            <span className="text-muted-foreground block text-[11px]">
              From “When can’t you meet?”. Only busy or free, never the reason.
            </span>
          </span>
          <Switch checked={showBusy} onCheckedChange={setShowBusy} />
        </label>
      </div>

      <FieldError message={error ?? undefined} />
      <Button
        type="button"
        className="w-full font-semibold"
        onClick={submit}
        disabled={pending || teams.some((t) => !t.name.trim())}
      >
        {pending ? "Setting up…" : "Finish setup"}
      </Button>
    </div>
  );
}

function TeamRow({
  team,
  top,
  members,
  onChange,
  onRemove,
}: {
  team: TeamInput;
  top: boolean;
  members: { userId: string; name: string }[];
  onChange: (patch: Partial<TeamInput>) => void;
  onRemove?: () => void;
}) {
  const meeting = team.meeting;
  const select = "border-input bg-background h-7 rounded-md border px-1.5 text-[11px]";
  return (
    <div className="space-y-2 rounded-xl border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Team name"
          placeholder="Team name"
          value={team.name}
          maxLength={80}
          onChange={(e) => onChange({ name: e.target.value })}
          className={cn("h-7 flex-1 text-sm", top ? "font-semibold" : "font-medium")}
        />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground rounded p-0.5"
            aria-label={`Remove ${team.name || "team"}`}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground">Lead</span>
        <select
          aria-label="Lead"
          value={team.leadUserId ?? ""}
          onChange={(e) => onChange({ leadUserId: e.target.value || null })}
          className={select}
        >
          <option value="">Open</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground ml-1">Meets</span>
        <select
          aria-label="Meeting day"
          value={meeting ? meeting.day : ""}
          onChange={(e) =>
            onChange({
              meeting:
                e.target.value === ""
                  ? null
                  : {
                      day: Number(e.target.value),
                      minutes: meeting?.minutes ?? 18 * 60,
                      cadence: meeting?.cadence ?? "weekly",
                    },
            })
          }
          className={select}
        >
          <option value="">No meeting</option>
          {DAY_LABELS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
        {meeting && (
          <>
            <select
              aria-label="Meeting time"
              value={meeting.minutes}
              onChange={(e) =>
                onChange({ meeting: { ...meeting, minutes: Number(e.target.value) } })
              }
              className={cn(select, "font-mono")}
            >
              {TIMES.map((t) => (
                <option key={t} value={t}>
                  {timeLabel(t)}
                </option>
              ))}
            </select>
            <select
              aria-label="How often"
              value={meeting.cadence}
              onChange={(e) =>
                onChange({ meeting: { ...meeting, cadence: e.target.value as Cadence } })
              }
              className={select}
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
