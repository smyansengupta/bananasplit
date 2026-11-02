"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { askReportsAction } from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { Sparkles } from "@/components/icons";

/**
 * Insights' ask box: a question, and Claude's answer from the numbers. On
 * Reports home it reads every report; on a report, only that one.
 */
export function AskReports({ orgId, reportId }: { orgId: string; reportId?: string }) {
  const sp = useSearchParams();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const range = {
    ...(sp.get("range") ? { range: sp.get("range")! } : {}),
    ...(sp.get("from") ? { from: sp.get("from")! } : {}),
    ...(sp.get("to") ? { to: sp.get("to")! } : {}),
  };
  const label = reportId ? "Ask about this report" : "Ask about your reports";
  return (
    <div className="space-y-2.5">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          if (!question.trim() || pending) return;
          setError(null);
          start(async () => {
            const result = await askReportsAction(orgId, question, range, reportId);
            if (!result.ok) {
              setError(result.error);
              setAnswer(null);
              return;
            }
            setAnswer(result.answer);
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
          aria-label={label}
          placeholder={reportId ? label : `${label}, like: which month did we spend the most?`}
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
      {pending && (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Claude is reading {reportId ? "this report" : "your reports"}...
        </p>
      )}
      {answer && !pending && (
        <p className="bg-tint-info flex gap-2.5 rounded-[14px] px-3.5 py-3 text-[13.5px] leading-relaxed">
          <Sparkles
            className="text-tint-info-foreground mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>{answer}</span>
        </p>
      )}
      {error && !pending && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
