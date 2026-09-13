"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

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

export function ProjectSelect({
  orgId,
  projects,
}: {
  orgId: string;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentProject = searchParams.get("project") ?? "all";
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  function setProject(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("project");
    } else {
      params.set("project", value);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleCreate() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const result = await createProject(orgId, { name: newName.trim() });
      if (result?.projectId) {
        setNewName("");
        setCreating(false);
        setProject(result.projectId);
        router.refresh();
      }
    });
  }

  function handleArchive() {
    if (currentProject === "all") return;
    startTransition(async () => {
      await archiveProject(orgId, currentProject);
      setProject("all");
      router.refresh();
    });
  }

  if (creating) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
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
        <SelectTrigger className="w-48">
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
