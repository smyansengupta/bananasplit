"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  saveQuestionsAction,
  saveSettingsAction,
  setFormClosedAction,
  trashFormAction,
} from "@/app/app/[orgSlug]/forms/actions";
import { QuestionPreview } from "@/components/forms/respondent";
import { QrCode } from "@/components/rsvp/qr-code";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast, undoable } from "@/components/ui/toaster";
import {
  blankQuestion,
  canBranch,
  FORM_LIMITS,
  hasOptions,
  opt,
  QUESTION_GROUPS,
  QUESTION_META,
  QUESTION_TYPES,
  type Question,
  type QuestionType,
} from "@/lib/forms/questions";
import { cn } from "@/lib/utils";

/** How long typing waits before the questions save. */
const TYPING_MS = 700;

// ---- Build ---------------------------------------------------------------

/**
 * Build: the questions down the left, the one you're on as respondents
 * will see it in the middle, and its settings on the right. Everything
 * saves as you go; a deleted question comes back with Undo.
 */
export function FormBuilder({
  orgId,
  formId,
  initial,
  databaseName,
}: {
  orgId: string;
  formId: string;
  initial: Question[];
  databaseName: string;
}) {
  const [questions, setQuestions] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.id ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { status, error, save } = useSaveOnChange(async (json: string) => {
    const result = await saveQuestionsAction(orgId, formId, JSON.parse(json));
    if (result.error) return result.error;
    // New questions get their column ids back; keep them so the next save
    // doesn't make a second column.
    if (result.data) {
      const ids = new Map(result.data.map((q) => [q.id, q.fieldId]));
      setQuestions((qs) => qs.map((q) => (ids.get(q.id) ? { ...q, fieldId: ids.get(q.id) } : q)));
    }
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function commit(next: Question[], typing = false) {
    setQuestions(next);
    if (timer.current) clearTimeout(timer.current);
    const send = () => void save(JSON.stringify(next));
    if (typing) timer.current = setTimeout(send, TYPING_MS);
    else send();
  }

  const current = questions.find((q) => q.id === selected) ?? null;
  const index = current ? questions.indexOf(current) : -1;
  const numberOf = (q: Question) =>
    questions.filter((x) => x.type !== "hidden").findIndex((x) => x.id === q.id) + 1;

  function update(patch: Partial<Question>, typing = false) {
    if (!current) return;
    commit(
      questions.map((q) => (q.id === current.id ? { ...q, ...patch } : q)),
      typing,
    );
  }

  function add(type: QuestionType) {
    if (questions.length >= FORM_LIMITS.questions) return;
    const q = blankQuestion(type);
    const at = index >= 0 ? index + 1 : questions.length;
    commit([...questions.slice(0, at), q, ...questions.slice(at)]);
    setSelected(q.id);
  }

  function move(id: string, by: number) {
    const i = questions.findIndex((q) => q.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j]!, next[i]!];
    commit(next);
  }

  async function remove(id: string) {
    const before = questions;
    const at = before.findIndex((q) => q.id === id);
    const next = before.filter((q) => q.id !== id);
    setSelected(next[Math.min(at, next.length - 1)]?.id ?? null);
    await undoable({
      title: "Question deleted",
      run: async () => {
        commit(next);
      },
      undo: async () => {
        commit(before);
        setSelected(id);
      },
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)_19rem]">
      <aside className="space-y-2">
        <ol className="bg-card edge rounded-card space-y-0.5 p-2" aria-label="Questions">
          {questions.map((q, i) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => setSelected(q.id)}
                aria-current={q.id === selected ? "true" : undefined}
                className={cn(
                  "rounded-field flex w-full items-start gap-2.5 px-2.5 py-2 text-left transition-colors",
                  q.id === selected ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className="bg-muted text-muted-foreground grid size-6 shrink-0 place-items-center rounded-[7px] font-mono text-[11px] font-semibold">
                  {q.type === "section" ? "§" : q.type === "hidden" ? "·" : numberOf(q)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] leading-snug font-medium break-words">
                    {q.title || "Untitled question"}
                  </span>
                  <span className="text-muted-foreground block text-[12px]">
                    {QUESTION_META[q.type].label}
                    {q.required ? ", required" : ""}
                  </span>
                </span>
                <span className="sr-only">Question {i + 1}</span>
              </button>
            </li>
          ))}
        </ol>
        <AddQuestion onAdd={add} disabled={questions.length >= FORM_LIMITS.questions} />
        <div className="px-1">
          <SavedMark status={status} error={error} />
        </div>
      </aside>

      <section className="bg-muted/40 edge rounded-card flex min-h-[26rem] items-center p-6 sm:p-10">
        {current ? (
          <div className="w-full max-w-xl">
            <QuestionPreview
              key={`${current.id}:${current.type}`}
              q={current}
              number={numberOf(current)}
            />
          </div>
        ) : (
          <p className="text-muted-foreground mx-auto text-sm">Add a question to start.</p>
        )}
      </section>

      {current ? (
        <QuestionSettings
          key={current.id}
          q={current}
          later={questions.slice(index + 1)}
          databaseName={databaseName}
          onChange={update}
          onMove={(by) => move(current.id, by)}
          onRemove={() => void remove(current.id)}
          first={index === 0}
          last={index === questions.length - 1}
        />
      ) : (
        <div />
      )}
    </div>
  );
}

function AddQuestion({
  onAdd,
  disabled,
}: {
  onAdd: (type: QuestionType) => void;
  disabled: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-start" disabled={disabled}>
          <Plus className="size-4" aria-hidden="true" />
          Add a question
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-60 overflow-y-auto">
        {QUESTION_GROUPS.map((g, gi) => (
          <div key={g.id}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              {g.label}
            </DropdownMenuLabel>
            {QUESTION_TYPES.filter((t) => QUESTION_META[t].group === g.id).map((t) => (
              <DropdownMenuItem key={t} onSelect={() => onAdd(t)}>
                {QUESTION_META[t].label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QuestionSettings({
  q,
  later,
  databaseName,
  onChange,
  onMove,
  onRemove,
  first,
  last,
}: {
  q: Question;
  later: Question[];
  databaseName: string;
  onChange: (patch: Partial<Question>, typing?: boolean) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
  first: boolean;
  last: boolean;
}) {
  const options = q.options ?? [];
  const setOptions = (next: { id: string; label: string }[], typing = false) =>
    onChange({ options: next }, typing);
  const targets = later.filter((x) => x.type !== "hidden");

  function changeType(type: QuestionType) {
    const fresh = blankQuestion(type, q.title);
    onChange({
      type,
      options: hasOptions(type) ? (q.options?.length ? q.options : fresh.options) : undefined,
      min: fresh.min,
      max: fresh.max,
      param: fresh.param,
      logic: canBranch(type) ? q.logic : undefined,
      allowOther: hasOptions(type) && type !== "ranking" ? q.allowOther : undefined,
    });
  }

  return (
    <aside className="bg-card edge rounded-card space-y-4 p-4">
      <div className="flex items-center gap-1">
        <select
          value={q.type}
          onChange={(e) => changeType(e.target.value as QuestionType)}
          aria-label="Question type"
          className="border-input bg-background h-9 min-w-0 flex-1 rounded-[10px] border px-2.5 text-[13.5px]"
        >
          {QUESTION_GROUPS.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {QUESTION_TYPES.filter((t) => QUESTION_META[t].group === g.id).map((t) => (
                <option key={t} value={t}>
                  {QUESTION_META[t].label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onMove(-1)}
          disabled={first}
          aria-label="Move up"
        >
          <ArrowUp className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onMove(1)}
          disabled={last}
          aria-label="Move down"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Delete question">
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="q-title">Question</Label>
        <Textarea
          id="q-title"
          rows={2}
          value={q.title}
          maxLength={FORM_LIMITS.questionTitle}
          onChange={(e) => onChange({ title: e.target.value }, true)}
          placeholder="What's your name?"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="q-help">Description</Label>
        <Textarea
          id="q-help"
          rows={2}
          value={q.help ?? ""}
          maxLength={FORM_LIMITS.help}
          onChange={(e) => onChange({ help: e.target.value || undefined }, true)}
        />
      </div>
      {q.type !== "section" && q.type !== "hidden" && (
        <Toggle
          id="q-required"
          label="Required"
          checked={q.required}
          onChange={(v) => onChange({ required: v })}
        />
      )}

      {hasOptions(q.type) && (
        <div className="space-y-2">
          <Label>Choices</Label>
          <ol className="space-y-1.5">
            {options.map((o, i) => (
              <li key={o.id} className="flex items-center gap-1.5">
                <Input
                  value={o.label}
                  maxLength={FORM_LIMITS.optionLabel}
                  aria-label={`Choice ${i + 1}`}
                  onChange={(e) =>
                    setOptions(
                      options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)),
                      true,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (options.length < FORM_LIMITS.options)
                        setOptions([...options.slice(0, i + 1), opt(""), ...options.slice(i + 1)]);
                    }
                  }}
                  onPaste={(e) => {
                    const lines = e.clipboardData
                      .getData("text")
                      .split(/\r?\n/)
                      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
                      .filter(Boolean);
                    if (lines.length < 2) return;
                    e.preventDefault();
                    const added = lines.map((l) => opt(l.slice(0, FORM_LIMITS.optionLabel)));
                    setOptions(
                      [
                        ...options.slice(0, i),
                        ...added,
                        ...options.slice(i + (o.label ? 0 : 1)),
                      ].slice(0, FORM_LIMITS.options),
                    );
                  }}
                  className="h-9"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove choice ${i + 1}`}
                  disabled={options.length <= 1}
                  onClick={() => setOptions(options.filter((x) => x.id !== o.id))}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOptions([...options, opt(`Option ${options.length + 1}`)])}
            disabled={options.length >= FORM_LIMITS.options}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a choice
          </Button>
          {q.type !== "ranking" && (
            <Toggle
              id="q-other"
              label='Add "Other"'
              checked={Boolean(q.allowOther)}
              onChange={(v) => onChange({ allowOther: v || undefined })}
            />
          )}
        </div>
      )}

      {q.type === "rating" && (
        <div className="grid gap-1.5">
          <Label>Stars</Label>
          <Segmented
            label="Stars"
            value={String(q.max ?? 5)}
            onSelect={(v) => onChange({ max: Number(v) })}
            options={["3", "5", "10"].map((v) => ({ value: v, label: v }))}
          />
        </div>
      )}
      {q.type === "scale" && (
        <div className="grid gap-1.5">
          <Label>Range</Label>
          <Segmented
            label="Range"
            value={`${q.min ?? 1}-${q.max ?? 10}`}
            onSelect={(v) => {
              const [min, max] = v.split("-").map(Number);
              onChange({ min, max });
            }}
            options={["1-5", "1-10", "0-10"].map((v) => ({
              value: v,
              label: v.replace("-", " to "),
            }))}
          />
        </div>
      )}
      {q.type === "hidden" && (
        <div className="grid gap-1.5">
          <Label htmlFor="q-param">Link parameter</Label>
          <Input
            id="q-param"
            value={q.param ?? ""}
            onChange={(e) =>
              onChange(
                {
                  param:
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, "")
                      .slice(0, 32) || undefined,
                },
                true,
              )
            }
            placeholder="source"
            className="h-9 font-mono"
          />
        </div>
      )}

      {canBranch(q.type) && targets.length > 0 && (
        <div className="space-y-2">
          <Label>Then go to</Label>
          {(q.type === "yesno"
            ? [
                { id: "yes", label: "Yes" },
                { id: "no", label: "No" },
              ]
            : options
          ).map((o) => {
            const rule = q.logic?.find((r) => r.when === o.id);
            return (
              <div
                key={o.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-2 text-[13px]"
              >
                <span className="min-w-0 break-words">{o.label || "Untitled"}</span>
                <select
                  value={rule?.goTo ?? ""}
                  aria-label={`After ${o.label}`}
                  onChange={(e) => {
                    const rest = (q.logic ?? []).filter((r) => r.when !== o.id);
                    onChange({
                      logic: e.target.value
                        ? [...rest, { when: o.id, goTo: e.target.value }]
                        : rest.length
                          ? rest
                          : undefined,
                    });
                  }}
                  className="border-input bg-background h-8 min-w-0 rounded-[8px] border px-2"
                >
                  <option value="">Next question</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {(t.title || "Untitled").slice(0, 40)}
                    </option>
                  ))}
                  <option value="end">End of form</option>
                </select>
              </div>
            );
          })}
        </div>
      )}

      {q.type !== "section" && (
        <p className="text-muted-foreground border-t pt-3 text-[12px]">
          Saves to {databaseName}, column &ldquo;{(q.title || "Question").slice(0, 60)}&rdquo;
        </p>
      )}
    </aside>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="leading-snug">
          {label}
        </Label>
        {hint && <p className="text-muted-foreground mt-0.5 text-[12px]">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

// ---- Settings --------------------------------------------------------------

interface SettingsForm {
  id: string;
  kind: "FORM" | "QUICK_POLL";
  title: string;
  description: string | null;
  access: "ANYONE" | "MEMBERS" | "SIGNED_IN";
  onePerPerson: boolean;
  anonymous: boolean;
  hideResultsUntilClosed: boolean;
  responseCap: number | null;
  closesAt: string | null;
  notifyOwner: boolean;
  review: boolean;
  open: boolean;
  closed: boolean;
}

/** "2026-10-05T18:30" in the browser's zone, for a datetime-local field. */
function localInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Settings: each one saves the moment it changes. */
export function FormSettingsPanel({
  orgId,
  orgSlug,
  form,
  databaseHref,
}: {
  orgId: string;
  orgSlug: string;
  form: SettingsForm;
  databaseHref: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(form);
  const [pending, start] = useTransition();
  const { status, error, save } = useSaveOnChange(async (patch: string) => {
    const result = await saveSettingsAction(orgId, form.id, JSON.parse(patch));
    if (result.error) return result.error;
    router.refresh();
  });
  const set = (patch: Partial<SettingsForm>) => {
    setState((s) => ({ ...s, ...patch }));
    void save(JSON.stringify(patch));
  };

  async function remove() {
    await undoable({
      title: "Deleted",
      run: async () => {
        const r = await trashFormAction(orgId, form.id, true);
        if (r.error) return r.error;
        router.push(`/app/${orgSlug}/forms`);
      },
      undo: async () => {
        const r = await trashFormAction(orgId, form.id, false);
        if (r.error) return r.error;
        router.push(`/app/${orgSlug}/forms/${form.id}?tab=settings`);
      },
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <section className="bg-card edge rounded-card space-y-4 p-5">
        <div className="grid gap-1.5">
          <Label htmlFor="f-title">Title</Label>
          <Input
            id="f-title"
            defaultValue={state.title}
            maxLength={200}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== form.title &&
              set({ title: e.target.value })
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-desc">Description</Label>
          <Textarea
            id="f-desc"
            rows={3}
            defaultValue={state.description ?? ""}
            maxLength={2000}
            onBlur={(e) =>
              (e.target.value || null) !== form.description &&
              set({ description: e.target.value || null })
            }
          />
        </div>
      </section>

      <section className="bg-card edge rounded-card space-y-4 p-5">
        <div className="grid gap-2">
          <Label>Who can answer</Label>
          <Segmented
            label="Who can answer"
            value={state.access}
            onSelect={(v) => set({ access: v as SettingsForm["access"] })}
            options={[
              { value: "ANYONE", label: "Anyone with the link" },
              { value: "MEMBERS", label: "Members" },
              { value: "SIGNED_IN", label: "Signed in, once each" },
            ]}
          />
        </div>
        {state.access === "MEMBERS" && (
          <Toggle
            id="f-once"
            label="One answer each"
            checked={state.onePerPerson}
            onChange={(v) => set({ onePerPerson: v })}
          />
        )}
        <Toggle
          id="f-anon"
          label="Anonymous"
          hint="Who answered isn't kept."
          checked={state.anonymous}
          onChange={(v) => set({ anonymous: v })}
        />
        {state.kind === "QUICK_POLL" && (
          <Toggle
            id="f-hide"
            label="Hide results until it closes"
            checked={state.hideResultsUntilClosed}
            onChange={(v) => set({ hideResultsUntilClosed: v })}
          />
        )}
        <Toggle
          id="f-review"
          label="Review responses"
          hint="Accept, waitlist or decline each one, with a rating and notes."
          checked={state.review}
          onChange={(v) => set({ review: v })}
        />
        <Toggle
          id="f-notify"
          label="Tell me about each response"
          checked={state.notifyOwner}
          onChange={(v) => set({ notifyOwner: v })}
        />
      </section>

      <section className="bg-card edge rounded-card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <div className="grid gap-1.5">
            <Label htmlFor="f-closes">Closes</Label>
            <Input
              id="f-closes"
              type="datetime-local"
              defaultValue={localInput(state.closesAt)}
              onChange={(e) =>
                set({ closesAt: e.target.value ? new Date(e.target.value).toISOString() : null })
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-cap">Stop after</Label>
            <Input
              id="f-cap"
              type="number"
              min={1}
              max={10000}
              placeholder="No limit"
              defaultValue={state.responseCap ?? ""}
              onBlur={(e) => {
                const n = e.target.value ? Math.floor(Number(e.target.value)) : null;
                if (n !== state.responseCap && (n === null || (n >= 1 && n <= 10000)))
                  set({ responseCap: n });
              }}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setFormClosedAction(orgId, form.id, !state.closed);
                if (r.error) {
                  toast({ title: r.error, tone: "error" });
                  return;
                }
                setState((s) => ({ ...s, closed: !s.closed }));
                toast({ title: state.closed ? "Reopened" : "Closed" });
                router.refresh();
              })
            }
          >
            {state.closed ? (
              <>
                <RotateCcw className="size-4" aria-hidden="true" />
                Reopen
              </>
            ) : (
              <>
                <Lock className="size-4" aria-hidden="true" />
                Close now
              </>
            )}
          </Button>
          <Button variant="outline" asChild>
            <a href={databaseHref}>Open database</a>
          </Button>
          <Button
            variant="ghost"
            className="text-tint-danger-foreground"
            onClick={() => void remove()}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete form
          </Button>
        </div>
      </section>
      <SavedMark status={status} error={error} />
    </div>
  );
}

// ---- Share -------------------------------------------------------------

export function SharePanel({ link, open, title }: { link: string; open: boolean; title: string }) {
  const short = useMemo(() => link.replace(/^https?:\/\//, ""), [link]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Select the link to copy it", tone: "error" });
    }
  }
  return (
    <div className="grid max-w-3xl gap-5 md:grid-cols-[minmax(0,1fr)_14rem]">
      <section className="bg-card edge rounded-card space-y-4 p-5">
        <div className="bg-muted/60 rounded-field flex items-center gap-2 px-3 py-2.5">
          <span className="min-w-0 flex-1 font-mono text-[13px] break-all select-all">{short}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void copy()}>
            <Copy className="size-4" aria-hidden="true" />
            Copy link
          </Button>
          <Button variant="outline" asChild>
            <a href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" aria-hidden="true" />
              Open
            </a>
          </Button>
        </div>
        {!open && <p className="text-muted-foreground text-[13px]">Closed: the link says so.</p>}
      </section>
      <section className="bg-card edge rounded-card grid place-items-center p-5">
        <QrCode value={link} label={`QR code for ${title}`} className="size-44" />
      </section>
    </div>
  );
}
