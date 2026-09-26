"use client";

import { Inbox, Plus, Settings2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { OwnerPicker } from "@/components/tasks/member-picker";
import { useConfirmFlagged } from "@/components/tasks/prompts";
import { QuickPriority, QuickStatus } from "@/components/tasks/quick-controls";
import { BlockedNote, DueLabel, FlagBadge, isTaskFlagged } from "@/components/tasks/task-badges";
import { accessSubjectOf, useTasks } from "@/components/tasks/tasks-context";
import type { ProjectOption, TaskItem } from "@/components/tasks/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { canEditTask, canTriage } from "@/lib/tasks/access";
import { relationFor } from "@/lib/tasks/assignment";

import { updateTask } from "../actions";
import { setProjectIntake } from "../projects-actions";

/**
 * The intake queue (Design Requests): anyone files a request (due in the
 * queue's default window, 5 days for CBC); only the triage owner or
 * OWNER/ADMIN sets priority and owner, right here in the list.
 */
export function IntakeView({
  project,
  intakeProjects,
  tasks,
}: {
  project: ProjectOption | null;
  intakeProjects: ProjectOption[];
  tasks: TaskItem[];
}) {
  const { org, viewer, actor, memberById, announce, showTask, newTask } = useTasks();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmElement, confirmFlagged] = useConfirmFlagged();
  const [, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  if (!project) {
    return (
      <>
        <EmptyState
          icon={Inbox}
          title="No intake queue yet"
          description="An intake queue lets anyone file requests (like design requests) while one triage owner sets their priority and owner."
          action={
            viewer.isAdmin ? (
              <Button size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="size-4" /> Set up a queue
              </Button>
            ) : undefined
          }
        />
        {viewer.isAdmin && (
          <QueueSettings open={settingsOpen} onOpenChange={setSettingsOpen} project={null} />
        )}
      </>
    );
  }

  const triage = canTriage(actor, { isIntake: true, triageUserId: project.triageUserId });
  const triageName = project.triageUserId
    ? (memberById.get(project.triageUserId)?.name ?? "the triage owner")
    : "an admin";
  const untriaged = tasks.filter((t) => t.status !== "COMPLETED" && !t.ownerId);
  const active = tasks.filter((t) => t.status !== "COMPLETED" && t.ownerId);
  const done = tasks.filter((t) => t.status === "COMPLETED");

  function assign(task: TaskItem, ownerId: string | null) {
    void (async () => {
      let confirmed = false;
      if (ownerId && relationFor(viewer.chart, ownerId) === "ABOVE") {
        confirmed = await confirmFlagged([memberById.get(ownerId)?.name ?? "This person"]);
        if (!confirmed) return;
      }
      startTransition(async () => {
        const result = await updateTask(org.id, task.id, { ownerId, confirmFlagged: confirmed });
        if (result.error) announce(result.error);
      });
    })();
  }

  const row = (t: TaskItem) => {
    const access = accessSubjectOf(t);
    const editable = canEditTask(actor, access);
    return (
      <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <button
          type="button"
          className="min-w-0 flex-1 basis-56 text-left"
          onClick={() => showTask(t)}
        >
          <span className="block truncate text-sm font-medium">{t.title}</span>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            Filed by <UserAvatar user={t.createdBy} size="xs" />{" "}
            {t.createdBy.name ?? "a former member"}
            {t.status === "BLOCKED" && <BlockedNote reason={t.blockedReason} className="ml-2" />}
          </span>
        </button>
        {isTaskFlagged(t) && <FlagBadge />}
        <DueLabel
          dueDate={t.dueDate}
          todayKey={org.todayKey}
          done={t.status === "COMPLETED"}
          className="text-muted-foreground w-24 text-xs"
        />
        <OwnerPicker
          value={t.ownerId}
          onChange={(id) => assign(t, id)}
          disabled={!triage}
          compact
        />
        <QuickPriority task={t} disabled={!triage} />
        <QuickStatus task={t} disabled={!editable} />
      </li>
    );
  };

  return (
    <div className="space-y-5">
      {confirmElement}
      <div className="flex flex-wrap items-center gap-3">
        {intakeProjects.length > 1 && (
          <Select
            value={project.id}
            onValueChange={(v) => router.push(`${pathname}?view=intake&project=${v}`)}
          >
            <SelectTrigger className="w-56" aria-label="Queue">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {intakeProjects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          <span className="text-foreground font-medium">{project.name}</span>: anyone files a
          request
          {project.defaultDueInDays
            ? `, due in ${project.defaultDueInDays} days by default`
            : ""}. {triage ? "You" : triageName} {triage ? "set" : "sets"} priority and owner.
        </p>
        {viewer.isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-4" /> Queue settings
          </Button>
        )}
        <Button size="sm" onClick={() => newTask({ projectId: project.id })}>
          <Plus className="size-4" /> New request
        </Button>
      </div>

      <Section
        title="Needs triage"
        tasks={untriaged}
        render={row}
        empty="Every request has an owner."
      />
      <Section title="In progress" tasks={active} render={row} empty="No requests in progress." />
      {done.length > 0 && (
        <Section title="Done in the last 14 days" tasks={done} render={row} empty="" />
      )}

      {viewer.isAdmin && (
        <QueueSettings open={settingsOpen} onOpenChange={setSettingsOpen} project={project} />
      )}
    </div>
  );
}

function Section({
  title,
  tasks,
  render,
  empty,
}: {
  title: string;
  tasks: TaskItem[];
  render: (t: TaskItem) => React.ReactNode;
  empty: string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold">
        {title} <span className="text-muted-foreground font-normal">({tasks.length})</span>
      </h2>
      {tasks.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">{empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border">{tasks.map(render)}</ul>
      )}
    </section>
  );
}

/** OWNER/ADMIN: turn a project into an intake queue, with its triage owner and default due window. */
function QueueSettings({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectOption | null;
}) {
  const { org, projects, announce } = useTasks();
  const [projectId, setProjectId] = useState(
    project?.id ?? projects.find((p) => !p.isIntake)?.id ?? "",
  );
  const selected = projects.find((p) => p.id === projectId);
  const [isIntake, setIsIntake] = useState(selected?.isIntake ?? true);
  const [triageUserId, setTriageUserId] = useState<string | null>(selected?.triageUserId ?? null);
  const [days, setDays] = useState(String(selected?.defaultDueInDays ?? 5));
  const [isPending, startTransition] = useTransition();

  function pick(id: string) {
    const p = projects.find((x) => x.id === id);
    setProjectId(id);
    setIsIntake(p?.isIntake || !project);
    setTriageUserId(p?.triageUserId ?? null);
    setDays(String(p?.defaultDueInDays ?? 5));
  }

  function save() {
    const n = Number.parseInt(days, 10);
    startTransition(async () => {
      const result = await setProjectIntake(org.id, {
        projectId,
        isIntake,
        triageUserId,
        defaultDueInDays: Number.isFinite(n) && n > 0 ? n : null,
      });
      if (result.error) {
        announce(result.error);
        return;
      }
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Intake queue settings</DialogTitle>
          <DialogDescription>
            Requests in an intake queue are triaged by one owner, who sets their priority and owner.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={pick}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {projects.length === 0 && (
              <p className="text-muted-foreground text-xs">
                Create a project first with New project.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="intake-switch">Use as an intake queue</Label>
            <Switch id="intake-switch" checked={isIntake} onCheckedChange={setIsIntake} />
          </div>
          {isIntake && (
            <>
              <div className="grid gap-1.5">
                <Label>Triage owner</Label>
                <OwnerPicker value={triageUserId} onChange={setTriageUserId} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="intake-days">Default due in (days)</Label>
                <Input
                  id="intake-days"
                  type="number"
                  min={1}
                  max={60}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="w-28"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending || !projectId}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
