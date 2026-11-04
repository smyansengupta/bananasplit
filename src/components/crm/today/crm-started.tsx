"use client";

import { Check, FileSpreadsheet, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { bringInAction, runSetupAction, startImportAction } from "@/app/app/[orgSlug]/crm/actions";
import { saveGoalAction } from "@/app/app/[orgSlug]/crm/goal-actions";
import { saveMemberSettingsAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import {
  hideCrmStartedAction,
  restoreCrmStartedAction,
  setCrmStepSkippedAction,
  shareOutOwnersAction,
  turnOnBookingAction,
} from "@/app/app/[orgSlug]/crm/settings-actions";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { useSheetUpload, type DroppedSheet } from "@/components/crm/settings/sheet-drop";
import { toast } from "@/components/ui/toaster";
import { GOAL_WHAT, parseTarget } from "@/lib/crm/goal-pace";
import { OWNER_MODES, startingKinds } from "@/lib/crm/setup-owners";
import {
  bringInChoices,
  canOpenCrmStep,
  canSkipCrmStep,
  crmStartedHref,
  crmStartedProgress,
  nextCrmStep,
  type BringInChoice,
  type CrmStartedKey,
  type CrmStartedViewer,
} from "@/lib/crm/started";
import { setupKindInfo, setupKindsFor, type SetupKind } from "@/lib/crm/templates";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type { CrmStartedData } from "@/server/crm/started";

/**
 * "Get your CRM started" (docs/features/crm.md, "Getting started"): one strip
 * across the top of Today asking one question at a time, its controls right
 * there and a default picked, so one click usually answers it. An answer moves
 * on at once: the steps' saves run behind the strip, one after another, because
 * the first answer makes the CRM the others are saved in. One that fails brings
 * its question back with the reason. Skip is the step's "not needed", the
 * segments jump to any step, and Hide checks off the rest with Undo in the
 * toast. The last answer says the CRM is ready, and the strip leaves.
 */

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

/** The step's main button. */
const SOLID = cn(
  "bg-block-goal-foreground text-block-goal inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60",
  FOCUS,
);

/** The step's other buttons. */
const RING = cn(
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold ring-1 ring-current/30 transition-colors hover:ring-current/60 disabled:cursor-default disabled:opacity-60",
  FOCUS,
);

/** Skip and Hide: there when wanted, never competing with the question. */
const QUIET = cn(
  "text-block-goal-meta hover:text-block-goal-foreground cursor-pointer rounded-full px-2 py-0.5 text-[12.5px] font-semibold transition-colors",
  FOCUS,
);

const FIELD =
  "placeholder:text-current/55 min-w-0 rounded-[12px] bg-current/10 px-3 text-[14px] ring-1 ring-current/25 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-current/60";

const ROW = "flex flex-wrap items-center gap-2";

/** The first number offered as a goal: enough to mean something, easy to change. */
const FIRST_GOAL = "25";

type Outcome = { ok: boolean; error?: string };
type Answer = <T extends Outcome>(
  step: CrmStartedKey,
  call: () => Promise<T>,
  done?: (result: Extract<T, { ok: true }>) => void,
) => void;
type Answers = Partial<Record<CrmStartedKey, "done" | "skipped">>;

function queuedLine(added: number, queued: number): string {
  if (queued > 0) return `${queued.toLocaleString("en-US")} are coming in the background.`;
  return added === 1 ? "One person brought in." : `${added.toLocaleString("en-US")} brought in.`;
}

export function CrmStarted({
  orgId,
  orgSlug,
  viewer,
  state,
  skipped,
  counts,
  meetingLink,
  signature,
  quarter,
}: CrmStartedData & { orgId: string; orgSlug: string; viewer: CrmStartedViewer }) {
  const router = useRouter();
  const { setOpen } = useCrmOpen();
  // Answers given here, shown before the server has them.
  const [answers, setAnswers] = useState<Answers>({});
  // The step last answered, which the next one follows, and a step jumped to.
  const [after, setAfter] = useState<CrmStartedKey | null>(null);
  const [jump, setJump] = useState<CrmStartedKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(0);
  const failed = useRef(false);

  const shown = (given: Answers) =>
    crmStartedProgress(
      viewer,
      { ...state, ...Object.fromEntries(Object.entries(given).map(([k, v]) => [k, v === "done"])) },
      [
        ...skipped,
        ...Object.keys(given).filter((key) => given[key as CrmStartedKey] === "skipped"),
      ],
    );
  const progress = shown(answers);
  const current = jump ?? nextCrmStep(progress.steps, after);

  // The button that was pressed has gone with its step: keep the keyboard here.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    heading.current?.focus({ preventScroll: true });
  }, [current]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setReady(false), 2200);
    return () => clearTimeout(timer);
  }, [ready]);

  /** Saves in the order things were answered; the page catches up when the last is in. */
  function enqueue(save: () => Promise<void>) {
    waiting.current += 1;
    queue.current = queue.current.then(save).then(() => {
      waiting.current -= 1;
      if (waiting.current > 0) return;
      failed.current = false;
      router.refresh();
    });
  }

  function settle<T extends Outcome>(
    step: CrmStartedKey,
    status: "done" | "skipped",
    call: () => Promise<T>,
    done?: (result: Extract<T, { ok: true }>) => void,
  ) {
    const given = { ...answers, [step]: status };
    moved.current = true;
    setAnswers(given);
    setError(null);
    setJump(null);
    setAfter(step);
    setReady(nextCrmStep(shown(given).steps, step) === null);

    const takeBack = () => setAnswers(({ [step]: _taken, ...rest }) => rest);
    enqueue(async () => {
      // Whatever follows a failed save waits for that question to be answered again.
      if (failed.current) return takeBack();
      const result = await runAction(call);
      if (result?.ok) {
        done?.(result as Extract<T, { ok: true }>);
        return;
      }
      failed.current = true;
      takeBack();
      setReady(false);
      setJump(step);
      if (result) setError(result.error ?? "That didn't work. Try again.");
    });
  }

  const answer: Answer = (step, call, done) => settle(step, "done", call, done);
  const skip = (step: CrmStartedKey) =>
    settle(step, "skipped", () => setCrmStepSkippedAction(orgId, step, true));

  function hideAll() {
    setError(null);
    setHidden(true);
    enqueue(async () => {
      const result = await runAction(() => hideCrmStartedAction(orgId));
      if (!result?.ok) {
        setHidden(false);
        if (result) setError(result.error);
        return;
      }
      toast({
        title: "Hidden",
        action: {
          label: "Undo",
          run: async () => {
            const undone = await restoreCrmStartedAction(orgId, result.previous);
            if (!undone.ok) return undone.error;
            setHidden(false);
            router.refresh();
          },
        },
      });
    });
  }

  if (hidden) return null;
  if (ready) {
    return (
      <div className="mb-6">
        <p
          role="status"
          className="bg-block-goal text-block-goal-foreground rounded-block animate-in fade-in-0 m-0 flex items-center gap-2.5 px-6 py-4 text-[15px] font-semibold duration-200 motion-reduce:animate-none"
        >
          <span
            aria-hidden="true"
            className="bg-block-goal-foreground text-block-goal grid size-5 place-items-center rounded-full"
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
          Your CRM is ready
        </p>
      </div>
    );
  }
  if (progress.complete || !current) return null;

  const position = progress.steps.findIndex((step) => step.key === current);
  const step = progress.steps[position]!;
  // Hide checks off what can be, so it can't end the strip before the first answer.
  const canHide = canOpenCrmStep(progress.steps, "mailbox");
  // "Leave them for now" already is the owner step's way of skipping it.
  const canSkip = step.status === "todo" && canSkipCrmStep(step.key) && step.key !== "owner";
  const choices = counts ? bringInChoices(counts, viewer.personal) : [];
  const hint =
    step.status === "done"
      ? "Done. You can change this any time."
      : step.key === "people" && choices.length === 0
        ? "Nobody's waiting to come in yet. Add someone, or drop a spreadsheet."
        : step.hint;

  return (
    <div className="mb-6">
      <section
        aria-label="Get your CRM started"
        className="bg-block-goal text-block-goal-foreground rounded-block flex flex-col gap-3 overflow-hidden p-5 sm:px-6 lg:min-h-38 lg:flex-row lg:gap-10"
      >
        <div
          key={step.key}
          className={cn(
            "min-w-0 flex-1",
            (after || jump) &&
              "animate-in fade-in-0 slide-in-from-right-2 duration-200 motion-reduce:animate-none",
          )}
        >
          <h2
            ref={heading}
            tabIndex={-1}
            className="display-title m-0 text-[clamp(1.25rem,1.1rem+0.5vw,1.5rem)] leading-[1.15] outline-none"
          >
            {step.question}
          </h2>
          {error ? (
            <p role="alert" className="mt-1 text-[14px] font-semibold">
              {error}
            </p>
          ) : (
            <p className="text-block-goal-meta mt-1 text-[14px]">{hint}</p>
          )}
          <div className="mt-3">
            {step.status === "done" ? (
              <Link href={crmStartedHref(orgSlug, step.key)} className={RING}>
                Change it
              </Link>
            ) : (
              <>
                {step.key === "kinds" && (
                  <KindsStep
                    orgId={orgId}
                    personal={viewer.personal}
                    hasPartners={(counts?.sponsors ?? 0) > 0}
                    answer={answer}
                  />
                )}
                {step.key === "people" && (
                  <PeopleStep
                    orgId={orgId}
                    orgSlug={orgSlug}
                    choices={choices}
                    answer={answer}
                    addOne={() => setOpen({ kind: "new", what: "person" })}
                  />
                )}
                {step.key === "owner" && (
                  <div className={ROW}>
                    {OWNER_MODES.map((mode, i) => (
                      <button
                        key={mode.id}
                        type="button"
                        title={mode.text}
                        onClick={() =>
                          mode.id === "none"
                            ? skip("owner")
                            : answer(
                                "owner",
                                () =>
                                  shareOutOwnersAction(orgId, mode.id, new Date(0).toISOString()),
                                (r) => {
                                  if (r.shared) {
                                    toast({
                                      title: `Shared out ${r.shared.toLocaleString("en-US")} people.`,
                                    });
                                  }
                                },
                              )
                        }
                        className={i === 0 ? SOLID : RING}
                      >
                        {mode.title}
                      </button>
                    ))}
                  </div>
                )}
                {step.key === "booking" && (
                  <div className={ROW}>
                    <button
                      type="button"
                      onClick={() =>
                        answer(
                          "booking",
                          () => turnOnBookingAction(orgId),
                          (r) =>
                            toast({
                              title: "Your meeting link is on",
                              action: {
                                label: "Copy link",
                                run: () => navigator.clipboard.writeText(r.url),
                              },
                            }),
                        )
                      }
                      className={SOLID}
                    >
                      Turn it on
                    </button>
                    <span
                      title={meetingLink}
                      className="flex h-9 max-w-full min-w-0 items-center rounded-full bg-current/12 px-3.5 text-[13px] font-medium"
                    >
                      <span className="truncate">{meetingLink}</span>
                    </span>
                  </div>
                )}
                {step.key === "goal" && quarter && (
                  <GoalStep orgId={orgId} quarter={quarter} answer={answer} />
                )}
                {step.key === "mailbox" && (
                  <SignatureStep orgId={orgId} signature={signature} answer={answer} />
                )}
              </>
            )}
          </div>
        </div>

        <div className="order-first flex flex-col gap-1 lg:order-none lg:w-52 lg:flex-none">
          <div className="flex h-6 items-center justify-between gap-3">
            <span className="text-[13px] font-semibold tabular-nums">
              Step {position + 1} of {progress.total}
            </span>
            {canHide && (
              <button type="button" onClick={hideAll} className={cn(QUIET, "-me-2")}>
                Hide
              </button>
            )}
          </div>
          <ol aria-label="Steps" className="m-0 flex list-none gap-1 p-0">
            {progress.steps.map((s, i) => (
              <li key={s.key} className="min-w-0 flex-1">
                <button
                  type="button"
                  title={s.question}
                  aria-label={`Step ${i + 1}: ${s.question}${
                    s.status === "done" ? " (done)" : s.status === "skipped" ? " (skipped)" : ""
                  }`}
                  aria-current={s.key === current ? "step" : undefined}
                  disabled={!canOpenCrmStep(progress.steps, s.key)}
                  onClick={() => {
                    setError(null);
                    setJump(s.key);
                  }}
                  className={cn(
                    "flex h-6 w-full cursor-pointer items-center rounded-sm disabled:cursor-default",
                    FOCUS,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "w-full rounded-full transition-colors",
                      s.key === current ? "h-1.5" : "h-1",
                      s.status === "done" && "bg-current",
                      s.status === "skipped" && "bg-current/50",
                      s.status === "todo" && "bg-current/20",
                    )}
                  />
                </button>
              </li>
            ))}
          </ol>
          {canSkip && (
            <div className="flex justify-end lg:mt-auto">
              <button type="button" onClick={() => skip(step.key)} className={cn(QUIET, "-me-2")}>
                Skip
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** The first answer: chips picked for you, then one button. This one makes the CRM. */
function KindsStep({
  orgId,
  personal,
  hasPartners,
  answer,
}: {
  orgId: string;
  personal: boolean;
  hasPartners: boolean;
  answer: Answer;
}) {
  const [kinds, setKinds] = useState<Set<SetupKind>>(
    () => new Set(startingKinds(personal, [], hasPartners)),
  );
  const flip = (kind: SetupKind) =>
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  return (
    <div className={ROW} role="group" aria-label="Who you mostly reach out to">
      {setupKindsFor(personal).map((kind) => {
        const info = setupKindInfo(kind, personal);
        const on = kinds.has(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={on}
            title={info.hint}
            onClick={() => flip(kind)}
            className={cn(RING, "h-8 px-3", on && "bg-current/18 ring-current/70")}
          >
            {on && <Check className="size-3.5" aria-hidden="true" />}
            {info.label}
          </button>
        );
      })}
      <button
        type="button"
        disabled={kinds.size === 0}
        onClick={() => answer("kinds", () => runSetupAction(orgId, [...kinds]))}
        className={SOLID}
      >
        Set up the CRM
      </button>
    </div>
  );
}

/** Everyone Bananasplit knows in one click, or a spreadsheet dropped beside it. */
function PeopleStep({
  orgId,
  orgSlug,
  choices,
  answer,
  addOne,
}: {
  orgId: string;
  orgSlug: string;
  choices: BringInChoice[];
  answer: Answer;
  addOne: () => void;
}) {
  const [sheet, setSheet] = useState<DroppedSheet | null>(null);
  const upload = useSheetUpload(orgSlug, setSheet);
  const total = choices.reduce((n, c) => n + c.n, 0);

  const bringEveryone = () =>
    answer(
      "people",
      async () => {
        let added = 0;
        let queued = 0;
        for (const source of choices) {
          const r = await bringInAction(orgId, source.id);
          if (!r.ok) return r;
          added += r.added + r.linked;
          queued += r.queued;
        }
        return { ok: true as const, added, queued };
      },
      (r) => toast({ title: queuedLine(r.added, r.queued) }),
    );

  const bringSheet = (dropped: DroppedSheet) =>
    answer(
      "people",
      () =>
        startImportAction(orgId, dropped.importId, {
          object: "person",
          mapping: dropped.mapping,
        }),
      (r) =>
        toast({
          title:
            r.log.status === "done"
              ? queuedLine(r.log.created + r.log.updated, 0)
              : queuedLine(0, dropped.total),
        }),
    );

  if (sheet) {
    return (
      <div className={ROW}>
        <button type="button" onClick={() => bringSheet(sheet)} className={SOLID}>
          Bring in {sheet.total.toLocaleString("en-US")} {sheet.total === 1 ? "row" : "rows"}
        </button>
        <span className="flex h-9 max-w-full min-w-0 items-center gap-1 rounded-full bg-current/12 ps-3.5 pe-1.5 text-[13px] font-medium">
          <span className="truncate">{sheet.fileName}</span>
          <button
            type="button"
            aria-label="Remove the file"
            onClick={() => setSheet(null)}
            className={cn(
              "grid size-6 flex-none cursor-pointer place-items-center rounded-full transition-colors hover:bg-current/15",
              FOCUS,
            )}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className={ROW} {...upload.zone}>
      {choices.length > 0 ? (
        <button type="button" onClick={bringEveryone} className={SOLID}>
          Bring in {total.toLocaleString("en-US")} {total === 1 ? "person" : "people"}
        </button>
      ) : (
        <button type="button" onClick={addOne} className={SOLID}>
          Add someone
        </button>
      )}
      <button
        type="button"
        disabled={upload.busy}
        onClick={upload.pick}
        className={cn(
          "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-current/45 px-3.5 text-[13px] font-medium transition-colors hover:bg-current/10 disabled:cursor-default disabled:opacity-60",
          FOCUS,
          upload.over && "border-current bg-current/15",
        )}
      >
        <FileSpreadsheet className="size-3.5" aria-hidden="true" />
        {upload.busy ? "Reading" : "or drop a spreadsheet"}
      </button>
      {upload.input}
    </div>
  );
}

/** One number: how many people to reach this quarter. Any other goal is set on its card. */
function GoalStep({ orgId, quarter, answer }: { orgId: string; quarter: string; answer: Answer }) {
  const [text, setText] = useState(FIRST_GOAL);
  const target = parseTarget(text);
  return (
    <form
      className={ROW}
      onSubmit={(e) => {
        e.preventDefault();
        if (target === null) return;
        answer("goal", () =>
          saveGoalAction(orgId, {
            metric: "people_reached",
            ownerId: null,
            periodKey: quarter,
            target: Math.ceil(target),
            name: GOAL_WHAT.people_reached.label,
          }),
        );
      }}
    >
      <label className="flex items-center gap-2 text-[14px] font-medium">
        <input
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="How many people to reach"
          className={cn(FIELD, "h-9 w-20 tabular-nums")}
        />
        people to reach
      </label>
      <button type="submit" disabled={target === null} className={SOLID}>
        Set goal
      </button>
    </form>
  );
}

/** Your signature, filled in from your name, and Save. */
function SignatureStep({
  orgId,
  signature,
  answer,
}: {
  orgId: string;
  signature: string;
  answer: Answer;
}) {
  const [text, setText] = useState(signature);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        answer("mailbox", () => saveMemberSettingsAction(orgId, { signature: text }));
      }}
    >
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your signature"
        aria-label="Your signature"
        className={cn(FIELD, "max-w-xl flex-[1_1_16rem] resize-none py-1.5 leading-[1.35]")}
      />
      <button type="submit" disabled={!text.trim()} className={SOLID}>
        Save
      </button>
    </form>
  );
}
