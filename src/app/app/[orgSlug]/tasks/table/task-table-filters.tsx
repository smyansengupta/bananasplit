"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_LABELS } from "@/components/tasks/status-select";
import { TaskStatus } from "@/generated/prisma/enums";

export function TaskTableFilters({
  members,
  labels,
}: {
  members: { userId: string; name: string | null; email: string }[];
  labels: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search tasks…"
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => setParam("q", e.target.value || null)}
        className="w-56"
      />
      <Select
        value={searchParams.get("status") ?? "all"}
        onValueChange={(v) => setParam("status", v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {Object.values(TaskStatus).map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={searchParams.get("assignee") ?? "all"}
        onValueChange={(v) => setParam("assignee", v)}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Anyone</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              {m.name ?? m.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={searchParams.get("label") ?? "all"}
        onValueChange={(v) => setParam("label", v)}
      >
        <SelectTrigger className="w-36">
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
    </div>
  );
}
