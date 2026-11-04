"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { publishDraftAction, rollbackAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { BackLink } from "@/components/back-link";
import {
  ArrowRightLeft,
  Check,
  CircleAlert,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  type IconComponent,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import type { ChangeKind, ChangeLine, TitleChange } from "@/lib/org-chart/publish";
import type { ChartPersonDTO } from "@/lib/org-chart/types";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * "Publish the new org chart": each change from the chart everyone sees,
 * in a sentence, with the person it touches; whose profile titles follow;
 * anything to fix first; and Publish, with Undo in the toast. The chart it
 * replaces stays in Version history.
 */

const LOOK: Record<ChangeKind, { icon: IconComponent; tint: string }> = {
  added: { icon: Plus, tint: "bg-tint-success text-tint-success-foreground" },
  open: { icon: UserPlus, tint: "bg-tint-success text-tint-success-foreground" },
  moved: { icon: ArrowRightLeft, tint: "bg-tint-info text-tint-info-foreground" },
  filled: { icon: Check, tint: "bg-tint-accent text-tint-accent-foreground" },
  person: { icon: ArrowRightLeft, tint: "bg-tint-accent text-tint-accent-foreground" },
  renamed: { icon: Pencil, tint: "bg-muted text-muted-foreground" },
  removed: { icon: Trash2, tint: "bg-tint-danger text-tint-danger-foreground" },
  other: { icon: Pencil, tint: "bg-muted text-muted-foreground" },
};

/** The first chart lists this many positions, then counts the rest. */
const FIRST_CHART_SHOWN = 8;

export function PublishReview({
  orgId,
  orgSlug,
  draft,
  draftHref,
  liveVersionId,
  firstChart,
  positionCount,
  lines,
  titled,
  issues,
  members,
  canSetTitles,
}: {
  orgId: string;
  orgSlug: string;
  draft: { id: string; editVersion: number };
  draftHref: string;
  /** The chart live now, which Undo puts back. */
  liveVersionId: string | null;
  firstChart: boolean;
  positionCount: number;
  lines: ChangeLine[];
  titled: TitleChange[];
  issues: { level: "error" | "warning"; message: string; positionKey: string | null }[];
  members: ChartPersonDTO[];
  canSetTitles: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [setTitles, setSetTitles] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const shown = firstChart ? lines.slice(0, FIRST_CHART_SHOWN) : lines;
  const hidden = lines.length - shown.length;

  const lead = firstChart
    ? `Your first org chart: ${positionCount} ${positionCount === 1 ? "position" : "positions"}.`
    : lines.length === 0
      ? "Nothing changes from the one everyone sees now."
      : `${lines.length} ${lines.length === 1 ? "change" : "changes"} from the one everyone sees now.`;

  const onPublish = () =>
    start(async () => {
      setError(null);
      const result = await runAction(() =>
        publishDraftAction(orgId, draft.id, {
          setTitles: canSetTitles && setTitles,
          expectedEditVersion: draft.editVersion,
        }),
      );
      if (!result) return;
      if (!result.ok) {
        setError("error" in result ? result.error : "The chart couldn't be published.");
        return;
      }
      const previous = liveVersionId;
      toast({
        title: "Org chart published",
        action: previous
          ? {
              label: "Undo",
              run: async () => {
                const undone = await rollbackAction(orgId, previous);
                router.refresh();
                return undone.ok ? null : "error" in undone ? undone.error : "Couldn't undo.";
              },
            }
          : undefined,
      });
      router.push(`/app/${orgSlug}/people?view=chart`);
      router.refresh();
    });

  return (
    <div className="flex max-w-[1180px] flex-col gap-6">
      <BackLink href={draftHref} label="Back to the draft" />

      <header className="flex flex-col gap-2.5">
        <h1 className="page-title text-[clamp(2rem,5vw,2.75rem)]">Publish the new org chart</h1>
        <p className="text-muted-foreground text-lg font-medium">{lead}</p>
      </header>

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-labelledby="what-changes"
          className="bg-card edge rounded-card flex min-w-0 flex-[999_1_560px] flex-col p-5 sm:p-6"
        >
          <h2 id="what-changes" className="heading mb-1 text-[15px]">
            {firstChart ? "What everyone will see" : "What changes"}
          </h2>
          {shown.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              The draft matches the chart. Publishing makes a new version anyway.
            </p>
          ) : (
            <ul className="divide-y">
              {shown.map((line) => {
                const look = LOOK[line.kind];
                const person = line.userId ? byId.get(line.userId) : undefined;
                return (
                  <li key={line.id} className="flex items-start gap-3.5 py-4">
                    <span
                      className={cn(
                        "grid size-[30px] shrink-0 place-items-center rounded-full",
                        look.tint,
                      )}
                    >
                      <look.icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 text-[14.5px] leading-normal">
                      <b className="font-semibold">{line.title}</b> {line.text}
                      {line.detail && (
                        <span className="text-muted-foreground block text-[13px]">
                          {line.detail}
                        </span>
                      )}
                    </span>
                    {person && <UserAvatar user={person} size="lg" />}
                  </li>
                );
              })}
            </ul>
          )}
          {hidden > 0 && (
            <p className="text-muted-foreground border-t pt-4 text-[13px]">And {hidden} more.</p>
          )}
        </section>

        <aside
          aria-labelledby="when-you-publish"
          className="bg-card edge rounded-card flex min-w-0 flex-[1_1_340px] flex-col gap-4 p-5"
        >
          <h2 id="when-you-publish" className="heading text-[15px]">
            When you publish
          </h2>

          {canSetTitles && titled.length > 0 && (
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <Label htmlFor="publish-titles" className="block text-[13.5px] font-semibold">
                  Update{" "}
                  {titled.length === 1 ? "1 member's title" : `${titled.length} members' titles`}
                </Label>
                <span className="text-muted-foreground block text-[12.5px]">
                  {titled
                    .slice(0, 3)
                    .map((t) => `${t.name ?? "A member"} becomes ${t.to}`)
                    .join(", ")}
                  {titled.length > 3 ? `, and ${titled.length - 3} more` : ""}
                </span>
              </span>
              <Switch
                id="publish-titles"
                checked={setTitles}
                onCheckedChange={(v) => setSetTitles(v === true)}
              />
            </div>
          )}

          {errors.length > 0 ? (
            <div className="bg-tint-danger rounded-tile flex flex-col gap-1.5 px-3.5 py-3 text-[13.5px]">
              <p className="flex items-center gap-2 font-semibold">
                <CircleAlert className="size-4" aria-hidden="true" />
                {errors.length === 1
                  ? "1 thing to fix first"
                  : `${errors.length} things to fix first`}
              </p>
              <ul className="flex flex-col gap-0.5">
                {errors.map((issue, i) => (
                  <li key={i}>
                    <Link
                      href={
                        issue.positionKey
                          ? `${draftHref}?position=${encodeURIComponent(issue.positionKey)}`
                          : draftHref
                      }
                      className="underline-offset-4 hover:underline"
                    >
                      {issue.message}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="bg-tint-success rounded-tile flex items-start gap-2.5 px-3.5 py-3 text-[13.5px]">
              <span className="bg-card text-tint-success-foreground grid size-6 shrink-0 place-items-center rounded-full">
                <Check className="size-3.5" aria-hidden="true" />
              </span>
              {warnings.length === 0
                ? "Nothing to fix. Everyone reports to someone, and every name is a member."
                : "Nothing to fix."}
            </p>
          )}

          {errors.length === 0 && warnings.length > 0 && (
            <details className="text-[13px]">
              <summary className="cursor-pointer font-semibold">
                {warnings.length === 1
                  ? "1 thing worth a look"
                  : `${warnings.length} things worth a look`}
              </summary>
              <ul className="text-muted-foreground mt-2 flex flex-col gap-1">
                {warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </details>
          )}

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={pending || errors.length > 0}
            onClick={onPublish}
          >
            {pending ? "Publishing…" : "Publish"}
          </Button>
          <span className="text-muted-foreground text-center text-[12.5px]">
            {firstChart
              ? "Everyone sees it on People. You can change it any time."
              : "The chart you're replacing stays in Version history."}
          </span>
        </aside>
      </div>
    </div>
  );
}
