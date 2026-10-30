"use client";

import { BackLink } from "@/components/back-link";
import { ChevronRight, Loader2, Plus, X } from "@/components/icons";
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
import { createFormAction, saveSettingsAction } from "@/app/app/[orgSlug]/forms/actions";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { newId } from "@/lib/forms/questions";
import { PageHeader } from "@/components/page-header";
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
 * Quick poll: the question and its options on one screen, everything else
 * folded under Options. Blank option rows are ignored; Enter in an option
 * moves on (or adds a row), and pasting a list fills several rows at once.
 *
 * Members only, it's a question poll (live counts, anonymity the database
 * enforces, members adding options). Anyone with the link (owners and
 * admins), it's a one-question form, answered at /f/{slug} with no sign-in.
 * Either way, Create copies the link.
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

export function QuestionPollForm({
  orgId,
  orgSlug,
  canMakeForms = false,
}: {
  orgId: string;
  orgSlug: string;
  /** Owners and admins can open a poll to anyone with the link. */
  canMakeForms?: boolean;
}) {
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
  const [who, setWho] = useState<"members" | "anyone">("members");
  const [more, setMore] = useState(false);

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
      if (who === "anyone") {
        const labels = options.map((o) => cleanText(o.text)).filter(Boolean);
        const made = await createFormAction(orgId, {
          kind: "QUICK_POLL",
          title: cleanText(question),
          questions: [
            {
              id: newId(),
              type: multiple ? "checkboxes" : "choice",
              title: cleanText(question),
              help: description.trim() || undefined,
              required: true,
              allowOther: allowMemberOptions || undefined,
              options: labels.map((label) => ({ id: newId(), label })),
            },
          ],
        });
        if (made.error || !made.data) {
          setError(made.error ?? "Something went wrong. Try again.");
          return;
        }
        await saveSettingsAction(orgId, made.data.id, {
          anonymous,
          hideResultsUntilClosed: hideResults,
          closesAt: closesAt ? closesAt.toISOString() : null,
        });
        await copyLink(`${window.location.origin}/f/${made.data.slug}`);
        router.push(`/app/${orgSlug}/forms/${made.data.id}?tab=share`);
        return;
      }
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
      const href = `/app/${orgSlug}/forms/polls/${result.pollId}`;
      await copyLink(`${window.location.origin}${href}`);
      router.push(href);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-8" noValidate>
      <div className="space-y-3">
        <BackLink href={`/app/${orgSlug}/forms`} label="Forms" />
        <PageHeader title="Quick poll" />
        {canMakeForms && (
          <Segmented
            label="Who can answer"
            value={who}
            onSelect={(v) => setWho(v === "anyone" ? "anyone" : "members")}
            options={[
              { value: "members", label: "Members" },
              { value: "anyone", label: "Anyone with the link" },
            ]}
          />
        )}
      </div>

      <Section>
        <div className="grid gap-1.5">
          <Label htmlFor="qpoll-question">Question</Label>
          <Input
            id="qpoll-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={QUESTION_MAX}
            placeholder="Where should we go for the end-of-term social?"
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
          <Label htmlFor="qpoll-description">Description</Label>
          <Textarea
            id="qpoll-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={2}
            placeholder="Anything to know before voting"
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
                    size="icon-sm"
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
          {options.length >= MAX_OPTIONS && (
            <p className="text-muted-foreground text-xs">Up to {MAX_OPTIONS} options.</p>
          )}
        </div>
      </Section>

      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-full py-1 text-sm font-medium transition-colors"
      >
        <ChevronRight
          className={cn("size-4 transition-transform duration-150", more && "rotate-90")}
          aria-hidden="true"
        />
        Options
      </button>

      {more && (
        <Section title="How voting works">
          <div className="bg-card divide-y rounded-xl border px-4">
            <Setting
              id="qpoll-multiple"
              label="Allow more than one choice"
              checked={multiple}
              onChange={setMultiple}
            />
            <Setting
              id="qpoll-anonymous"
              label="Anonymous voting"
              description="Can't be changed later."
              checked={anonymous}
              onChange={setAnonymous}
            />
            <Setting
              id="qpoll-member-options"
              label={who === "anyone" ? "Let people add an option" : "Members can add options"}
              checked={allowMemberOptions}
              onChange={setAllowMemberOptions}
            />
            <Setting
              id="qpoll-hide-results"
              label="Hide results until the poll closes"
              checked={hideResults}
              onChange={setHideResults}
            />
          </div>
        </Section>
      )}

      {more && (
        <Section title="When it closes">
          <div
            role="radiogroup"
            aria-label="When the poll closes"
            className="flex flex-wrap gap-1.5"
          >
            {CLOSING.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={closing === c.id}
                onClick={() => pickClosing(c.id)}
                className={cn(
                  "focus-visible:ring-ring/50 h-8 rounded-md border px-3 text-sm transition-colors outline-none focus-visible:ring-3",
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
                Your time zone.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {presetAt ? `Closes ${whenLabel(presetAt)}` : "Open until you close it"}
            </p>
          )}
        </Section>
      )}

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
          <Button type="submit" disabled={isPending || Boolean(missing)}>
            {isPending && <Loader2 aria-hidden className="size-4 animate-spin" />}
            Create and copy link
          </Button>
        </div>
      </div>
    </form>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4">
      {title && <legend className="mb-3 text-base font-medium">{title}</legend>}
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
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="leading-snug">
          {label}
        </Label>
        {description && (
          <p id={`${id}-help`} className="text-muted-foreground text-xs">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={description ? `${id}-help` : undefined}
        className="mt-0.5"
      />
    </div>
  );
}

/** Copies the poll's link, saying so; a browser that refuses still gets the poll. */
async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast({ title: "Link copied" });
  } catch {
    toast({ title: "Poll created" });
  }
}
