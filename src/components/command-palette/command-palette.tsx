"use client";

import { CheckSquare, NotebookText, Pin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { searchWorkspace } from "@/app/app/[orgSlug]/search/actions";
import { usePins } from "@/components/pins/pins-context";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface NoteResult {
  id: string;
  title: string;
  visibility: "PRIVATE" | "ORGANIZATION";
}

interface TaskResult {
  id: string;
  title: string;
  status: string;
}

export function CommandPalette({
  orgId,
  orgSlug,
  open,
  onOpenChange,
}: {
  orgId: string;
  orgSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pins = usePins();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteResult[]>([]);
  const [tasks, setTasks] = useState<TaskResult[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      startTransition(() => {
        setNotes([]);
        setTasks([]);
      });
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await searchWorkspace(orgId, trimmed);
        setNotes(result.notes);
        setTasks(result.tasks);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query, orgId, open]);

  function goTo(path: string) {
    onOpenChange(false);
    setQuery("");
    router.push(path);
  }

  const trimmedQuery = query.trim();
  const hasResults = notes.length > 0 || tasks.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search notes and tasks in this organization"
    >
      {/* shouldFilter=false: results are already filtered server-side by searchWorkspace */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search notes and tasks…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {pins && (!trimmedQuery || "pin something".includes(trimmedQuery.toLowerCase())) && (
            <CommandGroup heading="Actions">
              <CommandItem
                value="action-pin"
                onSelect={() => {
                  onOpenChange(false);
                  setQuery("");
                  pins.openPicker();
                }}
              >
                <Pin className="size-4" aria-hidden="true" />
                Pin something…
              </CommandItem>
            </CommandGroup>
          )}
          {trimmedQuery && !isPending && !hasResults && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}
          {notes.length > 0 && (
            <CommandGroup heading="Notes">
              {notes.map((note) => (
                <CommandItem
                  key={note.id}
                  value={`note-${note.id}`}
                  onSelect={() => goTo(`/app/${orgSlug}/notes/${note.id}`)}
                >
                  <NotebookText className="size-4" aria-hidden="true" />
                  {note.title || "Untitled note"}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {tasks.length > 0 && (
            <CommandGroup heading="Tasks">
              {tasks.map((task) => (
                <CommandItem
                  key={task.id}
                  value={`task-${task.id}`}
                  onSelect={() =>
                    goTo(`/app/${orgSlug}/tasks?view=table&q=${encodeURIComponent(task.title)}`)
                  }
                >
                  <CheckSquare className="size-4" aria-hidden="true" />
                  {task.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
