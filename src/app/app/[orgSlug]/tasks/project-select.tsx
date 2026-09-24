"use client";

import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { useTasks } from "@/components/tasks/tasks-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { archiveProject, createProject } from "./projects-actions";

/** The project filter (?project=), plus creating and archiving projects. */
export function ProjectSelect() {
  const { org, projects, announce } = useTasks();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentProject = searchParams.get("project") ?? "all";
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  function setProject(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("project");
    else params.set("project", value);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleCreate() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const result = await createProject(org.id, { name: newName.trim() });
      if (result.error || !result.projectId) {
        announce(result.error ?? "Couldn't create the project.");
        return;
      }
      setNewName("");
      setCreating(false);
      setProject(result.projectId);
    });
  }

  function handleArchive() {
    if (currentProject === "all") return;
    startTransition(async () => {
      await archiveProject(org.id, currentProject);
      setProject("all");
    });
  }

  if (creating) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          aria-label="Project name"
          placeholder="Project name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          className="h-9 w-40"
        />
        <Button size="sm" onClick={handleCreate} disabled={isPending}>
          Create
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={currentProject} onValueChange={setProject}>
        <SelectTrigger className="w-48" aria-label="Project">
          <SelectValue placeholder="All projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
        New project
      </Button>
      {currentProject !== "all" && (
        <Button size="sm" variant="ghost" disabled={isPending} onClick={handleArchive}>
          Archive
        </Button>
      )}
    </div>
  );
}

/** "New task" (in the current project, if one is selected). */
export function NewTaskButton() {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const projectId = searchParams.get("project");
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New task
      </Button>
      <TaskDetailDialog open={open} onOpenChange={setOpen} task={null} defaults={{ projectId }} />
    </>
  );
}
