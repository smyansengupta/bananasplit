"use client";

import { CalendarPlus, Clock, Crown, Eye, Flag, Plus, UserRound, Users, X, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ContinueButton, DashedButton, FieldError } from "@/components/onboarding/step-card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DAY_LABELS } from "@/lib/availability";
import { CADENCES, MAX_TEAMS, type Cadence, type TeamInput } from "@/lib/onboarding/org";
import { cn } from "@/lib/utils";
import type { TeamsSetupState } from "@/server/onboarding/org-setup";

import { goToNextOrgStep, saveTeamsStepAction } from "./actions";

/** 7 AM to 10 PM, every half hour. */
const TIMES = Array.from({ length: 31 }, (_, i) => 7 * 60 + i * 30);

function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

const STARTER: TeamInput[] = [
  { name: "Executive board", leadUserId: null, meeting: { day: 0, minutes: 19 * 60, cadence: "weekly" } },
  { name: "Finance", leadUserId: null, meeting: { day: 3, minutes: 17 * 60, cadence: "biweekly" } },
  { name: "Operations", leadUserId: null, meeting: { day: 2, minutes: 18 * 60, cadence: "weekly" } },
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

  const meetings = teams.filter((t) => t.meeting).length;

  return (
    <div className="space-y-5">
      {state.hasPublishedChart && (
        <p className="bg-muted/40 rounded-lg border px-3 py-2 text-xs">
          This org already has an org chart. Finishing publishes these teams as a new version; the old one stays in
          the chart&apos;s history.
        </p>
      )}

      <div className="space-y-2">
        {teams.map((team, i) => (
          <div key={i} className={cn("relative", i > 0 && "ml-5 pl-4")}>
            {i > 0 && (
              <span
                aria-hidden="true"
                className="border-border absolute top-0 left-0 h-8 w-4 rounded-bl-lg border-b border-l"
              />
            )}
            {i > 0 && i < teams.length - 1 && (
              <span aria-hidden="true" className="bg-border absolute top-0 bottom-[-8px] left-0 w-px" />
            )}
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
          <div className="ml-5 pl-4">
            <DashedButton
              icon={Plus}
              className="w-full"
              onClick={() => setTeams([...teams, { name: "", leadUserId: null, meeting: null }])}
            >
              Add a team
            </DashedButton>
          </div>
        )}
      </div>

      <div className="divide-y rounded-xl border">
        <Toggle
          icon={CalendarPlus}
          checked={addMeetings}
          onChange={setAddMeetings}
          title={`Put ${meetings === 1 ? "this meeting" : `these ${meetings} meetings`} on the calendar`}
          detail={
            state.googleConnected
              ? "The next 12 weeks. They mirror to your Google Calendar."
              : "The next 12 weeks. Connect Google Calendar to mirror them there."
          }
        />
        <Toggle
          icon={Eye}
          checked={showBusy}
          onChange={setShowBusy}
          title="Members can see each other's busy times"
          detail="From “When can’t you meet?”. Only busy or free, never the reason."
        />
      </div>

      <FieldError message={error ?? undefined} />
      <div className="flex border-t pt-4">
        <ContinueButton
          pending={pending}
          onClick={submit}
          disabled={teams.some((t) => !t.name.trim())}
          pendingLabel="Setting up…"
          icon={Flag}
        >
          Finish setup
        </ContinueButton>
      </div>
    </div>
  );
}

function Toggle({
  icon: Icon,
  title,
  detail,
  checked,
  onChange,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-3 py-3">
      <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-lg">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs">{detail}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
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
  const select = "border-input bg-background h-8 rounded-md border px-2 text-xs";
  const Icon = top ? Crown : Users;
  return (
    <div className={cn("bg-card space-y-2.5 rounded-xl border p-3", top && "border-warning/40 bg-warning/5")}>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg",
            top ? "bg-warning/15 text-warning" : "bg-muted text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <Input
          aria-label="Team name"
          placeholder="Team name"
          value={team.name}
          maxLength={80}
          onChange={(e) => onChange({ name: e.target.value })}
          className={cn("h-8 flex-1", top ? "font-semibold" : "font-medium")}
        />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1"
            aria-label={`Remove ${team.name || "team"}`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-[42px] text-xs">
        <label className="flex items-center gap-1.5">
          <UserRound className="text-muted-foreground size-3.5" aria-hidden="true" />
          <span className="sr-only">Lead</span>
          <select
            aria-label="Lead"
            value={team.leadUserId ?? ""}
            onChange={(e) => onChange({ leadUserId: e.target.value || null })}
            className={select}
          >
            <option value="">Lead: open</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <span className="flex flex-wrap items-center gap-1.5">
          <Clock className="text-muted-foreground size-3.5" aria-hidden="true" />
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
                onChange={(e) => onChange({ meeting: { ...meeting, minutes: Number(e.target.value) } })}
                className={select}
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
                onChange={(e) => onChange({ meeting: { ...meeting, cadence: e.target.value as Cadence } })}
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
        </span>
      </div>
    </div>
  );
}
