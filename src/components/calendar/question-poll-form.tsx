"use client";

import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useRef,
  useState,
  useTransition,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { createQuestionPoll } from "@/app/app/[orgSlug]/calendar/polls/question-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  cleanText,
  closesAtProblem,
  DESCRIPTION_MAX,
  MAX_OPTIONS,
  MIN_OPTIONS,
  OPTION_MAX,
  optionKey,
  optionsProblem,
  QUESTION_MAX,
} from "@/lib/polls/question-poll";
import { cn } from "@/lib/utils";

import { plain } from "./poll-format";

/**
 * "Ask a question": the question, its options and how the vote works.
 * Blank option rows are ignored; Enter in an option moves on (or adds a
 * row), and pasting a list fills several rows at once.
 */

const DAY = 86_400_000;
const CLOSING = [
  { id: "none", label: "No end", ms: null },
  { id: "1d", label: "1 day", ms: DAY },
  { id: "3d", label: "3 days", ms: 3 * DAY },
  { id: "1w", label: "1 week", ms: 7 * DAY },
  { id: "custom", label: "Custom", ms: null },
] as const;
type Closing = (typeof CLOSING)[number]["id"];

interface OptionRow {
  key: number;
  text: string;
}

/** "2026-10-05T18:30" in the browser's zone, for a datetime-local field. */
function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function whenLabel(date: Date): string {
  return plain(
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
  );
}

export function QuestionPollForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<OptionRow[]>([
    { key: 1, text: "" },
    { key: 2, text: "" },
  ]);
  const nextKey = useRef(3);
  const focusKey = useRef<number | null>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());

  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [allowMemberOptions, setAllowMemberOptions] = useState(false);
  const [hideResults, setHideResults] = useState(false);

  const [closing, setClosing] = useState<Closing>("none");
  const [presetAt, setPresetAt] = useState<Date | null>(null);
  const [customAt, setCustomAt] = useState("");
  const [customMin, setCustomMin] = useState("");

  // Rows that repeat an earlier one (case and spacing ignored).
  const duplicates = new Set<number>();
  const seen = new Set<string>();
  for (const o of options) {
    const key = optionKey(o.text);
    if (!key) continue;
    if (seen.has(key)) duplicates.add(o.key);
    else seen.add(key);
  }
  const filled = options.filter((o) => cleanText(o.text)).length;
  const missing = !cleanText(question)
    ? "Write your question to continue."
    : filled < MIN_OPTIONS
      ? "Add at least two options."
      : duplicates.size > 0
        ? "Each option must be different."
        : closing === "custom" && !customAt
          ? "Pick when the poll closes, or choose No end."
          : null;

  function addRow(after?: number, texts: string[] = [""]) {
    const room = MAX_OPTIONS - options.length;
    if (room <= 0) return;
    const rows = texts.slice(0, room).map((text) => ({ key: nextKey.current++, text }));
    focusKey.current = rows[rows.length - 1].key;
    setOptions((prev) => {
      const at = after === undefined ? prev.length : prev.findIndex((o) => o.key === after) + 1;
      return [...prev.slice(0, at), ...rows, ...prev.slice(at)];
    });
  }

  function removeRow(key: number) {
    setOptions((prev) => (prev.length <= MIN_OPTIONS ? prev : prev.filter((o) => o.key !== key)));
  }

  function setText(key: number, text: string) {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, text } : o)));
  }

  function onOptionKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const next = options[index + 1];
    if (next) inputs.current.get(next.key)?.focus();
    else if (cleanText(options[index].text)) addRow();
  }

  // A pasted list (one option per line) fills this row and the ones after it.
  function onOptionPaste(event: ClipboardEvent<HTMLInputElement>, row: OptionRow) {
    const lines = event.clipboardData
      .getData("text")
      .split(/\r?\n/)
      .map((l) => cleanText(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")))
      .filter(Boolean);
    if (lines.length < 2) return;
    event.preventDefault();
    const [first, ...rest] = lines;
    setText(row.key, first.slice(0, OPTION_MAX));
    addRow(
      row.key,
      rest.map((l) => l.slice(0, OPTION_MAX)),
    );
  }

  function pickClosing(id: Closing) {
    setClosing(id);
    setError(null);
    const preset = CLOSING.find((c) => c.id === id);
    const now = new Date().getTime();
    setPresetAt(preset?.ms ? new Date(now + preset.ms) : null);
    if (id === "custom") {
      setCustomMin(localInputValue(new Date(now + 5 * 60_000)));
      if (!customAt) setCustomAt(localInputValue(new Date(now + DAY)));
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (missing || isPending) return;
    const now = new Date();
    const preset = CLOSING.find((c) => c.id === closing);
    const closesAt = preset?.ms
      ? new Date(now.getTime() + preset.ms)
      : closing === "custom"
        ? new Date(customAt)
        : null;
    const problem = optionsProblem(options.map((o) => o.text)) ?? closesAtProblem(closesAt, now);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createQuestionPoll(orgId, {
        question,
        description: description.trim() || null,
        options: options.map((o) => o.text),
        multiple,
        anonymous,
        allowMemberOptions,
        hideResultsUntilClosed: hideResults,
        closesAt: closesAt ? closesAt.toISOString() : null,
      });
      if (result.error || !result.pollId) {
        setError(result.error ?? "Something went wrong. Try again.");
        return;
      }
      router.push(`/app/${orgSlug}/calendar/polls/${result.pollId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-8" noValidate>
      <div className="space-y-3">
        <Link
          href={`/app/${orgSlug}/calendar/polls`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Polls
        </Link>
        <div>
          <h1 className="page-title">Ask a question</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Give the options and let the club vote. Everyone in the club can answer.
          </p>
        </div>
      </div>

      <Section title="Question">
        <div className="grid gap-1.5">
          <Label htmlFor="qpoll-question">Question</Label>
          <Input
            id="qpoll-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={QUESTION_MAX}
            placeholder="e.g. Where should we go for the end-of-term social?"
            autoFocus
            required
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const first = options[0];
              if (first) inputs.current.get(first.key)?.focus();
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="qpoll-description">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="qpoll-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={2}
            placeholder="Anything people should know before they vote"
          />
        </div>
      </Section>

      <Section title="Options">
        <ol className="space-y-2" aria-label="Options">
          {options.map((row, i) => {
            const duplicate = duplicates.has(row.key);
            return (
              <li key={row.key} className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      "border-muted-foreground/35 size-[18px] shrink-0 border-2 transition-[border-radius]",
                      multiple ? "rounded-[5px]" : "rounded-full",
                    )}
                  />
                  <Input
                    ref={(el) => {
                      if (el) {
                        inputs.current.set(row.key, el);
                        if (focusKey.current === row.key) {
                          focusKey.current = null;
                          el.focus();
                        }
                      } else {
                        inputs.current.delete(row.key);
                      }
                    }}
                    value={row.text}
                    onChange={(e) => setText(row.key, e.target.value)}
                    onKeyDown={(e) => onOptionKeyDown(e, i)}
                    onPaste={(e) => onOptionPaste(e, row)}
                    maxLength={OPTION_MAX}
                    placeholder={`Option ${i + 1}`}
                    aria-label={`Option ${i + 1}`}
                    aria-invalid={duplicate ? true : undefined}
                    aria-describedby={duplicate ? `qpoll-dup-${row.key}` : undefined}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "text-muted-foreground shrink-0",
                      options.length <= MIN_OPTIONS && "invisible",
                    )}
                    aria-label={`Remove option ${i + 1}`}
                    onClick={() => removeRow(row.key)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                {duplicate && (
                  <p id={`qpoll-dup-${row.key}`} className="text-destructive ps-7 text-xs">
                    Already an option.
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2 ps-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => addRow()}
            disabled={options.length >= MAX_OPTIONS}
          >
            <Plus aria-hidden className="size-4" />
            Add option
          </Button>
          <p className="text-muted-foreground text-xs">
            {options.length >= MAX_OPTIONS
              ? `That's the most a poll can have (${MAX_OPTIONS}).`
              : "Tip: paste a list to add several at once."}
          </p>
        </div>
      </Section>

      <Section title="How voting works">
        <div className="bg-card divide-y rounded-xl border px-4">
          <Setting
            id="qpoll-multiple"
            label="Allow more than one choice"
            description="People can pick several options instead of one."
            checked={multiple}
            onChange={setMultiple}
          />
          <Setting
            id="qpoll-anonymous"
            label="Anonymous voting"
            description="Only the counts are shown. Nobody, not even admins or you, can see who voted for what. This can't be changed later."
            checked={anonymous}
            onChange={setAnonymous}
          />
          <Setting
            id="qpoll-member-options"
            label="Members can add options"
            description="Anyone in the club can add an option while the poll is open."
            checked={allowMemberOptions}
            onChange={setAllowMemberOptions}
          />
          <Setting
            id="qpoll-hide-results"
            label="Hide results until the poll closes"
            description="Voters see only their own choice until then. You and admins can still see the counts."
            checked={hideResults}
            onChange={setHideResults}
          />
        </div>
      </Section>

      <Section title="When it closes">
        <div role="radiogroup" aria-label="When the poll closes" className="flex flex-wrap gap-1.5">
          {CLOSING.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={closing === c.id}
              onClick={() => pickClosing(c.id)}
              className={cn(
                "focus-visible:ring-ring/50 h-8 rounded-full border px-3.5 text-sm transition-colors outline-none focus-visible:ring-3",
                closing === c.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {closing === "custom" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="qpoll-closes">Closes at</Label>
            <Input
              id="qpoll-closes"
              type="datetime-local"
              value={customAt}
              min={customMin}
              onChange={(e) => {
                setCustomAt(e.target.value);
                setError(null);
              }}
              aria-describedby="qpoll-closes-help"
              className="sm:max-w-xs"
            />
            <p id="qpoll-closes-help" className="text-muted-foreground text-xs">
              In your time zone. You can also close it by hand at any time.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {presetAt
              ? `Closes ${whenLabel(presetAt)}, your time. You can close or reopen it by hand too.`
              : "Stays open until you close it."}
          </p>
        )}
      </Section>

      <div className="space-y-3 border-t pt-4">
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm" role="status">
            {missing ??
              `${filled} options, ${multiple ? "pick any" : "pick one"}${anonymous ? ", anonymous" : ""}.`}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href={`/app/${orgSlug}/calendar/polls`}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={isPending || Boolean(missing)}>
            {isPending && <Loader2 aria-hidden className="size-4 animate-spin" />}
            Create poll
          </Button>
        </div>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4">
      <legend className="mb-3 text-base font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

function Setting({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="leading-snug">
          {label}
        </Label>
        <p id={`${id}-help`} className="text-muted-foreground text-xs">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={`${id}-help`}
        className="mt-0.5"
      />
    </div>
  );
}
