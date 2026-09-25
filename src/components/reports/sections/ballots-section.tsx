import Link from "next/link";
import { EyeOff } from "lucide-react";

import { reportLinks } from "@/server/reports/links";
import type { BallotQuestionResult, BallotResult } from "@/server/reports/types";

import { BarList } from "../bar-list";
import { formatCount, formatPct, shortDate } from "../format";
import { ReportCard, ReportEmpty, ReportError } from "../report-card";
import { loadReport, type ReportViewContext } from "./shared";

function Question({ q, k }: { q: BallotQuestionResult; k: number }) {
  const ranked = q.type === "slots";
  const measure = (o: BallotQuestionResult["options"][number]) => (ranked ? o.borda : o.votes);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="text-sm font-medium">{q.label}</h4>
        <span className="text-muted-foreground text-xs">
          {formatCount(q.ballots)} {q.ballots === 1 ? "answer" : "answers"}
          {ranked ? " · ranked by Borda points" : ""}
        </span>
      </div>
      <BarList
        label={q.label}
        items={q.options.map((o) => {
          const value = measure(o);
          return {
            key: o.key,
            label: o.label,
            value: o.suppressed ? null : value,
            display: o.suppressed ? (
              <span title={`Fewer than ${k} votes`} className="text-muted-foreground">
                &lt;{k}
              </span>
            ) : ranked ? (
              `${formatCount(value ?? 0)} pts`
            ) : (
              formatCount(value ?? 0)
            ),
            detail:
              ranked && !o.suppressed
                ? `${formatCount(o.firstChoice ?? 0)} first choice · ${formatCount(o.votes ?? 0)} ranked it`
                : !ranked && !o.suppressed && q.ballots > 0 && o.votes !== null
                  ? formatPct((o.votes / q.ballots) * 100)
                  : undefined,
          };
        })}
      />
    </div>
  );
}

function Ballot({ ballot, ctx, k }: { ballot: BallotResult; ctx: ReportViewContext; k: number }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4" aria-label={ballot.title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium">{ballot.title}</h3>
          <p className="text-muted-foreground text-xs">
            {formatCount(ballot.ballots)} {ballot.ballots === 1 ? "ballot" : "ballots"}
            {ballot.opensOn ? ` · opened ${shortDate(ballot.opensOn)}` : ""}
            {" · turnout "}
            {ballot.turnoutPct === null ? (
              <span title="No linked session with check-ins to compare with">n/a</span>
            ) : (
              <>
                {formatPct(ballot.turnoutPct)} of {formatCount(ballot.linkedSession?.checkIns ?? 0)} at{" "}
                {ballot.linkedSession?.title}
              </>
            )}
          </p>
        </div>
        <Link
          href={reportLinks.ballot(ctx.slug, ballot.id)}
          className="text-muted-foreground hover:text-foreground text-xs font-medium whitespace-nowrap"
        >
          View ballot data
        </Link>
      </div>
      {ballot.ballots === 0 ? (
        <ReportEmpty>No valid ballots yet.</ReportEmpty>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {ballot.questions.map((q) => (
            <Question key={q.key} q={q} k={k} />
          ))}
        </div>
      )}
      {ballot.freeTextQuestions > 0 ? (
        <p className="text-muted-foreground text-xs">Free-text answers are never included in reports.</p>
      ) : null}
    </section>
  );
}

/** 6. Ballots. */
export async function BallotsSection({ ctx }: { ctx: ReportViewContext }) {
  const result = await loadReport("ballots", ctx);
  if (!result) return <ReportError id="ballots" title="Ballots" tz={ctx.tz} />;
  const r = result.data;

  return (
    <ReportCard
      id="ballots"
      title="Ballots"
      description="Results per ballot, with turnout against the linked session."
      viewHref={reportLinks.ballots(ctx.slug)}
      viewLabel="View ballots"
      computedAt={result.computedAt}
      tz={ctx.tz}
    >
      {r.hidden ? (
        <ReportEmpty>
          <span className="inline-flex items-center gap-2">
            <EyeOff className="size-4" aria-hidden="true" />
            Ballot results are not shared with members in this organization.
          </span>
        </ReportEmpty>
      ) : r.ballots.length === 0 ? (
        <ReportEmpty>No ballots in {ctx.rangeLabel.toLowerCase()}.</ReportEmpty>
      ) : (
        <>
          {!r.fullCounts ? (
            <p className="text-muted-foreground text-xs">
              Totals only. Options with fewer than {r.minCellSize} votes show as &lt;{r.minCellSize} so no one&apos;s
              vote can be singled out.
            </p>
          ) : null}
          <div className="flex flex-col gap-4">
            {r.ballots.map((b) => (
              <Ballot key={b.id} ballot={b} ctx={ctx} k={r.minCellSize} />
            ))}
          </div>
        </>
      )}
    </ReportCard>
  );
}
