"use client";

import { useState } from "react";

import {
  ContinuePill,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { TAG_COLORS, TagListEditor, type TagRow } from "@/components/onboarding/tag-list-editor";
import { LABEL_COLOR_PALETTE, type LabelColor } from "@/lib/label-colors";
import type { EventType } from "@/server/onboarding/org-setup";

import { saveEventTypesStepAction } from "./actions";
import { useNextStep, type SetupStepProps } from "./step-flow";

/** The first three start the list; all are one-click adds. */
const SUGGESTED = [
  "Team meeting",
  "1:1",
  "Standup",
  "All-hands",
  "Client call",
  "Planning",
  "Review",
  "Offsite",
] as const;

const asColor = (color: string): LabelColor =>
  (LABEL_COLOR_PALETTE as readonly string[]).includes(color)
    ? (color as LabelColor)
    : TAG_COLORS[0]!;

/**
 * Meeting types: the kinds of meetings the organization holds (team
 * meetings, 1:1s, standups), named right on a week of the calendar
 * (OrgSettings.eventTypes), each in its colour. A new organization starts
 * with three suggestions and has more one click away.
 */
export function EventsStep(props: SetupStepProps & { initial: EventType[] }) {
  const { backHref, orgId, initial } = props;
  const { pending, error, next, skip } = useNextStep(props, "events");
  const [rows, setRows] = useState<TagRow[]>(() =>
    initial.length
      ? initial.map((t, i) => ({ key: `t-${i}`, id: null, name: t.name, color: asColor(t.color) }))
      : SUGGESTED.slice(0, 3).map((name, i) => ({
          key: `new-${i}`,
          id: null,
          name,
          color: TAG_COLORS[(i + 3) % TAG_COLORS.length]!,
        })),
  );

  return (
    <SetupCard>
      <StepIntro title="What kinds of meetings do you have?">
        Name them right on your calendar. Click a dot to change its colour.
      </StepIntro>
      <StepBody>
        <TagListEditor
          rows={rows}
          onChange={setRows}
          suggestions={SUGGESTED}
          noun="meeting type"
          max={20}
          week
        />
      </StepBody>
      <StepError message={error} />
      <StepFooter
        back={backHref ? { href: backHref } : undefined}
        skip={{ onClick: skip, disabled: pending }}
      >
        <ContinuePill
          pending={pending}
          disabled={rows.some((r) => !r.name.trim())}
          onClick={() =>
            next(() =>
              saveEventTypesStepAction(orgId, {
                types: rows.map((r) => ({ name: r.name, color: r.color })),
              }),
            )
          }
        />
      </StepFooter>
    </SetupCard>
  );
}
