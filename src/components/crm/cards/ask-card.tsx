"use client";

import { ArrowRight, Loader2, Sparkles } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  acceptAllAction,
  askAction,
  pasteAction,
  rejectAllAction,
  tellAction,
  undoSuggestionAction,
  type PastedItem,
} from "@/app/app/[orgSlug]/crm/ai-actions";
import { AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { CrmCard } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ASK_DRAFT_KEY, askIntent } from "@/lib/crm/ask-intent";
import type { TargetKind } from "@/lib/crm/suggestions";
import { cn } from "@/lib/utils";

/**
 * Ask (?open=ask; the Ask design): one big box, "Ask or tell the CRM",
 * and the answer under it in the same card. A question gets an answer from
 * what the member can see, with the records in a small table and "Open
 * these people" when People can show them as a list. A change shows
 * exactly what will change, Apply or Cancel, and Undo after. A pasted chat
 * gives the people and next steps in it, each with a checkbox, and "Add N
 * people". All of it runs on the organization's own AI key, and changes go
 * through the review queue's own apply and undo.
 */

type Result =
  | {
      kind: "answer";
      answer: string;
      rows: { n: string; kind: TargetKind; id: string; name: string; sub: string | null }[];
      cites: string[];
      readBy: string;
      peopleQuery: Record<string, string> | null;
    }
  | {
      kind: "change";
      target: { kind: TargetKind; id: string; name: string; sub: string | null };
      rows: { label: string; before: string | null; after: string }[];
      ids: string[];
      notes: string[];
      state: "pending" | "applied" | "undone";
    }
  | {
      kind: "paste";
      lines: string[];
      matched: { id: string; name: string } | null;
      items: PastedItem[];
      picked: Record<string, boolean>;
      state: "open" | "added" | "undone";
      added: string[];
    };

const EXAMPLES = [
  { label: "A question", text: "Who haven't we talked to in 60 days?" },
  { label: "A change", text: "Move the renewal to Committed and give it to me" },
  {
    label: "A pasted chat",
    text: "Rosa: Ben and I would love to help with the build day.\nRosa: I'm rosa@example.com\nYou: Great, I'll send the details by Friday.",
  },
];

const KIND_WORD: Record<TargetKind, string> = {
  person: "Person",
  company: "Company",
  deal: "Deal",
};
const ITEM_WORD: Record<PastedItem["kind"], string> = {
  person: "Person",
  timeline: "Timeline",
  step: "Next step",
};

function namesOf(items: readonly PastedItem[]): string {
  const names = items.map((i) => i.title.split(" ")[0]!);
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function AskCard({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const { setOpen, hrefFor } = useCrmOpen();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  // Suggestions queued for a preview nobody decided on: thrown away when the card closes.
  const pending = useRef<string[]>([]);

  useEffect(() => {
    let draft: string | null = null;
    try {
      draft = sessionStorage.getItem(ASK_DRAFT_KEY);
      sessionStorage.removeItem(ASK_DRAFT_KEY);
    } catch {
      draft = null;
    }
    if (draft?.trim()) {
      const text = draft;
      queueMicrotask(() => {
        setText(text);
        void go(text);
      });
    } else {
      box.current?.focus();
    }
    return () => {
      if (pending.current.length) void rejectAllAction(orgId, pending.current).catch(() => null);
    };
    // Runs once, when the card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function go(raw: string) {
    const q = raw.trim();
    if (!q || busy) return;
    if (pending.current.length) {
      void rejectAllAction(orgId, pending.current).catch(() => null);
      pending.current = [];
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const intent = askIntent(q);
    try {
      if (intent === "paste") {
        const r = await pasteAction(orgId, q);
        if (!r.ok) return setError(r.error);
        pending.current = r.items.map((i) => i.id);
        setResult({
          kind: "paste",
          lines: q
            .split(/\n+/)
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 6),
          matched: r.matched,
          items: r.items,
          picked: Object.fromEntries(r.items.map((i) => [i.id, true])),
          state: "open",
          added: [],
        });
      } else if (intent === "change") {
        const r = await tellAction(orgId, q);
        if (!r.ok) return setError(r.error);
        pending.current = r.ids;
        setResult({
          kind: "change",
          target: r.target,
          rows: r.rows,
          ids: r.ids,
          notes: r.notes,
          state: "pending",
        });
        requestAnimationFrame(() => applyRef.current?.focus());
      } else {
        const r = await askAction(orgId, q.slice(0, 500));
        if (!r.ok) return setError(r.error);
        setResult({
          kind: "answer",
          answer: r.answer,
          rows: [
            ...r.results.filter((x) => r.cites.includes(x.n)),
            ...r.results.filter((x) => !r.cites.includes(x.n)),
          ],
          cites: r.cites,
          readBy: r.readBy,
          peopleQuery: r.peopleQuery,
        });
      }
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const apply = async () => {
    if (result?.kind !== "change") return;
    setBusy(true);
    const r = await acceptAllAction(orgId, result.ids).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "That didn't go through. Try again.");
    if (r.accepted.length === 0) return setError(r.failed[0]?.error ?? "That couldn't be applied.");
    if (r.failed.length) setError(`Not all of it went through: ${r.failed[0]!.error}`);
    pending.current = [];
    setResult({ ...result, state: "applied" });
    router.refresh();
  };

  const cancel = async () => {
    if (result?.kind !== "change") return;
    const ids = result.ids;
    pending.current = [];
    setResult(null);
    await rejectAllAction(orgId, ids).catch(() => null);
    box.current?.focus();
  };

  const undoAll = async (ids: readonly string[]) => {
    setBusy(true);
    for (const id of ids) await undoSuggestionAction(orgId, id).catch(() => null);
    // Undone suggestions wait in the queue again: these were only ever this card's.
    await rejectAllAction(orgId, [...ids]).catch(() => null);
    setBusy(false);
    router.refresh();
  };

  const add = async () => {
    if (result?.kind !== "paste") return;
    const yes = result.items.filter((i) => result.picked[i.id]).map((i) => i.id);
    const no = result.items.filter((i) => !result.picked[i.id]).map((i) => i.id);
    setBusy(true);
    const r = await acceptAllAction(orgId, yes).catch(() => null);
    if (no.length) await rejectAllAction(orgId, no).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "That didn't go through. Try again.");
    if (r.failed.length) setError(r.failed[0]!.error);
    pending.current = [];
    setResult({ ...result, state: "added", added: r.accepted });
    router.refresh();
  };

  return (
    <CrmCard
      title="Ask or tell the CRM"
      subtitle="From what you can see, on your organization's own AI key"
      avatar={
        <span
          aria-hidden="true"
          className="grid size-[52px] shrink-0 place-items-center rounded-full"
          style={{ background: "color-mix(in oklab, var(--attention) 22%, var(--card))" }}
        >
          <Sparkles className="size-5" />
        </span>
      }
      description="Ask a question, say a change, or paste a chat"
    >
      <div className="flex flex-col gap-5">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            void go(text);
          }}
        >
          <Textarea
            ref={box}
            value={text}
            rows={Math.min(8, Math.max(1, text.split("\n").length))}
            maxLength={20_000}
            aria-label="Ask or tell the CRM"
            placeholder="Ask or tell the CRM"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void go(text);
              }
            }}
            className="bg-muted min-h-14 resize-none rounded-[28px] border-0 py-4 ps-5 pe-14 text-lg leading-snug"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Ask"
            title="Ask (Enter)"
            disabled={busy || !text.trim()}
            className="absolute end-2 bottom-2 rounded-full"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight className="size-4" aria-hidden="true" />
            )}
          </Button>
        </form>

        {!result && !busy && !error && !text.trim() && (
          <div className="flex flex-wrap items-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  setText(ex.text);
                  box.current?.focus();
                }}
                className="border-input hover:bg-muted text-muted-foreground hover:text-foreground h-9 rounded-full border px-3.5 text-sm font-medium"
              >
                {ex.label}
              </button>
            ))}
            <span className="text-muted-foreground text-xs">Shift+Enter for a new line</span>
          </div>
        )}

        {busy && !result && <p className="text-muted-foreground text-sm">Reading it…</p>}
        {error && (
          <p role="alert" className="text-tint-danger-foreground text-sm">
            {error}
          </p>
        )}

        {result?.kind === "answer" && (
          <div className="flex flex-col gap-4" aria-live="polite">
            <p className="text-[17px] leading-relaxed">{result.answer}</p>
            {result.rows.length > 0 && (
              <div className="ring-foreground/8 overflow-hidden rounded-[20px] ring-1">
                <div className="bg-muted text-muted-foreground grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 px-4 py-2 text-xs font-semibold">
                  <span>Name</span>
                  <span>Details</span>
                </div>
                {result.rows.slice(0, 12).map((r) => (
                  <a
                    key={r.n}
                    href={hrefFor({ kind: r.kind, id: r.id })}
                    className="border-border/60 hover:bg-muted/60 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 border-t px-4 py-2.5 text-sm"
                  >
                    <b className="truncate">{r.name}</b>
                    <span className="text-muted-foreground truncate">
                      {r.sub ?? KIND_WORD[r.kind]}
                    </span>
                  </a>
                ))}
              </div>
            )}
            {(() => {
              const people = result.rows.filter((r) => r.kind === "person");
              if (people.length >= 2 && result.peopleQuery) {
                const why = "They also show as a list in People";
                return (
                  <span className="flex flex-nowrap items-center gap-2.5">
                    <AmbientButton
                      action={{
                        key: "open",
                        label: `Open these ${people.length} people`,
                        tone: "solid",
                        reason: why,
                        href: `/app/${orgSlug}/crm/people?${new URLSearchParams(result.peopleQuery).toString()}`,
                      }}
                    />
                    <AmbientWhy>{why}</AmbientWhy>
                  </span>
                );
              }
              if (result.rows.length === 1) {
                const r = result.rows[0]!;
                const why = "The one it found";
                return (
                  <span className="flex flex-nowrap items-center gap-2.5">
                    <AmbientButton
                      action={{
                        key: "open",
                        label: `Open ${r.name}`,
                        tone: "solid",
                        reason: why,
                        href: hrefFor({ kind: r.kind, id: r.id }),
                      }}
                    />
                    <AmbientWhy>{why}</AmbientWhy>
                  </span>
                );
              }
              return null;
            })()}
            <p className="text-muted-foreground text-xs">
              Answered by {result.readBy} from what you can see in the CRM.
            </p>
          </div>
        )}

        {result?.kind === "change" && result.state === "pending" && (
          <div className="flex flex-col gap-3.5" aria-live="polite">
            <b className="text-[15px]">This will happen</b>
            <div className="ring-foreground/8 flex flex-col rounded-[20px] ring-1">
              <div className="flex items-baseline gap-3 px-4 py-3 text-[15px]">
                <span className="text-muted-foreground w-24 shrink-0 text-sm">
                  {KIND_WORD[result.target.kind]}
                </span>
                <b className="min-w-0 truncate">
                  {result.target.name}
                  {result.target.sub ? `, ${result.target.sub}` : ""}
                </b>
              </div>
              {result.rows.map((r) => (
                <div
                  key={r.label}
                  className="border-border/60 flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-3 text-[15px]"
                >
                  <span className="text-muted-foreground w-24 shrink-0 text-sm">{r.label}</span>
                  <span
                    className={cn(
                      r.before
                        ? "text-muted-foreground line-through decoration-1"
                        : "text-muted-foreground",
                    )}
                  >
                    {r.before ?? "Not set"}
                  </span>
                  <ArrowRight className="text-muted-foreground size-4" aria-hidden="true" />
                  <b>{r.after}</b>
                </div>
              ))}
            </div>
            {result.notes.length > 0 && (
              <p className="text-muted-foreground text-sm">{result.notes.join(" ")}</p>
            )}
            <div className="flex items-center gap-2">
              <Button ref={applyRef} disabled={busy} onClick={apply}>
                Apply
                <kbd className="bg-background/20 rounded px-1.5 text-[11px] font-medium">Enter</kbd>
              </Button>
              <Button variant="ghost" disabled={busy} onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {result?.kind === "change" && result.state !== "pending" && (
          <div
            className="bg-muted flex flex-wrap items-center gap-3 rounded-[20px] px-4 py-3 text-[15px]"
            aria-live="polite"
          >
            <span className="min-w-0 flex-1">
              {result.state === "applied"
                ? `Done. ${result.target.name}: ${result.rows.map((r) => `${r.label.toLowerCase()} ${r.after}`).join(", ")}.`
                : `Put back. ${result.target.name} is as it was.`}
            </span>
            {result.state === "applied" && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  await undoAll(result.ids);
                  setResult({ ...result, state: "undone" });
                }}
              >
                Undo
              </Button>
            )}
            {result.state === "applied" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen({ kind: result.target.kind, id: result.target.id })}
              >
                Open it
              </Button>
            )}
          </div>
        )}

        {result?.kind === "paste" && (
          <div className="flex flex-col gap-3.5" aria-live="polite">
            <div className="bg-muted flex flex-col gap-1 rounded-[20px] px-4 py-3 text-sm">
              {result.lines.map((l, i) => (
                <span key={i} className="truncate">
                  {l}
                </span>
              ))}
            </div>
            {result.state === "open" ? (
              <>
                <b className="text-[15px]">Found in it</b>
                {result.matched && (
                  <p className="text-muted-foreground -mt-2 text-sm">
                    It&apos;s with {result.matched.name}, already in People.
                  </p>
                )}
                <div className="ring-foreground/8 flex flex-col rounded-[20px] ring-1">
                  {result.items.map((it, i) => (
                    <label
                      key={it.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 px-4 py-3",
                        i > 0 && "border-border/60 border-t",
                      )}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={Boolean(result.picked[it.id])}
                        onCheckedChange={(v) =>
                          setResult({
                            ...result,
                            picked: { ...result.picked, [it.id]: Boolean(v) },
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <b className="block text-[15px]">{it.title}</b>
                        {it.text && (
                          <span className="text-muted-foreground text-sm">{it.text}</span>
                        )}
                      </span>
                      <span className="bg-muted shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                        {ITEM_WORD[it.kind]}
                      </span>
                    </label>
                  ))}
                </div>
                {(() => {
                  const chosen = result.items.filter((i) => result.picked[i.id]);
                  const people = chosen.filter((i) => i.kind === "person").length;
                  const steps = chosen.some(
                    (i) =>
                      i.kind === "step" || (i.kind === "person" && i.text.includes("Next step:")),
                  );
                  const label =
                    people > 0
                      ? `Add ${people} ${people === 1 ? "person" : "people"}`
                      : chosen.length > 0
                        ? `Add ${chosen.length === 1 ? "it" : `these ${chosen.length}`}`
                        : "Add nothing";
                  return (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button disabled={busy || chosen.length === 0} onClick={add}>
                        {label}
                      </Button>
                      <AmbientWhy>
                        {steps
                          ? "The next step goes to your Today"
                          : "No next step, so they may go quiet"}
                      </AmbientWhy>
                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="bg-muted flex flex-wrap items-center gap-3 rounded-[20px] px-4 py-3 text-[15px]">
                <span className="min-w-0 flex-1">
                  {result.state === "undone"
                    ? "Put back. Nothing from the chat was kept."
                    : (() => {
                        const added = result.items.filter((i) => result.added.includes(i.id));
                        const people = added.filter((i) => i.kind === "person");
                        const step = added.some(
                          (i) => i.kind === "step" || i.text.includes("Next step:"),
                        );
                        return `${people.length ? `Added ${namesOf(people)} to People.` : "Kept it."}${step ? " The next step is in your Today." : ""}`;
                      })()}
                </span>
                {result.state === "added" && result.added.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      await undoAll(result.added);
                      setResult({ ...result, state: "undone" });
                    }}
                  >
                    Undo
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </CrmCard>
  );
}
