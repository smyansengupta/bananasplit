"use client";

import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Loader2,
  Sparkles,
  Star,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { askAboutResponses, reviewResponseAction } from "@/app/app/[orgSlug]/forms/actions";
import { EmptyState } from "@/components/empty-state";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { answerText, initialsOf, responsesCsv, type AnswerNames } from "@/lib/forms/csv";
import { takesAnswer, type Question } from "@/lib/forms/questions";
import type { QuestionSummary } from "@/lib/forms/summary";
import { TAG_COLORS, tagVar } from "@/lib/tag-colors";
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

/** A file someone sent, for its card: what it is, how big, where it opens. */
export interface SentFile {
  name: string;
  kind: "pdf" | "image" | "word" | "slides" | "sheet" | "text";
  size: string;
  src: string;
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
const FILE_BADGE: Record<SentFile["kind"], string> = {
  pdf: "PDF",
  image: "IMG",
  word: "DOC",
  slides: "PPT",
  sheet: "XLS",
  text: "TXT",
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));

const isUpload = (q: Question) => q.type === "file" || q.type === "image" || q.type === "signature";
const fileIdOf = (value: unknown) =>
  typeof value === "string" ? (/\/files\/([A-Za-z0-9_-]{1,64})$/.exec(value)?.[1] ?? null) : null;

/** The same person always gets the same avatar colour. */
function avatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return tagVar(TAG_COLORS[h % TAG_COLORS.length]);
}

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const color = avatarColor(name);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        size === "lg" ? "size-11 text-[15px]" : "size-8 text-[12px]",
      )}
      style={{ color, background: `color-mix(in oklab, ${color} 15%, transparent)` }}
    >
      {initialsOf(name)}
    </span>
  );
}

function Stars({ value, of = 5 }: { value: number; of?: number }) {
  return (
    <span className="text-primary text-[12px] tracking-tight" aria-label={`${value} of ${of}`}>
      {"★".repeat(value)}
    </span>
  );
}

/**
 * A form's responses, four ways over the same rows: the Table (the
 * database's columns), Review (one at a time: a decision, stars and
 * private notes), Summary (a chart per question) and Ask Claude, which can
 * hand the people it names to Review. Export CSV saves the lot.
 */
export function FormResponses({
  orgId,
  formId,
  title,
  view,
  hrefOf,
  review,
  fresh,
  only,
  databaseHref,
  questions,
  rows,
  choices,
  members,
  files,
  summary,
}: {
  orgId: string;
  formId: string;
  title: string;
  view: View;
  hrefOf: Record<View, string>;
  review: boolean;
  fresh: number;
  /** Ids from Ask Claude: show just these. */
  only: string[] | null;
  databaseHref: string;
  questions: Question[];
  rows: ResponseItem[];
  choices: Record<string, { id: string; label: string }[]>;
  members: Record<string, string>;
  files: Record<string, SentFile>;
  summary: QuestionSummary[];
}) {
  const names: AnswerNames = { choices, members };
  const answered = questions.filter((q) => takesAnswer(q.type) && q.fieldId);
  const show = (q: Question, value: unknown): React.ReactNode => {
    const text = answerText(q, value, names);
    if (!text) return null;
    if (isUpload(q) || q.type === "link") {
      return (
        <a
          href={text}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {q.type === "link"
            ? text.replace(/^https?:\/\//, "")
            : (files[fileIdOf(value) ?? ""]?.name ?? "Open file")}
        </a>
      );
    }
    return text;
  };

  const views = [
    { value: "table", label: "Table", href: hrefOf.table },
    ...(review
      ? [{ value: "review", label: "Review", count: fresh, href: hrefOf.review }]
      : []),
    { value: "summary", label: "Summary", href: hrefOf.summary },
    { value: "ask", label: "Ask Claude", href: hrefOf.ask },
  ];
  const current: View = !review && view === "review" ? "summary" : view;
  const picked = only ? rows.filter((r) => only.includes(r.id)) : rows;

  function exportCsv() {
    const csv = responsesCsv(questions, rows, names, review);
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Responses"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Responses" value={current} options={views} />
        <span className="flex-1" />
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="size-4" aria-hidden="true" />
          Export CSV
        </Button>
        <Button variant="outline" asChild>
          <Link href={databaseHref}>
            <Database className="size-4" aria-hidden="true" />
            Open database
          </Link>
        </Button>
      </div>

      {only && (current === "table" || current === "review") && (
        <div className="bg-muted/50 rounded-field flex flex-wrap items-center gap-3 px-3 py-2 text-[13.5px]">
          <span className="flex-1">
            Showing the {picked.length} {picked.length === 1 ? "response" : "responses"} Claude
            named.
          </span>
          <Link href={hrefOf[current]} className="font-medium underline underline-offset-2">
            Show all
          </Link>
        </div>
      )}

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
              {picked.map((r) => (
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
        <Review
          key={`${rows.length}:${only?.join(",") ?? ""}`}
          orgId={orgId}
          rows={picked}
          answered={answered}
          names={names}
          files={files}
          show={show}
          pickedByClaude={Boolean(only)}
        />
      ) : current === "summary" ? (
        // The plan ends Summary with the question box, so a pattern in the
        // charts can be asked about without leaving them.
        <div className="space-y-6">
          <Summary summary={summary} total={rows.length} />
          <Ask orgId={orgId} formId={formId} reviewHref={review ? hrefOf.review : hrefOf.table} />
        </div>
      ) : (
        <Ask orgId={orgId} formId={formId} reviewHref={review ? hrefOf.review : hrefOf.table} />
      )}
    </div>
  );
}

/**
 * Under a name in the Review list: their first couple of short answers
 * (a team, a year), so the list reads before you open anyone.
 */
function secondLine(r: ResponseItem, answered: Question[], names: AnswerNames): string {
  const bits: string[] = [];
  for (const q of answered) {
    if (bits.length >= 2) break;
    if (!["choice", "dropdown", "short", "number"].includes(q.type)) continue;
    const text = answerText(q, r.values[q.fieldId!], names);
    if (!text || text === r.who || text.length > 40) continue;
    bits.push(text);
  }
  return bits.length ? bits.join(", ") : day(r.createdAt);
}

function Review({
  orgId,
  rows,
  answered,
  names,
  files,
  show,
  pickedByClaude,
}: {
  orgId: string;
  rows: ResponseItem[];
  answered: Question[];
  names: AnswerNames;
  files: Record<string, SentFile>;
  show: (q: Question, value: unknown) => React.ReactNode;
  pickedByClaude: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"todo" | "done">(
    !pickedByClaude && rows.some((r) => r.status === "NEW") ? "todo" : "done",
  );
  // Decisions show at once; a refresh with new rows re-keys this from above.
  const [local, setLocal] = useState(rows);
  const todo = local.filter((r) => r.status === "NEW");
  const done = local.filter((r) => r.status !== "NEW");
  // Claude's picks are shown together, whatever their status.
  const list = pickedByClaude ? local : filter === "todo" ? todo : done;
  const [selectedId, setSelectedId] = useState<string | null>(list[0]?.id ?? null);
  const at = Math.max(
    0,
    list.findIndex((r) => r.id === selectedId),
  );
  const current = list[at] ?? local.find((r) => r.id === selectedId) ?? null;
  const [peek, setPeek] = useState<SentFile | null>(null);
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
    if (filter === "todo" && !pickedByClaude && next) setSelectedId(next.id);
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

  const textAnswers = answered.filter((q) => !isUpload(q));
  const sent = current
    ? answered
        .filter(isUpload)
        .map((q) => {
          const id = fileIdOf(current.values[q.fieldId!]);
          return id && files[id] ? { id, file: files[id]! } : null;
        })
        .filter((x): x is { id: string; file: SentFile } => x !== null)
    : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="bg-card edge rounded-card space-y-2 p-2">
        {!pickedByClaude && (
          <Segmented
            label="Show"
            value={filter}
            onSelect={(v) => {
              const next = v === "todo" ? "todo" : "done";
              setFilter(next);
              setSelectedId((next === "todo" ? todo : done)[0]?.id ?? null);
            }}
            options={[
              { value: "todo", label: "To review", count: todo.length },
              { value: "done", label: "Done", count: done.length },
            ]}
            className="w-full"
          />
        )}
        <ul className="max-h-[64vh] space-y-0.5 overflow-y-auto">
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                aria-current={r.id === current?.id ? "true" : undefined}
                className={cn(
                  "rounded-field flex w-full items-center gap-2.5 px-2.5 py-2 text-left",
                  r.id === current?.id ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <Avatar name={r.who} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium break-words">{r.who}</span>
                  <span className="text-muted-foreground block text-[12px] break-words">
                    {secondLine(r, answered, names)}
                  </span>
                </span>
                {r.status === "NEW" ? (
                  r.rating ? (
                    <Stars value={r.rating} />
                  ) : (
                    <Badge variant="accent">New</Badge>
                  )
                ) : r.rating ? (
                  <Stars value={r.rating} />
                ) : (
                  <Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                )}
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="text-muted-foreground px-2.5 py-2 text-sm">
              {filter === "todo" ? "All reviewed." : "Nothing decided yet."}
            </li>
          )}
        </ul>
      </aside>

      {current ? (
        <section className="bg-card edge rounded-card space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar name={current.who} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="display-title text-[22px] leading-snug break-words">{current.who}</h2>
              <p className="text-muted-foreground mt-0.5 text-[13px]">
                {current.email
                  ? `${current.email}, sent ${day(current.createdAt)}`
                  : `Sent ${day(current.createdAt)}`}
              </p>
            </div>
            {current.status !== "NEW" && (
              <Badge variant={STATUS_TONE[current.status]}>{STATUS_LABEL[current.status]}</Badge>
            )}
            <span className="text-muted-foreground text-[13px] tabular-nums">
              {list.some((r) => r.id === current.id) ? `${at + 1} of ${list.length}` : ""}
            </span>
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
            {textAnswers.map((q) => (
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

          {sent.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Files">
              {sent.map(({ id, file }) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => setPeek(file)}
                    className="bg-muted/40 hover:bg-muted rounded-field flex w-full items-center gap-3 border p-2.5 text-left transition-colors"
                  >
                    {file.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={file.src}
                        alt=""
                        className="size-11 shrink-0 rounded-[8px] border object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="grid size-11 shrink-0 place-items-center rounded-[8px] text-[11px] font-bold"
                        style={{
                          color: tagVar("rust"),
                          background: `color-mix(in oklab, ${tagVar("rust")} 14%, transparent)`,
                        }}
                      >
                        {FILE_BADGE[file.kind]}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium break-words">
                        {file.name}
                      </span>
                      <span className="text-muted-foreground block text-[12px]">{file.size}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-1.5 border-t pt-4">
            <label htmlFor={`notes-${current.id}`} className="text-[13px] font-semibold">
              Your notes (owners and admins only)
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

      <Sheet open={peek !== null} onOpenChange={(o) => !o && setPeek(null)}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="pr-8 break-words">{peek?.name}</SheetTitle>
          </SheetHeader>
          {peek && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
              {peek.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={peek.src}
                  alt={peek.name}
                  className="max-h-[75vh] w-full rounded-[10px] object-contain"
                />
              ) : peek.kind === "pdf" ? (
                <iframe
                  src={peek.src}
                  title={peek.name}
                  className="min-h-[70vh] w-full flex-1 rounded-[10px] border"
                />
              ) : (
                <p className="text-muted-foreground text-[14px]">
                  This kind of file doesn&apos;t show here. Download it to open it.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <a href={`${peek.src}?download=1`}>
                    <Download className="size-4" aria-hidden="true" />
                    Download
                  </a>
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Summary({ summary, total }: { summary: QuestionSummary[]; total: number }) {
  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-semibold tabular-nums">
        {total} {total === 1 ? "response" : "responses"}
      </h2>
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
                        {pct}% <span className="text-[11.5px]">({b.count})</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function Ask({ orgId, formId, reviewHref }: { orgId: string; formId: string; reviewHref: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; ids: string[] } | null>(null);
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
      else setAnswer(r.answer ? { text: r.answer, ids: r.responseIds ?? [] } : null);
    });
  }

  return (
    <section className="bg-card edge rounded-card max-w-2xl space-y-4 p-5">
      <h2 className="text-[15px] font-semibold">Ask Claude about these responses</h2>
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
        <div className="bg-muted/50 rounded-field space-y-3 p-4">
          <p className="text-[14.5px] leading-relaxed whitespace-pre-line">{answer.text}</p>
          {answer.ids.length > 0 && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`${reviewHref}&ids=${answer.ids.map(encodeURIComponent).join(",")}`}>
                Open {answer.ids.length === 1 ? "this one" : `these ${answer.ids.length}`} in Review
              </Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
