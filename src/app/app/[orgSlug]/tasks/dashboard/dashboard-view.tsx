"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { MixBar } from "@/components/ui/meters";
import { STATUS_LABEL, STATUS_TOKEN, TASK_PANEL } from "@/components/tasks/layout-ui";
import { BlockedNote, DueLabel } from "@/components/tasks/task-badges";
import { TaskTitle } from "@/components/tasks/task-title";
import { useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import type { TaskStatus } from "@/generated/prisma/enums";
import { addDaysToKey, formatDueKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";
import type { PersonStatus, TaskDashboard } from "@/server/tasks/dashboard";

import type { WeeklyStatus } from "../updates/weekly-update-strip";
import type { TaskLayout, WorkspaceQuery } from "../views";

/**
 * The Dashboard layout: where the tasks in view stand. It reads the same
 * scope and filters as the board (Mine, My team, Everyone, a person, a
 * project...), so it is the board's question, counted. The figures are the
 * board's tasks (top-level), and each one links to the board or table with
 * the same filters plus that slice; the attention list opens a task in the
 * usual panel. In a club it also shows this week's updates. See
 * src/server/tasks/dashboard.ts for what is counted.
 */

const PEOPLE_SHOWN = 12;

export function DashboardView({
  data,
  everyone,
  weekly,
}: {
  data: TaskDashboard;
  /** No scope or person narrows the view: list every member, idle ones too. */
  everyone: boolean;
  /** This week's updates, in a club. `expected` is empty unless the viewer may see who hasn't posted. */
  weekly: (WeeklyStatus & { postedBy: string[]; expected: string[] }) | null;
}) {
  const { org, members, memberById, openTask } = useTasks();
  const ws = useWorkspace();
  const [allPeople, setAllPeople] = useState(false);
  const { totals, window: span } = data;

  // The same workspace (scope, person, project...) with one more slice.
  const link = (q: Partial<WorkspaceQuery>, view: TaskLayout = "board") =>
    ws.hrefWith({ view, ...q });
  const overdueQuery = { status: "open" as const, dueTo: span.yesterdayKey };

  // Everyone with work, then (for the whole club) everyone without: it's
  // worth seeing who has nothing on their plate too.
  const people = useMemo(() => {
    const rows = new Map(data.people.map((p) => [p.userId, p]));
    if (everyone) {
      for (const m of members) {
        if (!rows.has(m.id)) {
          rows.set(m.id, {
            userId: m.id,
            notStarted: 0,
            inProgress: 0,
            blocked: 0,
            done: 0,
            overdue: 0,
            doneRecently: 0,
          });
        }
      }
    }
    const open = (p: PersonStatus) => p.notStarted + p.inProgress + p.blocked;
    const name = (p: PersonStatus) => memberById.get(p.userId)?.name ?? "";
    return [...rows.values()]
      .filter((p) => memberById.has(p.userId))
      .sort(
        (a, b) =>
          b.overdue - a.overdue ||
          b.blocked - a.blocked ||
          open(b) - open(a) ||
          name(a).localeCompare(name(b)),
      );
  }, [data.people, members, memberById, everyone]);
  const shownPeople = allPeople ? people : people.slice(0, PEOPLE_SHOWN);

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        The tasks in view, counted (stories and tasks, as on the board). Click a number to see them.
      </p>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* Chart kit 8.5: how the work in view splits, to scale. */}
        <section
          className="bg-card edge rounded-card p-6 max-sm:p-[18px]"
          aria-labelledby="dash-mix"
        >
          <h2 id="dash-mix" className="heading">
            Where the work stands
          </h2>
          <div className="mt-4 mb-4 flex items-baseline gap-2.5">
            <b className="numeral text-[32px]">
              {totals.notStarted + totals.inProgress + totals.blocked + totals.done}
            </b>
            <span className="text-muted-foreground text-sm">tasks in view</span>
          </div>
          <MixBar
            label={`${totals.notStarted} not started, ${totals.inProgress} in progress, ${totals.blocked} blocked, ${totals.done} done`}
            segments={[
              { label: "Not started", value: totals.notStarted, hatch: true },
              {
                label: "In progress",
                value: totals.inProgress,
                color: "var(--chart-2)",
              },
              {
                label: "Blocked",
                value: totals.blocked,
                color: "var(--destructive)",
              },
              { label: "Done", value: totals.done, color: "var(--chart-4)" },
            ]}
          />
        </section>
        <section
          className="bg-card edge rounded-card p-6 max-sm:p-[18px]"
          aria-labelledby="dash-next"
        >
          <h2 id="dash-next" className="heading">
            Worth a look
          </h2>
          <ul className="mt-3 space-y-1">
            <Line
              label="Blocked"
              value={<Tone n={totals.blocked}>{totals.blocked}</Tone>}
              href={link({ status: "BLOCKED" })}
            />
            <Line
              label="Overdue"
              value={<Tone n={totals.overdue}>{totals.overdue}</Tone>}
              href={link(overdueQuery, "table")}
            />
            <Line
              label="Due in 7 days"
              value={totals.dueSoon}
              href={link(
                { status: "open", dueFrom: span.todayKey, dueTo: span.dueSoonKey },
                "table",
              )}
            />
            <Line label="No owner" value={totals.unowned} detail="Open, unassigned" />
          </ul>
        </section>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="dash-epics" className="space-y-2">
            <SectionTitle id="dash-epics">Epics</SectionTitle>
            {data.epics.length === 0 ? (
              <Empty>No tasks yet.</Empty>
            ) : (
              <div className={TASK_PANEL}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="ps-4">Epic</TableHead>
                      <TableHead className="w-40">Progress</TableHead>
                      <CountHead status="NOT_STARTED" />
                      <CountHead status="IN_PROGRESS" />
                      <CountHead status="BLOCKED" />
                      <TableHead className="text-right">Overdue</TableHead>
                      <CountHead status="COMPLETED" className="pe-4" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.epics.map((p) => {
                      const q = p.epicId ? { epicId: p.epicId } : null;
                      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                      return (
                        <TableRow key={p.epicId ?? "none"}>
                          <TableCell className="max-w-56 ps-4 font-medium">
                            {q ? (
                              <Link
                                href={link(q)}
                                className="block truncate underline-offset-4 hover:underline"
                              >
                                {p.name}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">{p.name}</span>
                            )}
                            {p.finished && (
                              <span className="text-muted-foreground text-xs font-normal">
                                {" "}
                                (done)
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Progress pct={pct} label={`${p.done} of ${p.total} done`} />
                          </TableCell>
                          <Count
                            n={p.notStarted}
                            href={q && link({ ...q, status: "NOT_STARTED" })}
                          />
                          <Count
                            n={p.inProgress}
                            href={q && link({ ...q, status: "IN_PROGRESS" })}
                          />
                          <Count n={p.blocked} href={q && link({ ...q, status: "BLOCKED" })} tone />
                          <Count
                            n={p.overdue}
                            href={q && link({ ...q, ...overdueQuery }, "table")}
                            tone
                          />
                          <Count
                            n={p.done}
                            href={q && link({ ...q, status: "COMPLETED" }, "table")}
                            className="pe-4"
                          />
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section aria-labelledby="dash-people" className="space-y-2">
            <SectionTitle id="dash-people">People</SectionTitle>
            {people.length === 0 ? (
              <Empty>Nobody owns a task yet.</Empty>
            ) : (
              <div className={TASK_PANEL}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="ps-4">Owner</TableHead>
                      <CountHead status="NOT_STARTED" />
                      <CountHead status="IN_PROGRESS" />
                      <CountHead status="BLOCKED" />
                      <TableHead className="text-right">Overdue</TableHead>
                      <TableHead className="pe-4 text-right">Done this week</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownPeople.map((p) => {
                      const m = memberById.get(p.userId)!;
                      // Exactly the tasks they own, in the same workspace.
                      const personLink = (q: Partial<WorkspaceQuery>, view: TaskLayout = "board") =>
                        link({ ownerId: p.userId, assigneeId: undefined, ...q }, view);
                      return (
                        <TableRow key={p.userId}>
                          <TableCell className="max-w-56 ps-4">
                            <Link
                              href={personLink({})}
                              className="flex min-w-0 items-center gap-2 font-medium underline-offset-4 hover:underline"
                            >
                              <UserAvatar user={m} size="xs" />
                              <span className="truncate">{m.name ?? "Member"}</span>
                            </Link>
                          </TableCell>
                          <Count n={p.notStarted} href={personLink({ status: "NOT_STARTED" })} />
                          <Count n={p.inProgress} href={personLink({ status: "IN_PROGRESS" })} />
                          <Count n={p.blocked} href={personLink({ status: "BLOCKED" })} tone />
                          <Count n={p.overdue} href={personLink(overdueQuery, "table")} tone />
                          <Count n={p.doneRecently} className="pe-4" />
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {people.length > PEOPLE_SHOWN && (
                  <div className="border-t px-4 py-2">
                    <Button variant="ghost" size="sm" onClick={() => setAllPeople((v) => !v)}>
                      {allPeople ? "Show fewer" : `Show all ${people.length}`}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          {weekly && <WeeklyUpdates weekly={weekly} orgSlug={org.slug} />}
          <section aria-labelledby="dash-attention" className="min-w-0 space-y-2">
            <SectionTitle id="dash-attention">
              Needs attention
              {totals.blocked + totals.overdue > data.attention.length && (
                <Link
                  href={link({ blockers: true }, "table")}
                  className="text-muted-foreground ms-2 text-xs font-normal normal-case underline-offset-4 hover:underline"
                >
                  See all
                </Link>
              )}
            </SectionTitle>
            {data.attention.length === 0 ? (
              <Empty>Nothing blocked or overdue.</Empty>
            ) : (
              <ul className={cn(TASK_PANEL, "divide-y")}>
                {data.attention.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => openTask(t.id)}
                      className="hover:bg-muted/40 focus-visible:bg-muted/40 flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors outline-none"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: STATUS_TOKEN[t.status] }}
                        />
                        <span className="truncate">
                          <TaskTitle>{t.title}</TaskTitle>
                        </span>
                      </span>
                      {t.status === "BLOCKED" && <BlockedNote reason={t.blockedReason} />}
                      <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {t.owner ? (
                          <span className="inline-flex items-center gap-1.5">
                            <UserAvatar user={t.owner} size="xs" />
                            {t.owner.name ?? "Member"}
                          </span>
                        ) : (
                          <span>No owner</span>
                        )}
                        <DueLabel dueDate={t.dueDate} todayKey={span.todayKey} />
                        {t.parentTask?.type === "EPIC" && (
                          <span className="truncate">{t.parentTask.title}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * This week's updates: who has posted (each opens their update) and, for
 * whoever may see it (canSeeWhoPosted), who hasn't yet.
 */
function WeeklyUpdates({
  weekly,
  orgSlug,
}: {
  weekly: WeeklyStatus & { postedBy: string[]; expected: string[] };
  orgSlug: string;
}) {
  const { memberById } = useTasks();
  const lastDay = addDaysToKey(weekly.weekStart, 6);
  const posted = weekly.postedBy.map((id) => memberById.get(id)).filter((m) => m !== undefined);
  const waiting = weekly.expected
    .filter((id) => !weekly.postedBy.includes(id))
    .map((id) => memberById.get(id))
    .filter((m) => m !== undefined);
  const href = (personId?: string) =>
    `/app/${orgSlug}/tasks?view=updates${personId ? `&person=${personId}` : ""}`;
  return (
    <section aria-labelledby="dash-weekly" className="space-y-2">
      <SectionTitle id="dash-weekly">
        Weekly updates
        <Link
          href={href()}
          className="text-muted-foreground ms-2 text-xs font-normal normal-case underline-offset-4 hover:underline"
        >
          {weekly.posted ? "Yours is posted" : "Write yours"}
        </Link>
      </SectionTitle>
      <div className={cn(TASK_PANEL, "space-y-3 px-4 py-3 text-sm")}>
        <p className="text-muted-foreground text-xs">
          Due {formatDueKey(lastDay, weekly.todayKey)}
        </p>
        {posted.length === 0 ? (
          <p className="text-muted-foreground">Nobody has posted this week yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Posted">
            {posted.map((m) => (
              <li key={m.id}>
                <Link
                  href={href(m.id)}
                  className="bg-muted hover:bg-muted/70 inline-flex items-center gap-1.5 rounded-md py-0.5 ps-0.5 pe-2 text-xs font-medium"
                >
                  <UserAvatar user={m} size="xs" />
                  {m.name ?? "Member"}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {waiting.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Still to post: {waiting.map((m) => m.name ?? "Member").join(", ")}
          </p>
        )}
      </div>
    </section>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="heading flex items-baseline gap-2">
      {children}
    </h3>
  );
}

/** One count in "Worth a look": the label, the number, a link to those tasks. */
function Line({
  label,
  value,
  href,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
  detail?: string;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {detail && <span className="text-muted-foreground block text-xs">{detail}</span>}
      </span>
      <span className="numeral text-[22px]">{value}</span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="hover:bg-muted/60 rounded-field flex items-center gap-3 px-3 py-2.5 transition-colors"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-3 py-2.5">{body}</div>
      )}
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">{children}</p>
  );
}

/** A figure that reads red while there is any (blocked, overdue). */
function Tone({ n, children }: { n: number; children: React.ReactNode }) {
  return <span className={cn(n > 0 && "text-destructive")}>{children}</span>;
}

function CountHead({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <TableHead className={cn("text-right whitespace-nowrap", className)}>
      {STATUS_LABEL[status]}
    </TableHead>
  );
}

function Count({
  n,
  href,
  tone,
  className,
}: {
  n: number;
  href?: string | null;
  /** Red while non-zero. */
  tone?: boolean;
  className?: string;
}) {
  return (
    <TableCell className={cn("text-right tabular-nums", className)}>
      {n === 0 ? (
        <span className="text-muted-foreground/60">–</span>
      ) : href ? (
        <Link
          href={href}
          className={cn(
            "underline-offset-4 hover:underline",
            tone && "text-destructive font-medium",
          )}
        >
          {n}
        </Link>
      ) : (
        <span className={cn(tone && "text-destructive font-medium")}>{n}</span>
      )}
    </TableCell>
  );
}

function Progress({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="flex items-center gap-2" title={label}>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="bg-muted h-1.5 w-24 overflow-hidden rounded-full"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: STATUS_TOKEN.COMPLETED }}
        />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">{pct}%</span>
    </div>
  );
}
