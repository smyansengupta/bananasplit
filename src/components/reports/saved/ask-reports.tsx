"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { askReportsAction } from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { Sparkles } from "@/components/icons";

interface Turn {
  question: string;
  answer: string;
}

/**
 * Insights' ask box: a question, Claude's answer from the numbers, and
 * follow-ups that build on what was asked before. On Reports home it reads
 * every report; on a report, only that one.
 */
export function AskReports({ orgId, reportId }: { orgId: string; reportId?: string }) {
  const sp = useSearchParams();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const range = {
    ...(sp.get("range") ? { range: sp.get("range")! } : {}),
    ...(sp.get("from") ? { from: sp.get("from")! } : {}),
    ...(sp.get("to") ? { to: sp.get("to")! } : {}),
  };
  const label = reportId ? "Ask about this report" : "Ask about your reports";
  const placeholder = turns.length
    ? "Ask a follow-up"
    : reportId
      ? label
      : `${label}, like: which month did we spend the most?`;

  return (
    <div className="space-y-3">
      {turns.length > 0 && (
        <ol className="space-y-3" aria-label="Questions and answers">
          {turns.map((t, i) => (
            <li key={i} className="space-y-1.5">
              <p className="text-muted-foreground ps-1 text-[13px] font-semibold">{t.question}</p>
              <p className="bg-tint-info flex gap-2.5 rounded-[14px] px-3.5 py-3 text-[13.5px] leading-relaxed">
                <Sparkles
                  className="text-tint-info-foreground mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{t.answer}</span>
              </p>
            </li>
          ))}
        </ol>
      )}
      {pending && asking && (
        <div className="space-y-1.5" aria-live="polite">
          <p className="text-muted-foreground ps-1 text-[13px] font-semibold">{asking}</p>
          <p className="text-muted-foreground ps-1 text-sm">
            Claude is reading {reportId ? "this report" : "your reports"}...
          </p>
        </div>
      )}
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          const asked = question.trim();
          if (!asked || pending) return;
          setError(null);
          setAsking(asked);
          start(async () => {
            const result = await askReportsAction(orgId, asked, range, reportId, turns);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setTurns((all) => [...all, { question: asked, answer: result.answer }]);
            setQuestion("");
          });
        }}
      >
        <svg
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          aria-label={turns.length ? "Ask a follow-up" : label}
          placeholder={placeholder}
          className="border-border bg-card focus-glow h-[42px] w-full rounded-full border pr-20 pl-10 text-base font-medium outline-none md:text-sm"
        />
        {question.trim() && (
          <button
            type="submit"
            disabled={pending}
            className="bg-foreground text-background focus-glow absolute top-1/2 right-1.5 h-[30px] -translate-y-1/2 rounded-full px-3.5 text-xs font-semibold outline-none disabled:opacity-40"
          >
            Ask
          </button>
        )}
      </form>
      {error && !pending && (
        <p role="alert" className="text-destructive ps-1 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
