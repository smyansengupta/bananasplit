import type { PollResults } from "@/server/databases/ballot-results";

/**
 * The per-question pivot of one poll: option counts and share of ballots,
 * plus first-choice counts and a Borda score for ranked questions. Cells
 * below the org's minimum group size show as '<k' for viewers without
 * access to individual votes.
 */
export function BallotResultsView({ results }: { results: PollResults }) {
  if (results.hidden) {
    return (
      <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
        Results of this poll are visible to owners and admins only (Settings &gt; Privacy).
      </p>
    );
  }
  if (results.questions.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
        No counted ballots for this poll yet.
      </p>
    );
  }
  const k = results.minCellSize;
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        {results.turnout.toLocaleString()} counted ballot{results.turnout === 1 ? "" : "s"}. Test
        ballots and ballots outside the poll&apos;s window are not counted. Groups smaller than {k}{" "}
        show as &lt;{k}.
      </p>
      {results.questions.map((q) => {
        const ranked = q.type === "slots";
        return (
          <section key={q.key} className="space-y-2" aria-label={q.label}>
            <h3 className="text-sm font-semibold">
              {q.label}{" "}
              <span className="text-muted-foreground font-normal">
                ({q.ballots} answered{ranked ? ", ranked" : ""})
              </span>
            </h3>
            {q.ballots === 0 ? (
              <p className="text-muted-foreground text-sm">No answers yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
                    <tr>
                      <th className="px-3 py-2 font-medium">Option</th>
                      <th className="px-3 py-2 text-right font-medium">Votes</th>
                      <th className="w-1/3 px-3 py-2 font-medium">Share of ballots</th>
                      {ranked && <th className="px-3 py-2 text-right font-medium">First choice</th>}
                      {ranked && <th className="px-3 py-2 text-right font-medium">Borda</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {q.options.map((o) => (
                      <tr key={o.key} className="border-t">
                        <td className="px-3 py-1.5">{o.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {o.suppressed ? <span title={`Fewer than ${k}`}>&lt;{k}</span> : o.votes}
                        </td>
                        <td className="px-3 py-1.5">
                          {o.share !== null && (
                            <div className="flex items-center gap-2">
                              <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                                <div
                                  className="bg-primary h-full rounded-full"
                                  style={{ width: `${Math.round(o.share * 100)}%` }}
                                />
                              </div>
                              <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                                {Math.round(o.share * 100)}%
                              </span>
                            </div>
                          )}
                        </td>
                        {ranked && (
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {o.suppressed ? "" : o.firstChoice}
                          </td>
                        )}
                        {ranked && (
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {o.suppressed ? "" : o.borda}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
