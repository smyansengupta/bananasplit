"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { askReportsAction } from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { Search, Sparkles } from "@/components/icons";

/** Reports home's "Ask about your reports": a question, and Claude's answer from the reports' numbers. */
export function AskReports({ orgId }: { orgId: string }) {
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
  return (
    <div className="space-y-2.5">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          if (!question.trim() || pending) return;
          setError(null);
          start(async () => {
            const result = await askReportsAction(orgId, question, range);
            if (!result.ok) {
              setError(result.error);
              setAnswer(null);
              return;
            }
            setAnswer(result.answer);
          });
        }}
      >
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          aria-label="Ask about your reports"
          placeholder="Ask about your reports, like: which month did we spend the most?"
          className="bg-muted/60 focus-glow h-11 w-full rounded-full pr-20 pl-11 text-base outline-none md:text-sm"
        />
        <button
          type="submit"
          disabled={!question.trim() || pending}
          className="bg-foreground text-background focus-glow absolute top-1/2 right-1.5 h-8 -translate-y-1/2 rounded-full px-3.5 text-xs font-semibold outline-none disabled:opacity-40"
        >
          Ask
        </button>
      </form>
      {pending && (
        <p className="text-muted-foreground text-sm">Claude is reading your reports...</p>
      )}
      {answer && !pending && (
        <p className="bg-tint-info text-tint-info-foreground rounded-tile flex gap-2.5 px-4 py-3 text-sm leading-relaxed">
          <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
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
