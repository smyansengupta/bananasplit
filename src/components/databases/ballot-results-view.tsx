import { EyeOff, Vote } from "@/components/icons";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PollResults } from "@/server/databases/ballot-results";

import { TableFrame } from "./table-frame";

/**
 * The per-question pivot of one poll: option counts and share of ballots,
 * plus first-choice counts and a Borda score for ranked questions. Cells
 * below the org's minimum group size show as '<k' for viewers without
 * access to individual votes. One card per question, the one table style
 * inside it.
 */
export function BallotResultsView({ results }: { results: PollResults }) {
  if (results.hidden) {
    return (
      <Card>
        <EmptyState
          icon={EyeOff}
          title="Only owners and admins see these results"
          description="Who sees poll results is set in Admin panel › Privacy."
        />
      </Card>
    );
  }
  if (results.questions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Vote}
          title="No counted ballots for this poll yet"
          description="Totals show up here as ballots come in."
        />
      </Card>
    );
  }
  const k = results.minCellSize;
  return (
    <div className="space-y-4.5">
      <p className="text-muted-foreground text-sm">
        Test ballots and ballots outside the poll&apos;s window are not counted. Groups smaller than{" "}
        {k} show as &lt;{k}.
      </p>
      {results.questions.map((q) => {
        const ranked = q.type === "slots";
        return (
          <Card key={q.key} aria-label={q.label} role="region">
            <CardHeader className="flex flex-wrap items-center gap-2">
              <CardTitle>
                <h3>{q.label}</h3>
              </CardTitle>
              <Badge variant="secondary">
                {q.ballots.toLocaleString()} answered{ranked ? ", ranked" : ""}
              </Badge>
            </CardHeader>
            <CardContent>
              {q.ballots === 0 ? (
                <p className="text-muted-foreground text-sm">No answers yet.</p>
              ) : (
                <TableFrame bare maxHeight="none">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Option</TableHead>
                        <TableHead className="text-right tabular-nums">Votes</TableHead>
                        <TableHead className="w-1/3">Share of ballots</TableHead>
                        {ranked && (
                          <TableHead className="text-right tabular-nums">First choice</TableHead>
                        )}
                        {ranked && <TableHead className="text-right tabular-nums">Borda</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {q.options.map((o) => (
                        <TableRow key={o.key}>
                          <TableCell className="font-medium whitespace-normal">{o.label}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {o.suppressed ? (
                              <span title={`Fewer than ${k}`} className="text-muted-foreground">
                                &lt;{k}
                              </span>
                            ) : (
                              (o.votes?.toLocaleString() ?? "")
                            )}
                          </TableCell>
                          <TableCell>
                            {o.share !== null && (
                              <div className="flex items-center gap-3">
                                <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                                  <div
                                    className="bg-chart-1 h-full rounded-full"
                                    style={{ width: `${Math.round(o.share * 100)}%` }}
                                  />
                                </div>
                                <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                                  {Math.round(o.share * 100)}%
                                </span>
                              </div>
                            )}
                          </TableCell>
                          {ranked && (
                            <TableCell className="text-right tabular-nums">
                              {o.suppressed ? "" : o.firstChoice}
                            </TableCell>
                          )}
                          {ranked && (
                            <TableCell className="text-right tabular-nums">
                              {o.suppressed ? "" : o.borda}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableFrame>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
