"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  Check,
  FileSpreadsheet,
  LayoutGrid,
  Loader2,
  PiggyBank,
  Plus,
  Trash2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { saveBoardAction } from "@/app/app/[orgSlug]/_shell/board-actions";
import { createBudgetPeriod, updateBudgetPeriod } from "@/app/app/[orgSlug]/finance/periods-actions";
import { saveBudgetLines, setStartingBalance } from "@/app/app/[orgSlug]/finance/setup-actions";
import { changeMemberRole } from "@/app/app/[orgSlug]/settings/members/actions";
import { BOARD_ICONS } from "@/components/boards/widget-board";
import { FinanceImport } from "@/components/finance/import/finance-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import type { BoardWidget } from "@/lib/boards";
import type { PeriodLike } from "@/lib/finance/import/plan";
import { parseAmount } from "@/lib/finance/import/values";
import { formatCents } from "@/lib/finance/money";
import { formatPeriodRange, PERIOD_PRESETS, type PeriodDraft } from "@/lib/finance/periods";
import {
  SETUP_STEPS,
  stepDone,
  SUGGESTED_CATEGORIES,
  type FinanceSetupState,
  type SetupStepId,
} from "@/lib/finance/setup";
import { FINANCE_WIDGETS } from "@/lib/finance/widgets";
import { cn } from "@/lib/utils";

/**
 * Finance › Set up: a club's money, step by step. Each step saves on its
 * own (leaving halfway loses nothing) and the list on the left shows what's
 * done, derived from the books. The first three make the dashboard right;
 * the rest can wait.
 */

export interface SetupMember {
  userId: string;
  name: string;
  role: "OWNER" | "ADMIN" | "TREASURER" | "MEMBER";
}

export interface FinanceSetupProps {
  orgId: string;
  orgSlug: string;
  /** The club's local date, YYYY-MM-DD. */
  today: string;
  state: FinanceSetupState;
  /** The active period's budget lines. */
  lines: { id: string; name: string; allocatedCents: number }[];
  periods: PeriodLike[];
  allCategories: { name: string; budgetPeriodId: string }[];
  members: SetupMember[];
  canAppoint: boolean;
  currentUserId: string;
  board: BoardWidget[];
}

const STEP_ICON: Record<SetupStepId, LucideIcon> = {
  period: CalendarRange,
  balance: Wallet,
  budget: PiggyBank,
  people: Users,
  records: FileSpreadsheet,
  board: LayoutGrid,
};

const STEP_INTRO: Record<SetupStepId, string> = {
  period: "Clubs budget by school year, semester or calendar year. Money is tracked one period at a time.",
  balance: "How much the club has right now, so the balance is right from day one.",
  budget: "How much each kind of spending may use this period. Rough numbers are fine; change them any time.",
  people: "Owners and treasurers manage the money. Treasurers can't manage members; admins can't see the money.",
  records: "Bring in last year's spreadsheet, a bank or Venmo export, receipts or an old budget.",
  board: "Pick what your finance dashboard shows. You can add, move and resize widgets later.",
};

const dollars = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

function firstOpenStep(state: FinanceSetupState): SetupStepId {
  return SETUP_STEPS.find((s) => s.core && !stepDone(state, s.id))?.id ?? "people";
}

export function FinanceSetup(props: FinanceSetupProps) {
  const { orgSlug, state } = props;
  const router = useRouter();
  const [step, setStep] = useState<SetupStepId>(() => firstOpenStep(state));
  const index = SETUP_STEPS.findIndex((s) => s.id === step);
  const go = (to: number) => setStep(SETUP_STEPS[Math.max(0, Math.min(SETUP_STEPS.length - 1, to))].id);
  const next = () => {
    if (index === SETUP_STEPS.length - 1) {
      toast({ title: "Finance is set up", description: "Add money in or out any time from the dashboard.", tone: "success" });
      router.push(`/app/${orgSlug}/finance`);
      return;
    }
    go(index + 1);
  };
  const doneCount = SETUP_STEPS.filter((s) => stepDone(state, s.id)).length;
  const meta = SETUP_STEPS[index];
  const Icon = STEP_ICON[step];
  const strip = useRef<HTMLOListElement>(null);

  // On a phone the steps are a strip that scrolls sideways: keep the current one in view.
  useEffect(() => {
    const list = strip.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: Math.max(0, current.offsetLeft - list.offsetLeft - 16), behavior: "smooth" });
  }, [step]);

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Setup steps" className="min-w-0 space-y-3">
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">
            {doneCount} of {SETUP_STEPS.length} done
          </p>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${(doneCount / SETUP_STEPS.length) * 100}%` }} />
          </div>
        </div>
        <ol ref={strip} className="flex gap-1 overflow-x-auto lg:flex-col">
          {SETUP_STEPS.map((s, i) => {
            const done = stepDone(state, s.id);
            const StepIcon = STEP_ICON[s.id];
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setStep(s.id)}
                  aria-current={s.id === step ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    s.id === step ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                      done ? "bg-success border-success text-success-foreground" : s.id === step ? "border-primary text-primary" : "",
                    )}
                  >
                    {done ? <Check className="size-3.5" aria-hidden="true" /> : <StepIcon className="size-3.5" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="text-muted-foreground hidden text-xs lg:block">
                      {i + 1}. {s.short}
                      {s.core ? "" : " · optional"}
                    </span>
                  </span>
                  <span className="sr-only">{done ? "(done)" : ""}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="setup-step-title" className="min-w-0 space-y-5 rounded-xl border p-5 sm:p-6">
        <header className="flex items-start gap-3">
          <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium">
              Step {index + 1} of {SETUP_STEPS.length}
              {meta.core ? "" : " · optional"}
            </p>
            <h2 id="setup-step-title" className="text-lg font-semibold">
              {meta.title}
            </h2>
            <p className="text-muted-foreground text-sm">{STEP_INTRO[step]}</p>
          </div>
        </header>

        {step === "period" && <PeriodStep {...props} onSaved={next} />}
        {step === "balance" && (
          <BalanceStep key={`${state.startingBalance?.cents}-${state.period?.id}`} {...props} onSaved={next} />
        )}
        {step === "budget" && (
          <BudgetStep key={props.lines.map((l) => `${l.id}:${l.allocatedCents}`).join(",")} {...props} onSaved={next} />
        )}
        {step === "people" && <PeopleStep {...props} />}
        {step === "records" && (
          <FinanceImport
            orgId={props.orgId}
            orgSlug={orgSlug}
            today={props.today}
            periods={props.periods}
            categories={props.allCategories}
            embedded
          />
        )}
        {step === "board" && <BoardStep {...props} onSaved={next} />}

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={() => go(index - 1)} disabled={index === 0}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost">
              <Link href={`/app/${orgSlug}/finance`}>Finish later</Link>
            </Button>
            {(step === "people" || step === "records" || stepDone(state, step)) && (
              <Button type="button" variant={step === "people" || step === "records" ? "default" : "outline"} onClick={next}>
                {index === SETUP_STEPS.length - 1 ? "Go to the dashboard" : stepDone(state, step) ? "Next step" : "Skip for now"}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- steps

type StepProps = FinanceSetupProps & { onSaved: () => void };

function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<string | null | undefined>, after?: () => void) => {
    setError(null);
    start(async () => {
      const problem = await work();
      if (problem) {
        setError(problem);
        return;
      }
      router.refresh();
      after?.();
    });
  };
  return { pending, error, run };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {error}
    </p>
  );
}

function SaveButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
      {children}
    </Button>
  );
}

function PeriodStep({ orgId, today, state, onSaved }: StepProps) {
  const { pending, error, run } = useSave();
  const base = new Date(`${today}T12:00:00`);
  const presets = PERIOD_PRESETS.map((p) => ({ id: p.id as string, name: p.name, draft: p.make(base) }));
  const current = state.period;
  const [choice, setChoice] = useState<string>(current ? "keep" : "school-year");
  const [custom, setCustom] = useState<PeriodDraft>(
    current ? { label: current.label, startsOn: current.startsOn, endsOn: current.endsOn } : presets[0].draft,
  );

  function save() {
    run(async () => {
      if (choice === "keep") return null;
      if (choice === "edit" && current) return (await updateBudgetPeriod(orgId, current.id, custom)).error;
      const draft = choice === "custom" ? custom : presets.find((p) => p.id === choice)?.draft;
      if (!draft) return "Pick a period.";
      return (await createBudgetPeriod(orgId, draft)).error;
    }, onSaved);
  }

  const options = [
    ...(current
      ? [
          { id: "keep", title: `Keep ${current.label}`, detail: formatPeriodRange(current.startsOn, current.endsOn) },
          { id: "edit", title: "Change its name or dates", detail: "Transactions stay in it" },
        ]
      : []),
    ...presets
      .filter((p) => !current || p.draft.label !== current.label)
      .map((p) => ({
        id: p.id,
        title: `${current ? "Start " : ""}${p.name} · ${p.draft.label}`,
        detail: formatPeriodRange(p.draft.startsOn, p.draft.endsOn),
      })),
    { id: "custom", title: current ? "Start a period with other dates" : "Other dates", detail: "Name it and pick the days" },
  ];

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Budget period">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={choice === o.id}
            onClick={() => {
              setChoice(o.id);
              if (o.id === "edit" && current) setCustom({ label: current.label, startsOn: current.startsOn, endsOn: current.endsOn });
            }}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-colors",
              choice === o.id ? "border-primary ring-primary/20 bg-primary/5 ring-2" : "hover:border-foreground/20",
            )}
          >
            <span className="block text-sm font-medium">{o.title}</span>
            <span className="text-muted-foreground block text-xs">{o.detail}</span>
          </button>
        ))}
      </div>
      {(choice === "custom" || choice === "edit") && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground text-xs font-medium">Name</span>
            <Input value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} placeholder="2026–27" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground text-xs font-medium">First day</span>
            <Input type="date" value={custom.startsOn} onChange={(e) => setCustom({ ...custom, startsOn: e.target.value })} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground text-xs font-medium">Last day</span>
            <Input type="date" value={custom.endsOn} onChange={(e) => setCustom({ ...custom, endsOn: e.target.value })} />
          </label>
        </div>
      )}
      {current && choice !== "keep" && choice !== "edit" && (
        <p className="text-muted-foreground text-xs">
          Starting a new period makes it the current one. {current.label} keeps its transactions; its categories are copied over at $0.
        </p>
      )}
      <ErrorLine error={error} />
      <SaveButton pending={pending}>{choice === "keep" ? "Use this period" : current ? "Save" : "Start tracking"}</SaveButton>
    </form>
  );
}

function BalanceStep({ orgId, today, state, onSaved }: StepProps) {
  const { pending, error, run } = useSave();
  const [amount, setAmount] = useState(state.startingBalance ? dollars(state.startingBalance.cents) : "");
  const [asOf, setAsOf] = useState(state.startingBalance?.asOf ?? today);
  const parsed = amount.trim() ? parseAmount(amount) : null;
  const cents = parsed ? (parsed.negative ? -parsed.cents : parsed.cents) : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (cents === null) return;
        run(async () => (await setStartingBalance(orgId, { cents, asOf })).error, onSaved);
      }}
    >
      {!state.period && (
        <p className="text-muted-foreground text-sm">This also starts this school year&apos;s budget if you haven&apos;t picked a period.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,12rem)]">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground text-xs font-medium">The club has</span>
          <div className="relative">
            <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">$</span>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="pl-6 text-base tabular-nums"
              aria-label="Starting balance in dollars"
              aria-invalid={amount.trim() !== "" && cents === null}
            />
          </div>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground text-xs font-medium">As of</span>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
      </div>
      <p className="text-muted-foreground text-xs">
        Add up the bank account, Venmo, cash box and anything the school holds for you. Put a minus in front if the club
        owes money. Enter 0 to remove it.
      </p>
      {amount.trim() !== "" && cents === null && <p className="text-destructive text-sm">That isn&apos;t an amount.</p>}
      <ErrorLine error={error} />
      <SaveButton pending={pending}>{cents !== null ? `Save ${formatCents(cents)}` : "Save"}</SaveButton>
    </form>
  );
}

interface LineDraft {
  key: string;
  id: string | null;
  name: string;
  amount: string;
}

function BudgetStep({ orgId, state, lines, onSaved }: StepProps) {
  const { pending, error, run } = useSave();
  const [drafts, setDrafts] = useState<LineDraft[]>(() =>
    lines.map((l) => ({ key: l.id, id: l.id, name: l.name, amount: l.allocatedCents ? dollars(l.allocatedCents) : "" })),
  );
  const [nextKey, setNextKey] = useState(0);
  const centsOf = (d: LineDraft) => {
    const a = d.amount.trim() ? parseAmount(d.amount) : null;
    return a && !a.negative ? a.cents : d.amount.trim() ? null : 0;
  };
  const total = drafts.reduce((s, d) => s + (centsOf(d) ?? 0), 0);
  const names = new Set(drafts.map((d) => d.name.trim().toLowerCase()));
  const suggestions = SUGGESTED_CATEGORIES.filter((n) => !names.has(n.toLowerCase()));
  const invalid = drafts.some((d) => !d.name.trim() || centsOf(d) === null);
  const add = (name = "") => {
    setDrafts((ds) => [...ds, { key: `new-${nextKey}`, id: null, name, amount: "" }]);
    setNextKey((k) => k + 1);
  };

  if (!state.period) {
    return <p className="text-muted-foreground text-sm">Pick your budget period first (step 1), then set the budget lines.</p>;
  }
  const periodId = state.period.id;
  const balance = state.startingBalance?.cents ?? null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        run(async () => {
          const res = await saveBudgetLines(
            orgId,
            periodId,
            drafts.map((d) => ({ id: d.id, name: d.name.trim(), allocatedCents: centsOf(d) ?? 0 })),
          );
          if (!res.error && res.kept) {
            toast({
              title: `${res.kept} line${res.kept === 1 ? " was" : "s were"} kept`,
              description: "Transactions are filed under them. Move those first to remove the line.",
            });
          }
          return res.error;
        }, onSaved);
      }}
    >
      <ul className="space-y-2">
        {drafts.map((d) => (
          <li key={d.key} className="flex items-center gap-2">
            <Input
              value={d.name}
              onChange={(e) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, name: e.target.value } : x)))}
              placeholder="Name, like Food"
              className="min-w-0 flex-1"
              aria-label="Budget line name"
              maxLength={100}
            />
            <div className="relative w-28 shrink-0 sm:w-36">
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">$</span>
              <Input
                value={d.amount}
                onChange={(e) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, amount: e.target.value } : x)))}
                inputMode="decimal"
                placeholder="0"
                className="pl-6 text-right tabular-nums"
                aria-label={`Budget for ${d.name || "this line"}`}
                aria-invalid={centsOf(d) === null}
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive size-9 shrink-0"
              onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
              aria-label={`Remove ${d.name || "this line"}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => add()}>
          <Plus className="size-4" aria-hidden="true" />
          Add a line
        </Button>
        {suggestions.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => add(n)}
            className="text-muted-foreground hover:border-primary/40 hover:text-foreground rounded-full border border-dashed px-2.5 py-1 text-xs"
          >
            + {n}
          </button>
        ))}
      </div>
      <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
        <span>
          Budgeted <span className="font-semibold tabular-nums">{formatCents(total)}</span>
          {balance !== null && (
            <span className="text-muted-foreground"> of the {formatCents(balance)} you have</span>
          )}
        </span>
        {balance !== null && total > balance && (
          <span className="text-warning text-xs">That&apos;s more than the club has right now, which is fine if money is coming in.</span>
        )}
      </div>
      {invalid && <p className="text-muted-foreground text-xs">Every line needs a name and an amount (or leave the amount empty for $0).</p>}
      <ErrorLine error={error} />
      <SaveButton pending={pending}>Save the budget</SaveButton>
    </form>
  );
}

function PeopleStep({ orgId, members, canAppoint, currentUserId }: FinanceSetupProps) {
  const { pending, error, run } = useSave();
  const [pick, setPick] = useState("");
  const owners = members.filter((m) => m.role === "OWNER");
  const treasurers = members.filter((m) => m.role === "TREASURER");
  const candidates = members.filter((m) => m.role === "MEMBER" && m.userId !== currentUserId);
  const names = (list: SetupMember[]) => (list.length ? list.map((m) => m.name).join(", ") : "Nobody yet");

  return (
    <div className="space-y-4">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs font-medium">Owners</dt>
          <dd className="text-sm font-medium">{names(owners)}</dd>
          <dd className="text-muted-foreground mt-0.5 text-xs">Everything, money included.</dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs font-medium">Treasurers</dt>
          <dd className="text-sm font-medium">{names(treasurers)}</dd>
          <dd className="text-muted-foreground mt-0.5 text-xs">The money: transactions, budget, approvals, sponsors.</dd>
        </div>
      </dl>
      {canAppoint ? (
        candidates.length > 0 ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pick) return;
              const who = candidates.find((m) => m.userId === pick)?.name ?? "They";
              run(async () => {
                const res = await changeMemberRole(orgId, pick, "TREASURER");
                if (!res.error) toast({ title: `${who} is now a treasurer`, tone: "success" });
                return res.error;
              }, () => setPick(""));
            }}
          >
            <label className="min-w-56 flex-1 space-y-1 text-sm">
              <span className="text-muted-foreground text-xs font-medium">Make a member treasurer</span>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
              >
                <option value="">Choose a member…</option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <SaveButton pending={pending}>Make treasurer</SaveButton>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">
            Everyone else already has a role above member. Change roles in Settings › Members.
          </p>
        )
      ) : (
        <p className="text-muted-foreground text-sm">Owners and admins choose treasurers in Settings › Members.</p>
      )}
      <p className="text-muted-foreground text-xs">
        Members can always ask to be paid back for what they bought; a treasurer or owner approves it, and nobody approves
        their own.
      </p>
      <ErrorLine error={error} />
    </div>
  );
}

function BoardStep({ orgId, board, onSaved }: StepProps) {
  const { pending, error, run } = useSave();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(board.map((w) => w.type)));
  const toggle = (type: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(type)) n.delete(type);
      else n.add(type);
      return n;
    });
  const layout = (): BoardWidget[] => {
    const kept = board.filter((w) => picked.has(w.type));
    const added = FINANCE_WIDGETS.filter((m) => picked.has(m.type) && !kept.some((w) => w.type === m.type)).map((m) => ({
      id: m.type,
      type: m.type,
      w: m.w,
      h: m.h,
    }));
    return [...kept, ...added];
  };
  const groups = [...new Set(FINANCE_WIDGETS.map((w) => w.group))];
  const preview = layout();

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await saveBoardAction(orgId, "finance", layout());
          return res.ok ? null : (res.error ?? "Your dashboard couldn't be saved.");
        }, onSaved);
      }}
    >
      {groups.map((g) => (
        <fieldset key={g} className="space-y-2">
          <legend className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{g}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FINANCE_WIDGETS.filter((w) => w.group === g).map((w) => {
              const WIcon = BOARD_ICONS[w.icon] ?? LayoutGrid;
              const on = picked.has(w.type);
              return (
                <button
                  key={w.type}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(w.type)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    on ? "border-primary bg-primary/5" : "hover:border-foreground/20",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-md",
                      on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {on ? <Check className="size-4" aria-hidden="true" /> : <WIcon className="size-4" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{w.title}</span>
                    <span className="text-muted-foreground block text-xs">{w.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium">Your dashboard ({preview.length} widgets)</p>
        <div className="bg-muted/30 grid grid-cols-4 gap-1.5 rounded-lg border p-2" aria-hidden="true">
          {preview.map((w) => {
            const m = FINANCE_WIDGETS.find((x) => x.type === w.type);
            return (
              <div
                key={w.id}
                className="bg-background text-muted-foreground truncate rounded border px-1.5 py-2 text-[10px]"
                style={{ gridColumn: `span ${Math.min(4, w.w)} / span ${Math.min(4, w.w)}` }}
              >
                {m?.title}
              </div>
            );
          })}
        </div>
      </div>
      <ErrorLine error={error} />
      <SaveButton pending={pending}>Save my dashboard</SaveButton>
    </form>
  );
}
