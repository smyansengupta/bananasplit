"use client";

import { useMemo, useState, useTransition } from "react";

import {
  ContinuePill,
  PreviewHeader,
  PreviewTile,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { bringSelection, moveLabel, type BringSection } from "@/lib/onboarding/bring";
import { cn } from "@/lib/utils";

import { bringIntoClubAction, finishBringAction } from "./bring-actions";

/**
 * B7 · Bring anything in? The creator's Personal event pages, calendar
 * events, polls, open tasks, folders, notes and files, none ticked (except
 * the one they came to move, from Move to a club or an upgrade prompt).
 * "Move N items into <club>" moves the ticked ones one way, keeping their
 * links, sign-ups, tickets and responses (notes and files arrive private to
 * the mover); then Finish opens the club.
 */
export function BringStep({
  orgId,
  orgSlug,
  clubName,
  index,
  total,
  backHref,
  sections,
  preselected,
  welcome,
}: {
  orgId: string;
  orgSlug: string;
  clubName: string;
  index: number;
  total: number;
  backHref: string | null;
  sections: BringSection[];
  /** Ticked to start with (only ids that are in `sections`). */
  preselected: string[];
  /** After setup: the club opens with its welcome. */
  welcome: boolean;
}) {
  const [shown, setShown] = useState(sections);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(preselected));
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<string[]>([]);
  const [moving, startMove] = useTransition();
  const [finishing, startFinish] = useTransition();

  const items = useMemo(() => shown.flatMap((s) => s.groups.flatMap((g) => g.items)), [shown]);
  const count = items.filter((i) => ticked.has(i.id)).length;
  const busy = moving || finishing;

  function toggle(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  }

  function toggleSection(section: BringSection) {
    const ids = section.groups.flatMap((g) => g.items.map((i) => i.id));
    const all = ids.every((id) => ticked.has(id));
    const next = new Set(ticked);
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    setTicked(next);
  }

  function move() {
    setError(null);
    startMove(async () => {
      const result = await bringIntoClubAction(orgId, bringSelection(items, ticked));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // What moved leaves the list, with what came along; what's left can still come.
      setShown(result.sections);
      setMoved([...moved, result.summary]);
      setTicked(new Set());
    });
  }

  const finish = () => startFinish(() => finishBringAction(orgSlug, welcome));
  const nothingLeft = items.length === 0;

  return (
    <SetupCard
      preview={
        <>
          <PreviewHeader meta={clubName} label="Coming with you" />
          {count === 0 && moved.length === 0 && (
            <p className="text-muted-foreground m-0 text-[13px] leading-normal">
              Nothing picked yet. Anything you leave stays in Personal, and you can move it later.
            </p>
          )}
          {items
            .filter((i) => ticked.has(i.id))
            .slice(0, 6)
            .map((i) => (
              <PreviewTile key={i.id}>
                <span className="truncate text-[14px] font-semibold">{i.title}</span>
                <span className="text-muted-foreground text-[12px]">{i.meta}</span>
              </PreviewTile>
            ))}
          {count > 6 && <p className="text-muted-foreground m-0 text-[12px]">and {count - 6} more</p>}
          {moved.length > 0 && (
            <p className="text-muted-foreground m-0 mt-auto text-[13px] leading-normal">
              Already in {clubName}: {moved.join("; ")}.
            </p>
          )}
        </>
      }
    >
      <StepIntro index={index} total={total} title="Bring anything in?">
        Move events, polls, tasks, notes and files from Personal into {clubName}. Links, RSVPs,
        tickets and poll responses keep working, and notes and files stay private to you until you
        share them. Moving is one way.
      </StepIntro>

      <StepBody className="gap-6">
        {moved.length > 0 && (
          <p
            role="status"
            className="bg-tint-success text-tint-success-foreground m-0 rounded-field px-3.5 py-2.5 text-[14px] font-semibold"
          >
            Moved {moved[moved.length - 1]} into {clubName}.
          </p>
        )}
        {nothingLeft && moved.length === 0 && (
          <p className="text-muted-foreground m-0 text-[15px]">
            There&apos;s nothing in Personal to bring.
          </p>
        )}
        {shown.map((section) => {
          const ids = section.groups.flatMap((g) => g.items.map((i) => i.id));
          const all = ids.length > 0 && ids.every((id) => ticked.has(id));
          return (
            <section key={section.key} aria-labelledby={`bring-${section.key}`}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 id={`bring-${section.key}`} className="m-0 text-[15px] font-bold">
                  {section.title}
                </h2>
                <button
                  type="button"
                  onClick={() => toggleSection(section)}
                  disabled={busy}
                  className="text-muted-foreground hover:text-foreground cursor-pointer border-none bg-transparent p-0 text-[13px] font-semibold"
                >
                  {all ? "Clear" : "Pick all"}
                </button>
              </div>
              {section.groups.map((group) => (
                <div key={group.label ?? "-"} className="mb-2 last:mb-0">
                  {group.label && (
                    <p className="text-muted-foreground m-0 mb-1.5 text-[12px] font-semibold tracking-wide uppercase">
                      {group.label}
                    </p>
                  )}
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <label
                          className={cn(
                            "bg-card border-foreground/10 hover:border-foreground/25 flex min-h-10 cursor-pointer items-center gap-3 rounded-field border px-4 py-2.5",
                            ticked.has(item.id) && "border-foreground/40",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={ticked.has(item.id)}
                            onChange={() => toggle(item.id)}
                            disabled={busy}
                            className="accent-primary size-4 flex-none cursor-pointer"
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[15px] font-semibold">{item.title}</span>
                            <span className="text-muted-foreground truncate text-[13px]">{item.meta}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })}
      </StepBody>

      <StepError message={error} />
      <StepFooter
        back={backHref ? { href: backHref } : undefined}
        skip={
          count > 0
            ? { onClick: finish, disabled: busy, label: moved.length ? "Finish" : "Skip" }
            : undefined
        }
      >
        {count > 0 ? (
          <ContinuePill pending={moving} pendingLabel="Moving…" disabled={busy} onClick={move}>
            {moveLabel(count, clubName)}
          </ContinuePill>
        ) : (
          <ContinuePill
            pending={finishing}
            pendingLabel="Opening your club…"
            disabled={busy}
            onClick={finish}
          >
            {welcome ? "Finish setup" : `Go to ${clubName}`}
          </ContinuePill>
        )}
      </StepFooter>
    </SetupCard>
  );
}
