"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Star,
  Upload,
  X,
} from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formResults, submitForm } from "@/app/f/[slug]/actions";
import { checkOne, OTHER, type Answer } from "@/lib/forms/answers";
import {
  accentVar,
  buttonWord,
  DEFAULT_DESIGN,
  thanksLine,
  type FormDesign,
} from "@/lib/forms/design";
import {
  firstQuestionId,
  hasOptions,
  nextQuestionId,
  scaleRange,
  type Question,
} from "@/lib/forms/questions";
import type { QuestionSummary } from "@/lib/forms/summary";
import { cn } from "@/lib/utils";

/**
 * Answering a form, one question per screen (the ClaudeNU join form's
 * manner): the question big, letter keys for choices, Enter to go on, the
 * arrows in the corner to go back and forth, a thin line across the top
 * for how far along you are. Skip rules choose the next question; hidden
 * fields come from the link. Nothing is sent until the last screen.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function Respondent({
  slug,
  title,
  description,
  orgName,
  questions,
  hidden,
  members,
  showResults,
  design = DEFAULT_DESIGN,
  preview = false,
  allowAnother = false,
}: {
  slug: string;
  title: string;
  description: string | null;
  orgName: string;
  questions: Question[];
  hidden: Record<string, string>;
  members: { id: string; name: string }[];
  showResults: boolean;
  /** How the page looks (the form's Design tab). */
  design?: FormDesign;
  /** An owner or admin trying it out: nothing is sent. */
  preview?: boolean;
  /** "Submit another" on the thank-you screen (forms that aren't one each). */
  allowAnother?: boolean;
}) {
  const visible = useMemo(() => questions.filter((q) => q.type !== "hidden"), [questions]);
  // The form opens on its first question (the plan has no Start screen):
  // a Start button that held the focus took the first space someone typed,
  // and with it everything before it ("Jordan Park" arrived as "Park").
  const [stage, setStage] = useState<"ask" | "done">("ask");
  const [trail, setTrail] = useState<string[]>(() => {
    const first = firstQuestionId(questions);
    return first ? [first] : [];
  });
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => ({ ...hidden }));
  const [other, setOther] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<{ summary: QuestionSummary[]; total: number } | null>(
    null,
  );
  const honeypot = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const autoNext = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentId = trail[trail.length - 1];
  const current = questions.find((q) => q.id === currentId) ?? null;
  const number = current ? visible.findIndex((q) => q.id === current.id) + 1 : 0;
  const progress =
    stage === "done" ? 1 : visible.length ? Math.max(0, trail.length - 1) / visible.length : 0;

  useEffect(
    () => () => {
      if (autoNext.current) clearTimeout(autoNext.current);
    },
    [],
  );
  useEffect(() => {
    // Each new screen takes the keyboard (and the first field the focus).
    const el = card.current?.querySelector<HTMLElement>("[data-autofocus]") ?? card.current;
    el?.focus({ preventScroll: true });
  }, [currentId, stage]);

  const set = useCallback((id: string, value: Answer) => {
    setError(null);
    setAnswers((a) => ({ ...a, [id]: value }));
  }, []);

  async function finish(final: Record<string, Answer>) {
    if (preview) {
      // A preview never sends: it shows what the end looks like.
      setStage("done");
      return;
    }
    setSending(true);
    setError(null);
    const result = await submitForm(slug, {
      answers: final,
      other,
      website: honeypot.current?.value ?? "",
    });
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      // Back to the first question with a problem.
      const bad = result.errors ? Object.keys(result.errors)[0] : undefined;
      if (bad && trail.includes(bad)) {
        setTrail(trail.slice(0, trail.indexOf(bad) + 1));
        setError(result.errors![bad]!);
      }
      return;
    }
    setStage("done");
    if (showResults) setResults(await formResults(slug));
  }

  function next(override?: Answer) {
    if (!current) return;
    const value = override !== undefined ? override : answers[current.id];
    const problem = checkOne(current, value, other[current.id]);
    if (problem) {
      setError(problem);
      return;
    }
    const final = override !== undefined ? { ...answers, [current.id]: override } : answers;
    const to = nextQuestionId(questions, current.id, value);
    if (to) {
      setError(null);
      setTrail((t) => [...t, to]);
    } else {
      void finish(final);
    }
  }

  function back() {
    setError(null);
    if (trail.length > 1) setTrail((t) => t.slice(0, -1));
  }

  /** Picks a choice: on a single-choice question, goes on by itself a moment later. */
  function pick(q: Question, id: string) {
    if (q.type === "checkboxes") {
      const now = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
      set(q.id, now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
      return;
    }
    set(q.id, id);
    if (id === OTHER) return;
    if (autoNext.current) clearTimeout(autoNext.current);
    autoNext.current = setTimeout(() => next(id), 260);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (stage !== "ask" || !current || sending) return;
    const typing =
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLInputElement && e.target.type !== "file");
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement && e.shiftKey)) {
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      next();
      return;
    }
    if (typing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toUpperCase();
    if (hasOptions(current.type) && current.type !== "ranking") {
      const i = LETTERS.indexOf(key);
      const opts = current.options ?? [];
      if (i >= 0 && i < opts.length) {
        e.preventDefault();
        pick(current, opts[i]!.id);
      } else if (current.allowOther && i === opts.length) {
        e.preventDefault();
        pick(current, OTHER);
      }
    } else if (current.type === "yesno" && (key === "Y" || key === "N")) {
      e.preventDefault();
      set(current.id, key === "Y");
      if (autoNext.current) clearTimeout(autoNext.current);
      autoNext.current = setTimeout(() => next(key === "Y"), 260);
    } else if ((current.type === "rating" || current.type === "scale") && /^[0-9]$/.test(e.key)) {
      const [lo, hi] = scaleRange(current);
      const n = Number(e.key === "0" && hi === 10 && lo > 0 ? 10 : e.key);
      if (n >= lo && n <= hi) {
        e.preventDefault();
        set(current.id, n);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      back();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      next();
    }
  }

  /** Starts again from the top, for the next person (or the next entry). */
  function again() {
    setAnswers({ ...hidden });
    setOther({});
    setResults(null);
    setError(null);
    const first = firstQuestionId(questions);
    setTrail(first ? [first] : []);
    setStage("ask");
  }

  const { firstName, keyAnswer } = useMemo(
    () => (stage === "done" ? doneFacts(questions, answers) : { firstName: null, keyAnswer: null }),
    [stage, questions, answers],
  );
  const accent = design.accent ? accentVar(design.accent) : null;

  return (
    <div
      className="relative flex flex-1 flex-col"
      style={
        accent
          ? ({
              ["--primary" as string]: accent,
              ["--primary-foreground" as string]: `oklch(from ${accent} clamp(0, (0.62 - l) * 1000, 1) 0 0)`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {design.cover === "wash" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64"
          style={{
            background:
              "linear-gradient(to bottom, color-mix(in oklab, var(--primary) 16%, transparent), transparent)",
          }}
        />
      )}
      {design.cover === "band" && <div aria-hidden="true" className="bg-primary h-20 w-full" />}
      {preview && (
        <p className="bg-muted text-muted-foreground px-4 py-2 text-center text-[13px] font-medium">
          Preview. Answers aren&apos;t saved.
        </p>
      )}
      <div aria-hidden="true" className="bg-muted fixed inset-x-0 top-0 z-10 h-1">
        <div
          className="bg-primary h-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <input
        ref={honeypot}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="sr-only"
      />

      <div
        ref={card}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-16 outline-none sm:px-8"
      >
        {stage === "done" ? (
          <div className="space-y-5" aria-live="polite">
            <h1 className="display-title text-[34px] leading-tight">
              {thanksLine(design, firstName)}
            </h1>
            <p className="text-muted-foreground text-[15px]">
              {keyAnswer ? `You picked ${keyAnswer}. ` : ""}
              {orgName} has your answers.
            </p>
            {results && <Results results={results} />}
            {(allowAnother || preview) && <Go onClick={again} label="Submit another" autoFocus />}
          </div>
        ) : current ? (
          <div
            key={current.id}
            className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-6 duration-300 motion-reduce:animate-none"
          >
            <h1 className="sr-only">{title}</h1>
            {description && trail.length === 1 && (
              // The form's description, above question 1 only.
              <p className="text-muted-foreground max-w-[60ch] text-[16px] leading-relaxed whitespace-pre-line">
                {description}
              </p>
            )}
            <div className="space-y-2">
              {current.type !== "section" && (
                <p className="text-primary flex items-center gap-1 font-mono text-[13px] font-medium tabular-nums">
                  {number}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </p>
              )}
              <h2 className="display-title text-[26px] leading-snug sm:text-[30px]">
                {current.title || "Untitled question"}
                {current.required && current.type !== "section" && (
                  <span className="text-muted-foreground" aria-label="required">
                    {" "}
                    *
                  </span>
                )}
              </h2>
              {current.help && (
                <p className="text-muted-foreground text-[15px] whitespace-pre-line">
                  {current.help}
                </p>
              )}
            </div>

            <Field
              q={current}
              value={answers[current.id]}
              other={other[current.id] ?? ""}
              onOther={(t) => setOther((o) => ({ ...o, [current.id]: t }))}
              onChange={(v) => set(current.id, v)}
              onPick={(id) => pick(current, id)}
              members={members}
              slug={slug}
              onError={setError}
            />

            {error && (
              <p role="alert" className="text-tint-danger-foreground text-[14px] font-medium">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <Go
                onClick={() => next()}
                label={buttonWord(
                  design,
                  !nextQuestionId(questions, current.id, answers[current.id]),
                )}
                pending={sending}
              />
              <span className="text-muted-foreground text-[12px] max-sm:hidden">
                press <b className="font-semibold">Enter</b>
              </span>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">This form has no questions yet.</p>
        )}
      </div>

      {stage === "ask" && current && (
        // In the page's corner, above the footer line rather than over it.
        <div className="absolute right-4 bottom-4 flex overflow-hidden rounded-full shadow-[var(--edge-highlight)] sm:right-8">
          <button
            type="button"
            onClick={back}
            aria-label="Previous question"
            className="bg-primary text-primary-foreground grid h-9 w-10 place-items-center hover:opacity-90"
          >
            <ChevronUp className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => next()}
            aria-label="Next question"
            className="bg-primary text-primary-foreground border-primary-foreground/20 grid h-9 w-10 place-items-center border-l hover:opacity-90"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

function Go({
  onClick,
  label,
  pending,
  autoFocus,
}: {
  onClick: () => void;
  label: string;
  pending?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      data-autofocus={autoFocus ? "" : undefined}
      className="bg-primary text-primary-foreground focus-visible:outline-foreground inline-flex h-10 items-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-transform outline-none focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : label === "Submit" ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <ArrowRight className="size-4" aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

const LINE =
  "border-primary/40 focus:border-primary placeholder:text-muted-foreground/60 w-full border-0 border-b-2 bg-transparent px-0 py-2 text-[22px] outline-none";

function Field({
  q,
  value,
  other,
  onOther,
  onChange,
  onPick,
  members,
  slug,
  onError,
}: {
  q: Question;
  value: Answer | undefined;
  other: string;
  onOther: (text: string) => void;
  onChange: (value: Answer) => void;
  onPick: (id: string) => void;
  members: { id: string; name: string }[];
  slug: string;
  onError: (message: string | null) => void;
}) {
  switch (q.type) {
    case "section":
      return null;
    case "short":
    case "email":
    case "phone":
    case "link":
    case "number":
      return (
        <input
          data-autofocus=""
          type={
            q.type === "email"
              ? "email"
              : q.type === "phone"
                ? "tel"
                : q.type === "link"
                  ? "url"
                  : q.type === "number"
                    ? "number"
                    : "text"
          }
          inputMode={q.type === "number" ? "decimal" : undefined}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(e) =>
            onChange(
              q.type === "number" && e.target.value !== ""
                ? Number(e.target.value)
                : e.target.value,
            )
          }
          placeholder="Type your answer here"
          aria-label={q.title}
          autoComplete={q.type === "email" ? "email" : q.type === "phone" ? "tel" : "off"}
          className={LINE}
        />
      );
    case "date":
      return (
        <input
          data-autofocus=""
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          aria-label={q.title}
          className={cn(LINE, "max-w-xs")}
        />
      );
    case "long":
      return (
        <textarea
          data-autofocus=""
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer here"
          aria-label={q.title}
          rows={4}
          className={cn(LINE, "resize-none text-[18px]")}
        />
      );
    case "choice":
    case "dropdown":
    case "checkboxes": {
      const picked = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      const opts = q.options ?? [];
      return (
        <div
          role={q.type === "checkboxes" ? "group" : "radiogroup"}
          aria-label={q.title}
          className="grid max-w-md gap-2"
        >
          {[...opts, ...(q.allowOther ? [{ id: OTHER, label: "Other" }] : [])].map((o, i) => (
            <Choice
              key={o.id}
              letter={LETTERS[i] ?? ""}
              label={o.label}
              selected={picked.includes(o.id)}
              multiple={q.type === "checkboxes"}
              onClick={() => onPick(o.id)}
              autoFocus={i === 0}
            />
          ))}
          {picked.includes(OTHER) && (
            <input
              autoFocus
              value={other}
              onChange={(e) => onOther(e.target.value)}
              placeholder="Your answer"
              aria-label="Other"
              maxLength={200}
              className={cn(LINE, "text-[18px]")}
            />
          )}
          {q.type === "checkboxes" && (
            <p className="text-muted-foreground text-[12px]">Pick any that fit.</p>
          )}
        </div>
      );
    }
    case "yesno":
      return (
        <div role="radiogroup" aria-label={q.title} className="grid max-w-xs gap-2">
          <Choice
            letter="Y"
            label="Yes"
            selected={value === true}
            onClick={() => onChange(true)}
            autoFocus
          />
          <Choice
            letter="N"
            label="No"
            selected={value === false}
            onClick={() => onChange(false)}
          />
        </div>
      );
    case "rating": {
      const [, hi] = scaleRange(q);
      const n = typeof value === "number" ? value : 0;
      return (
        <div role="radiogroup" aria-label={q.title} className="flex flex-wrap gap-1.5">
          {Array.from({ length: hi }, (_, i) => i + 1).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={n === s}
              aria-label={`${s} of ${hi}`}
              data-autofocus={s === 1 ? "" : undefined}
              onClick={() => onChange(s)}
              className="focus-visible:outline-foreground rounded-full p-1 outline-none focus-visible:outline-2"
            >
              <Star
                className={cn(
                  "size-9 transition-colors",
                  s <= n ? "fill-primary text-primary" : "text-muted-foreground/50",
                )}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      );
    }
    case "scale": {
      const [lo, hi] = scaleRange(q);
      return (
        <div role="radiogroup" aria-label={q.title} className="flex flex-wrap gap-1.5">
          {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={value === s}
              data-autofocus={s === lo ? "" : undefined}
              onClick={() => onChange(s)}
              className={cn(
                "focus-visible:outline-foreground grid size-11 place-items-center rounded-[12px] border text-[16px] font-semibold tabular-nums outline-none focus-visible:outline-2",
                value === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-primary/35 bg-primary/5 hover:bg-primary/10",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      );
    }
    case "ranking":
      return <Ranking q={q} value={value} onChange={onChange} />;
    case "file":
    case "image":
      return <UploadField q={q} value={value} onChange={onChange} slug={slug} onError={onError} />;
    case "signature":
      return (
        <SignatureField q={q} value={value} onChange={onChange} slug={slug} onError={onError} />
      );
    case "member":
      return <MemberField q={q} value={value} onChange={onChange} members={members} />;
    case "hidden":
      return null;
  }
}

function Choice({
  letter,
  label,
  selected,
  multiple,
  onClick,
  autoFocus,
}: {
  letter: string;
  label: string;
  selected: boolean;
  multiple?: boolean;
  onClick: () => void;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      role={multiple ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onClick}
      data-autofocus={autoFocus ? "" : undefined}
      className={cn(
        "focus-visible:outline-foreground flex items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left text-[16px] transition-colors outline-none focus-visible:outline-2",
        selected
          ? "border-primary bg-primary/15 ring-primary ring-1"
          : "border-primary/30 bg-primary/5 hover:bg-primary/10",
      )}
    >
      <kbd
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-[6px] border font-mono text-[11px]",
          selected
            ? "bg-primary text-primary-foreground border-primary"
            : "border-primary/40 bg-card",
        )}
      >
        {letter}
      </kbd>
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {selected && <Check className="text-primary size-4 shrink-0" aria-hidden="true" />}
    </button>
  );
}

function Ranking({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
}) {
  const opts = q.options ?? [];
  const order =
    Array.isArray(value) && value.length === opts.length ? value : opts.map((o) => o.id);
  useEffect(() => {
    if (!Array.isArray(value)) onChange(opts.map((o) => o.id));
    // Only when first shown: start in the order given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const label = new Map(opts.map((o) => [o.id, o.label]));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <ol className="grid max-w-md gap-2" aria-label={q.title}>
      {order.map((id, i) => (
        <li
          key={id}
          className="border-primary/30 bg-primary/5 flex items-center gap-3 rounded-[12px] border px-3 py-2"
        >
          <span className="text-muted-foreground w-5 text-[14px] font-semibold tabular-nums">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 text-[16px] break-words">{label.get(id)}</span>
          <button
            type="button"
            onClick={() => move(i, -1)}
            disabled={i === 0}
            aria-label={`Move ${label.get(id)} up`}
            data-autofocus={i === 0 ? undefined : undefined}
            className="hover:bg-muted grid size-8 place-items-center rounded-full disabled:opacity-30"
          >
            <ChevronUp className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => move(i, 1)}
            disabled={i === order.length - 1}
            aria-label={`Move ${label.get(id)} down`}
            className="hover:bg-muted grid size-8 place-items-center rounded-full disabled:opacity-30"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Sends one file for question `questionId`; its stored id, or an error to show. */
async function uploadAnswer(
  slug: string,
  questionId: string,
  file: File,
): Promise<{ id: string; name: string } | { error: string }> {
  const body = new FormData();
  body.set("file", file);
  body.set("questionId", questionId);
  try {
    const res = await fetch(`/f/${slug}/upload`, { method: "POST", body });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      error?: string;
    };
    if (!res.ok || !data.id) return { error: data.error ?? "That didn't upload. Try again." };
    return { id: data.id, name: data.name ?? file.name };
  } catch {
    return { error: "That didn't upload. Check your connection and try again." };
  }
}

/**
 * A signature, drawn with a finger, a pen or the mouse. "Use this" saves it
 * to the organization's Files as a picture, the same way an image upload
 * goes; Clear starts again.
 */
function SignatureField({
  q,
  value,
  onChange,
  slug,
  onError,
}: {
  q: Question;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
  slug: string;
  onError: (message: string | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);
  const [busy, setBusy] = useState(false);
  const saved = typeof value === "string" && value;

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    canvas.current!.setPointerCapture(e.pointerId);
    const p = point(e);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(canvas.current!).color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setInked(true);
  }
  function stop() {
    drawing.current = false;
  }
  function clear() {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setInked(false);
    onChange("");
  }
  async function use() {
    const c = canvas.current;
    if (!c || !inked) return;
    // The builder's preview has no form to send to.
    if (!slug) return;
    setBusy(true);
    onError(null);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    if (!blob) {
      setBusy(false);
      onError("That didn't save. Try again.");
      return;
    }
    const result = await uploadAnswer(
      slug,
      q.id,
      new File([blob], "signature.png", { type: "image/png" }),
    );
    setBusy(false);
    if ("error" in result) onError(result.error);
    else onChange(result.id);
  }

  return (
    <div className="max-w-md space-y-2">
      <canvas
        ref={canvas}
        width={800}
        height={260}
        data-autofocus=""
        tabIndex={0}
        aria-label={`${q.title}: draw your signature`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerLeave={stop}
        className="border-primary/35 bg-primary/5 text-foreground block aspect-[80/26] w-full touch-none rounded-[16px] border-2 border-dashed"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void use()}
          disabled={!inked || busy}
          className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-2 rounded-full px-4 text-[14px] font-semibold disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
          {saved ? "Saved" : "Use this"}
        </button>
        <button
          type="button"
          onClick={clear}
          className="text-muted-foreground hover:text-foreground h-9 rounded-full px-3 text-[14px] font-medium"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function UploadField({
  q,
  value,
  onChange,
  slug,
  onError,
}: {
  q: Question;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
  slug: string;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    // The builder's preview has no form to send to.
    if (!slug) return;
    setBusy(true);
    onError(null);
    const result = await uploadAnswer(slug, q.id, file);
    setBusy(false);
    if ("error" in result) {
      onError(result.error);
      return;
    }
    setName(result.name);
    onChange(result.id);
  }

  const has = typeof value === "string" && value;
  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void send(f);
        }}
        className={cn(
          "focus-within:outline-foreground flex max-w-md cursor-pointer flex-col items-center gap-2 rounded-[16px] border-2 border-dashed px-6 py-8 text-center transition-colors focus-within:outline-2",
          over
            ? "border-primary bg-primary/10"
            : "border-primary/35 bg-primary/5 hover:bg-primary/10",
        )}
      >
        <input
          ref={input}
          data-autofocus=""
          type="file"
          accept={q.type === "image" ? "image/*" : undefined}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f);
          }}
        />
        {busy ? (
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        ) : (
          <Upload className="size-6" aria-hidden="true" />
        )}
        <span className="text-[15px] font-semibold">
          {has
            ? (name ?? "Uploaded")
            : q.type === "image"
              ? "Choose a picture or drop it here"
              : "Choose a file or drop it here"}
        </span>
        <span className="text-muted-foreground text-[13px]">
          {has ? "Choose another to replace it" : "Up to 10 MB"}
        </span>
      </label>
      {has && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setName(null);
          }}
          className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1 text-[13px]"
        >
          <X className="size-3.5" aria-hidden="true" />
          Remove
        </button>
      )}
    </div>
  );
}

function MemberField({
  q,
  value,
  onChange,
  members,
}: {
  q: Question;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
  members: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const shown = members
    .filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);
  return (
    <div className="grid max-w-md gap-2">
      <input
        data-autofocus=""
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search members"
        aria-label={q.title}
        className={cn(LINE, "text-[18px]")}
      />
      {members.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">Sign in as a member to pick someone.</p>
      ) : (
        shown.map((m, i) => (
          <Choice
            key={m.id}
            letter={LETTERS[i] ?? ""}
            label={m.name}
            selected={value === m.id}
            onClick={() => onChange(m.id)}
          />
        ))
      )}
    </div>
  );
}

function Results({ results }: { results: { summary: QuestionSummary[]; total: number } }) {
  return (
    <div className="space-y-6 pt-2">
      {results.summary.map((s) =>
        s.kind === "text" ? null : (
          <div key={s.question.id} className="space-y-2.5">
            <p className="text-[15px] font-semibold">{s.question.title}</p>
            {s.bars.map((b) => {
              const pct = s.answered ? Math.round((b.count / s.answered) * 100) : 0;
              return (
                <div
                  key={b.id}
                  className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-3 text-[14px]"
                >
                  <div className="bg-muted relative h-8 overflow-hidden rounded-[8px]">
                    <div
                      className="bg-primary/25 absolute inset-y-0 left-0"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="relative z-[1] flex h-full items-center px-3 break-words">
                      {b.label}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-right tabular-nums">{pct}%</span>
                </div>
              );
            })}
          </div>
        ),
      )}
    </div>
  );
}

/**
 * One question as respondents see it, for the builder's preview: the same
 * screen, answerable, nothing sent. Key it by question and type so a new
 * question starts blank.
 */
export function QuestionPreview({ q, number }: { q: Question; number: number }) {
  const [value, setValue] = useState<Answer | undefined>(undefined);
  const [other, setOther] = useState("");
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {q.type !== "section" && q.type !== "hidden" && (
          // The question's number with an arrow, as the answer page shows it.
          <p className="text-primary flex items-center gap-1 font-mono text-[12px] font-medium tabular-nums">
            {number}
            <ArrowRight className="size-3" aria-hidden="true" />
          </p>
        )}
        <h2 className="display-title text-[24px] leading-snug">
          {q.title || "Untitled question"}
          {q.required && q.type !== "section" && <span className="text-muted-foreground"> *</span>}
        </h2>
        {q.help && (
          <p className="text-muted-foreground text-[15px] whitespace-pre-line">{q.help}</p>
        )}
      </div>
      {q.type === "hidden" ? (
        <p className="text-muted-foreground text-[14px]">
          Not shown. Filled from the link: ?{q.param ?? "source"}=...
        </p>
      ) : (
        <Field
          q={q}
          value={value}
          other={other}
          onOther={setOther}
          onChange={setValue}
          onPick={(id) =>
            setValue((now) => {
              if (q.type !== "checkboxes") return id;
              const list = Array.isArray(now) ? now : [];
              return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
            })
          }
          members={[]}
          slug=""
          onError={() => undefined}
        />
      )}
      <Go onClick={() => undefined} label="OK" />
    </div>
  );
}

/**
 * What the thank-you screen says back: the person's first name (from a
 * name question, else the first short answer) and their key answer (the
 * first single choice they made).
 */
export function doneFacts(
  questions: readonly Question[],
  answers: Readonly<Record<string, Answer>>,
): { firstName: string | null; keyAnswer: string | null } {
  const short = questions.filter((q) => q.type === "short");
  const nameQ = short.find((q) => /\bname\b/i.test(q.title)) ?? short[0];
  const raw = nameQ ? answers[nameQ.id] : undefined;
  const firstName =
    typeof raw === "string" && raw.trim() ? (raw.trim().split(/\s+/)[0] ?? null) : null;
  let keyAnswer: string | null = null;
  for (const q of questions) {
    if (q.type !== "choice" && q.type !== "dropdown") continue;
    const v = answers[q.id];
    const label = q.options?.find((o) => o.id === v)?.label;
    if (label) {
      keyAnswer = label;
      break;
    }
  }
  return { firstName, keyAnswer };
}
