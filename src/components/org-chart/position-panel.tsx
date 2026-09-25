"use client";

import { ExternalLink, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { loadOpenTasksAction } from "@/app/app/[orgSlug]/org-chart/actions";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { nodeVariant, personLabel, type ChartNodeDTO } from "@/lib/org-chart/types";

/**
 * The side panel for one position: title, person, reports-to and manages
 * (each a button that selects and centers that position), advisors,
 * responsibilities, decides alone, the person's profile link and their
 * open tasks (loaded when the panel opens). A right-hand sheet on desktop,
 * a bottom sheet on phones. Everything from the document renders as plain
 * text.
 */

interface OpenTask {
  id: string;
  title: string;
  status: string;
  dueDate: Date | string | null;
}

type TasksState =
  | { state: "idle" | "loading" }
  | { state: "error" }
  | {
      state: "ready";
      owned: OpenTask[];
      ownedCount: number;
      involved: OpenTask[];
      involvedCount: number;
    };

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
};

export interface PositionPanelProps {
  orgId: string;
  orgSlug: string;
  node: ChartNodeDTO | null;
  manager: ChartNodeDTO | null;
  reports: ChartNodeDTO[];
  advisors: ChartNodeDTO[];
  side: "right" | "bottom";
  onClose: () => void;
  onNavigate: (node: ChartNodeDTO) => void;
  /** Admin: opens this position in a draft (absent for members). */
  onEdit?: () => void;
}

export function PositionPanel(props: PositionPanelProps) {
  const { node, side, onClose } = props;
  return (
    // Non-modal on desktop: the chart stays visible and clickable beside the
    // panel (clicking another node switches the panel; Escape or X closes).
    <Sheet open={node !== null} onOpenChange={(open) => !open && onClose()} modal={side === "bottom"}>
      <SheetContent
        side={side}
        onInteractOutside={side === "right" ? (event) => event.preventDefault() : undefined}
        className={side === "bottom" ? "max-h-[85dvh] overflow-y-auto rounded-t-xl" : "w-full overflow-y-auto sm:max-w-md"}
      >
        {node && <PanelBody key={node.id} {...props} node={node} />}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({
  orgId,
  orgSlug,
  node,
  manager,
  reports,
  advisors,
  onNavigate,
  onEdit,
}: PositionPanelProps & { node: ChartNodeDTO }) {
  const variant = nodeVariant(node);
  const userId = node.user?.id ?? null;
  const [tasks, setTasks] = useState<TasksState>({ state: userId ? "loading" : "idle" });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadOpenTasksAction(orgId, userId).then(
      (result) => !cancelled && setTasks({ state: "ready", ...result }),
      () => !cancelled && setTasks({ state: "error" }),
    );
    return () => {
      cancelled = true;
    };
  }, [orgId, userId]);

  const tasksHref = userId ? `/app/${orgSlug}/tasks?view=table&owner=${encodeURIComponent(userId)}&status=open` : null;

  return (
    <div className="flex flex-col gap-5 px-4 pb-6">
      <SheetHeader className="px-0">
        <div className="flex items-center gap-3 pr-8">
          {node.user ? (
            <UserAvatar user={node.user} size="xl" />
          ) : (
            <span className="bg-muted text-muted-foreground flex size-16 shrink-0 items-center justify-center rounded-full border border-dashed">
              <UserPlus className="size-6" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <SheetTitle className="text-lg leading-tight">{node.title}</SheetTitle>
            <SheetDescription className="mt-0.5">{personLabel(node)}</SheetDescription>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {node.isAdvisor && <Badge variant="secondary">Advisor</Badge>}
              {variant === "open" && <Badge variant="secondary">Open hire</Badge>}
              {variant === "placeholder" && <Badge variant="outline">Not on the portal</Badge>}
            </div>
          </div>
        </div>
      </SheetHeader>

      {node.user ? (
        <Link
          href={`/app/${orgSlug}/people/${encodeURIComponent(node.user.id)}`}
          className="text-primary inline-flex w-fit items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          View {node.user.name ?? "their"} profile
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      ) : variant === "placeholder" ? (
        <p className="text-muted-foreground text-sm">
          {node.personName} isn&apos;t linked to a member of this workspace yet.
          {onEdit && " Link them in a draft."}
        </p>
      ) : null}

      <Section title="Reports to">
        {manager ? (
          <PersonLink node={manager} onNavigate={onNavigate} />
        ) : (
          <p className="text-muted-foreground text-sm">Nobody: this is the top of the chart.</p>
        )}
      </Section>

      <Section title={node.isAdvisor ? "Manages" : `Manages (${reports.length})`}>
        {reports.length > 0 ? (
          <ul className="space-y-1">
            {reports.map((r) => (
              <li key={r.id}>
                <PersonLink node={r} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No direct reports.</p>
        )}
      </Section>

      {advisors.length > 0 && (
        <Section title="Advisors">
          <ul className="space-y-1">
            {advisors.map((a) => (
              <li key={a.id}>
                <PersonLink node={a} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Responsibilities">
        <Bullets items={node.responsibilities} empty="None listed." />
      </Section>

      <Section title="Decides alone">
        <Bullets items={node.decidesAlone} empty="Nothing listed." />
      </Section>

      {userId && (
        <Section title="Open tasks">
          {tasks.state === "loading" && (
            <div className="space-y-2" aria-busy="true" aria-label="Loading tasks">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
            </div>
          )}
          {tasks.state === "error" && <p className="text-muted-foreground text-sm">Tasks couldn&apos;t be loaded.</p>}
          {tasks.state === "ready" && (
            <div className="space-y-3">
              <TaskList title="Owns" items={tasks.owned} total={tasks.ownedCount} />
              {tasks.involvedCount > 0 && (
                <TaskList title="Also involved in" items={tasks.involved} total={tasks.involvedCount} />
              )}
              {tasksHref && (
                <Link
                  href={tasksHref}
                  className="text-primary inline-block text-sm font-medium underline-offset-4 hover:underline"
                >
                  All open tasks
                </Link>
              )}
            </div>
          )}
        </Section>
      )}

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="text-muted-foreground hover:text-foreground w-fit text-sm underline underline-offset-4"
        >
          Edit this position in a draft
        </button>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function PersonLink({ node, onNavigate }: { node: ChartNodeDTO; onNavigate: (node: ChartNodeDTO) => void }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(node)}
      className="hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2"
    >
      {node.user ? (
        <UserAvatar user={node.user} size="sm" />
      ) : (
        <span aria-hidden="true" className="bg-muted size-6 shrink-0 rounded-full border border-dashed" />
      )}
      <span className="min-w-0 text-sm">
        <span className="font-medium">{personLabel(node)}</span>
        <span className="text-muted-foreground"> · {node.title}</span>
      </span>
    </button>
  );
}

function TaskList({ title, items, total }: { title: string; items: OpenTask[]; total: number }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {title} <span className="text-muted-foreground font-normal">({total})</span>
      </p>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No open tasks.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((t) => (
            <li key={t.id} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{t.title}</span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {STATUS_LABEL[t.status] ?? t.status}
                {t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {total > items.length && <p className="text-muted-foreground text-xs">and {total - items.length} more</p>}
    </div>
  );
}
