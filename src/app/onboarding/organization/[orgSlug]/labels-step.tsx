"use client";

import { useState, useTransition } from "react";

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
import { MAX_SETUP_LABELS } from "@/lib/onboarding/org";
import type { TaskLabelsSetup } from "@/server/onboarding/org-setup";

import type { SetupFlow } from "@/lib/onboarding/steps";

import { saveLabelsStepAction } from "./actions";
import { useGoNext } from "./step-flow";

/** The starting tags (the first four) and the quick adds: an organization's, or one person's. */
const SUGGESTED: Record<SetupFlow, readonly string[]> = {
  org: [
    "Product",
    "Marketing",
    "Operations",
    "Sales",
    "Design",
    "Engineering",
    "Finance",
    "Hiring",
  ],
  personal: ["Work", "Home", "Errands", "Health", "Money", "Travel", "Family"],
};

function asColor(color: string): LabelColor {
  return (LABEL_COLOR_PALETTE as readonly string[]).includes(color)
    ? (color as LabelColor)
    : LABEL_COLOR_PALETTE[0];
}

/**
 * Tags: the space's task tags. Keep, rename, recolour (ten colours, popped
 * over the row), remove or add; a new space starts with four and has more
 * one click away. The preview shows the newest tasks, or sample ones,
 * wearing them.
 */
export function LabelsStep({
  flow = "org",
  orgId,
  orgSlug,
  backHref,
  setup,
}: {
  flow?: SetupFlow;
  orgId: string;
  orgSlug: string;
  backHref: string | null;
  setup: TaskLabelsSetup;
}) {
  const { preview: inPreview, goNext } = useGoNext(flow, orgSlug, "labels");
  const fresh = setup.labels.length === 0;
  const [rows, setRows] = useState<TagRow[]>(() =>
    fresh
      ? SUGGESTED[flow].slice(0, 4).map((name, i) => ({
          key: `new-${i}`,
          id: null,
          name,
          color: TAG_COLORS[i]!,
        }))
      : setup.labels.map((l) => ({ key: l.id, id: l.id, name: l.name, color: asColor(l.color) })),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      if (inPreview) return goNext();
      const result = await saveLabelsStepAction(orgId, {
        labels: rows.map((r) => ({ id: r.id, name: r.name, color: r.color })),
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
      <StepIntro
        title={
          flow === "org"
            ? "How does your organization sort its work?"
            : "How do you sort your to-dos?"
        }
      >
        Tags group tasks so you can filter them at a glance. Click a dot to change its colour.
      </StepIntro>

      <StepBody>
        <TagListEditor
          rows={rows}
          onChange={setRows}
          suggestions={SUGGESTED[flow]}
          noun="tag"
          max={MAX_SETUP_LABELS}
        />
      </StepBody>

      <StepError message={error} />
      <StepFooter
        back={backHref ? { href: backHref } : undefined}
        skip={{
          onClick: () => start(goNext),
          disabled: pending,
        }}
      >
        <ContinuePill
          pending={pending}
          onClick={save}
          disabled={rows.some((r) => !r.name.trim())}
        />
      </StepFooter>
    </SetupCard>
  );
}
