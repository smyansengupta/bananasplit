"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { STATUS_LABELS } from "@/components/tasks/status-select";
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
import { TaskStatus } from "@/generated/prisma/enums";

/**
 * Table filters, all in the URL (?q, status incl. "open", owner, assignee,
 * label, dueFrom/dueTo, flagged, blockers). "Blockers" is the exec-sync
 * agenda: blocked plus overdue across the org. Changing a filter resets the page.
 */
export function TaskTableFilters() {
  const { members, labels } = useTasks();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  const blockers = searchParams.get("blockers") === "1";
  const flagged = searchParams.get("flagged") === "1";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search tasks…"
        aria-label="Search tasks"
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          if (searchTimer.current) clearTimeout(searchTimer.current);
          searchTimer.current = setTimeout(() => setParam("q", value || null), 250);
        }}
        className="w-56"
      />
      <Select value={searchParams.get("status") ?? "all"} onValueChange={(v) => setParam("status", v)}>
        <SelectTrigger className="w-40" aria-label="Status filter">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          {Object.values(TaskStatus).map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("owner") ?? "all"} onValueChange={(v) => setParam("owner", v)}>
        <SelectTrigger className="w-44" aria-label="Owner filter">
          <SelectValue placeholder="Owner" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any owner</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name ?? "Member"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("assignee") ?? "all"} onValueChange={(v) => setParam("assignee", v)}>
        <SelectTrigger className="w-44" aria-label="Involving filter">
          <SelectValue placeholder="Involving" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Involving anyone</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name ?? "Member"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("label") ?? "all"} onValueChange={(v) => setParam("label", v)}>
        <SelectTrigger className="w-36" aria-label="Label filter">
          <SelectValue placeholder="Label" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any label</SelectItem>
          {labels.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1">
        <Input
          type="date"
          aria-label="Due after"
          defaultValue={searchParams.get("dueFrom") ?? ""}
          onChange={(e) => setParam("dueFrom", e.target.value || null)}
          className="w-36"
        />
        <span className="text-muted-foreground text-sm">–</span>
        <Input
          type="date"
          aria-label="Due before"
          defaultValue={searchParams.get("dueTo") ?? ""}
          onChange={(e) => setParam("dueTo", e.target.value || null)}
          className="w-36"
        />
      </div>
      <Button
        size="sm"
        variant={blockers ? "default" : "outline"}
        aria-pressed={blockers}
        onClick={() => setParam("blockers", blockers ? null : "1")}
      >
        Blockers
      </Button>
      <Button
        size="sm"
        variant={flagged ? "default" : "outline"}
        aria-pressed={flagged}
        onClick={() => setParam("flagged", flagged ? null : "1")}
      >
        Flagged
      </Button>
    </div>
  );
}
