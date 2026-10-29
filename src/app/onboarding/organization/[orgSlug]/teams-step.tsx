"use client";

import { useState, useTransition } from "react";

import {
  AddRowButton,
  ContinuePill,
  PreviewHeader,
  PreviewTile,
  RemoveButton,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { Switch } from "@/components/ui/switch";
import { FieldSelect } from "@/components/ui/field-select";
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

/** The small selects on a team row (lead, day, time, cadence). */
const smallSelect =
  "border-input bg-card focus-banana h-8 cursor-pointer rounded-lg border px-2 text-[13px] outline-none";

/**
 * B5 · Teams: the teams become the published org chart (the first is the
 * top), their meetings go on the calendar for about a semester, and the
 * club decides whether members see each other's busy times.
 */
export function TeamsStep({
  orgId,
  orgSlug,
  index,
  total,
  backHref,
  state,
  currentUserId,
}: {
  orgId: string;
  orgSlug: string;
  index: number;
  total: number;
  backHref: string;
  state: TeamsSetupState;
  currentUserId: string;
}) {
  const [teams, setTeams] = useState<TeamInput[]>(() =>
    STARTER.map((t, i) => (i === 0 ? { ...t, leadUserId: currentUserId } : t)),
  );
  // Off until asked for: the starter teams are examples, and a new club
  // shouldn't find a semester of made-up meetings on its calendar.
  const [addMeetings, setAddMeetings] = useState(false);
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
  const [top, ...rest] = teams;
  const leadName = (id: string | null) => state.members.find((m) => m.userId === id)?.name;

  return (
    <SetupCard
      preview={
        <>
          <PreviewHeader meta="Org chart" />
          <PreviewTile className="items-center gap-0 py-5">
            <span className="bg-primary text-primary-foreground max-w-full truncate rounded-full px-3 py-1.5 text-[13px] font-bold">
              {top?.name.trim() || "Top team"}
            </span>
            {rest.length > 0 && (
              <>
                <span aria-hidden="true" className="bg-foreground/30 h-3.5 w-px" />
                {/* Each child draws its half of the bar above it, so the bar
                    runs from the first child's centre to the last one's. */}
                <div className="flex max-w-full flex-wrap justify-center">
                  {rest.map((t, i) => (
                    <span
                      key={i}
                      className="before:bg-foreground/30 after:bg-foreground/30 relative flex max-w-[50%] min-w-0 flex-col items-center px-[3px] pt-3 before:absolute before:top-0 before:right-0 before:left-0 before:h-px after:absolute after:top-0 after:left-1/2 after:h-3 after:w-px first:before:left-1/2 last:before:right-1/2"
                    >
                      <span className="bg-muted max-w-full truncate rounded-full px-2.5 py-[5px] text-[12px] font-semibold">
                        {t.name.trim() || "New team"}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </PreviewTile>
          <PreviewHeader label="Meetings" meta={addMeetings ? "On the calendar" : "Not added"} />
          {teams
            .filter((t) => t.meeting)
            .map((t, i) => (
              <PreviewTile key={i} className="gap-0.5 py-3">
                <span className="truncate text-[14px] font-semibold">
                  {t.name.trim() || "New team"}
                </span>
                <span className="text-muted-foreground text-[12px]">
                  {DAY_LABELS[t.meeting!.day]} · {timeLabel(t.meeting!.minutes)} ·{" "}
                  {CADENCES.find((c) => c.value === t.meeting!.cadence)?.label}
                  {leadName(t.leadUserId) ? ` · ${leadName(t.leadUserId)}` : ""}
                </span>
              </PreviewTile>
            ))}
          {meetings === 0 && (
            <p className="text-muted-foreground m-0 text-[12px]">No regular meetings yet.</p>
          )}
        </>
      }
    >
      <StepIntro index={index} total={total} title="Who's on which team?">
        Your teams become the org chart, with the first at the top, and their meetings go on the
        calendar.
      </StepIntro>

      <StepBody className="gap-3">
        {state.hasPublishedChart && (
          <p className="bg-muted text-muted-foreground rounded-field m-0 px-3.5 py-2.5 text-[13px]">
            Your organization already has an org chart. Continuing publishes these teams as a new
            version; the old one stays in the chart&apos;s history.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {teams.map((team, i) => (
            <TeamRow
              key={i}
              team={team}
              top={i === 0}
              members={state.members}
              onChange={(patch) => update(i, patch)}
              onRemove={i === 0 ? undefined : () => setTeams(teams.filter((_, j) => j !== i))}
            />
          ))}
          {teams.length < MAX_TEAMS && (
            <AddRowButton
              onClick={() => setTeams([...teams, { name: "", leadUserId: null, meeting: null }])}
            >
              Add a team
            </AddRowButton>
          )}
        </div>

        <div className="border-foreground/10 divide-border rounded-field divide-y border">
          <Toggle
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
            checked={showBusy}
            onChange={setShowBusy}
            title="Members can see each other's busy times"
            detail="Only busy or free, never the reason."
          />
        </div>
      </StepBody>

      <StepError message={error} />
      <StepFooter
        back={{ href: backHref }}
        skip={{ onClick: () => start(() => goToNextOrgStep(orgSlug, "teams")), disabled: pending }}
      >
        <ContinuePill
          pending={pending}
          onClick={submit}
          disabled={teams.some((t) => !t.name.trim())}
          pendingLabel="Setting up…"
        />
      </StepFooter>
    </SetupCard>
  );
}

function Toggle({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold">{title}</span>
        <span className="text-muted-foreground block text-[13px]">{detail}</span>
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
  return (
    <div
      className={cn(
        "bg-card focus-within-banana rounded-field flex flex-col gap-2 border px-4 py-3",
        top ? "border-foreground/30" : "border-foreground/10",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn("size-2.5 flex-none rounded-full", top ? "bg-primary" : "bg-avatar-3")}
        />
        <input
          aria-label="Team name"
          placeholder="Team name"
          value={team.name}
          maxLength={80}
          onChange={(e) => onChange({ name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
        />
        {top && (
          <span className="text-muted-foreground flex-none text-[13px]">Top of the chart</span>
        )}
        {onRemove && <RemoveButton label={`Remove ${team.name || "team"}`} onClick={onRemove} />}
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[22px]">
        <FieldSelect
          aria-label="Lead"
          value={team.leadUserId ?? ""}
          onChange={(e) => onChange({ leadUserId: e.target.value || null })}
          className={smallSelect}
        >
          <option value="">Lead: open</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              Lead: {m.name}
            </option>
          ))}
        </FieldSelect>
        <FieldSelect
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
          className={smallSelect}
        >
          <option value="">No meeting</option>
          {DAY_LABELS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </FieldSelect>
        {meeting && (
          <>
            <FieldSelect
              aria-label="Meeting time"
              value={meeting.minutes}
              onChange={(e) =>
                onChange({ meeting: { ...meeting, minutes: Number(e.target.value) } })
              }
              className={smallSelect}
            >
              {TIMES.map((t) => (
                <option key={t} value={t}>
                  {timeLabel(t)}
                </option>
              ))}
            </FieldSelect>
            <FieldSelect
              aria-label="How often"
              value={meeting.cadence}
              onChange={(e) =>
                onChange({ meeting: { ...meeting, cadence: e.target.value as Cadence } })
              }
              className={smallSelect}
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </FieldSelect>
          </>
        )}
      </div>
    </div>
  );
}
