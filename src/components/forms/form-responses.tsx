"use client";

import { ChevronLeft, ChevronRight, Database, Loader2, Sparkles, Star } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { askAboutResponses, reviewResponseAction } from "@/app/app/[orgSlug]/forms/actions";
import { EmptyState } from "@/components/empty-state";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { takesAnswer, type Question } from "@/lib/forms/questions";
import type { QuestionSummary } from "@/lib/forms/summary";
import { cn } from "@/lib/utils";

type View = "table" | "review" | "summary" | "ask";
type Status = "NEW" | "ACCEPTED" | "WAITLISTED" | "DECLINED";

export interface ResponseItem {
  id: string;
  who: string;
  email: string | null;
  status: Status;
  rating: number | null;
  notes: string | null;
  createdAt: string;
  values: Record<string, unknown>;
}

const STATUS_LABEL: Record<Status, string> = {
  NEW: "New",
  ACCEPTED: "Accepted",
  WAITLISTED: "Waitlisted",
  DECLINED: "Declined",
};
const STATUS_TONE: Record<Status, "accent" | "success" | "secondary" | "outline"> = {
  NEW: "accent",
  ACCEPTED: "success",
  WAITLISTED: "outline",
  DECLINED: "secondary",
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

/**
 * A form's responses, four ways over the same rows: the Table (the
 * database's columns), Review (one at a time: a decision, stars and
 * private notes), Summary (a chart per question) and Ask Claude.
 */
export function FormResponses({
  orgId,
  formId,
  view,
  hrefOf,
  review,
  fresh,
  databaseHref,
  questions,
  rows,
  choices,
  members,
  summary,
}: {
  orgId: string;
  formId: string;
  view: View;
  hrefOf: Record<View, string>;
  review: boolean;
  fresh: number;
  databaseHref: string;
  questions: Question[];
  rows: ResponseItem[];
  choices: Record<string, { id: string; label: string }[]>;
  members: Record<string, string>;
  summary: QuestionSummary[];
}) {
  const answered = questions.filter((q) => takesAnswer(q.type) && q.fieldId);
  const show = (q: Question, value: unknown): React.ReactNode => {
    if (value === undefined || value === null || value === "") return null;
    const label = (id: string) =>
      choices[q.fieldId!]?.find((c) => c.id === id)?.label ??
      q.options?.find((o) => o.id === id)?.label ??
      id;
    if (q.type === "yesno") return value === true ? "Yes" : "No";
    if (Array.isArray(value)) return value.map((v) => label(String(v))).join(", ");
    if (q.type === "choice" || q.type === "dropdown") return label(String(value));
    if (q.type === "member") return members[String(value)] ?? "Member";
    if (q.type === "file" || q.type === "image" || q.type === "link") {
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {q.type === "link" ? String(value).replace(/^https?:\/\//, "") : "Open file"}
        </a>
      );
    }
    if (q.type === "rating") return `${value} of ${q.max ?? 5}`;
    return String(value);
  };

  const views = [
    { value: "table", label: "Table", href: hrefOf.table },
    ...(review
      ? [{ value: "review", label: fresh > 0 ? `Review ${fresh}` : "Review", href: hrefOf.review }]
      : []),
    { value: "summary", label: "Summary", href: hrefOf.summary },
    { value: "ask", label: "Ask Claude", href: hrefOf.ask },
  ];
  const current: View = !review && view === "review" ? "summary" : view;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Responses" value={current} options={views} />
        <span className="flex-1" />
        <Button variant="outline" asChild>
          <Link href={databaseHref}>
            <Database className="size-4" aria-hidden="true" />
            Open database
          </Link>
        </Button>
      </div>

      {rows.length === 0 && current !== "ask" ? (
        <EmptyState icon={Database} title="No responses yet" />
      ) : current === "table" ? (
        <div className="bg-card edge rounded-card overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[13.5px]">
            <thead className="bg-muted/50 text-muted-foreground text-left text-[12px]">
              <tr>
                <th className="px-3 py-2 font-semibold">Response</th>
                {review && <th className="px-3 py-2 font-semibold">Status</th>}
                {answered.map((q) => (
                  <th key={q.id} className="max-w-[16rem] px-3 py-2 align-bottom font-semibold">
                    {q.title || "Question"}
                  </th>
                ))}
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Sent</th>
              </tr>
            </thead>
            <tbody className="divide-border/70 divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2.5 font-medium">{r.who}</td>
                  {review && (
                    <td className="px-3 py-2.5">
                      <Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </td>
                  )}
                  {answered.map((q) => (
                    <td
                      key={q.id}
                      className="max-w-[16rem] px-3 py-2.5 break-words whitespace-pre-line"
                    >
                      {show(q, r.values[q.fieldId!]) ?? (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  ))}
                  <td className="text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                    {when(r.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : current === "review" ? (
        <Review key={rows.length} orgId={orgId} rows={rows} answered={answered} show={show} />
      ) : current === "summary" ? (
        <Summary summary={summary} total={rows.length} />
      ) : (
        <Ask orgId={orgId} formId={formId} />
      )}
    </div>
  );
}

function Review({
  orgId,
  rows,
  answered,
  show,
}: {
  orgId: string;
  rows: ResponseItem[];
  answered: Question[];
  show: (q: Question, value: unknown) => React.ReactNode;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"new" | "all">(
    rows.some((r) => r.status === "NEW") ? "new" : "all",
  );
  // Decisions show at once; a refresh with new rows re-keys this from above.
  const [local, setLocal] = useState(rows);
  const list = local.filter((r) => filter === "all" || r.status === "NEW");
  const [selectedId, setSelectedId] = useState<string | null>(list[0]?.id ?? null);
  const at = Math.max(
    0,
    list.findIndex((r) => r.id === selectedId),
  );
  const current = list[at] ?? local.find((r) => r.id === selectedId) ?? null;
  const [, start] = useTransition();
  const notesSave = useSaveOnChange(async (text: string) => {
    if (!current) return;
    const r = await reviewResponseAction(orgId, current.id, { notes: text || null });
    if (r.error) return r.error;
  });

  function patch(id: string, p: Partial<ResponseItem>) {
    setLocal((l) => l.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  function decide(status: Status) {
    if (!current) return;
    const before = current.status;
    const id = current.id;
    patch(id, { status });
    // Move on to the next one still to review.
    const next = list[at + 1] ?? list[at - 1];
    if (filter === "new" && next) setSelectedId(next.id);
    start(async () => {
      const r = await reviewResponseAction(orgId, id, { status });
      if (r.error) {
        patch(id, { status: before });
        toast({ title: r.error, tone: "error" });
        return;
      }
      toast({
        title: STATUS_LABEL[status],
        action: {
          label: "Undo",
          run: async () => {
            const back = await reviewResponseAction(orgId, id, { status: before });
            if (back.error) return back.error;
            patch(id, { status: before });
            setSelectedId(id);
            router.refresh();
          },
        },
      });
      router.refresh();
    });
  }

  function rate(rating: number) {
    if (!current) return;
    const id = current.id;
    const value = current.rating === rating ? null : rating;
    patch(id, { rating: value });
    start(async () => {
      const r = await reviewResponseAction(orgId, id, { rating: value });
      if (r.error) toast({ title: r.error, tone: "error" });
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        const n = list[at + 1];
        if (n) setSelectedId(n.id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        const p = list[at - 1];
        if (p) setSelectedId(p.id);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [list, at]);

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="bg-card edge rounded-card space-y-2 p-2">
        <Segmented
          label="Show"
          value={filter}
          onSelect={(v) => setFilter(v === "new" ? "new" : "all")}
          options={[
            { value: "new", label: `To review ${local.filter((r) => r.status === "NEW").length}` },
            { value: "all", label: `All ${local.length}` },
          ]}
          className="w-full"
        />
        <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                aria-current={r.id === current?.id ? "true" : undefined}
                className={cn(
                  "rounded-field flex w-full items-center gap-2 px-2.5 py-2 text-left",
                  r.id === current?.id ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium break-words">{r.who}</span>
                  <span className="text-muted-foreground block text-[12px]">
                    {when(r.createdAt)}
                  </span>
                </span>
                {r.rating ? (
                  <span className="text-muted-foreground text-[12px] tabular-nums">
                    {r.rating}/5
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="text-muted-foreground px-2.5 py-2 text-sm">All reviewed.</li>
          )}
        </ul>
      </aside>

      {current ? (
        <section className="bg-card edge rounded-card space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="display-title text-[22px] leading-snug break-words">{current.who}</h2>
              <p className="text-muted-foreground mt-1 text-[13px]">
                {[current.email, when(current.createdAt)].filter(Boolean).join(", ")}
              </p>
            </div>
            <Badge variant={STATUS_TONE[current.status]}>{STATUS_LABEL[current.status]}</Badge>
            <div className="flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous response"
                disabled={at <= 0}
                onClick={() => list[at - 1] && setSelectedId(list[at - 1]!.id)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next response"
                disabled={at >= list.length - 1}
                onClick={() => list[at + 1] && setSelectedId(list[at + 1]!.id)}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <dl className="space-y-4">
            {answered.map((q) => (
              <div key={q.id} className="space-y-1">
                <dt className="text-muted-foreground text-[12.5px] font-semibold">
                  {q.title || "Question"}
                </dt>
                <dd className="text-[14.5px] break-words whitespace-pre-line">
                  {show(q, current.values[q.fieldId!]) ?? (
                    <span className="text-muted-foreground">No answer</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-1.5 border-t pt-4">
            <label htmlFor={`notes-${current.id}`} className="text-[13px] font-semibold">
              Notes, officers only
            </label>
            <Textarea
              key={current.id}
              id={`notes-${current.id}`}
              rows={3}
              defaultValue={current.notes ?? ""}
              maxLength={4000}
              onBlur={(e) => {
                patch(current.id, { notes: e.target.value || null });
                void notesSave.save(e.target.value);
              }}
            />
            <SavedMark status={notesSave.status} error={notesSave.error} />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <div className="flex" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={current.rating === n}
                  aria-label={`${n} of 5`}
                  onClick={() => rate(n)}
                  className="rounded-full p-1"
                >
                  <Star
                    className={cn(
                      "size-5",
                      (current.rating ?? 0) >= n
                        ? "fill-primary text-primary"
                        : "text-muted-foreground/50",
                    )}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <Button variant="outline" onClick={() => decide("WAITLISTED")}>
              Waitlist
            </Button>
            <Button variant="outline" onClick={() => decide("DECLINED")}>
              Decline
            </Button>
            <Button onClick={() => decide("ACCEPTED")}>Accept</Button>
          </div>
        </section>
      ) : (
        <div />
      )}
    </div>
  );
}

function Summary({ summary, total }: { summary: QuestionSummary[]; total: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {summary.map((s) => (
        <section key={s.question.id} className="bg-card edge rounded-card space-y-3 p-5">
          <div>
            <h3 className="text-[14.5px] font-semibold break-words">
              {s.question.title || "Question"}
            </h3>
            <p className="text-muted-foreground text-[12.5px] tabular-nums">
              {s.answered} of {total} answered
              {s.kind === "scale" && s.average !== null ? `, average ${s.average}` : ""}
            </p>
          </div>
          {s.kind === "text" ? (
            <ul className="space-y-2">
              {s.samples.map((t, i) => (
                <li
                  key={i}
                  className="bg-muted/50 rounded-field px-3 py-2 text-[13.5px] break-words whitespace-pre-line"
                >
                  {t}
                </li>
              ))}
              {s.samples.length === 0 && (
                <li className="text-muted-foreground text-sm">No answers yet.</li>
              )}
            </ul>
          ) : (
            <ul className="space-y-1.5">
              {s.bars.map((b) => {
                const pct = s.answered ? Math.round((b.count / s.answered) * 100) : 0;
                return (
                  <li
                    key={b.id}
                    className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px]"
                  >
                    <span className="bg-muted relative block h-7 overflow-hidden rounded-[7px]">
                      <span
                        className="absolute inset-y-0 left-0 bg-(--chart-1)"
                        style={{ width: `${pct}%`, opacity: 0.35 }}
                      />
                      <span className="relative flex h-full items-center px-2.5 break-words">
                        {b.label}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-right tabular-nums">
                      {b.count} <span className="text-[11.5px]">({pct}%)</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Ask({ orgId, formId }: { orgId: string; formId: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [connect, setConnect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const orgSlug = typeof window !== "undefined" ? window.location.pathname.split("/")[2] : "";

  function ask() {
    if (!question.trim()) return;
    setError(null);
    start(async () => {
      const r = await askAboutResponses(orgId, formId, question);
      if (r.connect) {
        setConnect(true);
        return;
      }
      if (r.error) setError(r.error);
      else setAnswer(r.answer ?? null);
    });
  }

  return (
    <section className="bg-card edge rounded-card max-w-2xl space-y-4 p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Who are the strongest applicants who can do Thursdays?"
          aria-label="Ask about these responses"
          maxLength={500}
          className="border-input bg-background h-10 min-w-0 flex-1 rounded-[10px] border px-3 text-[14px]"
        />
        <Button type="submit" disabled={pending || !question.trim()}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4" aria-hidden="true" />
          )}
          Ask
        </Button>
      </form>
      {connect && (
        <div className="bg-muted/50 rounded-field flex flex-wrap items-center gap-3 p-3 text-[14px]">
          <span className="flex-1">Connect Claude or another AI model to ask about responses.</span>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/app/${orgSlug}/integrations`}>Integrations</Link>
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-tint-danger-foreground text-[14px]">
          {error}
        </p>
      )}
      {answer && (
        <p className="bg-muted/50 rounded-field p-4 text-[14.5px] leading-relaxed whitespace-pre-line">
          {answer}
        </p>
      )}
    </section>
  );
}
