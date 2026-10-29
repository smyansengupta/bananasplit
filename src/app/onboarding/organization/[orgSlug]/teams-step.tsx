"use client";

import { Plus, X } from "@/components/icons";
import { useState, useTransition } from "react";

import {
  ContinuePill,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { MAX_TEAMS, type TeamInput } from "@/lib/onboarding/org";
import type { TeamsSetupState } from "@/server/onboarding/org-setup";

import { saveTeamsStepAction } from "./actions";
import { useGoNext } from "./step-flow";

const STARTER: TeamInput[] = [
  { name: "Leadership", leadUserId: null, meeting: null },
  { name: "Product", leadUserId: null, meeting: null },
  { name: "Operations", leadUserId: null, meeting: null },
];

/**
 * Teams: just their names. They're published as the org chart, the first at
 * the top and the rest reporting to it. Leads come later, once people have
 * joined; meetings are made on the calendar.
 */
export function TeamsStep({
  orgId,
  orgSlug,
  backHref,
  state,
}: {
  orgId: string;
  orgSlug: string;
  backHref: string | null;
  state: TeamsSetupState;
  currentUserId: string;
}) {
  const { preview, goNext } = useGoNext("org", orgSlug, "teams");
  const [teams, setTeams] = useState<TeamInput[]>(STARTER);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const update = (i: number, patch: Partial<TeamInput>) =>
    setTeams(teams.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  function submit() {
    setError(null);
    start(async () => {
      if (preview) return goNext();
      const result = await saveTeamsStepAction(orgId, {
        teams,
        addMeetingsToCalendar: false,
        showMemberAvailability: state.showMemberAvailability,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await goNext();
    });
  }

  return (
    <SetupCard>
      <StepIntro title="What teams do you have?">
        They become your org chart. The first one sits at the top.
      </StepIntro>

      <StepBody className="gap-2">
        {state.hasPublishedChart && (
          <p className="bg-muted text-muted-foreground rounded-field m-0 px-3.5 py-2.5 text-[13px]">
            You already have an org chart; this publishes a new version.
          </p>
        )}
        {teams.map((team, i) => (
          <div
            key={i}
            className="bg-card border-border focus-within-banana rounded-field flex h-11 items-center gap-2 border pr-2 pl-3.5"
          >
            <input
              aria-label="Team name"
              value={team.name}
              maxLength={60}
              placeholder="Team name"
              onChange={(e) => update(i, { name: e.target.value })}
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
            />
            {i > 0 && (
              <button
                type="button"
                aria-label={`Remove ${team.name || "this team"}`}
                onClick={() => setTeams(teams.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 flex-none cursor-pointer place-items-center rounded-full"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {teams.length < MAX_TEAMS && (
          <button
            type="button"
            onClick={() => setTeams([...teams, { name: "", leadUserId: null, meeting: null }])}
            className="border-input hover:bg-muted inline-flex h-9 w-fit cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add team
          </button>
        )}
      </StepBody>

      <StepError message={error} />
      <StepFooter
        back={backHref ? { href: backHref } : undefined}
        skip={{ onClick: () => start(goNext), disabled: pending }}
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
