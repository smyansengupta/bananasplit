"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveAutonomyAction } from "@/app/app/[orgSlug]/crm/settings-actions";
import { SettingsCard, SettingsStatus } from "@/app/app/[orgSlug]/settings/settings-card";
import { WorkflowList, type WorkflowRow } from "@/components/crm/automations";
import { Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import {
  TRUST_ITEMS,
  TRUST_LEVELS,
  type Autonomy,
  type TrustLevel,
} from "@/lib/crm/settings-prefs";

import { useSave } from "./use-save";

/**
 * CRM settings > Automations: the running list with a describe-it box on
 * top (a sentence opens the builder with the steps filled in), and how
 * much the CRM may do alone.
 */
export function RunningCard({
  orgId,
  orgSlug,
  rows,
}: {
  orgId: string;
  orgSlug: string;
  rows: WorkflowRow[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const base = `/app/${orgSlug}/crm/settings/automations`;
  return (
    <SettingsCard
      title="Running"
      description="Switch one off and it stops right away. Describe a new one in a sentence."
      footer={
        <>
          <Button variant="ghost" asChild>
            <Link href={`${base}?view=recipes`}>Recipes</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href={`${base}?view=scoring`}>Scores</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href={`${base}/new`}>Build one step by step</Link>
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const sentence = text.trim();
          if (sentence.length < 8) return;
          router.push(`${base}/new?describe=${encodeURIComponent(sentence.slice(0, 1000))}`);
        }}
      >
        <label className="border-input focus-within:border-ring flex h-11 items-center gap-2.5 rounded-full border px-4">
          <Sparkles className="text-muted-foreground size-[18px] shrink-0" aria-hidden="true" />
          <span className="sr-only">Describe an automation</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="When a client pays, thank them and tell Finance"
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
        </label>
      </form>
      <WorkflowList orgId={orgId} orgSlug={orgSlug} rows={rows} />
    </SettingsCard>
  );
}

export function TrustCard({ orgId, initial }: { orgId: string; initial: Autonomy }) {
  const [levels, setLevels] = useState<Autonomy>(initial);
  const { pending, status, save } = useSave();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveAutonomyAction(orgId, levels));
      }}
    >
      <SettingsCard
        title="How much it may do alone"
        description="Suggest puts it in Today to approve. Do and tell me does it and lists it under Done on its own."
        status={<SettingsStatus status={status} />}
        footer={
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        }
      >
        <ul className="divide-border divide-y">
          {TRUST_ITEMS.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
              <span className="min-w-0 flex-[1_1_15rem] text-[15px]">{item.label}</span>
              {item.locked ? (
                <span className="text-muted-foreground min-w-0 flex-[1_1_15rem] text-sm">{item.locked.why}</span>
              ) : (
                <Segmented
                  label={item.label}
                  value={levels[item.id]}
                  onSelect={(v) => setLevels((cur) => ({ ...cur, [item.id]: v as TrustLevel }))}
                  options={TRUST_LEVELS.map((l) => ({ value: l.value, label: l.label }))}
                />
              )}
            </li>
          ))}
        </ul>
      </SettingsCard>
    </form>
  );
}
